# Argonaut — project documentation

Argonaut is a personal knowledge vault: a voice-first note taker, editor and learning
facilitator, with linked notes in groups and subgroups, works (books written a page per note,
joined into a final view you can export), papers (PDFs, read right in the app), tests (written
by the AI assistant from a group of notes, or imported in batches that each come with a weekly
mission), and daily, weekly, monthly and yearly tasks, repeating or one-time, that you can
manage by voice.
It runs locally. `Argonaut.exe` starts everything in Docker and opens the app in its own
window.

- [Architecture](#architecture)
- [The workspace](#the-workspace)
- [Notes and images](#notes-and-images)
- [Papers](#papers)
- [Tests](#tests)
- [Shortcuts](#shortcuts)
- [Tasks and voice](#tasks-and-voice)
- [How a voice command flows](#how-a-voice-command-flows)
- [Data model](#data-model)
- [Project structure](#project-structure)
- [Languages and technologies](#languages-and-technologies)
- [Commands](#commands)
- [Configuration](#configuration)
- [API](#api)
- [Project rules](#project-rules)
- [Speech recognition benchmark](#speech-recognition-benchmark)

## Architecture

```mermaid
flowchart LR
  subgraph PC["Your PC (Windows)"]
    exe["Argonaut.exe<br/>C# launcher"]
    window["Argonaut window (WebView2)<br/>React UI in TypeScript"]
    speech["speechSynthesis<br/>read-aloud"]
    subgraph Docker["Docker Desktop"]
      api["argonaut-api · port 8787<br/>Node 24 + Express in TypeScript<br/>also serves the built web app"]
      db[("argonaut-db · port 5433<br/>PostgreSQL 16<br/>volume: argonaut-db-data")]
      spell["argonaut-spell<br/>hunspell dictionaries<br/>English · Portuguese<br/>French · Spanish"]
      whisper["argonaut-whisper<br/>whisper.cpp, base model<br/>speech to text"]
    end
  end
  llm["routellm.abacus.ai<br/>LLM proxy, cloud"]

  exe -- "docker compose<br/>up -d --build" --> Docker
  exe -- "waits for /api/health,<br/>then opens the window" --> window
  window -- "notes, papers, tasks, tests,<br/>workspace state, chat" --> api
  api -- "SQL" --> db
  api -- "spelling" --> spell
  api -- "microphone recordings" --> whisper
  api -- "chat completions" --> llm
  window <--> speech
```

- **Argonaut.exe** wakes Docker Desktop if needed, builds and starts every service in
  `docker-compose.yml`, waits until the API answers, then shows Argonaut in a window of its
  own, with its own taskbar entry and no browser around it. A second launch focuses the open
  window instead of opening another, and the window remembers where it was and how big.
- **Add desktop icon**, beside Light/Dark mode at the foot of the sidebar, puts a shortcut to
  `Argonaut.exe` on the desktop. The launcher makes it, since the page can't, and the button
  only shows while no shortcut on the desktop points at this `Argonaut.exe`, whatever it's
  called. Delete the icon and the button comes back. It never shows in a plain browser.
- **WSL is kept up to date at startup.** Docker Desktop runs inside WSL and refuses to start on
  an outdated one ("WSL needs updating"). So whenever Docker is down at launch, the launcher
  runs `wsl --update` before waking it. If that installed a newer WSL while Docker Desktop
  was already open (stuck on that error), it restarts Docker Desktop too. A running Docker is
  left alone, because installing an update shuts WSL down, and Docker with it. A failed update
  (offline, or the Windows prompt declined) doesn't stop the launch; its reason is shown if
  Docker then fails to start.
- **The window is a WebView2**, the browser engine built into Windows (the runtime comes
  with Windows updates), rather than Electron, which would bundle a whole browser. Its
  profile is `%LOCALAPPDATA%\Argonaut\WebView2`. Links out of the app (a DOI, a link in a note)
  open in your everyday browser; a paper's PDF opens in a window of its own. The microphone
  and clipboard are allowed for Argonaut's own pages only. Developer tools are off unless
  `ARGONAUT_DEVTOOLS=1` is set.
- **Speech recognition is local.** WebView2 has no Web Speech recognition, so the microphone
  records the question itself and the API hands it to **argonaut-whisper** (below).
- **argonaut-api** is both the API and the web server, so one port serves everything.
- **argonaut-db** keeps all data in the `argonaut-db-data` Docker volume, which survives
  container rebuilds.
- **argonaut-spell** holds only dictionaries — no notes, no database, and no port on your PC.
  The API asks it over the Docker network, so spelling stays separate from the vault itself.
- **argonaut-whisper** turns the assistant's microphone recordings into text: whisper.cpp
  (v1.9.5) with the multilingual `base` model, which covers English, Portuguese, French and
  more, detecting the language of each recording. It runs on the CPU, takes about 0.7 s for a
  short question, and, like the spell checker, has no port on your PC and no database. A
  recording is held in memory only while it's transcribed; neither it nor the text is stored
  or logged.

## The workspace

Three columns: the **sidebar** (notes), the **document**, and a **side panel** with two tabs,
**Assistant** and **History**.

- **Sidebar.** **New note** at the top, then search (**Ctrl+K**) and five sections: **Notes**,
  in [groups and subgroups](#groups), [**Works**](#works), books written a page per note,
  [**Papers**](#papers), PDFs in folders, and
  [**Tests**](#imported-batches-folders-and-weekly-missions), a folder for each imported
  batch, and [**Agent Skills**](#agent-skills), instructions for AI agents. Each section closes like a group, and the choice is remembered. The open note has a
  highlighted background and a thin gold mark; delete (×) appears when you point at a note or
  reach it by keyboard. Several notes can be [selected together](#selecting-several-notes).
  Search looks in titles, text, tags and group names, and in papers' titles, authors and DOIs,
  and shows the group or work each match is in. The footer switches light and dark mode.
- **Tab strip.** Missions, Tests and Shortcuts are pinned; open notes follow, then papers, then
  any work's final view. **Ctrl+Tab** shows the next tab and **Ctrl+Shift+Tab** the one before
  (Ctrl+PageDown and Ctrl+PageUp too), round and round. **Right-click** a note, paper or final
  view tab for **Close**, **Close others**, **Close tabs to the left**, **Close tabs to the
  right** and **Close all**; when the tab on screen goes, the one right-clicked takes its
  place. Closing a note's tab never loses its unsaved changes. **Assistant**, at the right end,
  shows or hides the side panel.
- **Document.** A single reading column, 720px at most and centred, in 17px text at 1.6 line
  height. The text is justified, while writing and in Preview: every wrapped line runs edge to
  edge, and only a paragraph's last line and headings keep a ragged end. The kicker line
  carries the note's group (or else its first tag), then **Link** (while editing), **Edit ·
  Preview** and **Read aloud**. Under the title sit the essentials (edited, words, saved,
  spelling issues) and a **Details** button, which opens the less-used properties: group,
  tags, spelling language, links and images.
- **Side panel.** *Assistant* asks about the open note, showing only the latest question and
  answer; *History* lists what you asked this session, never saved. Close it with × and the
  document takes the width back; the choice is remembered.
- **Connecting the assistant.** Until a key is set, the Assistant tab shows **Connect your AI
  assistant** with a **Configure assistant** button. It opens the steps: get a RouteLLM key,
  paste it into the exact `.env` file shown (with a Copy path button), relaunch, then **Check
  again**. The key never passes through the app, so it can't end up in the browser or a
  backup.

**Smaller screens.** The side panels give way before the document shrinks:

| Window width | Sidebar | Side panel |
|---|---|---|
| 1360px and wider | beside the document | beside the document, when open |
| 960 to 1359px | beside the document | slides over the document |
| under 960px | behind ≡, slides over | slides over the document |

Drawers, dialogs and the app's questions (such as "Delete this note?") keep keyboard focus
inside while open, close with **Esc** or a click outside, and return focus to whatever opened
them. The questions are Argonaut's own, not the browser's pop-ups: **Enter** picks the
highlighted answer. A change that fails (a delete, a move, an export with nothing in it) is
told by a notice at the bottom edge, which goes after a few seconds or when clicked. Tool labels become icons when the
workspace is narrow, and nothing scrolls sideways at any width down to phones.

**Accessibility.** All text meets WCAG AA contrast in both themes: at least 4.5:1, with
secondary text at about 6:1 on its backgrounds, and input outlines at least 3:1. No text is
smaller than 13px. Every control reached with Tab shows a gold focus outline, and every
icon-only button has a name for screen readers.

## Notes and images

Notes are Markdown. Press **Ctrl+S** to save a note to the database, and link notes to each
other as described in [Linking notes](#linking-notes).

**When a save doesn't work**, a pop-up rises from the bottom edge, below any task pop-ups,
naming the note. This covers Ctrl+S and the save of a note just created from a link.
- **Nothing answered:** if the API, Docker or WSL is down, it says so. Your changes stay in
  the window. Run `Argonaut.exe` to bring the services back (it updates WSL and wakes Docker
  as needed), then press **Try again**.
- **The server refused:** it shows the server's reason.
- **A hung service:** a save that hangs gives up after 15 seconds and is reported the same way.
- **Every failed save** brings the pop-up up again, saying "Still not saved".
- **Going away:** it leaves after ten seconds, but stays while you point at it or use it from
  the keyboard. Once the note saves it turns gold, says "Saved", and leaves.
- **Several notes:** each note whose save failed keeps its "Couldn't save" mark until it saves,
  not just the latest one.

**Two windows on the same note.** A save says which stored copy the window started from. If
another window saved the note since, nothing is overwritten; a question asks which text to
keep: **Keep this window's**, **Use the other window's**, or **Keep both** (this window's text
goes into a new note named "… (from this window)"). **Decide later** leaves it unsaved, and
the next Ctrl+S asks again.

**Deleting.** A note leaves the list at once. If the database turns the delete down (the
services are down, say), the note comes back and a notice says why.

**The offline copy.** The window keeps a copy of your notes in browser storage, written once
you pause typing and whenever the window is hidden or closed, so unsaved edits survive a
reload. If the browser refuses to store it (storage full or blocked), a notice says so: save
with Ctrl+S before closing. Every request gives up after 30 seconds (a save after 15, uploads
and the assistant later), so a hung service is reported instead of waiting forever.

**Tags** live under **Details › Tags**. Type one, then press **comma** or **Enter** and it
becomes a chip; leaving the box does the same. Spaces are fine, so "machine learning" is one
tag, and a tag already there isn't added twice. **×** on a chip removes it, and **Backspace**
in the empty box takes the last one back out. A note in a group has that group as its first
tag, a gold chip with a folder mark (see [Groups](#groups)).

Lists continue as you type. Press **Enter** at the end of a `*`, `-`, `+`, `1.` or `1)` item
and the next line starts with the same bullet or the next number. Numbered items after it are
renumbered, and task boxes (`- [ ]`) carry on empty. Enter on an empty item ends the list, and
**Shift+Enter** gives a plain new line. Code blocks are left alone, and **Ctrl+Z** takes back
an added bullet in one step.

To add an image, **paste** it (a screenshot, for example), **drag** it onto the note, or use
**Add image** under **Details**. Each image:

- is stored in PostgreSQL straight away, in the same database as your notes, so one
  [backup](#backups) keeps both;
- goes into the text exactly where your cursor is, as a link like
  `![photo](/api/attachments/…)` on a line of its own, or at the end if you haven't clicked
  into the text yet. Pasted mid-sentence, it splits the sentence there. You can keep typing
  while it uploads; the cursor stays where you put it;
- shows as a thumbnail under **Details › Images**, and in **Preview** at the full width of the
  text, however small the picture is. While writing, you see the link line, not the picture.

PNG, JPEG, GIF and WebP up to 15 MB are accepted. The file's own bytes decide its type, so a
renamed file can't slip through, and SVG is refused because it can carry scripts. The same
picture added twice is stored once. A note holds only the link, so notes stay small and the
browser's offline copy of them doesn't fill up. Save with Ctrl+S to keep the link in the note.

### Find and replace

**Ctrl+F** opens Argonaut's own find panel under the tabs, in place of the browser's; **Ctrl+R**
opens it on **Replace** (and no longer reloads the window). Text selected in the note becomes
what's searched for. Every match is tinted where it stands in the text and the current one is
outlined, so nothing is covered while you search.

- **Enter** finds the next match, **Shift+Enter** the one before; **F3** and **Shift+F3** do the
  same from anywhere, the cursor staying in the note. **Count** says how many there are.
- **Replace** works as in Notepad++: the first press finds a match, the next replaces it and
  moves on (Enter in *Replace with* does the same). **Replace all** changes every match in one
  step, which **Ctrl+Z** undoes in one step too.
- **Options:** Match case (**Alt+C**), Whole word (**Alt+W**; accented letters count as letters),
  Wrap around (**Alt+P**, on by default) and Backward direction (**Alt+B**). **Search mode**:
  Normal; Extended (**Alt+X**), where `\n`, `\t`, `\\`, `\x41` and `é` mean what they say;
  or Regular expression (**Alt+G**), with `^` and `$` per line and **. matches newline** to
  hand. In a regular expression's replacement, `$1` or `\1` is a captured group, `$<name>` a
  named one, `$&` the whole match and `$$` a dollar sign. A broken expression is reported, not
  run.
- **Esc** closes the panel and puts the cursor back in the note, the match found selected.

In Preview, in a work's final view, and on Missions, Tests and Shortcuts, Ctrl+F searches what
the page shows, painted with the browser's highlight API; replacing works only while writing a
note. On a paper, the PDF viewer does its own searching (see [Papers](#papers)).

### Groups

The sidebar's **Notes**, [**Works**](#works) and [**Agent Skills**](#agent-skills) sections hold notes; click a section's name to
close or open it. Notes are filed in **groups**, and groups can hold **subgroups** to any
depth. A note sits in one group, or none.

- **Make one** with the folder button beside **Notes**, or with **New subgroup** in a group's
  menu. Type the name and press **Enter**; **Esc** cancels. Names are unique among groups side
  by side, ignoring case, and groups sort by name with numbers in order (Chapter 2 before
  Chapter 10).
- **A group's menu** opens from its **⋯** or with a right-click: **Move to…**, **New
  subgroup**, **Rename** and **Delete group**. Arrow keys move through it and **Esc** closes it.
- **File a note** by dragging it onto a group, where it goes last, or pick its group under
  **Details › Group**. Dropping on empty space, or choosing **No group**, puts it back at the
  top level. **+** on a group starts a new note inside it, last in line.
- **Order notes** by dragging one above or below another; a gold line shows where it will
  land, in the same group or another. From the keyboard, **Alt+↑** and **Alt+↓** on a note in
  the sidebar move it one place. The order is stored at once and is what a work's final view
  follows.
- **Arrange groups** by dragging one onto another to make it a subgroup, or with **Move to…**,
  which also works from the keyboard. A group can't go inside itself.
- **Open and close** a group by clicking it; the sidebar remembers which groups and sections
  are closed, and opens them again when a note inside is opened from elsewhere. The number
  beside a group counts its notes, subgroups included.
- **Delete** a group from its menu. Its notes and subgroups move up a level, the notes after
  the ones already there, so no note is ever deleted with it; a subgroup whose name is taken
  there gets a number ("Verbs 2").

A note's group counts as a tag. It shows above the title (`French › Verbs`), leads the Tags
row as a folder chip whose **×** takes the note out of the group, is searched like a tag, and
is passed to the assistant with the note. Filing and ordering are stored at once and aren't
edits, so a saved note stays saved. To make a test from a group, see
[Generating a test from notes](#generating-a-test-from-notes).

### Selecting several notes

**Shift+click** a note to select every note from the one clicked last to it, in the order the
sidebar lists them (across groups, skipping closed ones); **Ctrl+click** adds a note to the
selection or takes it out, and counts the note open in the editor as already picked. From the
keyboard, **Shift+Enter** and **Ctrl+Enter** on a note do the same. Selected notes are tinted
gold, and a bar under the list offers **Open** (all of them, as tabs), **Move to…**, **Delete**
(one question for all) and **×** to clear the selection, as **Esc** does too.

**Dragging** a selected note moves the whole selection, in its order: onto a group (last
there) or above or below a note. **Right-click** a selected note for the same choices as the
bar; right-clicking any other note selects just that one and opens its menu (Open, Move to…,
Delete).

### Works

**Works** is the sidebar's section for writing books a page at a time. Each work is a folder
(marked with a book) and each page in it is a note.

- **Start a work** with the book button beside **Works**. **+** on it adds the next page,
  named for its place ("Page 5"), and puts the cursor in its text. Pages are ordinary notes:
  written, saved with Ctrl+S, linked and spell-checked the same way. A work can hold
  subfolders too, from its menu (**New subfolder**).
- **Order pages** by dragging them up and down, or with **Alt+↑** / **Alt+↓**. Notes dragged in
  from Notes become pages where they're dropped. The top level of Works holds works only.
- **Right-click a work** (or use its **⋯**) for **Generate current final view** and **Export
  final view (.md)**, above the usual group choices.

**The final view** is the work's text as one: every page under it, in sidebar order (each
subfolder's pages in turn, then the work's own), as the pages are at that moment, unsaved edits
included. It opens in a tab of its own, marked with a book. Pages meet the way the text
reads:

| Where a page ends | Joined with | Example |
|---|---|---|
| On a finished sentence: `.` `!` `?` `…`, also before closing quotes or brackets (`."`, `?»`, `.)`, `. »`) | a new line | `…she said.` / `Dawn came…` |
| Mid-sentence, including after `,` `;` `:` | one space | `…and the road` + `out of the valley…` |
| On a dash splitting a word or a thought (`well-`, `the man—`) | nothing | `well-known`, `the man—who` |
| On speech broken off (`—"`) | a new line | `"I was going to—"` / `She stopped him.` |

A heading, list item, quote or separator always starts on a line of its own, and empty pages
are skipped. The view is a snapshot: **Refresh** joins the pages again, **Copy text** copies
it, and **Export .md** saves it. Closing the tab discards it; nothing about it is stored, and
generating again replaces an open view instead of opening a second one.

**Export final view (.md)** saves the joined text as a Markdown file named after the work and
the day, such as `The Long Road 2026-09-27.md`. It's an ordinary download, which the Argonaut
window saves to `C:\Users\<you>\Downloads`. Characters Windows doesn't allow in file names are
left out of the name.

Deleting a work moves its pages to the end of Notes (and makes its subfolders works of their
own); no page is deleted.

### Agent Skills

**Agent Skills**, the last section of the sidebar, keeps instructions for AI agents: a skill
is a markdown note, filed in a folder for the job it does. Give a skill to an agent (copy its
text, or export it) together with a prompt, and the agent knows how to do that job for
Argonaut.

- **Make a folder** with the folder button beside **Agent Skills**, and a skill in it with
  **+**. Skills are ordinary notes, written and saved the same way, and move by dragging like
  notes in groups. They always sit in a folder: the top level of Agent Skills holds folders
  only, and deleting a top-level folder moves its skills to Notes.
- **Test Maker** holds the skill for making a test: given a topic in its prompt, an agent
  writes a test as JSON that the Tests tab imports as it is. Its text is kept in the repository
  too, in [documentation/agent-skills/test-maker.md](agent-skills/test-maker.md).
- Tests are never generated from skills: **Generate from notes** in the Tests tab offers only Notes and
  Works.

### Linking notes

A link to another note is written `[[Note title]]`, or `[[Note title|the words you see]]` when
the sentence reads better with other words. While writing, links are underlined; in
**Preview** they show only the words, as links.

- **Making a link.** Select the words and press **Ctrl+L**, or use **Link** beside the title.
  A dialog opens with those words already in its search box and your notes listed, best match
  first; accents and case don't matter. **Enter** or a click links the words to that note.
  If no note has that title, **Create a new note “…”** creates it, saves it and links to it,
  and you stay where you were. With nothing selected, the note's title goes in at the cursor.
- **Following a link.** Hold **Ctrl** and click it while writing (the pointer becomes a hand
  once Ctrl is held over a link), or click it in Preview. The linked note opens in its own tab.
- **Links to notes that don't exist yet** have a dashed underline. Clicking one creates that
  note, saves it and opens it, so you can write `[[Irregular verbs]]` now and fill it in later.
- **Details › Links to** lists the notes this one links to, and **Linked from** lists the notes
  that link here. Each opens with a click.

Links find their note by title, ignoring case and extra spaces. If two notes share a title,
the more recently edited one wins. **Renaming a note doesn't update links to it:** they turn
dashed, and clicking one would create a new note under the old title, so fix them by hand
after a rename. Brackets inside `code` stay plain text. Web links (`[text](https://…)`) open
in a separate browser window, so the app window never navigates away.

### Spelling

Misspelled words get a red wavy underline as you write, half a second after you stop typing.
**Right-click one** for a small pane offering **Accept “correction”** for each suggestion, and
**Keep my spelling**, which stores the word so it's never flagged again in that language.
Accepting a correction is a single Ctrl+Z away, like any other edit.

The language is worked out from the note itself, so a French note is checked in French. The
count of issues shows under the title, and **Details › Spelling** shows which language was
chosen and lets you pin one, or turn checking off for that note; the choice is saved with the
note. Code, links, images,
wikilink targets, addresses, acronyms and camelCase names are skipped, so only prose is
checked.

Dictionaries live in the `argonaut-spell` container (English, Portuguese, French, Spanish) and
the words you keep live in the database with your notes. The dictionaries are open source but
under mixed licences — MIT/BSD for English, MPL for French, LGPL or MPL for Portuguese, and
GPL, LGPL or MPL for Spanish — which matters only if this app is ever distributed.

## Papers

The sidebar's **Papers** section keeps PDFs, scientific papers above all, and shows them in the
document area to read.

- **Add papers** with the paper button beside **Papers** (several at once is fine), or **drop
  PDF files** from Explorer anywhere on the section; dropped on a folder, they're filed there.
  The first one added opens straight away. Only real PDFs are taken (the file's first bytes
  decide), up to 50 MB each, and the same file added twice is kept once.
- **Their details** are read from the PDF itself: title, authors, year and DOI from its XMP
  metadata (which most publishers include), else from its document information (most LaTeX and
  word-processor PDFs), including what's kept in compressed object streams; the page count from
  its page tree. Placeholder titles such as "Microsoft Word - draft.docx" are ignored, and the
  file name stands in. Everything can be corrected under **Details**.
- **Reading:** a paper opens in a tab of its own, after the notes. Its title, authors, year,
  pages, size and DOI (a link to doi.org) sit above the PDF, which is shown by the browser's own
  viewer: page thumbnails, zoom, rotation, printing, and searching inside it with **Ctrl+F**
  once the PDF has the focus. Pressing Ctrl+F elsewhere on a paper gives the PDF the focus, and
  says so, so the next Ctrl+F searches it. **Open in a window** puts the PDF beside Argonaut;
  **Download** saves a copy under its own name.
- **Folders:** the folder button beside **Papers** makes one. Drag a paper onto a folder to file
  it (onto the Papers heading for no folder), or use **Move to…** from its right-click menu.
  A folder's menu (right-click or **⋯**) adds papers into it, renames it or deletes it; its
  papers stay, in no folder. Folders sort by name and papers by title, numbers in order.
- **Deleting** a paper, from its right-click menu or under Details, deletes its PDF too, after
  one question.

PDFs are kept in PostgreSQL with everything else, so a [backup](#backups) holds them, and
backups grow by the size of the papers in them.

## Tests

The **Tests** tab holds question sets to check what you've learned: written by the AI
assistant from a group of your notes (see
[Generating a test from notes](#generating-a-test-from-notes)), or imported as JSON.
Import with **Import JSON file** or **paste JSON**; **the format** shows the rules and an
example you can copy. To try it straight away, import
[`documentation/sample-test.json`](sample-test.json), eight questions on French prepositions.

```json
{
  "title": "French prepositions",
  "description": "Optional, shown under the title",
  "questions": [
    {
      "question": "Le chat est ___ la table. (on)",
      "options": ["sur", "sous", "dans"],
      "answer": "sur",
      "explanation": "Optional, shown after answering."
    },
    {
      "question": "Which of these give a place? Choose all that apply.",
      "options": ["devant", "avec", "derrière"],
      "answer": ["devant", "derrière"]
    },
    { "question": "Translate: in Paris", "answer": ["à Paris"] }
  ]
}
```

- **Multiple choice:** a question with `options`. Its `answer` is the right option's text, or a
  list of them for "choose all that apply", where every right option must be picked.
- **Open answer:** a question without options. Its `answer` is the accepted answer, or a list
  of accepted answers. Case, spacing, curly quotes and a final full stop don't matter, but
  accents do: "a" for "à" shows **Almost — check the accents**. For any open answer marked
  wrong you can choose **I was right — count it**.
- **Code:** text in backticks shows as code, and a block between two lines of three backticks
  (the first may name the language, as in ` ```rust `) shows as a code block. Both work in
  questions, options and explanations; in JSON, a line break inside text is written `\n`.
- **Optional:** `explanation` per question; `description`, `shuffle_options` (default `true`)
  and `shuffle_questions` (default `false`) per test. A file can hold one test, a list of
  tests, or a named batch: `{"name": "Rust", "tests": [ … ]}`. `type` can be left out, since
  `options` already says which kind a question is.
- **Checked on import:** a file with mistakes is refused whole, and the message names the test,
  the question and the problem. For example: the answer "dans" isn't one of the options. A file
  holds at most 60 tests of up to 200 questions each.

Taking a test goes one question at a time: **Check** shows whether you were right, the answer
and the explanation, then **Next**. At the end you see your score, every answer, and
**Practice the missed**, which re-asks only those without saving a score. Finished tests keep
their history: the last score, the best score and how many times you've taken them.

To make a test in another chatbot instead, paste the example above into it along with the
note, and ask for a test in the same JSON format.

### Imported batches, folders and weekly missions

Every import is a batch. Its tests go into a folder of their own, shown in the Tests tab and in
the sidebar's **Tests** section, in the order the file gives them. The folder is named by the
file's `name`, else by the test's title when the file holds one test, else by the day
("Imported 2026-09-27"); importing the same file again makes "Rust 2" rather than mixing the
two.

Each batch also gets a **weekly mission**, "Tests · *folder*", with a subtask per test (up to 60,
more than the 20 a task made by hand may have). Passing a test at 100% ticks its subtask, and a
pop-up says so; open answers you counted with **I was right — count it** are fine. Passing the
last one completes the mission, with the usual pop-up. The mission is one-time: it stays on the
Weekly list, week after week, until every test is passed, and a test passed once stays ticked.
Set its **Kind** to Repeating to pass them all again every week.

- **In the sidebar,** folders are listed by name, each with how many of its tests are passed at
  100% (for example 3/50), then the tests in no folder. A test shows ✓ once passed at 100%,
  else its best score. Clicking a test starts it in the Tests tab, asking first if that would
  cut short a run with answers in it. Right-click a folder, or use its ⋯, to rename or delete
  it.
- **Deleting a folder** keeps its tests: they move below the folders and still count for their
  mission.
- **Deleting a test** keeps its scores and takes its subtask out of the mission; a mission left
  with no subtasks goes too.

### Rust: principal engineer

[`documentation/rust-principal-engineer-tests.json`](rust-principal-engineer-tests.json) is a
batch of 50 tests and 636 questions on what a principal engineer on a Rust codebase is expected
to know, one topic per test, written for the 2024 edition. Import it with **Import JSON file**:
it becomes the folder "Rust — principal engineer" and a weekly mission with 50 subtasks.

| Tests | Topics |
|---|---|
| 01–11 | Ownership and moves · borrowing · lifetimes · structs, enums and patterns · traits and generics · trait objects · standard library traits · error handling · collections · iterators · closures |
| 12–22 | Strings · smart pointers and interior mutability · memory layout · numbers · modules and visibility · Cargo and features · editions · declarative macros · procedural macros · unsafe · FFI |
| 23–33 | Threads · atomics and memory ordering · futures and polling · Pin · Tokio · cancellation and async design · advanced types · API design and semver · testing · performance · compile times |
| 34–50 | Tooling and CI · Serde · axum, tower and hyper · databases · observability · security and supply chain · no_std and embedded · WebAssembly · ownership-friendly data structures · architecture · leading Rust teams · I/O and processes · command-line apps · rustdoc · deployment · verification · C++, Python and JavaScript bridges |

Most questions are multiple choice; 21 are "choose all that apply", 44 are open answers, and 22
ask you to read a piece of Rust code. Every answer comes with an explanation.

### French prepositions

[`documentation/french-prepositions-tests.json`](french-prepositions-tests.json) is a batch of two
tests over the same 93 French prepositions. It covers the 41 simple ones in current use (à, de,
en, dans, sur, sous… nonobstant) and 52 common compound ones (à côté de, grâce à, au lieu de, au
sein de…). Import it with **Import JSON file**: it becomes the folder "French prepositions" and a
weekly mission with two subtasks.

| Test | Questions | Made of |
|---|---|---|
| French prepositions 1 | 117 (72 multiple choice, 45 open) | Every preposition once, the 24 core ones twice |
| French prepositions 2 | 116 (75 multiple choice, 41 open) | The same coverage in all-new sentences and questions |

Most questions are a sentence with a gap. The words in brackets give the meaning to find, and
"3 words" says how long the answer is. Some questions ask what a preposition means instead,
and one asks you to pick every word that means *except*. Questions come in a new order on each run.

Every explanation ends with the Portuguese equivalent (PT). Open answers accept synonyms where
French does (faute de or par manque de), and a missing accent counts as a near miss.

[`documentation/french-prepositions-cheat-sheet.md`](french-prepositions-cheat-sheet.md) lists the
same 93 prepositions, each with its Portuguese and English meaning and an example.

### Preposition tutorials

Four more batches give each of those 93 prepositions a test of its own: 30 sentences, all with a
gap for that one preposition. You look it up once, then type it 30 times.

| File | Folder it becomes | Tests |
|---|---|---|
| [`preposition-tutorials-1.json`](preposition-tutorials-1.json) | Preposition tutorials 1 — your 20 | 20, from à to dès |
| [`preposition-tutorials-2.json`](preposition-tutorials-2.json) | Preposition tutorials 2 — other simple ones | 21, from avant to nonobstant |
| [`preposition-tutorials-3.json`](preposition-tutorials-3.json) | Preposition tutorials 3 — place and time | 26, from à côté de to au cours de |
| [`preposition-tutorials-4.json`](preposition-tutorials-4.json) | Preposition tutorials 4 — cause and relation | 26, from à cause de to au sein de |

- **Title:** the meaning in Portuguese and English (ao lado de · next to), never the French word,
  so you find it on the cheat sheet.
- **Description:** a hint (3 words, starts with à), and whether the answer changes form.
- **Answers:** all typed, in the form each sentence needs: à cause du (de + le), à cause des
  (de + les), à cause d' before a vowel. Every form a test lists is asked at least once.
- **After each answer:** the sentence in Portuguese, what a contracted form is made of, and
  sometimes a note (an aspirated h, a fixed phrase, the version with que).

The questions keep their order. Select all four files in **Import JSON file** to get four folders
and four weekly missions, with one subtask per test.

### Generating a test from notes

**Generate from notes** asks the AI assistant to write a test from every note in a group,
subgroups included. Choose:

- **Notes from:** the group; each is listed with how many notes with text it holds.
- **Questions:** 3 to 30.
- **Kind:** mixed, multiple choice only, or open answers only.
- **Instructions:** optional, such as "focus on prepositions of place, and ask in English".

The notes go as they are in the window, unsaved changes included, as plain text: pictures are
left out and `[[links]]` become their words. Up to about 60,000 characters are sent (roughly
15,000 tokens); beyond that the rest is cut and the result says so. The assistant is told to
ask only about what the notes say, in the notes' own language unless the instructions say
otherwise. Its reply must pass the same checks as an imported file: if it doesn't, the
assistant gets one retry with the problem spelled out, and if that fails too, nothing is
stored and the reason is shown. A good test is saved at once, in no folder and with no mission,
listed after the folders and described by where it came from ("Generated from French › Verbs ·
4 notes").

Generating needs the AI assistant connected (**Configure assistant**, in the form or the
Assistant tab). The chosen notes' text goes to the LLM proxy for that one request; the reply
itself isn't kept, only the test made from it.

## Shortcuts

The **Shortcuts** tab, pinned after Tests, is a read-only reference to every keyboard
shortcut and gesture: saving, search, tabs, writing and formatting notes, missions, tests and
the side panel. **Ctrl+/** opens it from anywhere. Its content lives in
`src/components/ShortcutsPage.tsx`, so a new shortcut added elsewhere gets a line there too.

## Tasks and voice

The **Missions** tab lists tasks per cadence: Daily, Weekly, Monthly and Yearly. The header
shows how many are done in the current period (for example `1/3 daily`) and when it resets.
Each task has a title, an optional subtext and optional subtasks, and can be added, edited,
ticked and deleted on the board, or by voice.

Every task is one of two kinds, chosen with **Kind** in the task form and shown on its card:

- **Repeating**, the default: it starts over every period (each day, for a daily task), and a
  run of done periods builds a streak.
- **One-time**: it stays on its list until it's done, carrying over from one period to the
  next, and stays done once ticked. It shows as done until the current period ends, then
  leaves the board. Its subtasks stay ticked too, and it has no streak. The list you pick only
  decides where it shows.

The side panel's **Assistant** tab takes questions, typed or spoken. It shows only the latest
answer, which is also read aloud in the voice you pick; **History** lists what you asked this
session. Press the mic, then speak, for example:

- "Prepositions are done."
- "Mark Book Continuation as done." · "Reopen French learning."
- "Add a weekly task called Reading, with subtasks Chapter 1 and Chapter 2."
- "Add a one-time task Renew passport." · "Make Reading a one-time task."
- "Add a subtask Verbs to French learning, subtext conjugate être and avoir."
- "Rename Application Development to Argonaut development."
- "Delete the Verbs subtask."

Voice changes need the assistant: press **Configure assistant** in the Assistant tab for the
steps. In short, set `LLM_API_KEY` in `.env`, then relaunch `Argonaut.exe`; every launch
re-runs `docker compose up -d --build`, which recreates the API with the new settings.

**Speaking a question.** Click the microphone beside the question box and speak. A pause of
about a second and a half ends it (or click the microphone again), and the question is
written down by `argonaut-whisper` on this PC, then sent. If nobody speaks for eight seconds,
it stops without sending anything; a question can last up to a minute.

**Choosing a voice.** The **Reply voice** list in the Assistant tab groups what the window
offers:

- **Natural** — Edge's neural "Online (Natural)" voices (Ava, Andrew, Emma, Brian and so on).
  The Argonaut window (WebView2) doesn't offer them, so this group is empty there.
- **Built into Windows** — the local voices. Only Zira is installed on this PC, and it sounds
  flat and robotic.
- **Automatic** — the default, which picks the most lifelike English voice available.

Replies are spoken one sentence at a time. A natural-sounding voice that works in the
Argonaut window, and offline, would need a local neural engine such as Piper or Kokoro running
as another container.

## How a voice command flows

```mermaid
sequenceDiagram
  participant You
  participant UI as Assistant tab
  participant API as argonaut-api
  participant LLM as LLM proxy
  participant DB as PostgreSQL
  You->>UI: Prepositions are done
  Note over UI,API: the recording goes to argonaut-whisper through<br/>POST /api/speech/transcribe; the text is listed<br/>in History, kept in memory only
  UI->>API: POST /api/chat
  API->>DB: read the task board
  API->>LLM: conversation, with tasks listed as T1, T1.1 and so on
  LLM-->>API: spoken reply plus an ACTIONS line (complete T1.1)
  API->>DB: one transaction - tick the subtask, complete its task
  API-->>UI: reply, refreshed board, pop-ups
  UI-->>You: reply read aloud and a Task complete pop-up
```

The model asks for changes with a trailing `ACTIONS: [...]` JSON line, which works with any
model behind the proxy, including ones without tool calling. The server checks every action:
unknown tasks or operations are reported in a pop-up and skipped, and nothing else changes.

## Data model

```mermaid
erDiagram
  tasks {
    uuid id PK
    text title
    text subtext
    task_cadence cadence "DAILY, WEEKLY, MONTHLY or YEARLY"
    bool repeats "false for a one-time task"
    timestamptz archived_at "null while active"
  }
  subtasks {
    uuid id PK
    uuid task_id FK
    text title
    text subtext
    timestamptz archived_at "null while active"
  }
  task_completions {
    uuid task_id PK, FK
    task_cadence cadence PK
    int period_index PK "day, week, month or year number"
  }
  subtask_completions {
    uuid subtask_id PK, FK
    task_cadence cadence PK
    int period_index PK
  }
  notes {
    uuid id PK
    text title
    text content "Markdown, with image links"
    text_array tags
    text language "spelling: auto, off or a code"
    uuid group_id FK "null: in no group"
    float position "order within its group"
    bigint updated_at
  }
  note_groups {
    uuid id PK
    uuid parent_id FK "null: top level"
    text section "notes or works, top level only"
    text name "unique among siblings, any case"
  }
  kept_words {
    text language PK
    text word PK "never flagged again"
  }
  attachments {
    uuid id PK
    uuid note_id "note it was first added to"
    text content_type "PNG, JPEG, GIF or WebP"
    text sha256 UK "same picture stored once"
    bytea data "the image itself"
  }
  tests {
    uuid id PK
    text title
    jsonb questions "validated on import"
    bool shuffle_options
    uuid folder_id FK "null: generated, or its folder deleted"
    uuid subtask_id FK "its subtask in the batch's mission"
    timestamptz archived_at "null while active"
  }
  test_folders {
    uuid id PK
    text name UK "one per imported batch, any case"
  }
  test_attempts {
    uuid id PK
    uuid test_id FK
    int score
    int total
    jsonb responses "each answer and whether it counted"
  }
  papers {
    uuid id PK
    text title "read from the PDF, editable"
    text authors
    int year "null: unknown"
    text doi
    text file_name
    int byte_size
    int pages "null: not found in the file"
    text sha256 UK "same PDF stored once"
    uuid folder_id FK "null: in no folder"
  }
  paper_files {
    uuid paper_id PK, FK
    bytea data "the PDF itself"
  }
  paper_folders {
    uuid id PK
    text name UK "any case"
  }
  app_state {
    text key PK "workspace or preferences"
    jsonb value "open tabs, active tab, cadence, theme, voice"
  }
  tasks ||--o{ subtasks : "broken into"
  tasks ||--o{ task_completions : "done in a period"
  subtasks ||--o{ subtask_completions : "done in a period"
  notes ||..o{ attachments : "shows"
  note_groups |o--o{ notes : "holds"
  note_groups |o--o{ note_groups : "holds subgroups"
  tests ||--o{ test_attempts : "taken"
  test_folders |o--o{ tests : "holds"
  subtasks |o--o| tests : "ticked by a pass at 100%"
  papers ||--|| paper_files : "its PDF"
  paper_folders |o--o{ papers : "holds"
```

- **Repeating tasks start over.** Done marks belong to one period, so a daily task starts
  undone every day at local midnight. The SQL function `task_period()` numbers periods in your
  time zone, and a run of consecutive done periods is a streak.
- **One-time tasks (`repeats = false`) count a done mark from any period.** The board hides one
  once its only marks are from earlier periods, so it stays visible, ticked, until the period
  it was finished in ends.
- **A task with subtasks is done exactly when all its subtasks are.** Ticking the task ticks
  them all; reopening it clears them for the current period, or for good on a one-time task.
- **A note save carries `baseUpdatedAt`**, the edit time of the stored copy the window started
  from. If the stored copy has changed since, nothing is written and the answer is a 409 with
  that copy, so two windows can't silently overwrite each other.
- **Schema changes are numbered migrations** in `server/migrations/`, each applied once and
  recorded in `schema_migrations`, under an advisory lock.
- **Images no note has shown for 30 days are deleted** by a daily sweep, so removing a picture
  from a note eventually frees its space.
- **Note links are worked out from the text**, not stored: `[[Title]]` in a note's content is
  matched against note titles whenever the notes load, so there's no links table to keep in
  step.
- **Groups nest through `parent_id`.** A top-level group has a `section` (`notes` or `works`),
  and a subgroup has none: it's in its top-level group's section, which a check constraint
  keeps true. Deleting a group first moves its notes and subgroups to its parent, in one
  transaction. Filing and ordering (`PUT /api/notes/:id/group`, `PUT /api/notes/order`) leave
  a note's text and `updated_at` alone, and a note save from a window that predates groups or
  ordering leaves `group_id` and `position` as they are. Schema set-up takes a Postgres
  advisory lock, so two API processes starting together can't collide on it.
- **Notes are ordered by `position` within their group.** A note saved without one goes last;
  notes from before ordering were numbered in the order the sidebar showed them, last edited
  first. A work's final view is never stored.
- **Tasks and subtasks are archived, never deleted**, so streaks survive and a deleted starter
  task doesn't come back on the next start.
- **An import is one transaction:** the folder, the one-time weekly task, a subtask per test
  and the tests, each linked to its subtask, all go in together or not at all. A saved attempt
  that scores 100% ticks the linked subtask in the same transaction, once; archiving a test
  archives its subtask, and the task too when no subtask is left.
- **Images live in `attachments`**, beside the notes that link to them. The link has no
  foreign key, because an image can go into a note before its first save.
- **A paper's PDF lives in `paper_files`**, apart from its details, so listing papers never
  reads the bytes; deleting the paper deletes its file with it (a cascading key). The details
  are read once, when the PDF is added, by `server/src/pdfMeta.ts`, which only scans the file
  for metadata and never renders it.
- **`app_state`** holds interface state so every window reopens onto the same workspace.
  Browser storage is only a cache for a fast first paint.
- **Chat and voice text are never stored** — see [Project rules](#project-rules).

## Project structure

```text
knowledge-vault/
├── Argonaut.exe                 Launcher: start everything with a double-click
├── docker-compose.yml           Services: argonaut-db (PostgreSQL), argonaut-api, argonaut-spell and argonaut-whisper; ports on this PC only
├── .dockerignore                Keeps node_modules, .env and tools out of image builds
├── .env                         Local settings and the LLM key (kept out of images and the web bundle)
├── .env.example                 What .env holds, without the key
├── index.html                   Web app shell
├── package.json                 Frontend dependencies and npm scripts (check, test, test:api, test:spell)
├── tsconfig.json                Frontend TypeScript settings
├── tsconfig.test.json           Type-checks the unit tests
├── vite.config.ts               Vite build and dev server settings
├── dist/                        Built web app (generated by npm run build)
├── public/
│   └── favicon.svg              Argonaut mark, also the app window icon
├── shared/                      Code both the web app and the API use
│   ├── model.ts                 Types, limits, sections, id and image-type checks
│   ├── tabs.ts                  The tab kinds and their keys
│   └── appState.ts              Workspace and preferences fields, and their validation
├── src/                         Web app (React + TypeScript)
│   ├── main.tsx                 Entry point: providers for dialogs, app state and tasks
│   ├── App.tsx                  Layout: sidebar, document, side panel; drawers on smaller screens
│   ├── types.ts                 The shared model, re-exported
│   ├── styles/                  Styling, one file per part of the window, imported in order by index.css
│   │   ├── tokens.css           AA-contrast colours for dark and light, type and spacing
│   │   └── base.css, sidebar.css, editor.css, tests.css, …
│   ├── components/
│   │   ├── Sidebar.tsx          New note, search (Ctrl+K), the four sections, selecting several notes, theme toggle
│   │   ├── NoteTree.tsx         One section's tree: drag to file and order, the group menu, name boxes
│   │   ├── PaperTree.tsx        The Papers section: folders, dropping PDFs in, the paper and folder menus
│   │   ├── PaperView.tsx        A paper in the document area: its details, then the PDF in the browser's viewer
│   │   ├── TestTree.tsx         The Tests section: a folder per imported batch, passes, the folder menu
│   │   ├── treeParts.tsx        What the three trees share: folder rows, ⋯ buttons, menu items, the error line
│   │   ├── FindPanel.tsx        Ctrl+F and Ctrl+R: find and replace with Notepad++'s options
│   │   ├── Menu.tsx             Row menus: placed at the pointer or the ⋯ button, arrow keys, Esc
│   │   ├── NameBox.tsx          The inline box for naming or renaming a group, work or folder
│   │   ├── FinalView.tsx        A work's pages joined into one: Refresh, Copy text, Export .md
│   │   ├── Drawer.tsx           Sidebar or side panel laid over the document on smaller screens
│   │   ├── AssistantSetup.tsx   "Connect your AI assistant": the steps, Copy path, Check again
│   │   ├── EmptyState.tsx       Heading, text and an action for empty tabs
│   │   ├── EmptyWorkspace.tsx   What shows with no tab open
│   │   ├── Icon.tsx             Line icons for icon buttons
│   │   ├── TabStrip.tsx         Missions, Tests and Shortcuts tabs, then notes, papers, final views; the tab menu
│   │   ├── ShortcutsPage.tsx    Read-only list of every shortcut and gesture
│   │   ├── SpellMenu.tsx        The right-click pane: accept a correction, or keep the word
│   │   ├── NoteEditor.tsx       The document: title, essentials, Details, Markdown editor, Ctrl+Click links
│   │   ├── LinkDialog.tsx       Ctrl+L: find a note to link the selected words to, or create one
│   │   ├── TagInput.tsx         Tags as chips: comma or Enter adds one, × or Backspace removes
│   │   ├── MarkdownPreview.tsx  Sanitized Markdown rendering with clickable note links
│   │   ├── MissionsBoard.tsx    Tasks per cadence: add, edit, tick and delete; repeating or one-time
│   │   ├── MissionToasts.tsx    Side pop-ups: task complete, voice changes, daily briefing
│   │   ├── SaveAlert.tsx        The pop-up that rises when a save fails: why, Try again, then "Saved"
│   │   ├── TestsBoard.tsx       Tests tab: generate from notes, import JSON, format guide, tests by folder
│   │   ├── TestRunner.tsx       Taking a test: check, feedback, results, practice the missed
│   │   ├── RichText.tsx         Test text with `code` and code blocks, rendered as plain React text
│   │   ├── AssistantPanel.tsx   Side panel: Assistant and History tabs
│   │   ├── ProgressBar.tsx
│   │   └── ArgonautMark.tsx     The logo as SVG
│   ├── hooks/
│   │   ├── useAppState.tsx      Workspace and preferences, persisted in PostgreSQL
│   │   ├── useDialogs.tsx       The app's own questions and notices, in place of the browser's pop-ups
│   │   ├── useWorkspace.ts      Open tabs, active tab, first-run restore
│   │   ├── useTabs.ts           The tab on show, Ctrl+Tab, final views
│   │   ├── useAppShortcuts.ts   The window-wide keys, in one listener
│   │   ├── useNotes.ts          Notes with offline cache and sync-aware merging; filing, deleting, save conflicts
│   │   ├── useSaveConflict.ts   Asks which text to keep when two windows saved one note
│   │   ├── useResource.ts       Loading from the API, refetched on window focus, stale answers dropped
│   │   ├── useSearch.ts         The sidebar's search over notes and papers
│   │   ├── useSidebarState.ts   Which sections and folders are closed
│   │   ├── useStableList.ts, useStableHandlers.ts, useLatest.ts  Keep typing from redrawing what doesn't change
│   │   ├── useGroups.ts         The sidebar's groups: create, rename, move, delete
│   │   ├── useTests.ts          Tests and their folders, shared by the sidebar and the Tests tab
│   │   ├── usePapers.ts         Papers and their folders; adding PDFs one by one, with a notice
│   │   ├── useFind.ts           Find and replace: what's searched, matches, next and previous, replacing
│   │   ├── useMissions.tsx      Task board, pop-up queue, daily briefing
│   │   ├── useAssistantChat.ts  Conversation in memory; only the latest reply is shown
│   │   ├── useAssistantStatus.ts Whether a key is set, the model, and where .env is
│   │   ├── useLayoutMode.ts     wide, medium or narrow, from the window width
│   │   ├── useFocusTrap.ts      Keeps Tab inside drawers and dialogs; Esc closes them
│   │   ├── useSpeech.ts         Read-aloud with voice selection
│   │   ├── useVoiceInput.ts     The microphone: records a question, ends it on a pause, gets its text from the API
│   │   ├── useSpellcheck.ts     Checks the note half a second after you stop typing
│   │   └── useTheme.ts
│   └── lib/                     API clients and helpers
│       ├── api.ts               Shared fetch wrapper: time zone header, time limits, errors with their status
│       ├── notesApi.ts, groupsApi.ts, tasksApi.ts, testsApi.ts, papersApi.ts, attachmentsApi.ts, spellingApi.ts, appStateApi.ts, assistantClient.ts
│       ├── groups.ts            Group paths ("French › Verbs"), sections, subgroups, notes in order
│       ├── find.ts              The search itself: three modes, options, directions, replacement groups
│       ├── findDom.ts           Searching a rendered page and painting its matches (CSS highlights)
│       ├── finalView.ts         Joining a work's pages the way the text reads; the .md export
│       ├── grading.ts           Marks answers: exact, near miss on accents, or wrong
│       ├── markdownLists.ts     Enter continues * - + and numbered lists in the editor
│       ├── wikilinks.ts         Finds [[links]] outside code, matches them to note titles
│       ├── platform.ts          Ctrl or ⌘, for shortcut labels
│       ├── missionFormat.ts     Cadence labels, streak text, time left
│       └── storage.ts           Safe localStorage access
├── server/                      API + web server (Node + TypeScript)
│   ├── Dockerfile               Builds and tests, then runs compiled JavaScript as a normal user
│   ├── package.json, tsconfig.json, tsconfig.build.json
│   ├── migrations/              Numbered schema changes, each applied once
│   ├── seeds/starter-tasks.sql  Optional starter tasks for a new database
│   ├── test/                    API tests, each file on its own throwaway database
│   └── src/
│       ├── index.ts             Start-up: migrations, the daily image sweep, shutting down cleanly
│       ├── app.ts               Express routes, the local-pages-only guard, error handling, static web app
│       ├── config.ts            Settings from the environment
│       ├── errors.ts, input.ts  One error path, and the shared input checks
│       ├── db.ts                Connection pool, transaction helper, migrations one API at a time
│       ├── notes.ts             Saving notes, with the check against another window's save
│       ├── tasks.ts             Tasks and subtasks: validation, done state, streaks
│       ├── taskActions.ts       Voice changes: task list for the prompt, ACTIONS parsing
│       ├── attachments.ts       Image storage: type check by content, de-duplication
│       ├── tests.ts             Test import and validation, folders and missions per batch, scores
│       ├── testGeneration.ts    A test from notes: prompt, reading the reply, one retry
│       ├── groups.ts            Note groups: names, nesting, moving, deleting
│       ├── papers.ts            Papers and their folders: storing PDFs once, details, filing
│       ├── pdfMeta.ts           Reading a PDF's title, authors, year, DOI and page count
│       ├── spelling.ts          Asks argonaut-spell, hides the words you keep
│       ├── speech.ts            Checks a recording and asks argonaut-whisper for its text
│       ├── appState.ts          Validated, field-merged workspace and preferences
│       ├── llmClient.ts         Chat through the OpenAI-compatible LLM proxy
│       └── skills/              Notes on writing tests and diagrams, for the assistant
├── spell/                       Spell-check service (its own container, dictionaries only)
│   ├── Dockerfile
│   ├── package.json             hunspell-asm and the four dictionaries
│   ├── test/                    Dictionary and service tests
│   └── src/
│       ├── app.ts               /check, /suggest and /health
│       ├── index.ts             Start-up
│       └── dictionaries.ts      Loading, Markdown-aware word finding, language detection
├── database/                    The schema from scratch, for a PostgreSQL of your own
│   ├── schema.sql               Generated from server/migrations; checked by server/test/schema-file.test.mjs
│   ├── create-role-and-database.sql  The login role and its database
│   ├── install-database.ps1     Runs both with psql
│   └── generate-schema.ps1      Rebuilds schema.sql after a new migration
├── scripts/
│   └── install.ps1              First-time setup: checks, .env, containers, Argonaut.exe, desktop shortcut
├── whisper/
│   └── Dockerfile               argonaut-whisper: whisper.cpp v1.9.5 and the base model (checked by SHA-1)
├── launcher/                    Source of Argonaut.exe
│   ├── Launcher.cs              Splash window, WSL update, Docker start-up, health wait, the WebView2 app window
│   ├── build.ps1                Compiles Argonaut.exe with the C# compiler built into Windows; fetches the WebView2 SDK
│   ├── packages/                The WebView2 SDK, fetched by build.ps1 (not in git)
│   ├── argonaut.ico             Icon, 16 to 256 px
│   ├── argonaut-256.png         Mark shown on the splash window
│   └── obj/                     Generated by build.ps1 (bakes in the project folder)
├── tools/
│   └── whisper-bench/           Local speech recognition benchmark (not part of the app)
│       ├── bench.py
│       ├── run.ps1
│       └── requirements.txt
└── documentation/
    ├── README.md                This file
    ├── sample-test.json         A test to import: French prepositions of place
    ├── rust-principal-engineer-tests.json  A batch to import: 50 Rust tests, 636 questions
    ├── french-prepositions-tests.json      A batch to import: 2 tests over 93 French prepositions
    ├── french-prepositions-cheat-sheet.md  The 93 prepositions with meanings and examples
    ├── preposition-tutorials-1.json        A batch to import: 20 tests of 30 sentences
    ├── preposition-tutorials-2.json        A batch to import: 21 tests of 30 sentences
    ├── preposition-tutorials-3.json        A batch to import: 26 tests of 30 sentences
    └── preposition-tutorials-4.json        A batch to import: 26 tests of 30 sentences
```

## Languages and technologies

| Language | Used in | Purpose |
|---|---|---|
| **TypeScript** (React 18, Vite 6) | `src/` | The web app |
| **TypeScript** (Node 24, Express 4) | `server/src/`, `shared/` | API and web server, compiled to JavaScript in the image |
| **TypeScript** (Node 24, hunspell in WebAssembly) | `spell/src/` | Spell checking in its own container |
| **SQL** (PostgreSQL 16) | `server/migrations/`, queries in `server/src/*.ts` | Schema, task periods, streaks |
| **CSS** | `src/styles/` | Styling and themes |
| **HTML** | `index.html` | App shell |
| **C#** 5 (.NET Framework 4.x, WinForms) | `launcher/Launcher.cs` | `Argonaut.exe` |
| **PowerShell** | `launcher/build.ps1`, `tools/whisper-bench/run.ps1` | Build and setup scripts |
| **Python** 3.13 (OpenVINO GenAI) | `tools/whisper-bench/bench.py` | Speech recognition benchmark |
| **YAML** and **Dockerfile** | `docker-compose.yml`, `server/Dockerfile` | Container definitions |
| **SVG** | `public/favicon.svg` | Icon |

## Commands

All commands run from the `knowledge-vault` folder in PowerShell.

### Everyday use

```powershell
# Start everything and open Argonaut (or double-click Argonaut.exe)
.\Argonaut.exe

# Stop the database and API containers
.\Argonaut.exe --stop
```

### Development

```powershell
# First time only: install frontend dependencies
npm install

# Web app with hot reload at http://localhost:5173 (needs the API container running)
npm run dev

# Type-check the web app, server and spell checker, and run the unit tests
# (first time: run "npm install" inside server\ and spell\ too)
npm run check

# The API tests (they make and drop their own throwaway databases) and the spell checker's
npm run test:api
npm run test:spell

# Production build of the web app into dist\
npm run build
```

### Containers

```powershell
docker compose up -d --build          # build and start (what Argonaut.exe runs)
docker compose ps                      # status
docker compose logs -f argonaut-api   # follow API logs
docker compose logs -f argonaut-spell # follow the spell checker
docker compose logs -f argonaut-whisper # follow speech recognition
docker compose stop                    # stop without removing anything
```

The four containers have fixed addresses on their own network (`172.30.87.0/24`: database
.10, spell checker .11, API .12, speech recognition .13). Without them, a restart after Docker Desktop stops abruptly
(a crash, or a WSL update) can hand the containers each other's addresses while Docker keeps
forwarding ports 8787 and 5433 to the old ones. Then the containers look healthy, but every
request from Windows gets an empty reply and nothing saves.

If the app ever loads but can't save (the "Couldn't save" pop-up says the services aren't
answering), run `Argonaut.exe` first: it updates WSL and wakes Docker if they're down. If
saves still fail with the containers running, check whether the API answers from Windows:

```powershell
curl.exe -s http://localhost:8787/api/health        # should print {"ok":true}
docker exec argonaut-api node -e "fetch('http://127.0.0.1:8787/api/health').then(r => r.text()).then(console.log)"
```

If it answers inside the container but not from Windows, the port forwarding is stale.
Recreating the containers fixes it without touching the data, which lives in the
`knowledge-vault_argonaut-db-data` volume. Afterwards, press **Ctrl+S** on any tab marked ●.

```powershell
docker compose up -d --force-recreate
```

### Database

```powershell
# Open a SQL shell
docker exec -it argonaut-db psql -U argonaut -d argonaut
```

Connection for GUI tools: `postgresql://argonaut:argonaut@localhost:5433/argonaut`.
Inside `psql`: `\dt` lists tables and `\q` quits.

### Backups

Everything — notes, images, papers with their PDFs, tasks, tests with their scores, and
workspace — lives in the `argonaut-db-data` Docker volume. It survives rebuilds and restarts, but not a Docker Desktop reset or
`docker compose down -v`. Keep a copy elsewhere, ideally in a folder that syncs off this PC:

```powershell
# Back up to argonaut-backup.dump in the current folder
docker exec argonaut-db pg_dump -U argonaut -Fc -f /tmp/argonaut.dump argonaut
docker cp argonaut-db:/tmp/argonaut.dump .\argonaut-backup.dump

# Restore it, replacing what's in the database (the API is paused meanwhile)
docker compose stop argonaut-api
docker cp .\argonaut-backup.dump argonaut-db:/tmp/argonaut.dump
docker exec argonaut-db pg_restore -U argonaut -d argonaut --clean --if-exists /tmp/argonaut.dump
docker compose start argonaut-api
```

The dump is copied out with `docker cp` rather than redirected with `>`, because Windows
PowerShell rewrites redirected binary output and would corrupt it.

### Testing without touching real progress

Done marks and streaks in the `argonaut` database are real. Try changes against a throwaway
copy of the API on port 8788 instead:

```powershell
# Once: create the throwaway database (its tables are made on first start)
docker exec argonaut-db createdb -U argonaut argonaut_test

# Optional: the three starter tasks, which a new database no longer gets by itself
Get-Content server\seeds\starter-tasks.sql | docker exec -i argonaut-db psql -U argonaut -d argonaut_test

# Terminal 1: an API against it
cd server; $env:PGPORT = '5433'; $env:PGDATABASE = 'argonaut_test'; $env:PORT = '8788'; npm run dev

# Terminal 2: the web app pointed at that API
$env:VITE_API_BASE_URL = 'http://localhost:8788'; npm run dev

# Afterwards
docker exec argonaut-db dropdb -U argonaut argonaut_test
```

### Launcher

```powershell
# Rebuild Argonaut.exe after changing launcher\Launcher.cs or the icon (no SDK needed)
powershell -ExecutionPolicy Bypass -File launcher\build.ps1
```

Code changes to the app itself don't need a new exe: every launch runs
`docker compose up -d --build`, which picks them up. A rebuilt exe also needs copying to the
Desktop, where the shortcut copy lives.

Startup, in order:
1. Find Docker.
2. If its engine isn't running, update WSL (`wsl --update`, with `WSL_UTF8=1` so its output
   is readable), then start or restart Docker Desktop.
3. Run `docker compose up -d --build`.
4. Wait for `/api/health`.
5. Open or focus the app window.

When WSL is already current, the WSL step takes under a second.

### Speech benchmark

```powershell
# Every model on every device (downloads about 440 MB on first run)
powershell -ExecutionPolicy Bypass -File tools\whisper-bench\run.ps1

# A narrower run
powershell -ExecutionPolicy Bypass -File tools\whisper-bench\run.ps1 --models base.en --devices CPU --runs 3
```

Each device runs in its own process. One that stalls is stopped once a phrase takes longer
than `--slow-limit` seconds (default 30), so a full run always finishes.

## Configuration

| Setting | Where | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | `.env` | Where the dev server (port 5173) finds the API. The Docker build leaves it unset, so the app calls its own origin. |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | `.env`, passed to `argonaut-api` by `docker-compose.yml` | Assistant and voice task changes through the LLM proxy. Server-side only: no `VITE_` prefix, so never bundled into the web app. |
| `SETTINGS_FILE` | `.env` | The full path of `.env` itself, so **Configure assistant** can show it with a Copy path button. Optional; without it the steps describe the file instead. |
| Side panel open, and its tab | saved preferences | Remembered across windows; only applies on wide screens, where the panel sits beside the document |
| Groups shown closed | saved preferences | Which sidebar groups and Tests and Papers folders, and which of Notes, Works, Papers, Tests and Agent Skills, are closed, remembered across windows |
| Ports | `docker-compose.yml` | 8787 app and API, 5433 PostgreSQL (not the default 5432, so it can't clash with another PostgreSQL), 5173 dev server. Bound to this PC only (127.0.0.1 and ::1), never the network |
| `POSTGRES_PASSWORD` | `.env` (optional) | The database password; `argonaut` when unset |
| Window profile | `%LOCALAPPDATA%\Argonaut\WebView2` | The app window's own WebView2 profile: storage and cache. `%LOCALAPPDATA%\Argonaut\Browser` is the old Edge window's, unused now |
| Window place | `%LOCALAPPDATA%\Argonaut\window.txt` | Where the window was and its size, as `x y width height maximized` |
| `ARGONAUT_DEVTOOLS` | environment, when starting `Argonaut.exe` | `1` turns on the window's developer tools (F12) |

## API

| Method and path | Purpose |
|---|---|
| `GET /api/health` | Readiness check used by the launcher |
| `GET /api/state` · `PATCH /api/state/:key` | Workspace and preferences (field-merged) |
| `GET /api/notes` | All notes |
| `PUT /api/notes/:id` · `DELETE /api/notes/:id` | Save or delete a note. A save may carry `groupId`, and `baseUpdatedAt` to answer 409 with the stored note if another window saved it since; deleting a note that isn't there answers 404 |
| `PUT /api/notes/:id/group` | File a note last in a group, `{"groupId": "…"}`, or in none with `null` |
| `PUT /api/notes/order` | A group's notes in their new order, all filed there: `{"groupId": …, "noteIds": [...]}` |
| `GET /api/groups` · `POST /api/groups` | The groups, or make one: `{"name", "parentId"}`, plus `"section": "works"` for a work |
| `PATCH /api/groups/:id` · `DELETE /api/groups/:id` | Rename (`name`) or move a group (`parentId`, or `null` and a `section`), or delete it; its contents move up |
| `GET /api/papers` | Papers (details only, never the PDFs) and their folders |
| `POST /api/papers` | Add a PDF (the body is the file; `X-File-Name` and optional `X-Folder-Id` headers): its details are read from it. A file already stored answers 200 with that paper and `"duplicate": true` |
| `GET /api/papers/:id/file` | The PDF, shown inline under its file name and cached for good |
| `PATCH /api/papers/:id` · `DELETE /api/papers/:id` | Edit `title`, `authors`, `year`, `doi` or `folderId`, or delete the paper with its PDF |
| `POST /api/paper-folders` · `PATCH`/`DELETE /api/paper-folders/:id` | Make, rename or delete a folder of papers (its papers stay, in no folder) |
| `POST /api/attachments` | Store an image (the body is the file; `X-File-Name` and `X-Note-Id` headers) |
| `GET /api/attachments/:id` | An image, cached by the browser for good since an id never changes |
| `GET /api/tests` | Tests, oldest first, with their folder, question counts, last score, best score and times taken |
| `POST /api/tests/import` | Import a batch (one test, a list, or `{"name": …, "tests": [...]}`): answers with its `folder`, the `mission` title, the tests, the folders and the task board |
| `GET /api/test-folders` | The Tests folders, one per imported batch |
| `PATCH /api/test-folders/:id` · `DELETE /api/test-folders/:id` | Rename a folder (`{"name": …}`, not onto another folder's name), or delete it; its tests stay |
| `POST /api/tests/generate` | Have the LLM write a test from notes: `source`, `notes` (title and content), `count`, `kind`, `instructions` |
| `GET /api/tests/:id` · `DELETE /api/tests/:id` | One test with its questions, or archive it: scores are kept, its mission subtask goes |
| `POST /api/tests/:id/attempts` | Save a finished run: each answer and whether it counted. Answers with the tests and, when a pass at 100% ticked a mission subtask, `update`: the board and the pop-ups |
| `GET /api/tasks` | Task board: tasks, subtasks, done state, streaks, when each period ends |
| `POST /api/tasks` | Create a task, optionally with subtasks; `"repeats": false` makes it one-time |
| `PATCH /api/tasks/:id` · `DELETE /api/tasks/:id` | Edit a task (title, subtext, cadence, repeats), or archive it |
| `PUT /api/tasks/:id/done` | Mark done or reopen: `{"done": true}`. For the current period, or for good on a one-time task |
| `POST /api/tasks/:id/subtasks` | Add a subtask |
| `PATCH /api/subtasks/:id` · `DELETE /api/subtasks/:id` | Edit a subtask, or archive it |
| `PUT /api/subtasks/:id/done` | Tick or untick a subtask |
| `POST /api/speech/transcribe` | The text of a spoken question: the body is 16 kHz mono 16-bit WAV, up to a minute (`{"text": …}`); 503 when argonaut-whisper isn't answering |
| `POST /api/spelling/check` | Misspelled words in a note, with the language used (`{"text": …, "language": …}`) |
| `POST /api/spelling/suggest` | Corrections for one word, asked for when the right-click pane opens |
| `POST /api/spelling/keep` | Keep a word: it stops being flagged in that language |
| `GET /api/chat/status` | Whether a key is set (never the key), the model, and the settings file's path |
| `POST /api/chat` | A chat turn, which can also change tasks |

Task changes answer with the refreshed board and the pop-ups to show. Requests send an
`X-Timezone` header, so periods roll over at local midnight. The API answers only pages served
from this PC (it checks `Host` and `Origin`), and every error is JSON: `{"error": "…"}`.

## Project rules

- **Voice and chat text is never persisted.** What you ask appears in the History tab only and
  is gone on refresh: not in PostgreSQL, not in browser storage. Only the latest reply is shown
  (and read aloud); earlier replies are never listed, and stay in memory only so follow-up
  questions have context.
- **The assistant changes tasks only through checked actions.** It never writes SQL, only
  tasks you asked about change, and deletes are archives.
- **Secrets stay server-side.** Anything with a `VITE_` prefix is bundled into the browser, so
  keys never get one.
- **Test against a throwaway database.** Done marks and streaks in `argonaut` are real — see
  [Testing without touching real progress](#testing-without-touching-real-progress).

## Speech recognition benchmark

`tools/whisper-bench` measures local Whisper speech recognition (English models `base.en` and
`small.en`) with Intel OpenVINO on each device: startup time, time per phrase and accuracy.
Test phrases are synthesized with the Windows voice, so no recordings are involved. Packages,
models and reports live in `%LOCALAPPDATA%\Argonaut\whisper-bench`.

### Findings on this PC (2026-09-15)

Intel Core i5-6600K, Intel Arc B580 (driver 32.0.101.8864), OpenVINO 2026.3.

| Device | Model | Command (4 s of audio) | Dictation (17 s of audio) | Word error rate |
|---|---|---|---|---|
| CPU | base.en | 0.56 s | 0.82 s | 0% |
| CPU | small.en | 2.6 s | 4.9 s | 0% (17% on one phrase: "Postgres" heard as "post-gress") |
| Arc B580 | base.en | Stalled: no phrase finished within 5 minutes | — | — |

- **The CPU is already fast enough** for spoken commands with `base.en`. `small.en` is 4–6×
  slower and was no more accurate on these phrases, so `base.en` is the pick.
- **The Arc's hardware is fast; OpenVINO's ready-made Whisper pipeline stalls on it.** Split
  tests:
  - The Whisper encoder with a fixed input shape ran in **4.5 ms** on the Arc, against 0.4 s
    on the CPU.
  - The same encoder with the flexible input shape the pipeline uses produced nothing in
    4 minutes. One CPU core stayed pegged, the GPU sat idle, and Intel's graphics compiler
    was loaded.
  - The decoder, which needs flexible shapes because it grows by one step per word, stalled
    the same way.
- **Resizable BAR (off on this PC) is not the cause.** Fixed-shape models run fast without it.
- **Ways to use the Arc:**
  - Re-run the benchmark after an OpenVINO or Arc driver update.
  - Build a hybrid: encoder on the Arc with a fixed shape, decoder on the CPU at about 6 ms
    per word. Estimated around 0.1–0.2 s per command; not measured.
  - Try whisper.cpp's Vulkan backend, which avoids the OpenCL path entirely.
  - An untested guess: two Intel graphics drivers load side by side (a 2022 driver for the
    HD 530 integrated GPU and the 2026 Arc driver). Disabling the integrated GPU may change
    the behavior.
