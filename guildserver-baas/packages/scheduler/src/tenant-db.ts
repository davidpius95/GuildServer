import postgres from "postgres";

function makeSql(database: string) {
  return postgres({
    host:     process.env.BAAS_PG_HOST     ?? "baas-postgres",
    port:     parseInt(process.env.BAAS_PG_PORT ?? "5432"),
    username: process.env.BAAS_PG_ADMIN_USER     ?? "postgres",
    password: process.env.BAAS_PG_ADMIN_PASSWORD ?? "",
    database,
    max:      2,
    onnotice: () => {},
  });
}

export async function createTenantDatabase(
  dbName: string,
  dbUser: string,
  dbPassword: string,
): Promise<void> {
  const admin = makeSql("postgres");
  try {
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);
    await admin.unsafe(`CREATE USER "${dbUser}" WITH PASSWORD '${dbPassword}'`);
    await admin.unsafe(`GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO "${dbUser}"`);
  } finally {
    await admin.end();
  }

  // Connect to the new DB and set default privileges so PostgREST anon/authenticated roles work
  const tenant = makeSql(dbName);
  try {
    await tenant.unsafe(`
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT ALL ON TABLES    TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    `);
  } finally {
    await tenant.end();
  }
}

export async function dropTenantDatabase(dbName: string, dbUser: string): Promise<void> {
  const admin = makeSql("postgres");
  try {
    // Terminate any active connections so DROP DATABASE succeeds
    await admin.unsafe(
      `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
        WHERE datname = '${dbName}' AND pid <> pg_backend_pid()`,
    );
    await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
    await admin.unsafe(`DROP USER IF EXISTS "${dbUser}"`);
  } finally {
    await admin.end();
  }
}
