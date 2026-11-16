// A stand-in for the assistant: an OpenAI-compatible endpoint with canned replies, chosen by the
// last thing the user said. No test ever calls a real model.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

interface Message {
  role: string;
  content: string;
}

export interface MockLlm {
  url: string;
  // The body of the last request the app sent, parsed.
  lastRequest(): { model: string; messages: Message[] };
  close(): Promise<void>;
}

const SCENARIOS: [RegExp, string][] = [
  [
    /long/i,
    "Here is the first sentence about your tasks. The second one runs on a good while longer, with enough detail that the whole reply comfortably crosses the chunking limit used for speech. A third sentence follows. And a short fourth one!",
  ],
  [/prepositions/i, 'Nice work — prepositions are done for today.\nACTIONS: [{"op":"complete","ref":"T1.1"}]'],
  [
    /reading/i,
    'Added a weekly reading task with two chapters.\n```json\nACTIONS: [{"op":"create_task","title":"Reading","subtext":"Two chapters of the novel","cadence":"weekly","subtasks":[{"title":"Chapter 1"},{"title":"Chapter 2","subtext":"Take notes"}]}]\n```',
  ],
  [/rename/i, 'Renamed it.\nACTIONS: [{"op":"update","ref":"T2","title":"Book continuation","subtext":"Write 3 pages today"}]'],
  [/remove verbs/i, 'Removed it.\nACTIONS: [{"op":"delete","ref":"T1.2"}]'],
  [/verbs/i, 'Added verbs under French learning.\nACTIONS: [{"op":"add_subtask","ref":"T1","title":"Verbs","subtext":"Conjugate être and avoir"}]'],
  [/everything/i, 'Application development is done.\nACTIONS: [{"op":"complete","ref":"T3"},{"op":"complete","ref":"T9"},{"op":"explode","ref":"T1"}]'],
  [/garbled/i, "Sure.\nACTIONS: [not json"],
];

// Test writing: the system prompt asks for "exactly N questions"; the learner's instructions
// (in the first user message) pick how the reply goes wrong, if at all.
function questions(count: number) {
  return Array.from({ length: count }, (_, index) =>
    index % 2 === 0
      ? {
          question: `Which layer loads first? (${index + 1})`,
          options: ["Metadata", "Full instructions", "Reference files"],
          answer: "Metadata",
          explanation: "Names and descriptions are loaded up front.",
        }
      : { question: `What does RAG add to the context window? (${index + 1})`, answer: ["relevant chunks", "the relevant chunks"] },
  );
}

function testReply(messages: Message[]): string {
  const system = messages[0]?.content ?? "";
  const first = messages.find((message) => message.role === "user")?.content ?? "";
  const last = messages.at(-1)?.content ?? "";
  const count = Number(system.match(/exactly (\d+) questions/)?.[1] ?? 5);
  const retry = last.startsWith("That can't be used as a test");
  const good = { title: "Agent context avenues", questions: questions(count) };

  if (/always-broken/.test(first)) return "Here you go: {not json at all";
  if (/broken-then-fixed/.test(first) && !retry) {
    return JSON.stringify({ title: "Broken", questions: [{ question: "Pick one", options: ["a", "b"], answer: "c" }] });
  }
  if (/fenced/.test(first)) return `Here is your test.\n\`\`\`json\n${JSON.stringify(good, null, 2)}\n\`\`\`\nGood luck!`;
  if (/no-title/.test(first)) return JSON.stringify({ questions: good.questions });
  if (/only-questions/.test(first)) return JSON.stringify(good.questions);
  if (/all-open/.test(first) && !retry) {
    return JSON.stringify({ title: "Open only", questions: good.questions.filter((question) => !("options" in question)) });
  }
  if (/too-many/.test(first)) return JSON.stringify({ title: "Too many", questions: questions(count + 7) });
  return JSON.stringify(good);
}

export function startMockLlm(): Promise<MockLlm> {
  let last = { model: "", messages: [] as Message[] };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      last = JSON.parse(body) as typeof last;
      const said = last.messages.at(-1)?.content ?? "";
      const reply = /practice tests/.test(last.messages[0]?.content ?? "")
        ? testReply(last.messages)
        : (SCENARIOS.find(([pattern]) => pattern.test(said))?.[1] ?? "Hello there.");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        lastRequest: () => last,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
