/**
 * Off-site backup destinations (S3-compatible) for an organization.
 *
 * Owners and admins manage them; any member can see that they exist. Secrets
 * are encrypted at rest and never returned. A destination is only saved after
 * a successful write/read/delete round trip, so a typo in a bucket name fails
 * here rather than silently at 03:00 when the first backup tries to upload.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, count, eq } from "drizzle-orm";
import { databaseBackups, databases, members, s3Storages } from "@guildserver/database";
import { createTRPCRouter, protectedProcedure } from "../trpc/trpc";
import { encryptSecret } from "../utils/crypto";
import { StorageError, assertSafeEndpoint, configFromRow, testStorage } from "../services/storage/s3";

/** Columns safe to return: never the access key or the secret. */
const PUBLIC_COLUMNS = {
  id: s3Storages.id,
  organizationId: s3Storages.organizationId,
  name: s3Storages.name,
  endpoint: s3Storages.endpoint,
  region: s3Storages.region,
  bucket: s3Storages.bucket,
  pathPrefix: s3Storages.pathPrefix,
  forcePathStyle: s3Storages.forcePathStyle,
  lastTestedAt: s3Storages.lastTestedAt,
  lastTestOk: s3Storages.lastTestOk,
  lastTestError: s3Storages.lastTestError,
  createdAt: s3Storages.createdAt,
  updatedAt: s3Storages.updatedAt,
};

/** S3 bucket naming rules, which MinIO and most compatibles also enforce. */
const bucketName = z
  .string()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/, "Bucket names use lowercase letters, digits, dots and hyphens");

async function roleIn(ctx: any, organizationId: string) {
  const member = await ctx.db.query.members.findFirst({
    where: and(eq(members.organizationId, organizationId), eq(members.userId, ctx.user.id)),
  });
  return member?.role as "owner" | "admin" | "member" | undefined;
}

async function requireManager(ctx: any, organizationId: string) {
  const role = await roleIn(ctx, organizationId);
  if (!role) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found or access denied" });
  if (role !== "owner" && role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only an organization owner or admin can manage backup storage" });
  }
}

async function storageForManager(ctx: any, id: string) {
  const storage = await ctx.db.query.s3Storages.findFirst({ where: eq(s3Storages.id, id) });
  // Outside the organization: do not confirm the storage exists.
  if (!storage || !(await roleIn(ctx, storage.organizationId))) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Backup storage not found" });
  }
  await requireManager(ctx, storage.organizationId);
  return storage;
}

function badRequest(error: unknown): never {
  throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : String(error) });
}

export const backupStorageRouter = createTRPCRouter({
  list: protectedProcedure.input(z.object({ organizationId: z.string().uuid() })).query(async ({ ctx, input }) => {
    if (!(await roleIn(ctx, input.organizationId))) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found or access denied" });
    }
    return ctx.db.select(PUBLIC_COLUMNS).from(s3Storages).where(eq(s3Storages.organizationId, input.organizationId));
  }),

  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        name: z.string().trim().min(1).max(255),
        endpoint: z.string().url().max(2048),
        region: z.string().trim().min(1).max(64).default("us-east-1"),
        bucket: bucketName,
        pathPrefix: z.string().trim().max(512).regex(/^[A-Za-z0-9._/-]*$/, "Use letters, digits, '.', '_', '-' and '/'").optional(),
        accessKeyId: z.string().min(1).max(512),
        secretAccessKey: z.string().min(1).max(1024),
        forcePathStyle: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireManager(ctx, input.organizationId);
      if (input.pathPrefix?.includes("..")) badRequest(new Error("pathPrefix must not contain '..'"));

      try {
        await assertSafeEndpoint(input.endpoint);
      } catch (error) {
        if (error instanceof StorageError) badRequest(error);
        throw error;
      }

      const plain = {
        endpoint: input.endpoint,
        region: input.region,
        bucket: input.bucket,
        pathPrefix: input.pathPrefix || null,
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
        forcePathStyle: input.forcePathStyle,
      };
      const result = await testStorage(plain);
      if (!result.ok) badRequest(new Error(`Could not use this storage: ${result.error}`));

      const [row] = await ctx.db
        .insert(s3Storages)
        .values({
          organizationId: input.organizationId,
          name: input.name,
          ...plain,
          accessKeyId: encryptSecret(input.accessKeyId)!,
          secretAccessKey: encryptSecret(input.secretAccessKey)!,
          lastTestedAt: new Date(),
          lastTestOk: true,
        })
        .returning(PUBLIC_COLUMNS);
      return row;
    }),

  test: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const storage = await storageForManager(ctx, input.id);
    const result = await testStorage(configFromRow(storage));
    await ctx.db
      .update(s3Storages)
      .set({ lastTestedAt: new Date(), lastTestOk: result.ok, lastTestError: result.ok ? null : result.error, updatedAt: new Date() })
      .where(eq(s3Storages.id, storage.id));
    return result;
  }),

  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const storage = await storageForManager(ctx, input.id);

    // Deleting a storage that databases still use would silently stop their
    // off-site copies; deleting one that holds backups would make those
    // copies unrestorable from here. Both must be dealt with first.
    const [{ value: usedBy }] = await ctx.db.select({ value: count() }).from(databases).where(eq(databases.backupStorageId, storage.id));
    const [{ value: holding }] = await ctx.db.select({ value: count() }).from(databaseBackups).where(eq(databaseBackups.storageId, storage.id));
    if (usedBy > 0 || holding > 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `This storage is used by ${usedBy} database(s) and holds ${holding} backup(s). Move or remove them first.`,
      });
    }

    await ctx.db.delete(s3Storages).where(eq(s3Storages.id, storage.id));
    return { success: true };
  }),
});
