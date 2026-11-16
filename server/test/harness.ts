// What every API test file starts from: a database of its own and the app running in this
// process. Nothing here can reach the real `argonaut` database: a test's database is created,
// used and dropped under a name that must start with argonaut_test_.
//
// It needs the Postgres of docker-compose.yml to be up, reached the way the host reaches it
// (localhost:5433). TEST_PGHOST, TEST_PGPORT, TEST_PGUSER and TEST_PGPASSWORD point elsewhere.
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after } from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { AppConfig } from "../src/config.js";
import { startMockLlm, type MockLlm } from "./mockLlm.js";

const SERVER = {
  host: process.env.TEST_PGHOST ?? "localhost",
  port: Number(process.env.TEST_PGPORT ?? 5433),
  user: process.env.TEST_PGUSER ?? "argonaut",
  password: process.env.TEST_PGPASSWORD ?? "argonaut",
};

const STARTER_TASKS = fileURLToPath(new URL("../seeds/starter-tasks.sql", import.meta.url));

export interface Answer {
  status: number;
  // The parsed JSON, or the raw bytes of anything else.
  data: unknown;
  headers: Headers;
}

export interface TestApi {
  // Where the app answers, for requests the helpers below don't cover.
  base: string;
  // Sends JSON, or raw bytes when the body is a Uint8Array. `base` picks another instance.
  call(method: string, path: string, body?: unknown, options?: { base?: string; headers?: Record<string, string> }): Promise<Answer>;
  // A statement on the test's database. Answers like `psql -tA`: columns joined by |, rows by
  // line breaks, t and f for booleans.
  sql(text: string): Promise<string>;
  // The stand-in for the assistant, and the last request the app sent it.
  llm: MockLlm;
  // The starter tasks of seeds/starter-tasks.sql.
  seedTasks(): Promise<void>;
  // A second instance of the app on the same database with other settings; answers with its base.
  another(overrides: Partial<AppConfig>): Promise<string>;
}

function show(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "t" : "f";
  return value instanceof Date ? value.toISOString() : String(value);
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
}

export async function startApi(name: string, overrides: Partial<AppConfig> = {}): Promise<TestApi> {
  const database = `argonaut_test_${name}`;
  if (!/^argonaut_test_[a-z0-9_]+$/.test(database)) throw new Error(`Not a test database name: ${database}`);

  const admin = new pg.Client({ ...SERVER, database: "postgres" });
  try {
    await admin.connect();
  } catch (cause) {
    throw new Error(
      `The tests need Argonaut's Postgres on ${SERVER.host}:${SERVER.port}. Start it with: docker compose up -d argonaut-db`,
      { cause },
    );
  }
  // Left behind by a run that was cut short.
  await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${database}`);

  // The app reads its database settings when db.ts is first imported, so they're set first.
  Object.assign(process.env, {
    PGHOST: SERVER.host,
    PGPORT: String(SERVER.port),
    PGUSER: SERVER.user,
    PGPASSWORD: SERVER.password,
    PGDATABASE: database,
  });
  const { migrate, pool } = await import("../src/db.js");
  const { createApp } = await import("../src/app.js");
  await migrate();

  const llm = await startMockLlm();
  const config: AppConfig = {
    llm: { baseUrl: llm.url, apiKey: "test-key", model: "stand-in", settingsFile: "" },
    // Nothing listens here; the spelling tests bring a speller of their own.
    spellUrl: "http://127.0.0.1:9",
    whisperUrl: "http://127.0.0.1:9",
    devOrigins: ["http://localhost:5173"],
    publicDir: null,
    ...overrides,
  };
  const servers: Server[] = [];
  const start = (settings: AppConfig) => {
    const server = createServer(createApp(settings));
    servers.push(server);
    return listen(server);
  };
  const base = await start(config);
  const direct = new pg.Client({ ...SERVER, database });
  await direct.connect();

  after(async () => {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await llm.close();
    await direct.end();
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin.end();
  });

  return {
    base,
    llm,
    async call(method, path, body, options = {}) {
      // Bytes go as they are (copied, so the type is one fetch takes); anything else as JSON.
      const payload = body === undefined ? undefined : body instanceof Uint8Array ? new Uint8Array(body) : JSON.stringify(body);
      const response = await fetch((options.base ?? base) + path, {
        method,
        headers: {
          ...(typeof payload === "string" ? { "Content-Type": "application/json" } : {}),
          "X-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
          ...options.headers,
        },
        body: payload,
      });
      const type = response.headers.get("content-type") ?? "";
      const data = type.includes("json")
        ? await response.json().catch(() => null)
        : Buffer.from(await response.arrayBuffer());
      return { status: response.status, data, headers: response.headers };
    },
    async sql(text) {
      const result = await direct.query({ text, rowMode: "array" });
      // Several statements in one go answer with the last one's rows.
      const last = Array.isArray(result) ? result.at(-1) : result;
      return ((last?.rows ?? []) as unknown[][]).map((row) => row.map(show).join("|")).join("\n");
    },
    async seedTasks() {
      await direct.query(readFileSync(STARTER_TASKS, "utf8"));
    },
    another: (settings) => start({ ...config, ...settings }),
  };
}
