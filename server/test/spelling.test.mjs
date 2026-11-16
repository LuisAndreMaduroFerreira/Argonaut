// Spell checking through the API: what goes to the speller, the words you keep (stored here,
// filtered out of its answers), and what happens when it doesn't answer. The dictionaries are
// tested where they live, in spell/test.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { startApi } from "./harness.ts";

// A speller that knows three wrong words and echoes the language it was asked for.
const WRONG = { knowlege: "knowledge", tabl: "table", caderno: "notebook" };
const asked = [];
const speller = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const input = JSON.parse(body);
    asked.push({ path: req.url, ...input });
    if (input.text?.includes("crash")) {
      res.writeHead(500).end();
      return;
    }
    const answer =
      req.url === "/check"
        ? {
            language: input.language ?? "en",
            words: [...input.text.matchAll(/\p{L}+/gu)]
              .filter((match) => Object.hasOwn(WRONG, match[0].toLowerCase()))
              .map((match) => ({ start: match.index, end: match.index + match[0].length, word: match[0] })),
          }
        : { suggestions: [WRONG[input.word.toLowerCase()] ?? ""].filter(Boolean) };
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(answer));
  });
});
await new Promise((resolve) => speller.listen(0, "127.0.0.1", resolve));
const spellUrl = `http://127.0.0.1:${speller.address().port}`;

const api = await startApi("spelling", { spellUrl });
const unreachable = await api.another({ spellUrl: "http://127.0.0.1:9" });
const post = (path, body, base) => api.call("POST", path, body, { base });

test("spelling: checks, suggestions, kept words, and a speller that's down", async (t) => {
  t.after(() => speller.close());
  const ok = (label) => t.diagnostic(label);

  let res = await post("/api/spelling/check", { text: "The knowlege vault holds my notes." });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { language: "en", words: [{ start: 4, end: 12, word: "knowlege" }] });
  assert.equal(asked.at(-1).language, undefined, "no language given means the speller works it out");
  ok("a misspelling comes back with its place in the text, in the language the speller chose");

  res = await post("/api/spelling/check", { text: "Este caderno é meu.", language: "pt" });
  assert.equal(res.data.language, "pt");
  assert.equal(asked.at(-1).language, "pt");
  res = await post("/api/spelling/check", { text: "Este caderno é meu.", language: "klingon" });
  assert.equal(asked.at(-1).language, undefined, "an unknown language is left for the speller to work out");
  ok("a pinned language is passed on; one that isn't known is not");

  res = await post("/api/spelling/suggest", { word: "knowlege", language: "en" });
  assert.deepEqual(res.data, { suggestions: ["knowledge"] });
  ok("suggestions come back for a word");

  res = await post("/api/spelling/keep", { word: " Knowlege ", language: "en" });
  assert.equal(res.status, 201);
  assert.equal(res.data.word, "Knowlege");
  res = await post("/api/spelling/check", { text: "The knowlege vault, and a tabl." });
  assert.deepEqual(res.data.words.map((entry) => entry.word), ["tabl"]);
  res = await post("/api/spelling/check", { text: "O knowlege aqui é outro.", language: "pt" });
  assert.deepEqual(res.data.words.map((entry) => entry.word), ["knowlege"]);
  ok("a word you keep stops being flagged, whatever its capitals, in that language only");

  for (const [path, body] of [
    ["/api/spelling/check", { text: "x".repeat(50_001) }],
    ["/api/spelling/check", { text: 42 }],
    ["/api/spelling/suggest", { word: "word", language: "klingon" }],
    ["/api/spelling/suggest", { word: "", language: "en" }],
    ["/api/spelling/keep", { word: "  ", language: "en" }],
    ["/api/spelling/keep", { word: "word", language: "klingon" }],
  ]) {
    res = await post(path, body);
    assert.equal(res.status, 400, `${path} ${JSON.stringify(body).slice(0, 60)}`);
  }
  ok("oversized text, unknown languages and empty words are refused");

  const noteId = "7b5e7a11-0000-4000-8000-00000000cafe";
  const note = { title: "Français", content: "Le chat est sur la table.", tags: [] };
  res = await api.call("PUT", `/api/notes/${noteId}`, { ...note, language: "fr" });
  assert.equal(res.data.note.language, "fr");
  res = await api.call("PUT", `/api/notes/${noteId}`, { ...note, language: "klingon" });
  assert.equal(res.status, 400);
  const notes = (await api.call("GET", "/api/notes")).data;
  assert.equal(notes.find((entry) => entry.id === noteId).language, "fr");
  ok("a note remembers its spelling language, and an unknown one is refused");

  for (const [path, body, base] of [
    ["/api/spelling/check", { text: "The knowlege vault." }, unreachable],
    ["/api/spelling/suggest", { word: "tabl", language: "fr" }, unreachable],
    ["/api/spelling/check", { text: "crash" }, undefined],
  ]) {
    res = await post(path, body, base);
    assert.equal(res.status, 503, path);
    assert.equal(res.data.error, "The spell checker isn't answering");
  }
  res = await post("/api/spelling/keep", { word: "tabl", language: "fr" }, unreachable);
  assert.equal(res.status, 201);
  ok("with the speller unreachable or failing, the API says so; keeping a word still works");
});
