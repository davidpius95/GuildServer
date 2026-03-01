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
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;