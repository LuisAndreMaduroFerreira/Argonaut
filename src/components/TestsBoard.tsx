import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { LIMITS } from "../types";
import type { AssistantStatus, GenerateKind, GenerateOptions, Note, NoteGroup, TestDetail, TestSummary } from "../types";
import { fetchTest } from "../lib/testsApi";
import { SECTION_LABELS, flattenGroups, notesInReadingOrder } from "../lib/groups";
import { useMissions } from "../hooks/useMissions";
import { useDialogs } from "../hooks/useDialogs";
import { errorMessage } from "../lib/api";
import type { TestsState } from "../hooks/useTests";
import { Icon } from "./Icon";
import { TestRunner } from "./TestRunner";

// Tests are made from what's studied: Notes and Works. Agent Skills are instructions for agents.
const SOURCE_SECTIONS = ["notes", "works"] as const;

const EXAMPLE = {
  title: "French prepositions",
  description: "Optional, shown under the title",
  questions: [
    {
      question: "Le chat est ___ la table. (on)",
      options: ["sur", "sous", "dans"],
      answer: "sur",
      explanation: "Optional, shown after answering: sur means on.",
    },
    {
      question: "Which of these give a place? Choose all that apply.",
      options: ["devant", "avec", "derrière"],
      answer: ["devant", "derrière"],
    },
    {
      question: "Translate: in Paris",
      answer: ["à Paris"],
    },
  ],
};

const EXAMPLE_JSON = JSON.stringify(EXAMPLE, null, 2);

