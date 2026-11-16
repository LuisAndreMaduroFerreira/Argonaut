import { useEffect, useRef, useState } from "react";
import type { BoardUpdate, TestDetail, TestQuestion, TestSummary } from "../types";
import { gradeChoice, gradeOpen, shuffled, type Verdict } from "../lib/grading";
import { recordAttempt } from "../lib/testsApi";
import { ProgressBar } from "./ProgressBar";
import { RichRest, RichText, inlineCode, segments } from "./RichText";
import { errorMessage } from "../lib/api";

interface RunItem {
  index: number; // position in the test as written
  question: TestQuestion;
  options: string[]; // display order, shuffled unless the test says otherwise
}

interface Answer {
  given: string | string[];
  verdict: Verdict;
  counted: boolean; // correct, or a near miss you chose to count
}

function prepare(test: TestDetail, only?: number[]): RunItem[] {
  const indexes = only ?? test.questions.map((_, index) => index);
  const items = indexes.flatMap((index) => {
    const question = test.questions[index];
    if (!question) return [];
    const options = question.type === "choice" ? question.options : [];
    return [{ index, question, options: test.shuffleOptions ? shuffled(options) : options }];
  });
  return test.shuffleQuestions ? shuffled(items) : items;
}

// The question's opening words are the heading; any code and text after it follow beneath.
function QuestionPrompt({ text }: { text: string }) {
  const parts = segments(text);
  const lead = parts[0]?.kind === "text" ? parts[0] : null;
  return (
    <>
      <h1 className="test-prompt">{lead ? inlineCode(lead.body) : "Read the code:"}</h1>
      <RichRest parts={lead ? parts.slice(1) : parts} className="test-prompt-more" />
    </>
  );
}

function formatGiven(given: string | string[]): string {
  return Array.isArray(given) ? given.join(", ") : given;
}

function expectedAnswer(question: TestQuestion): string {
  if (question.type === "choice") return question.answer.join(", ");
  const [first, ...others] = question.answer;
  return others.length > 0 ? `${first} (also accepted: ${others.join(" · ")})` : (first ?? "");
}

interface TestRunnerProps {
  test: TestDetail;
  only?: number[]; // practice run over these questions; not saved to history
  // The update is there when a run at 100% ticked the test's mission subtask.
  onRecorded: (result: { tests: TestSummary[]; update: BoardUpdate | null }) => void;
  onRetake: () => void;
  onPractice: (indexes: number[]) => void;
  onExit: () => void;
  // "started" once an answer is checked, "finished" when the results show: only a started run
  // has answers that leaving would lose.
  onPhase: (phase: "started" | "finished") => void;
}

