// The database underneath: schema changes that run exactly once, and connections that drop.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { test } from "node:test";
import { startApi } from "./harness.ts";

const api = await startApi("database");
const { call, sql } = api;
const { migrate } = await import("../src/db.ts");

const applied = async () => (await sql("SELECT name FROM schema_migrations ORDER BY name")).split("\n");
const hasTable = async (name) => (await sql(`SELECT to_regclass('${name}') IS NOT NULL`)) === "t";

test("migrations: each file runs once, in order, and a broken one changes nothing", async (t) => {
  const ok = (label) => t.diagnostic(label);

  const shipped = readdirSync(new URL("../migrations", import.meta.url)).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(await applied(), shipped);
  assert.deepEqual(await migrate(), []);
  ok("a new database has run every migration, and starting again runs none");

  const dir = mkdtempSync(path.join(tmpdir(), "argonaut-migrations-"));
  writeFileSync(path.join(dir, "9002_second.sql"), "ALTER TABLE mig_first ADD COLUMN note TEXT;");
  writeFileSync(path.join(dir, "9001_first.sql"), "CREATE TABLE mig_first (id INT);");
  writeFileSync(path.join(dir, "notes.txt"), "not a migration");
  writeFileSync(path.join(dir, "1_short.sql"), "CREATE TABLE mig_wrong_name (id INT);");
  assert.deepEqual(await migrate(dir), ["9001_first.sql", "9002_second.sql"]);
  assert.equal(await sql("SELECT count(*) FROM information_schema.columns WHERE table_name = 'mig_first'"), "2");
  assert.equal(await hasTable("mig_wrong_name"), false);
  assert.deepEqual(await migrate(dir), []);
  ok("new files run in name order, once; files that aren't numbered migrations are left alone");

  writeFileSync(path.join(dir, "9003_broken.sql"), "CREATE TABLE mig_third (id INT);\nSELECT nonsense FROM nowhere;");
  writeFileSync(path.join(dir, "9004_after.sql"), "CREATE TABLE mig_fourth (id INT);");
  await assert.rejects(migrate(dir), /Migration 9003_broken\.sql failed and was rolled back: relation "nowhere" does not exist/);
  assert.equal(await hasTable("mig_third"), false, "the part that worked is undone");
  assert.equal(await hasTable("mig_fourth"), false, "nothing after it runs");
  assert.equal((await applied()).includes("9003_broken.sql"), false);
  ok("a migration that fails is rolled back whole, named in the error, and stops the ones after it");

  writeFileSync(path.join(dir, "9003_broken.sql"), "CREATE TABLE mig_third (id INT);");
  const both = await Promise.all([migrate(dir), migrate(dir)]);
  assert.deepEqual(both.flat().sort(), ["9003_broken.sql", "9004_after.sql"]);
  ok("two processes starting together take turns: each migration still runs once");
});

test("a dropped database connection doesn't take the API down", async (t) => {
  const ok = (label) => t.diagnostic(label);

  assert.equal((await call("GET", "/api/health")).status, 200);
  // What a restart of Postgres does to the connections the API keeps waiting in its pool.
  const dropped = await sql(
    "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()",
  );
  assert.ok(Number(dropped) >= 1, "the API had a connection open to drop");
  await wait(300);
  const res = await call("GET", "/api/notes");
  assert.equal(res.status, 200);
  ok("the pool logs the drop and opens a new connection for the next request");
});
