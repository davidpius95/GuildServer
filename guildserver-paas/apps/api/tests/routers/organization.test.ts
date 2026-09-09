import { describe, it, expect } from '@jest/globals';
import { organizationRouter } from '../../src/routers/organization';
import { db, testUtils } from '../setup';
import { members, organizations } from '@guildserver/database';
import { eq, and } from 'drizzle-orm';

// Mimics the shape produced by createContext() in src/trpc/context.ts
const createTestContext = (user?: any) => ({
  db,
  req: {} as any,
  res: {} as any,
  user: user ?? null,
  isAuthenticated: !!user,
  isAdmin: user?.role === 'admin',
});

describe('OrganizationRouter', () => {
  describe('create', () => {
    it('should create new organization and add creator as owner', async () => {
      const user = await testUtils.createUser();
      const caller = organizationRouter.createCaller(createTestContext(user));

      const result = await caller.create({
        name: 'Test Organization',
        slug: 'test-organization',
        description: 'A test organization',
      });

      expect(result).toMatchObject({
        name: 'Test Organization',
        slug: 'test-organization',
        description: 'A test organization',
      });

      // Verify user is added as owner
      const memberRows = await db.select().from(members)
        .where(and(
          eq(members.organizationId, result.id),
          eq(members.userId, user.id)
        ));

      expect(memberRows).toHaveLength(1);
      expect(memberRows[0].role).toBe('owner');
    });

    it('should reject a slug that is already taken', async () => {
      const user = await testUtils.createUser();
      const caller = organizationRouter.createCaller(createTestContext(user));

      await caller.create({
        name: 'Same Slug Org',
        slug: 'same-slug',
      });

      await expect(caller.create({
        name: 'Another Org',
        slug: 'same-slug',
      })).rejects.toThrow('Organization slug is already taken');
    });

    it('should require authentication', async () => {
      const caller = organizationRouter.createCaller(createTestContext());

      await expect(caller.create({
        name: 'Test Org',
        slug: 'test-org',
      })).rejects.toThrow('UNAUTHORIZED');
    });

    it('should validate input', async () => {
      const user = await testUtils.createUser();
      const caller = organizationRouter.createCaller(createTestContext(user));

      await expect(caller.create({
        name: '',
        slug: 'valid-slug',
      })).rejects.toThrow();

      await expect(caller.create({
        name: 'Valid Name',
        slug: 'Not A Valid Slug!',
      })).rejects.toThrow();
    });
  });

  describe('list', () => {
    it('should list organizations user is member of', async () => {
      const user = await testUtils.createUser();
      const owner = await testUtils.createUser();
      const org1 = await testUtils.createOrganization(owner.id, { name: 'Org 1' });
      const org2 = await testUtils.createOrganization(owner.id, { name: 'Org 2' });
      await testUtils.createOrganization(owner.id, { name: 'Org 3' }); // user is not a member

      // Add user to org1 and org2, but not org3
      await testUtils.createMember(user.id, org1.id, 'owner');
      await testUtils.createMember(user.id, org2.id, 'member');

      const caller = organizationRouter.createCaller(createTestContext(user));
      const orgs = await caller.list();

      expect(orgs).toHaveLength(2);

      const orgNames = orgs.map((org) => org.name).sort();
      expect(orgNames).toEqual(['Org 1', 'Org 2']);

      // Check member role is included
      const org1Result = orgs.find((org) => org.name === 'Org 1');
      expect(org1Result?.role).toBe('owner');
    });

    it('should return empty array for user with no organizations', async () => {
      const user = await testUtils.createUser();
      const caller = organizationRouter.createCaller(createTestContext(user));

      const orgs = await caller.list();
      expect(orgs).toHaveLength(0);
    });

    it('should require authentication', async () => {
      const caller = organizationRouter.createCaller(createTestContext());

      await expect(caller.list()).rejects.toThrow('UNAUTHORIZED');
    });
  });

  describe('getById', () => {
    it('should return organization details for member', async () => {
      const { user, org } = await testUtils.createTestSetup();
      const caller = organizationRouter.createCaller(createTestContext(user));

      const result = await caller.getById({ id: org.id });

      expect(result).toMatchObject({
        id: org.id,
        name: org.name,
        slug: org.slug,
        userRole: 'owner',
      });
    });

    it('should deny access to non-members', async () => {
      const owner = await testUtils.createUser();
      const user = await testUtils.createUser();
      const org = await testUtils.createOrganization(owner.id);
      const caller = organizationRouter.createCaller(createTestContext(user));

      await expect(caller.getById({ id: org.id }))
        .rejects.toThrow("You don't have access to this organization");
    });

    it('should require authentication', async () => {
      const caller = organizationRouter.createCaller(createTestContext());

      await expect(caller.getById({ id: '00000000-0000-0000-0000-000000000000' }))
        .rejects.toThrow('UNAUTHORIZED');
    });
  });

  describe('update', () => {
    it('should update organization for owner/admin', async () => {
      const { user, org } = await testUtils.createTestSetup();
      const caller = organizationRouter.createCaller(createTestContext(user));

      const updated = await caller.update({
        id: org.id,
        name: 'Updated Organization',
        description: 'Updated description',
      });

      expect(updated).toMatchObject({
        id: org.id,
        name: 'Updated Organization',
        description: 'Updated description',
      });
    });

    it('should deny update for non-admin members', async () => {
      const owner = await testUtils.createUser();
      const user = await testUtils.createUser();
      const org = await testUtils.createOrganization(owner.id);
      await testUtils.createMember(user.id, org.id, 'member'); // Not admin/owner

      const caller = organizationRouter.createCaller(createTestContext(user));

      await expect(caller.update({
        id: org.id,
        name: 'Updated Name',
      })).rejects.toThrow("You don't have permission to update this organization");
    });
  });

  describe('delete', () => {
    it('should delete organization for owner', async () => {
      const { user, org } = await testUtils.createTestSetup();
      const caller = organizationRouter.createCaller(createTestContext(user));

      const result = await caller.delete({ id: org.id });
      expect(result.success).toBe(true);

      // Verify organization is deleted
      const orgRows = await db.select().from(organizations)
        .where(eq(organizations.id, org.id));
      expect(orgRows).toHaveLength(0);
    });

    it('should deny deletion for non-owners', async () => {
      const owner = await testUtils.createUser();
      const user = await testUtils.createUser();
      const org = await testUtils.createOrganization(owner.id);
      await testUtils.createMember(user.id, org.id, 'admin'); // Admin, not owner

      const caller = organizationRouter.createCaller(createTestContext(user));

      await expect(caller.delete({ id: org.id }))
        .rejects.toThrow('Only the owner can delete this organization');
    });
  });

  describe('member management', () => {
    describe('inviteMember', () => {
      it('should add an existing user as a member by email', async () => {
        const { user, org } = await testUtils.createTestSetup();
        const invitee = await testUtils.createUser({ email: 'newmember@example.com' });
        const caller = organizationRouter.createCaller(createTestContext(user));

        const newMember = await caller.inviteMember({
          organizationId: org.id,
          email: 'newmember@example.com',
          role: 'member',
        });

        expect(newMember).toMatchObject({
          userId: invitee.id,
          organizationId: org.id,
          role: 'member',
        });
      });

      it('should error when no account exists for the email', async () => {
        const { user, org } = await testUtils.createTestSetup();
        const caller = organizationRouter.createCaller(createTestContext(user));

        await expect(caller.inviteMember({
          organizationId: org.id,
          email: 'nobody@example.com',
          role: 'member',
        })).rejects.toThrow('No GuildServer account exists for this email yet');
      });

      it('should prevent inviting existing members', async () => {
        const { user, org } = await testUtils.createTestSetup();
        const existingUser = await testUtils.createUser({ email: 'existing@example.com' });
        await testUtils.createMember(existingUser.id, org.id, 'member');

        const caller = organizationRouter.createCaller(createTestContext(user));

        await expect(caller.inviteMember({
          organizationId: org.id,
          email: 'existing@example.com',
          role: 'admin',
        })).rejects.toThrow('User is already a member of this organization');
      });

      it('should require admin permissions', async () => {
        const owner = await testUtils.createUser();
        const user = await testUtils.createUser();
        const org = await testUtils.createOrganization(owner.id);
        await testUtils.createMember(user.id, org.id, 'member'); // Not admin/owner
        await testUtils.createUser({ email: 'target@example.com' });

        const caller = organizationRouter.createCaller(createTestContext(user));

        await expect(caller.inviteMember({
          organizationId: org.id,
          email: 'target@example.com',
          role: 'member',
        })).rejects.toThrow("You don't have permission to invite members");
      });
    });

    describe('getMembers', () => {
      it('should list all organization members', async () => {
        const { user, org } = await testUtils.createTestSetup();

        // Add additional members
        const user2 = await testUtils.createUser({ email: 'user2@example.com' });
        const user3 = await testUtils.createUser({ email: 'user3@example.com' });
        await testUtils.createMember(user2.id, org.id, 'admin');
        await testUtils.createMember(user3.id, org.id, 'member');

        const caller = organizationRouter.createCaller(createTestContext(user));
        const orgMembers = await caller.getMembers({ organizationId: org.id });

        expect(orgMembers).toHaveLength(3);

        const roles = orgMembers.map((m) => m.role).sort();
        expect(roles).toEqual(['admin', 'member', 'owner']);

        // Check user info is included, password hash excluded
        orgMembers.forEach((member) => {
          expect(member.user).toMatchObject({
            id: expect.any(String),
            name: expect.any(String),
            email: expect.any(String),
          });
          expect(member.user).not.toHaveProperty('passwordHash');
        });
      });

      it('should require membership to view members', async () => {
        const owner = await testUtils.createUser();
        const user = await testUtils.createUser();
        const org = await testUtils.createOrganization(owner.id);
        const caller = organizationRouter.createCaller(createTestContext(user));

        await expect(caller.getMembers({ organizationId: org.id }))
          .rejects.toThrow("You don't have access to this organization");
      });
    });

    describe('updateMember', () => {
      it('should update member role for admin', async () => {
        const { user, org } = await testUtils.createTestSetup();
        const member = await testUtils.createUser({ email: 'member@example.com' });
        await testUtils.createMember(member.id, org.id, 'member');

        const caller = organizationRouter.createCaller(createTestContext(user));

        const updated = await caller.updateMember({
          organizationId: org.id,
          userId: member.id,
          role: 'admin',
        });

        expect(updated.role).toBe('admin');

        // Verify in database
        const memberRows = await db.select().from(members)
          .where(and(
            eq(members.organizationId, org.id),
            eq(members.userId, member.id)
          ));
        expect(memberRows[0].role).toBe('admin');
      });

      it('should prevent role changes by non-admins', async () => {
        const owner = await testUtils.createUser();
        const user = await testUtils.createUser();
        const org = await testUtils.createOrganization(owner.id);
        const member = await testUtils.createUser();

        await testUtils.createMember(user.id, org.id, 'member');
        await testUtils.createMember(member.id, org.id, 'member');

        const caller = organizationRouter.createCaller(createTestContext(user));

        await expect(caller.updateMember({
          organizationId: org.id,
          userId: member.id,
          role: 'admin',
        })).rejects.toThrow("You don't have permission to update members");
      });
    });

    describe('removeMember', () => {
      it('should remove member for admin', async () => {
        const { user, org } = await testUtils.createTestSetup();
        const member = await testUtils.createUser();
        await testUtils.createMember(member.id, org.id, 'member');

        const caller = organizationRouter.createCaller(createTestContext(user));

        const result = await caller.removeMember({
          organizationId: org.id,
          userId: member.id,
        });

        expect(result.success).toBe(true);

        // Verify member is removed
        const memberRows = await db.select().from(members)
          .where(and(
            eq(members.organizationId, org.id),
            eq(members.userId, member.id)
          ));
        expect(memberRows).toHaveLength(0);
      });

      it('should prevent removing the organization owner', async () => {
        const { user, org } = await testUtils.createTestSetup();
        const caller = organizationRouter.createCaller(createTestContext(user));

        await expect(caller.removeMember({
          organizationId: org.id,
          userId: user.id, // Removing self as owner
        })).rejects.toThrow('Cannot remove the organization owner');
      });
    });
  });
});
