import { z } from "zod";
import { SignJWT } from "jose";
import { hash, verify, randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { router, publicProcedure, protectedProcedure } from "../trpc/trpc";
import { db, users, organizations, members } from "@guildserver/baas-db";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

function makeSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function signToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(process.env.JWT_EXPIRES_IN ?? "7d")
    .sign(secret);
}

export const authRouter = router({
  register: publicProcedure
    .input(z.object({
      name:     z.string().min(1),
      email:    z.string().email(),
      password: z.string().min(8),
    }))
    .mutation(async ({ input }) => {
      const existing = await db.select().from(users).where(eq(users.email, input.email));
      if (existing.length) throw new TRPCError({ code: "CONFLICT", message: "Email already registered" });

      const passwordHash = await bcrypt.hash(input.password, 12);
      const [user] = await db.insert(users).values({
        id: randomUUID(),
        email: input.email,
        name:  input.name,
        password: passwordHash,
      }).returning();

      const slug = `${makeSlug(input.name)}-baas-${Date.now().toString(36)}`;
      const [org] = await db.insert(organizations).values({
        id: randomUUID(),
        name:    `${input.name}'s BaaS`,
        slug,
        ownerId: user.id,
        product: "baas",
      }).returning();

      await db.insert(members).values({
        id: randomUUID(),
        userId:         user.id,
        organizationId: org.id,
        role:           "owner",
      });

      const token = await signToken(user.id);
      return { token, user: { id: user.id, email: user.email, name: user.name } };
    }),

  login: publicProcedure
    .input(z.object({ email: z.string().email(), password: z.string() }))
    .mutation(async ({ input }) => {
      const [user] = await db.select().from(users).where(eq(users.email, input.email));
      if (!user?.password) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });

      const valid = await bcrypt.compare(input.password, user.password);
      if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });

      const token = await signToken(user.id);
      return { token, user: { id: user.id, email: user.email, name: user.name } };
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const [user] = await db.select().from(users).where(eq(users.id, ctx.userId));
    if (!user) throw new TRPCError({ code: "NOT_FOUND" });
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }),
});
