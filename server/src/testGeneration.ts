import { GENERATE_KINDS, LIMITS, type GenerateKind, type GenerateOptions } from "../../shared/model.js";
import { HttpError, InputError } from "./errors.js";
import { isObject } from "./input.js";
import type { Llm, LlmMessage } from "./llmClient.js";
import { parseTestImport, type TestDraft } from "./tests.js";

// A test written by the LLM from a group of notes. The notes travel with the request, as the
// window has them, so unsaved edits count too. The reply must pass the same checks as an
// imported file; a reply that doesn't gets one retry with the problem spelled out.

const MAX = {
  notes: 200,
  // About 15,000 tokens of notes: plenty for a test, and a bounded cost per request.
  material: 60_000,
  source: 200,
} as const;

export function parseGenerateRequest(body: unknown): GenerateOptions {
  if (!isObject(body)) throw new InputError("Expected the notes to make a test from");
  const { minQuestions, maxQuestions } = LIMITS.generate;

  if (!Array.isArray(body.notes) || body.notes.length === 0) throw new InputError("Pick a group that has notes in it");
  if (body.notes.length > MAX.notes) {
    throw new InputError(`At most ${MAX.notes} notes can go into one test`);
  }
  const notes = body.notes.map((note, index) => {
    if (!isObject(note) || typeof note.title !== "string" || typeof note.content !== "string") {
      throw new InputError(`Note ${index + 1} needs a title and content`);
    }
    return { title: note.title, content: note.content };
  });

  const count = body.count ?? 10;
  if (typeof count !== "number" || !Number.isInteger(count) || count < minQuestions || count > maxQuestions) {
    throw new InputError(`Ask for between ${minQuestions} and ${maxQuestions} questions`);
  }
  const kind = body.kind ?? "mixed";
  if (typeof kind !== "string" || !(GENERATE_KINDS as readonly string[]).includes(kind)) {
    throw new InputError('"kind" must be "mixed", "choice" or "open"');
  }
  const instructions = body.instructions ?? "";
  if (typeof instructions !== "string" || instructions.length > LIMITS.generate.instructions) {
    throw new InputError(`Instructions can be at most ${LIMITS.generate.instructions} characters`);
  }
  const source =
    typeof body.source === "string" && body.source.trim() !== ""
      ? body.source.trim().slice(0, MAX.source)
      : "your notes";

  return { source, notes, count, kind: kind as GenerateKind, instructions: instructions.trim() };
}

// Pictures and link syntax say nothing the model can use, so the notes go as plain prose.
function plainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[\[([^[\]|\n]+?)(?:\|([^[\]\n]*?))?\]\]/g, (_match, target: string, label?: string) =>
      (label?.trim() || target).trim(),
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildMaterial(notes: GenerateOptions["notes"]): { text: string; used: number; truncated: boolean } {
  let text = "";
  let used = 0;
  for (const note of notes) {
    const body = plainText(note.content);
    if (!body) continue;
    const block = `## ${note.title.trim() || "Untitled"}\n\n${body}\n\n`;
    const room = MAX.material - text.length;
    if (block.length > room) {
      // A useful part of a long note is still worth including; a sliver isn't.
      if (room > 1_000) {
        text += `${block.slice(0, room)}\n[…the rest was cut to keep the request small]\n`;
        used += 1;
      }
      return { text: text.trim(), used, truncated: true };
    }
    text += block;
    used += 1;
  }
  return { text: text.trim(), used, truncated: false };
}

const KIND_RULES: Record<GenerateKind, string> = {
  mixed: "Mix multiple-choice and open-answer questions, roughly half of each.",
  choice: 'Every question is multiple choice, with "options".',
  open: 'Every question is open answer, without "options".',
};

