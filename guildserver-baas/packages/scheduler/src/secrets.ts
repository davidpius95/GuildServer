import { SignJWT } from "jose";
import { randomBytes } from "crypto";

export async function generateProjectSecrets() {
  const jwtSecret = randomBytes(40).toString("hex");
  const dbPassword = randomBytes(16).toString("hex");
  const key = new TextEncoder().encode(jwtSecret);

  const sign = (role: string) =>
    new SignJWT({ role, iss: "supabase" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("2099-01-01T00:00:00Z")
      .sign(key);

  const [anonKey, serviceRoleKey] = await Promise.all([sign("anon"), sign("service_role")]);
  return { jwtSecret, dbPassword, anonKey, serviceRoleKey };
}
