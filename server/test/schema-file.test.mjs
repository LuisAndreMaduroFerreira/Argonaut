// database/schema.sql, the from-scratch schema, must build exactly what the migrations build,
// and leave the API nothing to migrate. Regenerate it with database/generate-schema.ps1.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import pg from "pg";

const SERVER = {
  host: process.env.TEST_PGHOST ?? "localhost",
  port: Number(process.env.TEST_PGPORT ?? 5433),
  user: process.env.TEST_PGUSER ?? "argonaut",
  password: process.env.TEST_PGPASSWORD ?? "argonaut",
};
const FROM_FILE = "argonaut_test_schema_file";
const MIGRATED = "argonaut_test_schema_migrated";
const migrations = new URL("../migrations/", import.meta.url);
const schemaFile = new URL("../../database/schema.sql", import.meta.url);

// Everything the app depends on, one line per column, constraint, index, trigger and function.
const SHAPE = `
  SELECT 'column ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
         || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
         || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '') || ' storage ' || a.attstorage::text
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid AND c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'constraint ' || conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid)
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace
  UNION ALL
  SELECT 'index ' || indexdef FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL
  SELECT 'trigger ' || tgrelid::regclass || ' ' || pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal
  UNION ALL
  SELECT 'function ' || proname || ' ' || md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
  UNION ALL
  SELECT 'type ' || t.typname || ' ' || string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
   WHERE t.typnamespace = 'public'::regnamespace GROUP BY t.typname
  ORDER BY 1`;

async function connect(database) {
  const client = new pg.Client({ ...SERVER, database });
  await client.connect();
  return client;
}

test("schema.sql builds what the migrations build", async (t) => {
  const admin = await connect("postgres");
  for (const name of [FROM_FILE, MIGRATED]) {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  }
  t.after(async () => {
    for (const name of [FROM_FILE, MIGRATED]) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  });

  const fromFile = await connect(FROM_FILE);
  await fromFile.query(readFileSync(schemaFile, "utf8"));
  await fromFile.end();

  // The API's own migrate(), on the database built from the file: nothing left to do.
  process.env.PGHOST = SERVER.host;
  process.env.PGPORT = String(SERVER.port);
  process.env.PGUSER = SERVER.user;
  process.env.PGPASSWORD = SERVER.password;
  process.env.PGDATABASE = FROM_FILE;
  const { migrate, pool } = await import("../src/db.js");
  assert.deepEqual(await migrate(), [], "schema.sql already holds every migration");
  await pool.end();

  // The other database, built the way migrate() builds one.
  const migrated = await connect(MIGRATED);
  await migrated.query(
    "CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  );
  const names = readdirSync(migrations).filter((name) => /^\d{4}_[\w-]+\.sql$/.test(name)).sort();
  for (const name of names) {
    await migrated.query("BEGIN");
    await migrated.query(readFileSync(new URL(name, migrations), "utf8"));
    await migrated.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
    await migrated.query("COMMIT");
  }

  const shape = async (database) => {
    const client = await connect(database);
    const rows = (await client.query(SHAPE)).rows.map((row) => Object.values(row)[0]);
    const applied = (await client.query("SELECT name FROM schema_migrations ORDER BY name")).rows.map((row) => row.name);
    await client.end();
    return { rows, applied };
  };
  const expected = await shape(MIGRATED);
  await migrated.end();
  const actual = await shape(FROM_FILE);
  assert.ok(expected.rows.length > 50, "the comparison sees the schema");
  assert.deepEqual(actual.applied, names);
  assert.deepEqual(actual.rows, expected.rows, "schema.sql is out of date: run database/generate-schema.ps1");
  t.diagnostic(`${expected.rows.length} columns, constraints, indexes, triggers, functions and types match`);
});
