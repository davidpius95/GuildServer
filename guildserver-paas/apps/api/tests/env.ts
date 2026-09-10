/**
 * Jest `setupFiles` entry: populate the environment before any module loads.
 *
 * `@guildserver/database` reads DATABASE_URL at import time and throws if it is
 * missing, so this has to run in the setupFiles phase rather than in
 * setup.ts (setupFilesAfterEnv), which is already too late.
 */
import { resolveTestDatabaseUrl } from "./test-database-url";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-for-testing-only";

const testDbUrl = resolveTestDatabaseUrl();
process.env.TEST_DATABASE_URL = testDbUrl;
process.env.DATABASE_URL = testDbUrl;
process.env.REDIS_URL = process.env.TEST_REDIS_URL || "redis://localhost:6380/0";