export function TestRunner({ test, only, onRecorded, onRetake, onPractice, onExit, onPhase }: TestRunnerProps) {
  const [items] = useState(() => prepare(test, only));
  const [position, setPosition] = useState(0);
  const [chosen, setChosen] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [finished, setFinished] = useState(false);
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved" | "failed"; error?: string }>({
    state: "idle",
  });
  // Set when this run passed at 100% and ticked the test's subtask in its weekly mission.
  const [ticked, setTicked] = useState(false);
  const submitRef = useRef<HTMLButtonElement | null>(null);
  const record = !only;

  const item = items[position];
  const answer = answers[position];
  const answered = answer !== undefined;
  const isLast = position === items.length - 1;

  // After checking, Enter moves on.
  useEffect(() => {
    if (answered) submitRef.current?.focus();
  }, [answered]);

  if (!item) return null;

  if (finished) {
    const score = answers.filter((entry) => entry.counted).length;
    const missed = items.filter((_, i) => !answers[i]?.counted).map((entry) => entry.index);
    return (
      <div className="editor-scroll">
        <div className="test-content">
          <div className="kicker">{record ? "Results" : "Practice results"} · {test.title}</div>
          <h1 className="test-score">
            {score}/{items.length}
          </h1>
          <ProgressBar value={score} max={items.length} label="Score" />
          <div className="missions-subline">
            <span>{Math.round((100 * score) / items.length)}% correct</span>
            <span>
              {!record
                ? "practice — not saved"
                : save.state === "saving"
                  ? "saving…"
                  : save.state === "saved"
                    ? ticked
                      ? "saved · its subtask in the weekly mission is ticked"
                      : "saved to your history"
                    : save.state === "failed"
                      ? `not saved — ${save.error}`
                      : ""}
            </span>
          </div>
          <ol className="test-review">
            {items.map((entry, i) => {
              const result = answers[i];
              if (!result) return null;
              return (
                <li key={entry.index} className={result.counted ? "review-right" : "review-wrong"}>
                  <RichText text={entry.question.question} className="review-question" />
                  <div className="review-line">
                    {result.counted ? "✓" : "✗"} you:{" "}
                    {formatGiven(result.given) ? inlineCode(formatGiven(result.given)) : "—"}
                  </div>
                  {!result.counted && (
                    <div className="review-line">answer: {inlineCode(expectedAnswer(entry.question))}</div>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="test-actions">
            <button type="button" className="pill-btn primary" onClick={onRetake}>
              Take it again
            </button>
            {missed.length > 0 && (
              <button type="button" className="pill-btn" onClick={() => onPractice(missed)}>
                Practice the {missed.length} missed
              </button>
            )}
            <button type="button" className="pill-btn" onClick={onExit}>
              Back to tests
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { question } = item;
  const multiple = question.type === "choice" && question.answer.length > 1;
  const canCheck = question.type === "choice" ? chosen.length > 0 : typed.trim().length > 0;

  const check = () => {
    const given = question.type === "choice" ? chosen : typed.trim();
    const verdict =
      question.type === "choice" ? gradeChoice(question.answer, chosen) : gradeOpen(question.answer, typed);
    setAnswers((prev) => [...prev, { given, verdict, counted: verdict === "correct" }]);
    onPhase("started");
  };

  const countIt = () => {
    setAnswers((prev) => prev.map((entry, i) => (i === position ? { ...entry, counted: true } : entry)));
  };

  const next = async () => {
    if (!isLast) {
      setPosition((current) => current + 1);
      setChosen([]);
      setTyped("");
      return;
    }
    setFinished(true);
    onPhase("finished");
    if (!record) return;
    setSave({ state: "saving" });
    try {
      const result = await recordAttempt(
        test.id,
        items.map((entry, i) => ({
          question: entry.index,
          given: answers[i]!.given,
          correct: answers[i]!.counted,
        })),
      );
      setTicked(result.update !== null);
      onRecorded(result);
      setSave({ state: "saved" });
    } catch (cause) {
      setSave({ state: "failed", error: errorMessage(cause, "the API didn't answer") });
    }
  };

  const toggle = (option: string) => {
    setChosen((current) =>
      !multiple ? [option] : current.includes(option) ? current.filter((o) => o !== option) : [...current, option],
    );
  };

  return (
    <div className="editor-scroll">
      <div className="test-content">
        <header className="test-run-header">
          <div className="kicker">
            {record ? "Test" : "Practice"} · {test.title}
          </div>
          <div className="test-progress-line">
            <span>
              Question {position + 1} of {items.length}
            </span>
            <button type="button" className="ghost-btn" onClick={onExit}>
              quit
            </button>
          </div>
          <ProgressBar value={position + (answered ? 1 : 0)} max={items.length} label="Test progress" />
        </header>

        <form
          key={position}
          className="test-question"
          onSubmit={(event) => {
            event.preventDefault();
            if (answered) void next();
            else if (canCheck) check();
          }}
        >
          <QuestionPrompt text={question.question} />

          {question.type === "choice" ? (
            <fieldset className="choice-list" disabled={answered}>
              <legend className="choice-hint">{multiple ? "Choose all that apply" : "Choose one"}</legend>
              {item.options.map((option) => {
                const selected = chosen.includes(option);
                const correct = question.answer.includes(option);
                const state = !answered ? "" : correct ? (selected ? "right" : "missed") : selected ? "wrong" : "";
                return (
                  <label key={option} className={`choice-option ${selected ? "choice-option-selected" : ""} ${state ? `choice-option-${state}` : ""}`}>
                    <input
                      type={multiple ? "checkbox" : "radio"}
                      name="choice"
                      checked={selected}
                      onChange={() => toggle(option)}
                    />
                    <span className="choice-text">{inlineCode(option)}</span>
                    {state === "right" && <span className="choice-mark">✓</span>}
                    {state === "missed" && <span className="choice-mark">✓ right answer</span>}
                    {state === "wrong" && <span className="choice-mark">✗</span>}
                  </label>
                );
              })}
            </fieldset>
          ) : (
            <input
              className="open-answer"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              disabled={answered}
              placeholder="Your answer"
              aria-label="Your answer"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          )}

          {answer && (
            <div className={`test-feedback ${answer.counted ? "test-feedback-right" : "test-feedback-wrong"}`} role="status">
              <div className="test-verdict">
                {answer.counted
                  ? answer.verdict === "correct"
                    ? "Correct"
                    : "Counted as correct"
                  : answer.verdict === "accents"
                    ? "Almost — check the accents"
                    : "Not quite"}
              </div>
              {(!answer.counted || question.type === "open") && (
                <div className="test-expected">Answer: {inlineCode(expectedAnswer(question))}</div>
              )}
              {question.explanation && <RichText text={question.explanation} className="test-explanation" />}
              {question.type === "open" && !answer.counted && (
                <button type="button" className="ghost-btn ghost-btn-active" onClick={countIt}>
                  I was right — count it
                </button>
              )}
            </div>
          )}

          <div className="test-actions">
            <button ref={submitRef} type="submit" className="pill-btn primary" disabled={!answered && !canCheck}>
              {!answered ? "Check" : isLast ? "See results" : "Next"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
