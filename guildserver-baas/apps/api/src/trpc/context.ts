import { Request } from "express";
import { jwtVerify } from "jose";
import { db, users, members, organizations } from "@guildserver/baas-db";
import { eq } from "drizzle-orm";

export interface BaasContext {
  userId?: string;
  organizationId?: string;
  product?: string;
  isAuthenticated: boolean;
  isAdmin: boolean;
}

export async function createContext({ req }: { req: Request }): Promise<BaasContext> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return { isAuthenticated: false, isAdmin: false };

  try {
    const token  = auth.slice(7);
    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    const { payload } = await jwtVerify(token, secret);

    const userId = payload.userId as string | undefined;
    if (!userId) return { isAuthenticated: false, isAdmin: false };

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return { isAuthenticated: false, isAdmin: false };

    // Find active BaaS org membership
    const membership = await db
      .select({ organizationId: members.organizationId })
      .from(members)
      .innerJoin(organizations, eq(organizations.id, members.organizationId))
      .where(eq(members.userId, userId))
      .limit(1);

    return {
      userId,
      organizationId: membership[0]?.organizationId ?? undefined,
      isAuthenticated: true,
      isAdmin: user.role === "admin",
    };
  } catch {
    return { isAuthenticated: false, isAdmin: false };
  }
}