function FormatGuide() {
  const [copied, setCopied] = useState(false);
  return (
    <section className="format-guide" aria-label="Test format">
      <ul>
        <li>
          A question with <code>options</code> is multiple choice. Its <code>answer</code> is the right option's text,
          or a list of them for “choose all that apply”.
        </li>
        <li>
          A question without options is open. Its <code>answer</code> is the accepted answer, or a list of accepted
          answers. Case, spacing and a final full stop don't matter; accents do.
        </li>
        <li>
          Optional: <code>explanation</code> per question; <code>description</code>, <code>shuffle_options</code>{" "}
          (default true) and <code>shuffle_questions</code> (default false) per test.
        </li>
        <li>
          Text can show code: <code>`inline`</code>, or a block between lines of <code>```</code>.
        </li>
        <li>
          A file can hold one test, or a batch: <code>{'{"name": "Rust", "tests": [ … ]}'}</code>. Each import gets a
          folder of its own in the sidebar's Tests section, named after the batch, and a weekly mission with a subtask
          per test, ticked when you pass that test at 100%.
        </li>
      </ul>
      <div className="format-guide-actions">
        <span>Example</span>
        <button
          type="button"
          className="ghost-btn ghost-btn-active"
          onClick={() => {
            void navigator.clipboard.writeText(EXAMPLE_JSON).then(() => setCopied(true));
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre>{EXAMPLE_JSON}</pre>
    </section>
  );
}

function describeCounts(test: TestSummary): string {
  const choice = test.questionCount - test.openCount;
  const parts = [choice > 0 ? `${choice} multiple choice` : "", test.openCount > 0 ? `${test.openCount} open` : ""];
  return `${test.questionCount} question${test.questionCount === 1 ? "" : "s"} · ${parts.filter(Boolean).join(" · ")}`;
}

interface Run {
  test: TestDetail;
  only?: number[];
  key: number;
  // Unset until the first answer is checked.
  phase?: "started" | "finished";
}

const KIND_LABELS: Record<GenerateKind, string> = {
  mixed: "Mixed",
  choice: "Multiple choice",
  open: "Open answers",
};

const hasText = (note: Note) => note.content.trim() !== "";

interface GenerateFormProps {
  notes: Note[];
  groups: NoteGroup[];
  assistant: AssistantStatus | null;
  busy: boolean;
  onConfigure: () => void;
  onGenerate: (options: GenerateOptions) => void;
  onCancel: () => void;
}

// A test written by the AI assistant from every note in a group, subgroups included.
function GenerateForm({ notes, groups, assistant, busy, onConfigure, onGenerate, onCancel }: GenerateFormProps) {
  // Groups from Notes, then works from Works; each one's notes in the order the sidebar shows.
  const options = useMemo(
    () =>
      SOURCE_SECTIONS.flatMap((section) =>
        flattenGroups(groups, section).map(({ group, label }) => ({
          id: group.id,
          label,
          section,
          notes: notesInReadingOrder(notes, groups, group.id).filter(hasText),
        })),
      ),
    [notes, groups],
  );
  const [picked, setPicked] = useState("");
  const [count, setCount] = useState(10);
  const [kind, setKind] = useState<GenerateKind>("mixed");
  const [instructions, setInstructions] = useState("");

  // Until a group is picked (or if it's gone), the first group with notes in it.
  const groupId = options.some((option) => option.id === picked)
    ? picked
    : (options.find((option) => option.notes.length > 0) ?? options[0])?.id ?? "";
  const chosen = options.find((option) => option.id === groupId) ?? null;
  const characters = chosen?.notes.reduce((sum, note) => sum + note.content.length, 0) ?? 0;
  const connected = assistant?.configured === true;
  const { minQuestions, maxQuestions } = LIMITS.generate;
  const countValid = Number.isInteger(count) && count >= minQuestions && count <= maxQuestions;
  const ready = connected && chosen !== null && chosen.notes.length > 0 && countValid && !busy;

  return (
    <form
      className="task-form generate-form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (!ready || !chosen) return;
        onGenerate({
          source: chosen.label,
          notes: chosen.notes.map((note) => ({ title: note.title, content: note.content })),
          count,
          kind,
          instructions,
        });
      }}
    >
      {assistant && !connected && (
        <div className="generate-setup" role="note">
          <p>Making a test from notes uses the AI assistant, which isn't connected yet.</p>
          <button type="button" className="pill-btn primary" onClick={onConfigure}>
            Configure assistant
          </button>
        </div>
      )}
      <label className="field">
        <span>Notes from</span>
        <select value={groupId} onChange={(event) => setPicked(event.target.value)}>
          {options.length === 0 && <option value="">No groups yet</option>}
          {SOURCE_SECTIONS.map((section) => {
            const inSection = options.filter((option) => option.section === section);
            return (
              inSection.length > 0 && (
                <optgroup key={section} label={SECTION_LABELS[section]}>
                  {inSection.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label} ({option.notes.length}{" "}
                      {section === "works"
                        ? option.notes.length === 1
                          ? "page"
                          : "pages"
                        : option.notes.length === 1
                          ? "note"
                          : "notes"}
                      )
                    </option>
                  ))}
                </optgroup>
              )
            );
          })}
        </select>
      </label>
      <div className="generate-row">
        <label className="field">
          <span>Questions</span>
          <input
            type="number"
            min={minQuestions}
            max={maxQuestions}
            value={Number.isNaN(count) ? "" : count}
            onChange={(event) => setCount(event.target.valueAsNumber)}
          />
        </label>
        <label className="field">
          <span>Kind</span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as GenerateKind)}
          >
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Instructions (optional)</span>
        <textarea
          className="generate-instructions"
          rows={2}
          maxLength={LIMITS.generate.instructions}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder="For example: focus on prepositions of place, and ask in English"
        />
      </label>
      <p className="form-hint">
        {options.length === 0
          ? "Put notes in a group first: the folder button beside Notes in the sidebar makes one."
          : chosen && chosen.notes.length > 0
            ? `${chosen.notes.length === 1 ? "1 note goes" : `${chosen.notes.length} notes go`} to the assistant (${characters.toLocaleString()} characters, subgroups included), as they are now, unsaved changes too. Pictures are left out.`
            : "That group has no notes with text yet."}
        {!countValid && ` Choose between ${minQuestions} and ${maxQuestions} questions.`}
      </p>
      <div className="task-form-actions">
        <button type="button" className="ghost-btn" onClick={onCancel}>
          cancel
        </button>
        <button type="submit" className="ghost-btn ghost-btn-active" disabled={!ready}>
          generate
        </button>
      </div>
    </form>
  );
}

interface TestsBoardProps {
  notes: Note[];
  groups: NoteGroup[];
  assistant: AssistantStatus | null;
  // Tests and folders, shared with the sidebar's Tests section.
  testsState: TestsState;
  // A test picked in the sidebar, to start here. onTestStarted clears it once it's taken, so
  // picking the same test again is a new request.
  testToStart: string | null;
  onTestStarted: () => void;
  onConfigure: () => void;
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

export function TestsBoard({
  notes,
  groups,
  assistant,
  testsState,
  testToStart,
  onTestStarted,
  onConfigure,
}: TestsBoardProps) {
  const { tests, folders, loadError, setTests } = testsState;
  const missions = useMissions();
  const { confirm } = useDialogs();
  const [run, setRun] = useState<Run | null>(null);
  const [panel, setPanel] = useState<"none" | "paste" | "format" | "generate">("none");
  const [pasted, setPasted] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // What's being generated right now, for the progress line.
  const [generating, setGenerating] = useState<GenerateOptions | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Returns whether the import went through, so a pasted draft is only cleared on success.
  const importText = async (text: string, source: string): Promise<boolean> => {
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch (cause) {
      setMessage({
        kind: "error",
        text: `Couldn't read ${source}: it isn't valid JSON (${errorMessage(cause, "unknown error")}).`,
      });
      return false;
    }
    setBusy(true);
    try {
      const result = await testsState.importBatch(payload);
      missions.apply({ board: result.board, feedback: [{ kind: "changed", action: "Weekly mission added", title: result.mission }] });
      const count = `${result.imported} test${result.imported === 1 ? "" : "s"}`;
      setMessage({
        kind: "ok",
        text:
          `Imported ${count} with ${result.questions} questions from ${source} into the folder “${result.folder.name}”. ` +
          `The weekly mission “${result.mission}” has a subtask for each test, ticked when you pass it at 100%.`,
      });
      return true;
    } catch (cause) {
      setMessage({ kind: "error", text: `Couldn't import ${source}:\n${errorMessage(cause, "")}` });
      return false;
    } finally {
      setBusy(false);
    }
  };

  // The form stays open meanwhile, so a failed attempt can be adjusted and tried again.
  const generate = async (options: GenerateOptions) => {
    setGenerating(options);
    setMessage(null);
    try {
      const result = await testsState.generate(options);
      const from = result.notesUsed === 1 ? "1 note" : `${result.notesUsed} notes`;
      setMessage({
        kind: "ok",
        text:
          `Made “${result.title}”: ${result.questions} questions from ${from} in ${options.source}.` +
          (result.truncated ? " The notes were long, so only the first part went to the assistant." : ""),
      });
      setPanel("none");
    } catch (cause) {
      setMessage({ kind: "error", text: `Couldn't make the test: ${errorMessage(cause, "unknown error")}` });
    } finally {
      setGenerating(null);
    }
  };

  const importFiles = async (files: FileList | null) => {
    for (const file of files ?? []) {
      if (!(await importText(await file.text(), file.name))) break;
    }
  };

  const start = async (summary: TestSummary) => {
    setMessage(null);
    try {
      setRun({ test: await fetchTest(summary.id), key: Date.now() });
    } catch (cause) {
      setMessage({ kind: "error", text: errorMessage(cause, "Couldn't open the test") });
    }
  };

  // A test picked in the sidebar starts here. Picking the one being taken leaves it be; cutting
  // short a run that has answers in it asks first. A finished run was already saved, so it's
  // left without asking, and picking that same test again starts it afresh.
  // A request waits for the list to load; it's taken once, whatever comes of it.
  useEffect(() => {
    if (!testToStart || !tests) return;
    onTestStarted();
    const summary = tests.find((test) => test.id === testToStart);
    if (!summary) return;
    if (run && run.test.id === summary.id && run.phase !== "finished") return;
    void (async () => {
      if (
        run?.phase === "started" &&
        !(await confirm({
          title: `Leave “${run.test.title}” for “${summary.title}”?`,
          message: "This run's answers so far aren't saved.",
          confirmLabel: "Leave it",
          cancelLabel: "Stay",
        }))
      ) {
        return;
      }
      await start(summary);
    })();
  }, [testToStart, tests, run, onTestStarted, confirm]);

  // Deleting a test takes its subtask out of its weekly mission (and the mission too, once it has
  // no subtasks left), so the board is fetched again.
  const remove = async (summary: TestSummary) => {
    const sure = await confirm({
      title: `Delete “${summary.title}”?`,
      message: "Its past scores are kept. If it came in an import, its subtask leaves that weekly mission.",
      confirmLabel: "Delete",
    });
    if (!sure) return;
    try {
      await testsState.remove(summary.id);
      void missions.refresh();
    } catch (cause) {
      setMessage({ kind: "error", text: errorMessage(cause, "Couldn't delete the test") });
    }
  };

  if (run) {
    return (
      <TestRunner
        key={run.key}
        test={run.test}
        only={run.only}
        onRecorded={(result) => {
          setTests(result.tests);
          if (result.update) missions.apply(result.update);
        }}
        onRetake={() => setRun({ test: run.test, key: Date.now() })}
        onPractice={(only) => setRun({ test: run.test, only, key: Date.now() })}
        onExit={() => setRun(null)}
        onPhase={(phase) => setRun((current) => (current && current.phase !== phase ? { ...current, phase } : current))}
      />
    );
  }

  if (!tests) {
    return (
      <div className="pane-center">
        <p className="pane-message">{loadError ? `Tests unavailable — ${loadError}` : "Loading tests…"}</p>
      </div>
    );
  }

  const totalQuestions = tests.reduce((sum, test) => sum + test.questionCount, 0);
  // Each import's folder, by name, with its tests in the order the file gave them; tests from
  // no folder (made from notes, or whose folder was deleted) come last.
  const inFolders = [...folders]
    .sort(byName)
    .map((folder) => ({ folder, tests: tests.filter((test) => test.folderId === folder.id) }))
    .filter((part) => part.tests.length > 0);
  const loose = tests.filter((test) => !folders.some((folder) => folder.id === test.folderId));

  const card = (test: TestSummary) => (
    <article key={test.id} className="test-card">
      <div className="test-card-main">
        <h3 className="task-title">{test.title}</h3>
        {test.description && <p className="task-subtext">{test.description}</p>}
        <div className="test-meta">
          <span>{describeCounts(test)}</span>
          <span>{test.last ? `last ${test.last.score}/${test.last.total}` : "not taken yet"}</span>
          {test.bestPercent !== null && <span className="mission-highlight">best {test.bestPercent}%</span>}
          {test.attempts > 0 && <span>taken {test.attempts}×</span>}
        </div>
      </div>
      <span className="test-card-actions">
        <button type="button" className="pill-btn primary" onClick={() => void start(test)}>
          Start
        </button>
        <button type="button" className="ghost-btn" onClick={() => void remove(test)}>
          delete
        </button>
      </span>
    </article>
  );

  return (
    <div className="editor-scroll">
      <div className="missions-content">
        <header className="missions-header">
          <div className="kicker">Tests</div>
          <h1 className="missions-level">Test your learning</h1>
          <div className="missions-subline">
            <span>
              {tests.length} test{tests.length === 1 ? "" : "s"} · {totalQuestions} questions
            </span>
            <span>multiple choice and open answers, made from your notes or imported as JSON</span>
          </div>
        </header>

        <div className="missions-toolbar">
          <button
            type="button"
            className={`pill-btn primary ${panel === "generate" ? "pill-btn-active" : ""}`}
            aria-expanded={panel === "generate"}
            onClick={() => setPanel(panel === "generate" ? "none" : "generate")}
          >
            Generate from notes
          </button>
          <button type="button" className="pill-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
            Import JSON file
          </button>
          <button
            type="button"
            className={`ghost-btn ${panel === "paste" ? "ghost-btn-active" : ""}`}
            onClick={() => setPanel(panel === "paste" ? "none" : "paste")}
          >
            paste JSON
          </button>
          <button
            type="button"
            className={`ghost-btn ${panel === "format" ? "ghost-btn-active" : ""}`}
            onClick={() => setPanel(panel === "format" ? "none" : "format")}
          >
            the format
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            multiple
            hidden
            onChange={(event) => {
              void importFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

        {generating && (
          <p className="test-message test-message-generating" role="status">
            Writing {generating.count} questions from {generating.notes.length}{" "}
            {generating.notes.length === 1 ? "note" : "notes"} in {generating.source}… this can take a minute.
          </p>
        )}
        {message && (
          <p className={`test-message test-message-${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>
            {message.text}
          </p>
        )}

        {panel === "generate" && (
          <GenerateForm
            notes={notes}
            groups={groups}
            assistant={assistant}
            busy={generating !== null}
            onConfigure={onConfigure}
            onGenerate={(options) => void generate(options)}
            onCancel={() => setPanel("none")}
          />
        )}

        {panel === "paste" && (
          <form
            className="task-form"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void importText(pasted, "the pasted JSON").then((ok) => {
                if (ok) {
                  setPasted("");
                  setPanel("none");
                }
              });
            }}
          >
            <label className="field">
              <span>JSON</span>
              <textarea
                className="json-input"
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
                placeholder='{ "title": "…", "questions": [ … ] }'
                spellCheck={false}
                autoFocus
              />
            </label>
            <div className="task-form-actions">
              <button type="button" className="ghost-btn" onClick={() => setPanel("none")}>
                cancel
              </button>
              <button type="submit" className="ghost-btn ghost-btn-active" disabled={busy || pasted.trim() === ""}>
                import
              </button>
            </div>
          </form>
        )}

        {panel === "format" && <FormatGuide />}

        {tests.length === 0 ? (
          <p className="missions-empty">
            No tests yet. Generate one from a group of notes, import a JSON file (see “the format”), or try
            documentation\sample-test.json.
          </p>
        ) : (
          <>
            {inFolders.map(({ folder, tests: inFolder }) => {
              const passed = inFolder.filter((test) => test.bestPercent === 100).length;
              return (
                <section key={folder.id} className="test-folder" aria-labelledby={`test-folder-${folder.id}`}>
                  <h2 className="test-folder-heading" id={`test-folder-${folder.id}`}>
                    <Icon name="folder" size={18} />
                    <span>{folder.name}</span>
                  </h2>
                  <p className="test-folder-meta">
                    {inFolder.length} test{inFolder.length === 1 ? "" : "s"} · {passed} passed at 100%
                  </p>
                  <div className="test-list">{inFolder.map(card)}</div>
                </section>
              );
            })}
            {loose.length > 0 && (
              <section className="test-folder" aria-label={inFolders.length > 0 ? "Not in a folder" : "Tests"}>
                {inFolders.length > 0 && <h2 className="test-folder-heading">Not in a folder</h2>}
                <div className="test-list">{loose.map(card)}</div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
