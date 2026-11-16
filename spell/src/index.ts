import { createApp } from "./app.js";
import { loadedLanguages, warmUp } from "./dictionaries.js";

const port = Number(process.env.PORT ?? 8790);

const server = createApp().listen(port, () => {
  console.log(`argonaut-spell listening on :${port}`);
  warmUp()
    .then(() => console.log(`dictionaries ready: ${loadedLanguages().join(", ")}`))
    .catch((error: unknown) => console.error("Failed to load a dictionary", error));
});

// Node is the container's main process, so it has to act on "stop" itself. A check takes
// milliseconds and nothing is kept, so there's nothing to wait for.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
  });
}
