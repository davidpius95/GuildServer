import { describe, it, expect, beforeEach } from '@jest/globals';
import { createTRPCMsw } from 'msw-trpc';
import { authRouter } from '../../src/routers/auth';
import { db, testUtils } from '../setup';
import { TRPCError } from '@trpc/server';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

// Create tRPC client for testing
const createTestContext = (user?: any) => ({
  db,
  user,
});

describe('AuthRouter', () => {
  beforeEach(async () => {
    // Clear users table before each test
    await db.delete(db.select().from('users'));
  });

  describe('register', () => {
    it('should register a new user successfully', async () => {
      const caller = authRouter.createCaller(createTestContext());

      const input = {
        name: 'John Doe',
        email: 'john@example.com',
        password: 'password123',
      };

      const result = await caller.register(input);

      expect(result).toMatchObject({
        user: {
          name: 'John Doe',
          email: 'john@example.com',
        },
        token: expect.any(String),
      });

      // Verify JWT token
      const decoded = jwt.verify(result.token, process.env.JWT_SECRET!) as any;
      expect(decoded.userId).toBe(result.user.id);
      expect(decoded.email).toBe('john@example.com');

      // Verify user exists in database
      const user = await testUtils.createUser(); // This will find the existing user
      expect(user.email).toBe('john@example.com');
    });

    it('should hash password correctly', async () => {
      const caller = authRouter.createCaller(createTestContext());

      const input = {
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: 'mypassword',
      };

      await caller.register(input);

      // Find user in database and check password hash
      const users = await db.select().from('users').where(eq('email', input.email));
      const user = users[0];

      expect(user.passwordHash).not.toBe(input.password);
      expect(user.passwordHash).toMatch(/^\$2[aby]\$\d+\$.{53}$/); // bcrypt pattern

      // Verify password can be compared
      const isValid = await bcrypt.compare(input.password, user.passwordHash);
      expect(isValid).toBe(true);
    });

    it('should prevent duplicate email registration', async () => {
      const caller = authRouter.createCaller(createTestContext());

      const input = {
        name: 'User One',
        email: 'duplicate@example.com',
        password: 'password123',
      };

      // First registration should succeed
      await caller.register(input);

      // Second registration with same email should fail
      await expect(caller.register({
        ...input,
        name: 'User Two',
      })).rejects.toThrow('Email already exists');
    });

    it('should validate input format', async () => {
      const caller = authRouter.createCaller(createTestContext());

      // Invalid email
      await expect(caller.register({
        name: 'Test User',
        email: 'invalid-email',
        password: 'password123',
      })).rejects.toThrow();

      // Short password
      await expect(caller.register({
        name: 'Test User',
        email: 'test@example.com',
        password: 'short',
      })).rejects.toThrow();

      // Empty name
      await expect(caller.register({
        name: '',
        email: 'test@example.com',
        password: 'password123',
      })).rejects.toThrow();
    });
  });

  describe('login', () => {
    it('should login with valid credentials', async () => {
      const caller = authRouter.createCaller(createTestContext());

      // First register a user
      const registerInput = {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      };
      await caller.register(registerInput);

      // Then login
      const loginResult = await caller.login({
        email: registerInput.email,
        password: registerInput.password,
      });

      expect(loginResult).toMatchObject({
        user: {
          email: 'test@example.com',
          name: 'Test User',
        },
        token: expect.any(String),
      });

      // Verify JWT token
      const decoded = jwt.verify(loginResult.token, process.env.JWT_SECRET!) as any;
      expect(decoded.email).toBe('test@example.com');
    });

    it('should reject invalid email', async () => {
      const caller = authRouter.createCaller(createTestContext());

      await expect(caller.login({
        email: 'nonexistent@example.com',
        password: 'password123',
      })).rejects.toThrow('Invalid credentials');
    });

    it('should reject invalid password', async () => {
      const caller = authRouter.createCaller(createTestContext());

      // Register user
      await caller.register({
        name: 'Test User',
        email: 'test@example.com',
        password: 'correctpassword',
      });

      // Try login with wrong password
      await expect(caller.login({
        email: 'test@example.com',
        password: 'wrongpassword',
      })).rejects.toThrow('Invalid credentials');
    });

    it('should update last login timestamp', async () => {
      const caller = authRouter.createCaller(createTestContext());

      await caller.register({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      });

      const beforeLogin = new Date();
      await caller.login({
        email: 'test@example.com',
        password: 'password123',
      });

      const users = await db.select().from('users').where(eq('email', 'test@example.com'));
      const user = users[0];

      expect(user.lastLoginAt).toBeDefined();
      expect(user.lastLoginAt!.getTime()).toBeGreaterThanOrEqual(beforeLogin.getTime());
    });
  });

  describe('getProfile', () => {
    it('should return user profile for authenticated user', async () => {
      const user = await testUtils.createUser({
        name: 'Profile User',
        email: 'profile@example.com',
      });

      const caller = authRouter.createCaller(createTestContext(user));
      const profile = await caller.getProfile();

      expect(profile).toMatchObject({
        id: user.id,
        name: 'Profile User',
        email: 'profile@example.com',
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });

      // Should not include password hash
      expect(profile).not.toHaveProperty('passwordHash');
    });

    it('should require authentication', async () => {
      const caller = authRouter.createCaller(createTestContext()); // No user

      await expect(caller.getProfile()).rejects.toThrow('UNAUTHORIZED');
    });
  });

  describe('updateProfile', () => {
    it('should update user profile', async () => {
      const user = await testUtils.createUser({
        name: 'Old Name',
        email: 'old@example.com',
      });

      const caller = authRouter.createCaller(createTestContext(user));

      const updated = await caller.updateProfile({
        name: 'New Name',
        email: 'new@example.com',
      });

      expect(updated).toMatchObject({
        id: user.id,
        name: 'New Name',
        email: 'new@example.com',
      });

      // Verify in database
      const users = await db.select().from('users').where(eq('id', user.id));
      const dbUser = users[0];
      expect(dbUser.name).toBe('New Name');
      expect(dbUser.email).toBe('new@example.com');
    });

    it('should prevent email conflicts', async () => {
      const user1 = await testUtils.createUser({ email: 'user1@example.com' });
      const user2 = await testUtils.createUser({ email: 'user2@example.com' });

      const caller = authRouter.createCaller(createTestContext(user2));

      await expect(caller.updateProfile({
        email: 'user1@example.com', // Already taken
      })).rejects.toThrow('Email already exists');
    });

    it('should require authentication', async () => {
      const caller = authRouter.createCaller(createTestContext());

      await expect(caller.updateProfile({
        name: 'New Name',
      })).rejects.toThrow('UNAUTHORIZED');
    });
  });

  describe('changePassword', () => {
    it('should change password with valid current password', async () => {
      const caller = authRouter.createCaller(createTestContext());

      // Register user
      await caller.register({
        name: 'Password User',
        email: 'password@example.com',
        password: 'oldpassword',
      });

      // Get user to create authenticated context
      const users = await db.select().from('users').where(eq('email', 'password@example.com'));
      const user = users[0];
      const authenticatedCaller = authRouter.createCaller(createTestContext(user));

      // Change password
      await authenticatedCaller.changePassword({
        currentPassword: 'oldpassword',
        newPassword: 'newpassword123',
      });

      // Verify new password works for login
      const loginResult = await caller.login({
        email: 'password@example.com',
        password: 'newpassword123',
      });

      expect(loginResult.user.email).toBe('password@example.com');
    });

    it('should reject incorrect current password', async () => {
      const user = await testUtils.createUser();
      const caller = authRouter.createCaller(createTestContext(user));

      await expect(caller.changePassword({
        currentPassword: 'wrongpassword',
        newPassword: 'newpassword123',
      })).rejects.toThrow('Current password is incorrect');
    });

    it('should validate new password format', async () => {
      const user = await testUtils.createUser();
      const caller = authRouter.createCaller(createTestContext(user));

      await expect(caller.changePassword({
        currentPassword: 'correctpassword',
        newPassword: 'short',
      })).rejects.toThrow(); // Too short
    });
  });

  describe('JWT token handling', () => {
    it('should generate valid JWT tokens', async () => {
      const caller = authRouter.createCaller(createTestContext());

      const result = await caller.register({
        name: 'JWT User',
        email: 'jwt@example.com',
        password: 'password123',
      });

      const decoded = jwt.verify(result.token, process.env.JWT_SECRET!) as any;

      expect(decoded).toMatchObject({
        userId: result.user.id,
        email: 'jwt@example.com',
        iat: expect.any(Number),
        exp: expect.any(Number),
      });

      // Token should expire in 24 hours
      const expirationTime = decoded.exp - decoded.iat;
      expect(expirationTime).toBe(24 * 60 * 60); // 24 hours in seconds
    });
  });
});