function systemPrompt(request: GenerateOptions): string {
  return [
    "You write practice tests from a learner's own notes, so they can check what they've learned.",
    "",
    "Reply with one JSON object and nothing else, in exactly this shape:",
    "{",
    '  "title": "a short title for the test",',
    '  "questions": [',
    '    { "question": "…", "options": ["…", "…", "…"], "answer": "the correct option, copied exactly", "explanation": "…" },',
    '    { "question": "… Choose all that apply.", "options": ["…", "…", "…", "…"], "answer": ["each correct option"], "explanation": "…" },',
    '    { "question": "…", "answer": ["an accepted answer", "another accepted wording"], "explanation": "…" }',
    "  ]",
    "}",
    "",
    "Rules:",
    `- Write exactly ${request.count} questions. ${KIND_RULES[request.kind]}`,
    "- Ask only about what the notes say. Don't add outside facts, and don't ask about pictures or links.",
    '- Multiple choice: 3 to 5 different, plausible options. "answer" repeats the correct option\'s text exactly. Give a list of answers only for "choose all that apply", and say so in the question.',
    '- Open answer: answerable in a word or a short phrase. List every reasonable wording in "answer"; case and a final full stop don\'t matter, accents do.',
    "- Each explanation is one sentence saying why, based on the notes.",
    "- Spread the questions over the whole material instead of asking several about one detail.",
    "- Write in the language the notes are written in, unless the learner's instructions say otherwise.",
  ].join("\n");
}

function userPrompt(request: GenerateOptions, material: string): string {
  const instructions = request.instructions ? `The learner's instructions: ${request.instructions}\n\n` : "";
  return `${instructions}The notes, from ${request.source}:\n\n${material}`;
}

// The JSON object in a reply, with or without a ```json fence or a sentence around it.
function extractJson(reply: string): unknown {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced?.[1] ?? reply).trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new SyntaxError("no JSON object found");
  }
}

function readTest(reply: string, request: GenerateOptions): { draft: TestDraft } | { error: string } {
  let payload: unknown;
  try {
    payload = extractJson(reply);
  } catch {
    return { error: "it isn't valid JSON" };
  }
  // Models sometimes skip the title, or send the question list on its own.
  if (Array.isArray(payload) && isObject(payload[0]) && "question" in payload[0]) {
    payload = { questions: payload };
  }
  if (isObject(payload) && payload.title === undefined && payload.name === undefined) {
    payload = { ...payload, title: `${request.source} — practice` };
  }

  let drafts: TestDraft[];
  try {
    drafts = parseTestImport(payload);
  } catch (error) {
    if (error instanceof InputError) return { error: error.message };
    throw error;
  }
  const draft = drafts[0]!;
  const wanted = request.kind === "mixed" ? draft.questions : draft.questions.filter((q) => q.type === request.kind);
  if (wanted.length === 0) {
    return { error: `it has no ${request.kind === "open" ? "open-answer" : "multiple-choice"} questions` };
  }
  return { draft: { ...draft, questions: wanted.slice(0, request.count) } };
}

export async function generateTest(
  llm: Llm,
  request: GenerateOptions,
): Promise<{ draft: TestDraft; used: number; truncated: boolean }> {
  if (!llm.status().configured) {
    throw new HttpError(
      503,
      "Making a test from notes needs the AI assistant, which isn't connected yet. Configure assistant shows how.",
    );
  }
  const material = buildMaterial(request.notes);
  if (material.used === 0) throw new InputError("Those notes have no text to make questions from yet");

  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt(request) },
    { role: "user", content: userPrompt(request, material.text) },
  ];
  const ask = () => llm.complete(messages, 180_000);

  let reply = await ask();
  let result = readTest(reply, request);
  if ("error" in result) {
    messages.push(
      { role: "assistant", content: reply },
      { role: "user", content: `That can't be used as a test: ${result.error}. Reply with the corrected JSON only.` },
    );
    reply = await ask();
    result = readTest(reply, request);
    if ("error" in result) throw new HttpError(502, `The assistant's reply wasn't a usable test: ${result.error}`);
  }

  const notes = material.used === 1 ? "1 note" : `${material.used} notes`;
  return {
    draft: { ...result.draft, description: `Generated from ${request.source} · ${notes}` },
    used: material.used,
    truncated: material.truncated,
  };
}
