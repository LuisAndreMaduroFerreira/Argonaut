import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Pool, type PoolClient } from "pg";

export const pool = new Pool({
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "argonaut",
  password: process.env.PGPASSWORD ?? "argonaut",
  database: process.env.PGDATABASE ?? "argonaut",
});

// When Postgres restarts or Docker hiccups, the connections waiting in the pool are dropped.
// The pool opens new ones on the next query; without this listener Node would treat the drop
// as an unhandled error and the API would exit.
pool.on("error", (error) => {
  console.error("A database connection was dropped:", error.message);
});

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

// Any fixed number: two API processes starting together take turns setting up the schema,
// because CREATE ... IF NOT EXISTS isn't safe when run at the same moment.
const SCHEMA_LOCK = 815_002;

// Brings the schema up to date. Each file in migrations/ runs once per database, in name
// order, in a transaction of its own, and is then recorded in schema_migrations. A change to
// the schema is a new file with the next number; a file that has run is never edited.
// Answers with the names that ran now.
export async function migrate(directory = MIGRATIONS_DIR): Promise<string[]> {
  const files = readdirSync(directory)
    .filter((name) => /^\d{4}_[\w-]+\.sql$/.test(name))
    .sort();
  const applied: string[] = [];
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    const known = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const done = new Set(known.rows.map((row) => row.name));
    for (const name of files) {
      if (done.has(name)) continue;
      await client.query("BEGIN");
      try {
        await client.query(readFileSync(path.join(directory, name), "utf8"));
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Migration ${name} failed and was rolled back: ${reason}`, { cause: error });
      }
      applied.push(name);
    }
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK]).catch(() => undefined);
    client.release();
  }
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
