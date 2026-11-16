// What the API and the web app agree on: the values that may be stored, their limits, and the
// shape of everything the API answers with. Both sides import this file, so neither can drift
// from the other. Nothing here may depend on the browser or on Node.

// The sidebar sections that hold groups of notes: notes, works (books written a page per
// note), and agent skills (instructions for AI agents, a markdown note each, kept in folders).
// Tests and Papers are sections too, with folders of their own.
export const SECTIONS = ["notes", "works", "skills"] as const;
export type Section = (typeof SECTIONS)[number];

export const SIDEBAR_SECTIONS = [...SECTIONS, "tests", "papers"] as const;
export type SidebarSection = (typeof SIDEBAR_SECTIONS)[number];

export const CADENCES = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
export type Cadence = (typeof CADENCES)[number];

export const SPELL_LANGUAGES = {
  en: "English",
  pt: "Portuguese",
  fr: "French",
  es: "Spanish",
} as const;
export type SpellLanguage = keyof typeof SPELL_LANGUAGES;

// What a note may store as its spelling language: "" works it out from the text, "off" skips
// checking, or one of the codes above.
export const NOTE_LANGUAGES: readonly string[] = ["", "off", ...Object.keys(SPELL_LANGUAGES)];

// The pictures a note can hold. SVG is left out: it can carry scripts.
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export function isImageType(value: string): value is ImageType {
  return (IMAGE_TYPES as readonly string[]).includes(value);
}

export const LIMITS = {
  imageBytes: 15 * 1024 * 1024,
  paperBytes: 50 * 1024 * 1024,
  // Speech for the assistant: 16 kHz mono 16-bit WAV, 32,000 bytes a second, up to a minute.
  speechSampleRate: 16_000,
  speechSeconds: 60,
  speechBytes: 44 + 60 * 32_000,
  // Groups of notes, and folders of tests and papers.
  folderName: 80,
  taskTitle: 80,
  taskSubtext: 240,
  // Subtasks a task can be given by hand; a test import's mission has one per test.
  subtasks: 20,
  spellText: 50_000,
  spellWord: 80,
  generate: { minQuestions: 3, maxQuestions: 30, instructions: 500 },
} as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  // One of NOTE_LANGUAGES.
  language: string;
  // The sidebar group the note is in, or null for none. It also shows as the note's first tag.
  groupId: string | null;
  // Its place among the notes of its group, as dragged there; null sorts last.
  position: number | null;
  createdAt: number;
  updatedAt: number;
}

// A sidebar group; one with a parent is a subgroup. Top-level groups belong to a section; in
// Works each is a book. A subgroup takes its section from the group it's in, so its own is null.
export interface NoteGroup {
  id: string;
  parentId: string | null;
  section: Section | null;
  name: string;
}

// A PDF in the sidebar's Papers section, read in the document area. Its details are read from
// the file when it's added, and can be edited.
export interface Paper {
  id: string;
  title: string;
  authors: string;
  year: number | null;
  doi: string;
  fileName: string;
  byteSize: number;
  pages: number | null;
  // The Papers folder it's filed in, or null for none.
  folderId: string | null;
  addedAt: number;
}

export interface PaperFolder {
  id: string;
  name: string;
}

// Every change to papers or their folders answers with both lists.
export interface PapersState {
  papers: Paper[];
  folders: PaperFolder[];
}

export interface PaperPatch {
  title?: string;
  authors?: string;
  year?: number | null;
  doi?: string;
  folderId?: string | null;
}

export interface Misspelling {
  start: number;
  end: number;
  word: string;
}

export interface TextFields {
  title: string;
  subtext: string;
}

export interface Subtask extends TextFields {
  id: string;
  done: boolean;
}

// A repeating task starts undone every period of its cadence. A one-time task stays done once
// ticked; it is listed under its cadence's tab until then, and leaves the list when the period
// it was finished in has passed.
export interface Task extends TextFields {
  id: string;
  cadence: Cadence;
  repeats: boolean;
  done: boolean;
  streak: number;
  subtasks: Subtask[];
}

export interface TaskBoard {
  // endsAt is an ISO date.
  periods: Record<Cadence, { key: string; endsAt: string }>;
  tasks: Task[];
}

export interface TaskDraft extends TextFields {
  cadence: Cadence;
  repeats: boolean;
  subtasks: TextFields[];
}

export interface TaskPatch {
  title?: string;
  subtext?: string;
  cadence?: Cadence;
  repeats?: boolean;
}

export type TaskFeedback =
  | { kind: "completed"; title: string; cadence: Cadence; done: number; total: number; streak: number }
  | { kind: "changed"; action: string; title: string };

// Every task change answers with the refreshed board.
export interface BoardUpdate {
  board: TaskBoard;
  feedback: TaskFeedback[];
}

// A folder in the sidebar's Tests section: the tests of one import.
export interface TestFolder {
  id: string;
  name: string;
}

// A choice question's answer lists the correct options; an open one's lists accepted answers.
export type TestQuestion =
  | { type: "choice"; question: string; options: string[]; answer: string[]; explanation: string }
  | { type: "open"; question: string; answer: string[]; explanation: string };

export interface TestSummary {
  id: string;
  title: string;
  description: string;
  // The Tests folder it was imported into; null for a generated test, or once its folder is gone.
  folderId: string | null;
  questionCount: number;
  openCount: number;
  attempts: number;
  // finishedAt is an ISO date.
  last: { score: number; total: number; finishedAt: string } | null;
  bestPercent: number | null;
}

export interface TestDetail {
  id: string;
  title: string;
  description: string;
  shuffleOptions: boolean;
  shuffleQuestions: boolean;
  questions: TestQuestion[];
}

// One answered question: its place in the test, what was answered, and whether it counted.
export interface TestResponse {
  question: number;
  given: string | string[];
  correct: boolean;
}

export const GENERATE_KINDS = ["mixed", "choice", "open"] as const;
export type GenerateKind = (typeof GENERATE_KINDS)[number];

export interface GenerateOptions {
  // Where the notes come from, shown in the test's description: "French › Verbs".
  source: string;
  notes: { title: string; content: string }[];
  count: number;
  kind: GenerateKind;
  instructions: string;
}

export interface AssistantStatus {
  configured: boolean;
  model: string;
  // The .env file the key belongs in, when .env says where it is.
  settingsFile: string;
}

export type Theme = "light" | "dark";
export type PanelTab = "assistant" | "history";

// Interface state kept in Postgres (app_state), so every window opens onto the same workspace.
export interface WorkspaceState {
  openNoteIds: string[];
  // Papers open in tabs of their own, after the notes.
  openPaperIds: string[];
  // A stored tab key (see tabs.ts), or null when nothing is open.
  activeTab: string | null;
  missionCadence: Cadence;
}

export interface PreferencesState {
  theme: Theme;
  voiceURI: string;
  missionBriefingDay: string | null;
  // The side panel beside the document on wide screens: open or collapsed, and its tab.
  panelOpen: boolean;
  panelTab: PanelTab;
  // Sidebar groups and folders shown closed.
  collapsedGroups: string[];
  // Sidebar sections shown closed.
  collapsedSections: SidebarSection[];
}
