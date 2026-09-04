import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL_UNPOOLED;

if (!databaseUrl) {
  throw new Error("DATABASE_URL_UNPOOLED is required to verify the schema");
}

const expectedTables = [
  "calls",
  "organizations",
  "service_areas",
  "voice_agents",
] as const;

const pool = new Pool({ connectionString: databaseUrl, max: 1 });

try {
  const result = await pool.query<{ table_name: string }>(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name = any($1::text[])
    order by table_name
  `, [expectedTables]);

  const actualTables = result.rows.map((row) => row.table_name);
  if (actualTables.join(",") !== expectedTables.join(",")) {
    throw new Error(
      `Schema verification failed. Expected ${expectedTables.join(", ")}; found ${actualTables.join(", ")}`,
    );
  }

  console.info(`Verified migrated tables: ${actualTables.join(", ")}`);
} finally {
  await pool.end();
}
