import { Fragment } from "react";
import { MOD_KEY } from "../lib/platform";

// A reference page: every keyboard shortcut and gesture Argonaut understands. Nothing here
// is editable. When a shortcut is added or changed elsewhere, update this list with it.

type Trigger =
  | { keys: string[] } // pressed together
  | { gesture: string } // a click, a drag, something on screen
  | { syntax: string }; // typed into a note

interface Row {
  trigger: Trigger;
  action: string;
}

interface Section {
  title: string;
  rows: Row[];
}

const SECTIONS: Section[] = [
  {
    title: "Anywhere",
    rows: [
      { trigger: { keys: [MOD_KEY, "S"] }, action: "Save the note you're writing to the database" },
      { trigger: { keys: [MOD_KEY, "K"] }, action: "Jump to search: note titles, text, tags and group names" },
      {
        trigger: { keys: [MOD_KEY, "F"] },
        action: "Find in the note you're writing, or on the page shown (Preview, a final view, Missions, Tests)",
      },
      { trigger: { keys: [MOD_KEY, "R"] }, action: "Find and replace in the note you're writing" },
      { trigger: { keys: ["F3"] }, action: "Find the next match again; Shift+F3 the one before" },
      { trigger: { keys: [MOD_KEY, "Tab"] }, action: "Show the next tab; with Shift, the one before (Ctrl+PageDown and PageUp too)" },
      { trigger: { keys: [MOD_KEY, "/"] }, action: "Open this page" },
      { trigger: { keys: ["Esc"] }, action: "In search: clear it and leave the search box" },
      { trigger: { keys: ["Esc"] }, action: "Close an open drawer, the side panel overlay or a dialog" },
      { trigger: { keys: ["Enter"] }, action: "In a question (Delete…? Changed in another window): pick the highlighted answer" },
      { trigger: { keys: ["Esc"] }, action: "In a question: cancel, or Decide later" },
      { trigger: { gesture: "Click a notice at the bottom edge" }, action: "Dismiss it" },
      { trigger: { keys: ["Tab"] }, action: "Move between controls; the focused one gets a gold outline" },
      { trigger: { gesture: "≡, top left on narrow screens" }, action: "Open the notes list" },
    ],
  },
  {
    title: "Groups",
    rows: [
      { trigger: { gesture: "Folder button beside Notes" }, action: "Make a group at the top level" },
      { trigger: { gesture: "Drag a note onto a group" }, action: "File it there, last; drop it on empty space for the top level" },
      { trigger: { gesture: "Drag a note above or below another" }, action: "Put it in that place; a gold line shows where" },
      { trigger: { keys: ["Alt", "↑"] }, action: "On a note in the sidebar: move it up one place (Alt+↓ moves it down)" },
      { trigger: { gesture: "Drag a group onto another" }, action: "Make it a subgroup; drop it on empty space to bring it back up" },
      { trigger: { gesture: "+ on a group" }, action: "Start a new note in that group" },
      {
        trigger: { gesture: "⋯ on a group, or right-click it" },
        action: "Move to…, New subgroup, Rename, or Delete (its notes move up, none are lost)",
      },
      {
        trigger: { gesture: "Click a group, or Notes / Works / Papers / Tests" },
        action: "Open or close it; the choice is remembered",
      },
      { trigger: { keys: ["Enter"] }, action: "In a group's name box: keep the name" },
      { trigger: { keys: ["Esc"] }, action: "In a group's name box or menu: cancel" },
      { trigger: { keys: ["↑", "↓"] }, action: "In a group's menu: move between its choices" },
      { trigger: { gesture: "Group, in Details" }, action: "Move the open note to another group or work" },
      { trigger: { gesture: "× on the folder tag" }, action: "Take the note out of its group" },
    ],
  },
  {
    title: "Papers",
    rows: [
      { trigger: { gesture: "Paper button beside Papers" }, action: "Add PDFs (one or several); the first opens to read" },
      { trigger: { gesture: "Drop PDF files on Papers" }, action: "Add them; dropped on a folder, they're filed there" },
      { trigger: { gesture: "Folder button beside Papers" }, action: "Make a folder of papers" },
      { trigger: { gesture: "Click a paper" }, action: "Read it in the document area, in a tab of its own" },
      { trigger: { gesture: "Drag a paper onto a folder" }, action: "File it there; onto the Papers heading for no folder" },
      {
        trigger: { gesture: "Right-click a paper or a folder" },
        action: "Open, Move to… or Delete a paper; add papers to a folder, rename or delete it",
      },
      { trigger: { gesture: "Details, above a paper" }, action: "Edit its title, authors, year, DOI and folder" },
      {
        trigger: { keys: [MOD_KEY, "F"] },
        action: "On a paper: give the PDF the focus; Ctrl+F again searches inside it",
      },
      { trigger: { gesture: "Open in a window, Download" }, action: "Read the PDF beside Argonaut, or save a copy" },
    ],
  },
  {
    title: "Selecting several notes",
    rows: [
      {
        trigger: { gesture: "Shift+click a note" },
        action: "Select every note from the one clicked last down (or up) to this one, as the sidebar lists them",
      },
      { trigger: { gesture: `${MOD_KEY}+click a note` }, action: "Add it to the selection, or take it out" },
      { trigger: { keys: ["Shift", "Enter"] }, action: `On a note in the sidebar: the same as Shift+click (${MOD_KEY}+Enter as ${MOD_KEY}+click)` },
      { trigger: { gesture: "Drag a selected note" }, action: "Move all the selected notes together, in their order" },
      {
        trigger: { gesture: "Right-click a note" },
        action: "Open, Move to… or Delete it, or all the selected notes when it's one of them",
      },
      { trigger: { gesture: "The bar under the notes" }, action: "Open, Move to… or Delete the selected notes, or clear the selection" },
      { trigger: { keys: ["Esc"] }, action: "In the sidebar: clear the selection" },
    ],
  },
  {
    title: "Find and replace",
    rows: [
      { trigger: { keys: ["Enter"] }, action: "In Find what: the next match (Backward direction makes it the one before)" },
      { trigger: { keys: ["Shift", "Enter"] }, action: "In Find what: a match the other way" },
      {
        trigger: { keys: ["Enter"] },
        action: "In Replace with: replace the selected match and go to the next (the first press finds one)",
      },
      { trigger: { gesture: "Replace all" }, action: "Every match in the note at once; Ctrl+Z undoes it in one step" },
      { trigger: { gesture: "Count" }, action: "How many matches the note or page has" },
      { trigger: { keys: ["Esc"] }, action: "Close find; the match found stays selected in the note" },
      { trigger: { keys: ["Alt", "C"] }, action: "Match case, on or off (Alt+W whole word, Alt+P wrap around, Alt+B backward)" },
      {
        trigger: { keys: ["Alt", "N"] },
        action: "Normal search mode (Alt+X extended, with \\n, \\t, \\x41; Alt+G regular expression)",
      },
      {
        trigger: { syntax: "$1  \\1  $<name>" },
        action: "In a regular expression's replacement: a group it captured ($& is the whole match, $$ a dollar sign)",
      },
    ],
  },
  {
    title: "Works",
    rows: [
      { trigger: { gesture: "Book button beside Works" }, action: "Start a work: a book whose pages are notes" },
      { trigger: { gesture: "+ on a work" }, action: "Add the next page (named Page 1, Page 2…), and start writing it" },
      {
        trigger: { gesture: "Right-click a work, or its ⋯" },
        action: "Generate current final view, Export final view (.md), and the group choices",
      },
      {
        trigger: { gesture: "Generate current final view" },
        action: "Every page joined in order, in a tab of its own; a new line only where a page ends a sentence",
      },
      {
        trigger: { gesture: "Export final view (.md)" },
        action: "Save the joined text as a Markdown file in Downloads, named after the work and the date",
      },
      { trigger: { gesture: "× on a final view's tab" }, action: "Close it; the view is discarded, nothing is kept" },
      { trigger: { gesture: "Refresh, in a final view" }, action: "Join the pages again as they are now" },
    ],
  },
  {
    title: "Tabs",
    rows: [
      { trigger: { gesture: "+ after the tabs" }, action: "Start a new note" },
      { trigger: { gesture: "Middle-click a tab" }, action: "Close it" },
      {
        trigger: { gesture: "Right-click a tab" },
        action: "Close it, Close others, Close tabs to the left or to the right, or Close all",
      },
      { trigger: { gesture: "× on a tab" }, action: "Close it — the note stays in the sidebar" },
      { trigger: { gesture: "● on a tab" }, action: `The note has unsaved changes; ${MOD_KEY}+S saves them` },
    ],
  },
  {
    title: "Writing a note",
    rows: [
      { trigger: { keys: ["Enter"] }, action: "In a list: start the next item with the same bullet or the next number" },
      { trigger: { keys: ["Enter"] }, action: "On an empty list item: end the list" },
      { trigger: { keys: ["Shift", "Enter"] }, action: "A new line without a bullet" },
      { trigger: { keys: [MOD_KEY, "Z"] }, action: "Undo — a bullet Argonaut added goes in one step" },
      {
        trigger: { keys: [MOD_KEY, "V"] },
        action: "Paste a copied picture where the cursor is; Preview shows it the full width of the text",
      },
      {
        trigger: { gesture: "Right-click a red-underlined word" },
        action: "Accept a correction, or keep your spelling so it's never flagged again",
      },
      { trigger: { gesture: "Drag an image onto the note" }, action: "Add it to the note" },
      {
        trigger: { keys: [MOD_KEY, "L"] },
        action: "Link the selected words to another note; pick one, or create a new note from them",
      },
      { trigger: { gesture: "Link, beside the title" }, action: "The same as Ctrl+L" },
      { trigger: { keys: [MOD_KEY, "Click"] }, action: "On a link while writing: open the linked note" },
      { trigger: { gesture: "Click a link in Preview" }, action: "Open the linked note; a dashed link creates the note first" },
      {
        trigger: { gesture: "Links to · Linked from, in Details" },
        action: "Jump to the notes this one links to, or that link here",
      },
      { trigger: { gesture: "Edit · Preview, beside the title" }, action: "Switch between writing and the formatted note" },
      { trigger: { gesture: "Read aloud, beside the title" }, action: "Hear the note; press again to stop" },
      { trigger: { gesture: "Details, under the title" }, action: "Tags, spelling language, links, and Add image" },
      { trigger: { keys: [","] }, action: "In Tags: turn what you typed into a tag; Enter does the same" },
      { trigger: { keys: ["Backspace"] }, action: "In an empty Tags box: take the last tag back out" },
      { trigger: { gesture: "× on a tag" }, action: "Remove that tag" },
    ],
  },
  {
    title: "Formatting",
    rows: [
      { trigger: { syntax: "# Heading" }, action: "A heading; ## for a smaller one" },
      { trigger: { syntax: "**bold**" }, action: "Bold" },
      { trigger: { syntax: "*italic*" }, action: "Italic" },
      { trigger: { syntax: "* item   1. item" }, action: "A bulleted or numbered list (- and + work as bullets too)" },
      { trigger: { syntax: "- [ ] task" }, action: "A checklist item; - [x] when done" },
      { trigger: { syntax: "[[Note title]]" }, action: "Link to another note (Ctrl+L writes this for you)" },
      { trigger: { syntax: "[[Note title|words]]" }, action: "A link that shows different words than the title" },
      { trigger: { syntax: "[text](https://…)" }, action: "A web link" },
      { trigger: { syntax: "> quote" }, action: "A quotation" },
      { trigger: { syntax: "`code`" }, action: "Code; a line of ``` starts and ends a code block" },
    ],
  },
  {
    title: "Missions",
    rows: [
      { trigger: { gesture: "Click a box" }, action: "Mark a task or subtask done, or not done" },
      {
        trigger: { gesture: "Kind, in the task form" },
        action: "Repeating tasks start over every period; one-time tasks stay done once ticked",
      },
      { trigger: { gesture: "Point at a task" }, action: "Shows + subtask, edit and delete" },
      { trigger: { keys: ["Enter"] }, action: "Save the task or subtask you're adding or editing" },
      { trigger: { keys: ["Esc"] }, action: "Cancel adding or editing" },
    ],
  },
  {
    title: "Tests",
    rows: [
      {
        trigger: { gesture: "Generate from notes" },
        action: "The AI assistant writes a test from every note in a group, subgroups included",
      },
      {
        trigger: { gesture: "Import JSON file" },
        action: "Each import gets a folder in the sidebar's Tests section and a weekly mission, a subtask per test",
      },
      {
        trigger: { gesture: "Pass a test at 100%" },
        action: "Ticks its subtask in that mission; open answers you count as right are fine",
      },
      { trigger: { gesture: "Click a test in the sidebar" }, action: "Start it in the Tests tab" },
      {
        trigger: { gesture: "Right-click a Tests folder, or its ⋯" },
        action: "Rename it, or delete it; its tests stay, none is deleted",
      },
      { trigger: { keys: ["Enter"] }, action: "In an answer box: check the answer; Enter again for the next question" },
      { trigger: { keys: ["Space"] }, action: "Pick the option that has focus" },
      { trigger: { gesture: "I was right — count it" }, action: "Count an open answer the grading marked wrong" },
      { trigger: { gesture: "quit" }, action: "Leave the test without saving a score" },
    ],
  },
  {
    title: "Side panel",
    rows: [
      { trigger: { gesture: "Assistant, top right" }, action: "Show or hide the side panel" },
      { trigger: { keys: ["←", "→"] }, action: "On the panel's tabs: switch between Assistant and History" },
      { trigger: { keys: ["Enter"] }, action: "In the question box: send it" },
      { trigger: { keys: ["Shift", "Enter"] }, action: "In the question box: a new line" },
      { trigger: { gesture: "Configure assistant" }, action: "The steps to connect the AI assistant" },
    ],
  },
];

