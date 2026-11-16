// The dictionaries: what counts as a mistake in each language, what's skipped in Markdown, and
// how a note's language is worked out.
import assert from "node:assert/strict";
import { test } from "node:test";
import { check, detectLanguage, findWords, suggest, type Language } from "../src/dictionaries.js";

const words = async (text: string, language: Language) => (await check(text, language)).map((entry) => entry.word);

test("English: a misspelling is found, with its place, and the best suggestion leads", async () => {
  assert.deepEqual(await words("The knowlege vault holds my notes.", "en"), ["knowlege"]);
  assert.deepEqual(await words("Everything here is spelled correctly.", "en"), []);
  assert.deepEqual((await check("The knowlege vault", "en"))[0], { start: 4, end: 12, word: "knowlege" });
  assert.equal((await suggest("knowlege", "en"))[0], "knowledge");
  assert.equal((await suggest("sentance", "en"))[0], "sentence");
});

test("French: accents and elisions like j'aime and l'eau are accepted", async () => {
  assert.deepEqual(await words("Le chat est sur la table et le livre est derrière.", "fr"), []);
  assert.deepEqual(await words("Le chat est sur la tabl.", "fr"), ["tabl"]);
  assert.equal((await suggest("tabl", "fr"))[0], "table");
  assert.deepEqual(await words("Il habite à Paris et j'aime l'eau fraîche.", "fr"), []);
});

test("Portuguese and Spanish prose passes", async () => {
  assert.deepEqual(await words("Este é um caderno de notas com as minhas ideias.", "pt"), []);
  assert.deepEqual(await words("Hoje escrevi três páginas do livro.", "pt"), []);
  assert.deepEqual(await words("El libro está sobre la mesa.", "es"), []);
});

test("code, links, images, wikilinks and addresses are skipped; the prose around them is checked", async () => {
  const markdown = [
    "# Heading",
    "",
    "See `npm run dev` and [the docs](https://example.com/asdfgh) and ![shot](/api/attachments/625f2988-a0a1).",
    "",
    "```",
    "const mispeled = true;",
    "```",
    "",
    "Link to [[Another Note]] and mail me at someone@example.com.",
    "",
    "This sentance has a mistake.",
  ].join("\n");
  assert.deepEqual(await words(markdown, "en"), ["sentance"]);
});

test("acronyms and code-style names are left alone", async () => {
  assert.deepEqual(await words("The API returns JSON for the camelCase field noteId.", "en"), []);
});

test("hyphens and apostrophes stay inside a word", () => {
  assert.deepEqual(
    findWords("a-b c'd").map((entry) => entry.word),
    ["a-b", "c'd"],
  );
});

test("the language of a note is worked out from the text, falling back to English", () => {
  assert.equal(detectLanguage("Le chat est sur la table, dans la cuisine, avec les enfants qui sont ici."), "fr");
  assert.equal(detectLanguage("Este é um caderno com as minhas notas, para que não se percam, muito bom."), "pt");
  assert.equal(detectLanguage("El libro está sobre la mesa, con las llaves, pero no hay más sitio aquí."), "es");
  assert.equal(detectLanguage("This is a notebook for the things that I am learning, with notes from books."), "en");
  assert.equal(detectLanguage("Short note."), "en");
});

test("a long note is checked quickly, and the list of mistakes is capped", async () => {
  const long = "The knowlege vault ".repeat(400);
  const started = performance.now();
  const found = await check(long, "en");
  assert.equal(found.length, 400);
  assert.ok(performance.now() - started < 2_000, "7,600 characters take well under two seconds");
  assert.equal((await check("knowlege ".repeat(600), "en")).length, 500);
});
