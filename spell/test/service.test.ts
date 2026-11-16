// The service the API talks to: /health, /check and /suggest, with the real dictionaries.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";

const server = createApp().listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => {
  server.closeAllConnections();
  server.close();
});

async function post(path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: (await response.json()) as Record<string, unknown> };
}

test("health names the languages, without naming the software behind it", async () => {
  const response = await fetch(`${base}/health`);
  assert.equal(response.headers.get("x-powered-by"), null);
  const data = (await response.json()) as { ok: boolean; languages: string[] };
  assert.equal(data.ok, true);
  assert.deepEqual(data.languages, ["en", "pt", "fr", "es"]);
});

test("a check works the language out, or uses the one it's given", async () => {
  let res = await post("/check", { text: "The knowlege vault holds my notes, and this is a note about them." });
  assert.deepEqual(res.data, { language: "en", words: [{ start: 4, end: 12, word: "knowlege" }] });

  res = await post("/check", { text: "Le chat est sur la table, dans la cuisine, avec les enfants qui sont ici. Une tabl." });
  assert.equal(res.data.language, "fr");
  assert.deepEqual(
    (res.data.words as { word: string }[]).map((entry) => entry.word),
    ["tabl"],
  );

  res = await post("/check", { text: "Este é um caderno com as minhas notas.", language: "pt" });
  assert.deepEqual(res.data, { language: "pt", words: [] });
  res = await post("/check", { text: "Este é um caderno com as minhas notas.", language: "en" });
  assert.ok((res.data.words as unknown[]).length > 0, "pinning the wrong language flags the words");
});

test("suggestions come back for a word in a language", async () => {
  const res = await post("/suggest", { word: "tabl", language: "fr" });
  assert.equal((res.data.suggestions as string[])[0], "table");
});

test("what can't be checked is a 400", async () => {
  for (const [path, body] of [
    ["/check", { text: "x".repeat(50_001) }],
    ["/check", { text: 5 }],
    ["/suggest", { word: "word", language: "klingon" }],
    ["/suggest", { word: "", language: "en" }],
    ["/suggest", { word: "x".repeat(81), language: "en" }],
  ] as const) {
    const res = await post(path, body);
    assert.equal(res.status, 400, `${path} ${JSON.stringify(body).slice(0, 50)}`);
    assert.equal(typeof res.data.error, "string");
  }
});
