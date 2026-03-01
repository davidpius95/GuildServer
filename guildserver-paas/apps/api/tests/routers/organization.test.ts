import { describe, it, expect, beforeEach } from '@jest/globals';
import { organizationRouter } from '../../src/routers/organization';
import { db, testUtils } from '../setup';

const createTestContext = (user?: any) => ({
  db,
  user,
});

describe('OrganizationRouter', () => {
  describe('create', () => {
    it('should create new organization and add user as owner', async () => {
      const user = await testUtils.createUser();
      const caller = organizationRouter.createCaller(createTestContext(user));

      const result = await caller.create({
        name: 'Test Organization',
        description: 'A test organization',
      });

      expect(result).toMatchObject({
        name: 'Test Organization',
        description: 'A test organization',
        slug: expect.stringMatching(/^test-organization-\d+$/),
      });

      // Verify user is added as owner
      const members = await db.select().from('members')
        .where(and(
          eq('organizationId', result.id),
          eq('userId', user.id)
        ));

      expect(members).toHaveLength(1);
      expect(members[0].role).toBe('owner');
    });

    it('should generate unique slug', async () => {
      const user = await testUtils.createUser();
      const caller = organizationRouter.createCaller(createTestContext(user));

      const org1 = await caller.create({
        name: 'Same Name',
        description: 'First org',
      });

      const org2 = await caller.create({
        name: 'Same Name',
        description: 'Second org',
      });

      expect(org1.slug).not.toBe(org2.slug);
      expect(org1.slug).toMatch(/^same-name-\d+$/);
      expect(org2.slug).toMatch(/^same-name-\d+$/);
    });

    it('should require authentication', async () => {
      const caller = organizationRouter.createCaller(createTestContext());

      await expect(caller.create({
        name: 'Test Org',
        description: 'Test',
      })).rejects.toThrow('UNAUTHORIZED');
    });

    it('should validate input', async () => {
      const user = await testUtils.createUser();
      const caller = organizationRouter.createCaller(createTestContext(user));

      await expect(caller.create({
        name: '',
        description: 'Test',
      })).rejects.toThrow();

      await expect(caller.create({
        name: 'a', // Too short
        description: 'Test',
      })).rejects.toThrow();
    });
  });

  describe('list', () => {
    it('should list organizations user is member of', async () => {
      const user = await testUtils.createUser();
      const org1 = await testUtils.createOrganization({ name: 'Org 1' });
      const org2 = await testUtils.createOrganization({ name: 'Org 2' });
      const org3 = await testUtils.createOrganization({ name: 'Org 3' });

      // Add user to org1 and org2, but not org3
      await testUtils.createMember(user.id, org1.id, 'owner');
      await testUtils.createMember(user.id, org2.id, 'developer');

      const caller = organizationRouter.createCaller(createTestContext(user));
      const organizations = await caller.list();

      expect(organizations).toHaveLength(2);
      
      const orgNames = organizations.map(org => org.name).sort();
      expect(orgNames).toEqual(['Org 1', 'Org 2']);

      // Check member info is included
      const org1Result = organizations.find(org => org.name === 'Org 1');
      expect(org1Result?.memberRole).toBe('owner');
      expect(org1Result?.memberSince).toBeInstanceOf(Date);
    });

    it('should return empty array for user with no organizations', async () => {
      const user = await testUtils.createUser();
      const caller = organizationRouter.createCaller(createTestContext(user));

      const organizations = await caller.list();
      expect(organizations).toHaveLength(0);
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
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });

      expect(result.memberCount).toBeGreaterThan(0);
      expect(result.projectCount).toBeGreaterThanOrEqual(0);
    });

    it('should deny access to non-members', async () => {
      const user = await testUtils.createUser();
      const org = await testUtils.createOrganization();
      const caller = organizationRouter.createCaller(createTestContext(user));

      await expect(caller.getById({ id: org.id }))
        .rejects.toThrow('Organization not found or access denied');
    });

    it('should return 404 for non-existent organization', async () => {
      const user = await testUtils.createUser();
      const caller = organizationRouter.createCaller(createTestContext(user));

      await expect(caller.getById({ id: 'non-existent-id' }))
        .rejects.toThrow('Organization not found or access denied');
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

      expect(updated.updatedAt.getTime()).toBeGreaterThan(org.updatedAt.getTime());
    });

    it('should deny update for non-admin members', async () => {
      const user = await testUtils.createUser();
      const org = await testUtils.createOrganization();
      await testUtils.createMember(user.id, org.id, 'developer'); // Not admin

      const caller = organizationRouter.createCaller(createTestContext(user));

      await expect(caller.update({
        id: org.id,
        name: 'Updated Name',
      })).rejects.toThrow('Insufficient permissions');
    });

    it('should validate slug uniqueness when updating', async () => {
      const user = await testUtils.createUser();
      const org1 = await testUtils.createOrganization({ slug: 'existing-slug' });
      const org2 = await testUtils.createOrganization();
      
      await testUtils.createMember(user.id, org2.id, 'owner');

      const caller = organizationRouter.createCaller(createTestContext(user));

      await expect(caller.update({
        id: org2.id,
        slug: 'existing-slug',
      })).rejects.toThrow('Slug already exists');
    });
  });

  describe('delete', () => {
    it('should delete organization for owner', async () => {
      const { user, org } = await testUtils.createTestSetup();
      const caller = organizationRouter.createCaller(createTestContext(user));

      const result = await caller.delete({ id: org.id });
      expect(result.success).toBe(true);

      // Verify organization is deleted
      const organizations = await db.select().from('organizations')
        .where(eq('id', org.id));
      expect(organizations).toHaveLength(0);
    });

    it('should deny deletion for non-owners', async () => {
      const user = await testUtils.createUser();
      const org = await testUtils.createOrganization();
      await testUtils.createMember(user.id, org.id, 'admin'); // Admin, not owner

      const caller = organizationRouter.createCaller(createTestContext(user));

      await expect(caller.delete({ id: org.id }))
        .rejects.toThrow('Only organization owners can delete organizations');
    });

    it('should prevent deletion with existing projects', async () => {
      const { user, org, project } = await testUtils.createTestSetup();
      const caller = organizationRouter.createCaller(createTestContext(user));

      await expect(caller.delete({ id: org.id }))
        .rejects.toThrow('Cannot delete organization with existing projects');
    });
  });

  describe('member management', () => {
    describe('inviteMember', () => {
      it('should invite new member with valid email', async () => {
        const { user, org } = await testUtils.createTestSetup();
        const caller = organizationRouter.createCaller(createTestContext(user));

        const invitation = await caller.inviteMember({
          organizationId: org.id,
          email: 'newmember@example.com',
          role: 'developer',
        });

        expect(invitation).toMatchObject({
          email: 'newmember@example.com',
          role: 'developer',
          organizationId: org.id,
          status: 'pending',
          invitedBy: user.id,
        });

        expect(invitation.token).toBeDefined();
        expect(invitation.expiresAt).toBeInstanceOf(Date);
      });

      it('should prevent duplicate invitations', async () => {
        const { user, org } = await testUtils.createTestSetup();
        const caller = organizationRouter.createCaller(createTestContext(user));

        await caller.inviteMember({
          organizationId: org.id,
          email: 'duplicate@example.com',
          role: 'developer',
        });

        await expect(caller.inviteMember({
          organizationId: org.id,
          email: 'duplicate@example.com',
          role: 'admin',
        })).rejects.toThrow('User already invited or is a member');
      });

      it('should prevent inviting existing members', async () => {
        const { user, org } = await testUtils.createTestSetup();
        const existingUser = await testUtils.createUser({ email: 'existing@example.com' });
        await testUtils.createMember(existingUser.id, org.id, 'developer');

        const caller = organizationRouter.createCaller(createTestContext(user));

        await expect(caller.inviteMember({
          organizationId: org.id,
          email: 'existing@example.com',
          role: 'admin',
        })).rejects.toThrow('User already invited or is a member');
      });

      it('should require admin permissions', async () => {
        const user = await testUtils.createUser();
        const org = await testUtils.createOrganization();
        await testUtils.createMember(user.id, org.id, 'developer'); // Not admin

        const caller = organizationRouter.createCaller(createTestContext(user));

        await expect(caller.inviteMember({
          organizationId: org.id,
          email: 'test@example.com',
          role: 'developer',
        })).rejects.toThrow('Insufficient permissions');
      });
    });

    describe('listMembers', () => {
      it('should list all organization members', async () => {
        const { user, org } = await testUtils.createTestSetup();
        
        // Add additional members
        const user2 = await testUtils.createUser({ email: 'user2@example.com' });
        const user3 = await testUtils.createUser({ email: 'user3@example.com' });
        await testUtils.createMember(user2.id, org.id, 'admin');
        await testUtils.createMember(user3.id, org.id, 'developer');

        const caller = organizationRouter.createCaller(createTestContext(user));
        const members = await caller.listMembers({ organizationId: org.id });

        expect(members).toHaveLength(3);
        
        const roles = members.map(m => m.role).sort();
        expect(roles).toEqual(['admin', 'developer', 'owner']);

        // Check user info is included
        members.forEach(member => {
          expect(member.user).toMatchObject({
            id: expect.any(String),
            name: expect.any(String),
            email: expect.any(String),
          });
          expect(member.user).not.toHaveProperty('passwordHash');
        });
      });

      it('should require membership to view members', async () => {
        const user = await testUtils.createUser();
        const org = await testUtils.createOrganization();
        const caller = organizationRouter.createCaller(createTestContext(user));

        await expect(caller.listMembers({ organizationId: org.id }))
          .rejects.toThrow('Organization not found or access denied');
      });
    });

    describe('updateMemberRole', () => {
      it('should update member role for admin', async () => {
        const { user, org } = await testUtils.createTestSetup();
        const member = await testUtils.createUser({ email: 'member@example.com' });
        await testUtils.createMember(member.id, org.id, 'developer');

        const caller = organizationRouter.createCaller(createTestContext(user));

        const updated = await caller.updateMemberRole({
          organizationId: org.id,
          userId: member.id,
          role: 'admin',
        });

        expect(updated.role).toBe('admin');

        // Verify in database
        const members = await db.select().from('members')
          .where(and(
            eq('organizationId', org.id),
            eq('userId', member.id)
          ));
        expect(members[0].role).toBe('admin');
      });

      it('should prevent role changes by non-admins', async () => {
        const user = await testUtils.createUser();
        const org = await testUtils.createOrganization();
        const member = await testUtils.createUser();
        
        await testUtils.createMember(user.id, org.id, 'developer');
        await testUtils.createMember(member.id, org.id, 'developer');

        const caller = organizationRouter.createCaller(createTestContext(user));

        await expect(caller.updateMemberRole({
          organizationId: org.id,
          userId: member.id,
          role: 'admin',
        })).rejects.toThrow('Insufficient permissions');
      });
    });

    describe('removeMember', () => {
      it('should remove member for admin', async () => {
        const { user, org } = await testUtils.createTestSetup();
        const member = await testUtils.createUser();
        await testUtils.createMember(member.id, org.id, 'developer');

        const caller = organizationRouter.createCaller(createTestContext(user));

        const result = await caller.removeMember({
          organizationId: org.id,
          userId: member.id,
        });

        expect(result.success).toBe(true);

        // Verify member is removed
        const members = await db.select().from('members')
          .where(and(
            eq('organizationId', org.id),
            eq('userId', member.id)
          ));
        expect(members).toHaveLength(0);
      });

      it('should prevent removing the last owner', async () => {
        const { user, org } = await testUtils.createTestSetup();
        const caller = organizationRouter.createCaller(createTestContext(user));

        await expect(caller.removeMember({
          organizationId: org.id,
          userId: user.id, // Removing self as last owner
        })).rejects.toThrow('Cannot remove the last owner');
      });
    });
  });
});