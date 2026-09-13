import { type CreateExpressContextOptions } from "@trpc/server/adapters/express";
import jwt from "jsonwebtoken";
import { db } from "@guildserver/database";
import type { users } from "@guildserver/database";

interface User {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "user" | null;
}

/**
 * Set when a procedure is reached through the REST v1 surface, which
 * authenticates with an API token rather than a session. Procedures use it
 * either to refuse token callers outright (api-token management) or to leave
 * the audit record to the REST layer, which attributes it to the token.
 */
export interface ApiTokenContext {
  id: string;
  organizationId: string;
  scopes: string[];
}

export async function createContext({ req, res }: CreateExpressContextOptions) {
  // Get token from Authorization header
  const token = req.headers.authorization?.replace("Bearer ", "");
  
  let user: User | null = null;
  
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
      
      // Fetch user from database
      const dbUser = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, decoded.userId),
        columns: {
          id: true,
          email: true,
          name: true,
          role: true,
        },
      });
      
      if (dbUser) {
        user = dbUser;
      }
    } catch (error) {
      // Invalid token, user remains null
      console.warn("Invalid JWT token:", error);
    }
  }

  return {
    req,
    res,
    db,
    user,
    isAuthenticated: !!user,
    isAdmin: user?.role === "admin",
    // A session context is never a token context; the REST caller supplies it.
    apiToken: undefined as ApiTokenContext | undefined,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;