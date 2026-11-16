import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { useMissions } from "../hooks/useMissions";
import { useDialogs } from "../hooks/useDialogs";
import { errorMessage } from "../lib/api";
import {
  addSubtask,
  createTask,
  removeSubtask,
  removeTask,
  setSubtaskDone,
  setTaskDone,
  updateSubtask,
  updateTask,
} from "../lib/tasksApi";
import { CADENCE_LABELS, streakLabel, timeLeft } from "../lib/missionFormat";
import { CADENCES, LIMITS, type BoardUpdate, type Cadence, type Subtask, type Task, type TextFields } from "../types";
import { ProgressBar } from "./ProgressBar";

// Runs one task change and applies the board it returns; resolves false if it failed.
type Run = (action: () => Promise<BoardUpdate>) => Promise<boolean>;

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function cancelOnEscape(onCancel: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === "Escape") onCancel();
  };
}

interface TextInputsProps {
  value: TextFields;
  onChange: (value: TextFields) => void;
  titleLabel: string;
  titlePlaceholder: string;
  autoFocus?: boolean;
}

function TextInputs({ value, onChange, titleLabel, titlePlaceholder, autoFocus }: TextInputsProps) {
  return (
    <>
      <label className="field">
        <span>{titleLabel}</span>
        <input
          value={value.title}
          onChange={(event) => onChange({ ...value, title: event.target.value })}
          placeholder={titlePlaceholder}
          maxLength={LIMITS.taskTitle}
          required
          autoFocus={autoFocus}
        />
      </label>
      <label className="field">
        <span>Subtext</span>
        <input
          value={value.subtext}
          onChange={(event) => onChange({ ...value, subtext: event.target.value })}
          placeholder="Optional"
          maxLength={LIMITS.taskSubtext}
        />
      </label>
    </>
  );
}

interface TaskFormValues {
  fields: TextFields;
  cadence: Cadence;
  repeats: boolean;
  subtasks: TextFields[];
}

const PERIOD_WORDS: Record<Cadence, string> = {
  DAILY: "day",
  WEEKLY: "week",
  MONTHLY: "month",
  YEARLY: "year",
};

// How a task behaves, in words: shown on its card and as the form's hint.
function kindLabel(repeats: boolean, cadence: Cadence): string {
  return repeats ? `Repeats ${CADENCE_LABELS[cadence].toLowerCase()}` : "One-time";
}

interface TaskFormProps {
  task?: Task; // editing when given
  initialCadence: Cadence;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (values: TaskFormValues) => Promise<void>;
}

