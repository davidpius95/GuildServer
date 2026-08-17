import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { domainRouter } from '../../src/routers/domain';
import { db, testUtils } from '../setup';
import { eq } from 'drizzle-orm';
import { domains } from '@guildserver/database';
import * as domainVerifier from '../../src/services/domain-verifier';

jest.mock('../../src/services/domain-verifier');

const mockedVerifier = jest.mocked(domainVerifier);

const createTestContext = (user?: any) => ({
  db,
  user,
});

describe('DomainRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('add', () => {
    it('should add a custom domain and store redirectsTo', async () => {
      const { user, app } = await testUtils.createTestSetup();
      const caller = domainRouter.createCaller(createTestContext(user));

      const result = await caller.add({
        applicationId: app.id,
        domain: 'custom.example.com',
      });

      expect(result.domain).toBe('custom.example.com');
      expect(result.redirectsTo).toBeDefined();
      expect(result.redirectsTo).toContain('.guildserver.localhost');
      expect(result.forwardingInstructions).toBeDefined();
      expect(result.forwardingInstructions.registrars).toBeInstanceOf(Array);
      
      // Verify in DB
      const dbDomains = await db.select().from(domains).where(eq(domains.id, result.id));
      expect(dbDomains).toHaveLength(1);
      expect(dbDomains[0].redirectsTo).toBe(result.redirectsTo);
      expect(dbDomains[0].verificationMethod).toBe('redirect');
    });

    it('should deny access to users from other organizations', async () => {
      const { app } = await testUtils.createTestSetup();
      const otherUser = await testUtils.createUser();
      const caller = domainRouter.createCaller(createTestContext(otherUser));

      await expect(caller.add({
        applicationId: app.id,
        domain: 'custom.example.com',
      })).rejects.toThrow('Application not found or access denied');
    });
  });

  describe('verify', () => {
    it('should persist real status from verifier', async () => {
      const { user, app } = await testUtils.createTestSetup();
      const caller = domainRouter.createCaller(createTestContext(user));

      const domain = await caller.add({
        applicationId: app.id,
        domain: 'custom.example.com',
      });

      mockedVerifier.verifyRedirect.mockResolvedValueOnce({
        status: 'active',
        finalUrl: 'https://' + domain.redirectsTo,
        httpStatus: 301,
      });

      const verifyResult = await caller.verify({
        id: domain.id,
        applicationId: app.id,
      });

      expect(verifyResult.verified).toBe(true);
      expect(verifyResult.domain.status).toBe('active');
      expect(verifyResult.domain.lastCheckedAt).toBeDefined();
      expect(verifyResult.domain.lastHttpStatus).toBe(301);
      expect(verifyResult.domain.verificationError).toBeNull();
    });

    it('should handle verification failure', async () => {
      const { user, app } = await testUtils.createTestSetup();
      const caller = domainRouter.createCaller(createTestContext(user));

      const domain = await caller.add({
        applicationId: app.id,
        domain: 'custom.example.com',
      });

      mockedVerifier.verifyRedirect.mockResolvedValueOnce({
        status: 'failed',
        reason: 'timeout',
        httpStatus: undefined,
      });

      const verifyResult = await caller.verify({
        id: domain.id,
        applicationId: app.id,
      });

      expect(verifyResult.verified).toBe(false);
      expect(verifyResult.domain.status).toBe('failed');
      expect(verifyResult.domain.verificationError).toBe('timeout');
    });
  });

  describe('getCertificateStatus', () => {
    it('should return not_applicable for redirect domains', async () => {
      const { user, app } = await testUtils.createTestSetup();
      const caller = domainRouter.createCaller(createTestContext(user));

      await caller.add({
        applicationId: app.id,
        domain: 'custom.example.com',
      });

      const statusList = await caller.getCertificateStatus({ applicationId: app.id });
      
      const customDomainStatus = statusList.find(s => s.domain === 'custom.example.com');
      expect(customDomainStatus).toBeDefined();
      expect(customDomainStatus?.sslStatus).toBe('not_applicable');
      expect(customDomainStatus?.sslMessage).toContain('TLS is handled by your registrar');
    });
  });
  
  describe('getInstructions', () => {
    it('should return forwarding instructions for redirect domains', async () => {
      const { user, app } = await testUtils.createTestSetup();
      const caller = domainRouter.createCaller(createTestContext(user));

      const domain = await caller.add({
        applicationId: app.id,
        domain: 'custom.example.com',
      });

      const instructions = await caller.getInstructions({
        id: domain.id,
        applicationId: app.id,
      });
      
      expect(instructions).toBeDefined();
      expect(instructions.isWildcard).toBe(false);
      expect(instructions.registrars.length).toBeGreaterThan(0);
    });
  });
});