function TriggerView({ trigger }: { trigger: Trigger }) {
  if ("keys" in trigger) {
    return (
      <>
        {trigger.keys.map((key, index) => (
          <Fragment key={`${key}-${index}`}>
            {index > 0 && <span className="shortcut-plus">+</span>}
            <kbd>{key}</kbd>
          </Fragment>
        ))}
      </>
    );
  }
  if ("gesture" in trigger) return <span className="shortcut-gesture">{trigger.gesture}</span>;
  return <code className="shortcut-syntax">{trigger.syntax}</code>;
}

export function ShortcutsPage() {
  return (
    <div className="editor-scroll">
      <div className="missions-content">
        <header className="missions-header">
          <div className="kicker">Shortcuts</div>
          <h1 className="missions-level">Keybinds and shortcuts</h1>
          <div className="missions-subline">
            <span>What the keyboard and mouse can do in Argonaut</span>
            <span>
              {MOD_KEY} + / opens this page
            </span>
          </div>
        </header>

        {SECTIONS.map((section) => {
          const headingId = `shortcuts-${section.title.toLowerCase().replace(/\s+/g, "-")}`;
          return (
            <section key={section.title} className="shortcut-section" aria-labelledby={headingId}>
              <h2 className="shortcut-heading" id={headingId}>
                {section.title}
              </h2>
              <dl className="shortcut-list">
                {section.rows.map((row) => (
                  <div key={`${JSON.stringify(row.trigger)}-${row.action}`} className="shortcut-row">
                    <dt>
                      <TriggerView trigger={row.trigger} />
                    </dt>
                    <dd>{row.action}</dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })}
      </div>
    </div>
  );
}