function TaskForm({ task, initialCadence, busy, onCancel, onSubmit }: TaskFormProps) {
  const [fields, setFields] = useState<TextFields>({ title: task?.title ?? "", subtext: task?.subtext ?? "" });
  const [cadence, setCadence] = useState<Cadence>(task?.cadence ?? initialCadence);
  const [repeats, setRepeats] = useState(task?.repeats ?? true);
  const [subtasks, setSubtasks] = useState<(TextFields & { key: string })[]>([]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit({ fields, cadence, repeats, subtasks: subtasks.map(({ title, subtext }) => ({ title, subtext })) });
  };

  return (
    <form className="task-form" onSubmit={handleSubmit} onKeyDown={cancelOnEscape(onCancel)}>
      <div className="task-form-row">
        <TextInputs
          value={fields}
          onChange={setFields}
          titleLabel="Task"
          titlePlaceholder="French learning"
          autoFocus
        />
        <label className="field">
          <span>Kind</span>
          <select value={repeats ? "repeats" : "once"} onChange={(event) => setRepeats(event.target.value === "repeats")}>
            <option value="repeats">Repeating</option>
            <option value="once">One-time</option>
          </select>
        </label>
        <label className="field">
          <span>{repeats ? "Every" : "List"}</span>
          <select value={cadence} onChange={(event) => setCadence(event.target.value as Cadence)}>
            {CADENCES.map((option) => (
              <option key={option} value={option}>
                {repeats ? PERIOD_WORDS[option] : CADENCE_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="form-hint">
        {repeats
          ? `Starts undone again every ${PERIOD_WORDS[cadence]}.`
          : `Stays done once ticked. Shown under ${CADENCE_LABELS[cadence]} until then, and for the rest of that ${PERIOD_WORDS[cadence]} after.`}
      </p>
      {!task && (
        <div className="subtask-drafts">
          {subtasks.map((subtask, index) => (
            <div key={subtask.key} className="subtask-form-row">
              <TextInputs
                value={subtask}
                onChange={(next) =>
                  setSubtasks((prev) => prev.map((item) => (item.key === subtask.key ? { ...item, ...next } : item)))
                }
                titleLabel={`Subtask ${index + 1}`}
                titlePlaceholder="Prepositions"
                autoFocus
              />
              <button
                type="button"
                className="ghost-btn"
                aria-label={`Remove subtask ${index + 1}`}
                onClick={() => setSubtasks((prev) => prev.filter((item) => item.key !== subtask.key))}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setSubtasks((prev) => [...prev, { key: crypto.randomUUID(), title: "", subtext: "" }])}
          >
            + subtask
          </button>
        </div>
      )}
      <div className="task-form-actions">
        <button type="button" className="ghost-btn" onClick={onCancel}>
          cancel
        </button>
        <button type="submit" className="ghost-btn ghost-btn-active" disabled={busy}>
          {task ? "save" : "add task"}
        </button>
      </div>
    </form>
  );
}

interface SubtaskFormProps {
  subtask?: Subtask; // editing when given
  busy: boolean;
  onCancel: () => void;
  onSubmit: (fields: TextFields) => Promise<void>;
}

function SubtaskForm({ subtask, busy, onCancel, onSubmit }: SubtaskFormProps) {
  const [fields, setFields] = useState<TextFields>({
    title: subtask?.title ?? "",
    subtext: subtask?.subtext ?? "",
  });

  return (
    <form
      className="subtask-form-row"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(fields);
      }}
      onKeyDown={cancelOnEscape(onCancel)}
    >
      <TextInputs value={fields} onChange={setFields} titleLabel="Subtask" titlePlaceholder="Prepositions" autoFocus />
      <span className="subtask-form-actions">
        <button type="button" className="ghost-btn" onClick={onCancel}>
          cancel
        </button>
        <button type="submit" className="ghost-btn ghost-btn-active" disabled={busy}>
          {subtask ? "save" : "add"}
        </button>
      </span>
    </form>
  );
}

interface DoneBoxProps {
  done: boolean;
  busy: boolean;
  label: string;
  onToggle: () => void;
}

function DoneBox({ done, busy, label, onToggle }: DoneBoxProps) {
  return (
    <input
      type="checkbox"
      className="done-box"
      checked={done}
      disabled={busy}
      onChange={onToggle}
      aria-label={label}
    />
  );
}

interface SubtaskRowProps {
  subtask: Subtask;
  busy: boolean;
  run: Run;
}

function SubtaskRow({ subtask, busy, run }: SubtaskRowProps) {
  const { confirm } = useDialogs();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="subtask-row">
        <SubtaskForm
          subtask={subtask}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSubmit={async (fields) => {
            if (await run(() => updateSubtask(subtask.id, fields))) setEditing(false);
          }}
        />
      </li>
    );
  }

  return (
    <li className={`subtask-row ${subtask.done ? "subtask-row-done" : ""}`}>
      <DoneBox
        done={subtask.done}
        busy={busy}
        label={subtask.title}
        onToggle={() => void run(() => setSubtaskDone(subtask.id, !subtask.done))}
      />
      <div className="task-text">
        <span className="subtask-title">{subtask.title}</span>
        {subtask.subtext && <span className="subtask-subtext">{subtask.subtext}</span>}
      </div>
      <span className="row-actions">
        <button type="button" className="ghost-btn" onClick={() => setEditing(true)} disabled={busy}>
          edit
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={async () => {
            if (await confirm({ title: `Delete the subtask “${subtask.title}”?`, confirmLabel: "Delete" })) {
              void run(() => removeSubtask(subtask.id));
            }
          }}
          disabled={busy}
        >
          delete
        </button>
      </span>
    </li>
  );
}

interface TaskCardProps {
  task: Task;
  busy: boolean;
  run: Run;
}

function TaskCard({ task, busy, run }: TaskCardProps) {
  const { confirm } = useDialogs();
  const [editing, setEditing] = useState(false);
  const [addingSubtask, setAddingSubtask] = useState(false);
  const streak = streakLabel(task.streak, task.cadence);
  const subtasksDone = task.subtasks.filter((subtask) => subtask.done).length;
  // Subtasks fill the bar step by step; a task without them is simply done or not.
  const progress =
    task.subtasks.length > 0
      ? { value: subtasksDone, max: task.subtasks.length }
      : { value: task.done ? 1 : 0, max: 1 };

  if (editing) {
    return (
      <article className="task-card">
        <TaskForm
          task={task}
          initialCadence={task.cadence}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSubmit={async ({ fields, cadence, repeats }) => {
            if (await run(() => updateTask(task.id, { ...fields, cadence, repeats }))) setEditing(false);
          }}
        />
      </article>
    );
  }

  const handleDelete = async () => {
    const withSubtasks = task.subtasks.length > 0 ? " and its subtasks" : "";
    if (await confirm({ title: `Delete “${task.title}”${withSubtasks}?`, confirmLabel: "Delete" })) {
      void run(() => removeTask(task.id));
    }
  };

  return (
    <article className={`task-card ${task.done ? "task-card-done" : ""}`}>
      <div className="task-row">
        <DoneBox
          done={task.done}
          busy={busy}
          label={task.title}
          onToggle={() => void run(() => setTaskDone(task.id, !task.done))}
        />
        <div className="task-text">
          <h2 className="task-title">{task.title}</h2>
          {task.subtext && <p className="task-subtext">{task.subtext}</p>}
        </div>
        <span className="row-actions">
          <button type="button" className="ghost-btn" onClick={() => setAddingSubtask(true)} disabled={busy}>
            + subtask
          </button>
          <button type="button" className="ghost-btn" onClick={() => setEditing(true)} disabled={busy}>
            edit
          </button>
          <button type="button" className="ghost-btn" onClick={handleDelete} disabled={busy}>
            delete
          </button>
        </span>
      </div>

      {(task.subtasks.length > 0 || addingSubtask) && (
        <ul className="subtask-list">
          {task.subtasks.map((subtask) => (
            <SubtaskRow key={subtask.id} subtask={subtask} busy={busy} run={run} />
          ))}
          {addingSubtask && (
            <li className="subtask-row">
              <SubtaskForm
                busy={busy}
                onCancel={() => setAddingSubtask(false)}
                onSubmit={async (fields) => {
                  if (await run(() => addSubtask(task.id, fields))) setAddingSubtask(false);
                }}
              />
            </li>
          )}
        </ul>
      )}

      <div className="task-progress">
        <ProgressBar value={progress.value} max={progress.max} label={`${task.title} progress`} />
      </div>

      <div className="task-meta">
        <span className={`task-kind ${task.repeats ? "" : "task-kind-once"}`}>{kindLabel(task.repeats, task.cadence)}</span>
        {task.subtasks.length > 0 && (
          <span>
            {subtasksDone}/{task.subtasks.length} subtasks
          </span>
        )}
        {task.done && <span className="mission-highlight">done</span>}
        {streak && <span className="mission-highlight">{streak}</span>}
      </div>
    </article>
  );
}

interface MissionsBoardProps {
  cadence: Cadence;
  onCadenceChange: (cadence: Cadence) => void;
}

export function MissionsBoard({ cadence, onCadenceChange }: MissionsBoardProps) {
  const { board, boardError, apply } = useMissions();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const now = useNow(30_000);

  if (!board) {
    return (
      <div className="pane-center">
        <p className="pane-message">
          {boardError ? `Tasks unavailable — ${boardError}` : "Loading tasks…"}
        </p>
      </div>
    );
  }

  const run: Run = async (action) => {
    setBusy(true);
    setActionError(null);
    try {
      apply(await action());
      return true;
    } catch (cause) {
      setActionError(errorMessage(cause, "Something went wrong"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const label = CADENCE_LABELS[cadence];
  const visible = board.tasks.filter((task) => task.cadence === cadence);
  const doneCount = visible.filter((task) => task.done).length;

  return (
    <div className="editor-scroll">
      <div className="missions-content">
        <header className="missions-header">
          <div className="kicker">Missions</div>
          <h1 className="missions-level">{label}</h1>
          <ProgressBar value={doneCount} max={visible.length} label={`${label} progress`} />
          <div className="missions-subline">
            <span>
              {doneCount}/{visible.length} {label.toLowerCase()}
            </span>
            <span>resets in {timeLeft(board.periods[cadence].endsAt, now)}</span>
          </div>
        </header>

        <div className="missions-toolbar">
          <div className="segmented" role="tablist" aria-label="Cadence">
            {CADENCES.map((option) => {
              const tasks = board.tasks.filter((task) => task.cadence === option);
              return (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  aria-selected={option === cadence}
                  className={`segment ${option === cadence ? "segment-active" : ""}`}
                  onClick={() => onCadenceChange(option)}
                >
                  {CADENCE_LABELS[option]}
                  <span className="segment-count">
                    {tasks.filter((task) => task.done).length}/{tasks.length}
                  </span>
                </button>
              );
            })}
          </div>
          <button type="button" className="ghost-btn ghost-btn-active missions-new" onClick={() => setCreating(true)}>
            + new task
          </button>
        </div>

        {creating && (
          <TaskForm
            initialCadence={cadence}
            busy={busy}
            onCancel={() => setCreating(false)}
            onSubmit={async ({ fields, cadence: chosen, repeats, subtasks }) => {
              if (await run(() => createTask({ ...fields, cadence: chosen, repeats, subtasks }))) {
                setCreating(false);
                onCadenceChange(chosen);
              }
            }}
          />
        )}

        {actionError && <p className="form-error">{actionError}</p>}

        {visible.length === 0 ? (
          <p className="missions-empty">
            No {label.toLowerCase()} tasks yet — add one with “+ new task”, or ask Argonaut.
          </p>
        ) : (
          <div className="task-list">
            {visible.map((task) => (
              <TaskCard key={task.id} task={task} busy={busy} run={run} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
