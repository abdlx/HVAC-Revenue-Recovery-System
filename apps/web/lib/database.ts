import "server-only";
import { createDatabase } from "@hvac/db";

type DatabaseConnection = ReturnType<typeof createDatabase>;
const globalForDatabase = globalThis as typeof globalThis & {
  hvacDatabase?: DatabaseConnection;
};

export function getDatabase(): DatabaseConnection {
  if (globalForDatabase.hvacDatabase) return globalForDatabase.hvacDatabase;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const connection = createDatabase(databaseUrl);
  if (process.env.NODE_ENV !== "production") globalForDatabase.hvacDatabase = connection;
  return connection;
}
