import { defineConfig } from "drizzle-kit";

// drizzle-kit is used for `studio` and for drafting SQL. Production schema
// changes still ship as hand-reviewed files applied by src/migrate.ts.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
