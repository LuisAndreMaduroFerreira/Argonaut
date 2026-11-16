import { createApp } from "./app.js";
import { sweepImages } from "./attachments.js";
import { configFromEnv } from "./config.js";
import { migrate, pool } from "./db.js";

const port = Number(process.env.PORT ?? 8787);
// How long requests in progress get to finish when the container is asked to stop. Docker
// waits ten seconds before it kills the process.
const SHUTDOWN_MS = 8_000;
const DAY_MS = 24 * 60 * 60 * 1000;

async function tidyImages(): Promise<void> {
  try {
    const removed = await sweepImages();
    if (removed > 0) console.log(`removed ${removed} image${removed === 1 ? "" : "s"} no note shows any more`);
  } catch (error) {
    // Housekeeping never takes the API down; it runs again tomorrow.
    console.error("Couldn't tidy stored images:", error);
  }
}

async function main(): Promise<void> {
  const applied = await migrate();
  if (applied.length > 0) console.log(`database updated: ${applied.join(", ")}`);

  const server = createApp(configFromEnv()).listen(port, () => {
    console.log(`argonaut-api listening on :${port}`);
  });

  void tidyImages();
  setInterval(() => void tidyImages(), DAY_MS).unref();

  // `docker compose stop` and a new deploy send SIGTERM. Stop taking requests, let the ones in
  // progress finish (a save, an upload), then close the database connections.
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: finishing requests in progress, then stopping`);
    const giveUp = setTimeout(() => {
      console.error("Requests were still running; stopping anyway");
      process.exit(1);
    }, SHUTDOWN_MS);
    server.close(() => {
      clearTimeout(giveUp);
      void pool.end().finally(() => process.exit(0));
    });
    // Connections a browser is only keeping open for later hold nothing up.
    server.closeIdleConnections();
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

main().catch((error: unknown) => {
  console.error("Argonaut's API couldn't start:", error);
  process.exit(1);
});
