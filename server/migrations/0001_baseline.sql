-- The schema as it stood on 2026-11-12, when numbered migrations replaced a script that ran at
-- every start. On a new database this builds everything. On a database from before, it runs
-- once more and changes nothing: every statement is written to be safe to repeat.

CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- Notes can pin the language the spell checker uses: '' works it out from the text,
-- 'off' turns checking off, or a code like 'pt' fixes it.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT '';

-- Groups for the sidebar. A group with a parent is a subgroup, to any depth. Names are
-- unique among siblings, ignoring case, so a group's path always names one group.
CREATE TABLE IF NOT EXISTS note_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES note_groups (id),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Top-level groups belong to a sidebar section: 'notes', or 'works' for books written page by
-- page. A subgroup takes its section from the group it's in, so its own is null.
ALTER TABLE note_groups ADD COLUMN IF NOT EXISTS section TEXT;
UPDATE note_groups SET section = 'notes' WHERE parent_id IS NULL AND section IS NULL;

DO $$
BEGIN
  ALTER TABLE note_groups ADD CONSTRAINT note_groups_section_check CHECK (
    (parent_id IS NULL AND section IN ('notes', 'works')) OR (parent_id IS NOT NULL AND section IS NULL)
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- Names are unique among siblings, and a work may share a name with a group in Notes. The
-- index dropped here is the one from before Works existed (2026-09-27).
DROP INDEX IF EXISTS note_groups_sibling_name;
CREATE UNIQUE INDEX IF NOT EXISTS note_groups_sibling_section_name
  ON note_groups (
    COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(section, ''),
    lower(name)
  );

-- A note sits in at most one group. Deleting a group moves its notes up a level first, so
-- the fallback to no group only matters if a row is ever removed by hand.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES note_groups (id) ON DELETE SET NULL;

-- Notes keep the order they're dragged into within their group, and new ones go last. Notes
-- from before ordering existed start in the order the sidebar showed: last edited first.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS position DOUBLE PRECISION;
UPDATE notes SET position = ranked.base + ranked.place
FROM (
  SELECT n.id,
         row_number() OVER (PARTITION BY n.group_id ORDER BY n.updated_at DESC) AS place,
         COALESCE((SELECT max(o.position) FROM notes o WHERE o.group_id IS NOT DISTINCT FROM n.group_id), 0) AS base
  FROM notes n
  WHERE n.position IS NULL
) AS ranked
WHERE notes.id = ranked.id;

-- Words you chose to keep, so the spell checker stops flagging them. The words live here
-- rather than in the spell container, which holds only dictionaries.
CREATE TABLE IF NOT EXISTS kept_words (
  language TEXT NOT NULL,
  word TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (language, word)
);

-- Images added to notes, kept beside them so one database backup holds both. Notes refer
-- to them as /api/attachments/<id>. note_id records where an image was first added and has
-- no foreign key, because images can go into a note before its first save.
CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID,
  file_name TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Question sets imported from JSON and taken in the Tests tab. Questions are kept as the
-- validated JSON. Tests are archived rather than deleted, so past scores keep their test.
CREATE TABLE IF NOT EXISTS tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  shuffle_options BOOLEAN NOT NULL DEFAULT true,
  shuffle_questions BOOLEAN NOT NULL DEFAULT false,
  questions JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  archived_at TIMESTAMPTZ
);

-- One row per finished run: what was answered, and whether each answer counted.
CREATE TABLE IF NOT EXISTS test_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES tests (id),
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  responses JSONB NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (total > 0 AND score BETWEEN 0 AND total)
);

CREATE INDEX IF NOT EXISTS test_attempts_test_id ON test_attempts (test_id, finished_at);

-- Interface state (open tabs, theme, voice) shared by every window, so the Argonaut
-- app window and a dev browser tab open onto the same workspace. Values are merged per field.
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tasks with subtasks replaced the automatic, XP-earning missions on 2026-09-15. Only a
-- database from before that day still has these tables.
DROP TABLE IF EXISTS mission_completions, activity_events, missions;
DROP TYPE IF EXISTS mission_cadence CASCADE;

DO $$
BEGIN
  CREATE TYPE task_cadence AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- A task repeats every period of its cadence (day, week, month, year) and starts each one
-- undone. Tasks and subtasks are archived rather than deleted so streak history survives.
-- clock_timestamp() keeps rows inserted in one transaction in the order they were added.
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  subtext TEXT NOT NULL DEFAULT '',
  cadence task_cadence NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS subtasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks (id),
  title TEXT NOT NULL,
  subtext TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  archived_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS subtasks_task_id ON subtasks (task_id);

-- One-time tasks stay done once ticked instead of starting over each period.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS repeats BOOLEAN NOT NULL DEFAULT true;

-- Done marks, one per period. The cadence is part of the key, so marks made before a
-- task's cadence changed never count toward the new one.
CREATE TABLE IF NOT EXISTS task_completions (
  task_id UUID NOT NULL REFERENCES tasks (id),
  cadence task_cadence NOT NULL,
  period_index INTEGER NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, cadence, period_index)
);

CREATE TABLE IF NOT EXISTS subtask_completions (
  subtask_id UUID NOT NULL REFERENCES subtasks (id),
  cadence task_cadence NOT NULL,
  period_index INTEGER NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subtask_id, cadence, period_index)
);

-- Resolves the period containing p_at in the user's time zone. period_index is a
-- consecutive integer per cadence (days since epoch, Monday-aligned weeks, months,
-- years), so a streak is simply a run of consecutive indexes.
CREATE OR REPLACE FUNCTION task_period(
  p_cadence task_cadence,
  p_tz TEXT,
  p_at TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  period_index INTEGER,
  period_key TEXT,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
  SELECT
    CASE p_cadence
      WHEN 'DAILY' THEN b.start_local::date - DATE '1970-01-01'
      WHEN 'WEEKLY' THEN (b.start_local::date - DATE '1970-01-05') / 7
      WHEN 'MONTHLY' THEN EXTRACT(YEAR FROM b.start_local)::int * 12
        + EXTRACT(MONTH FROM b.start_local)::int - 1
      ELSE EXTRACT(YEAR FROM b.start_local)::int
    END,
    CASE p_cadence
      WHEN 'DAILY' THEN to_char(b.start_local, 'YYYY-MM-DD')
      WHEN 'WEEKLY' THEN to_char(b.start_local, 'IYYY-"W"IW')
      WHEN 'MONTHLY' THEN to_char(b.start_local, 'YYYY-MM')
      ELSE to_char(b.start_local, 'YYYY')
    END,
    b.start_local AT TIME ZONE p_tz,
    (b.start_local + b.span) AT TIME ZONE p_tz
  FROM (
    SELECT
      date_trunc(
        CASE p_cadence
          WHEN 'DAILY' THEN 'day'
          WHEN 'WEEKLY' THEN 'week'
          WHEN 'MONTHLY' THEN 'month'
          ELSE 'year'
        END,
        p_at AT TIME ZONE p_tz
      ) AS start_local,
      CASE p_cadence
        WHEN 'DAILY' THEN INTERVAL '1 day'
        WHEN 'WEEKLY' THEN INTERVAL '1 week'
        WHEN 'MONTHLY' THEN INTERVAL '1 month'
        ELSE INTERVAL '1 year'
      END AS span
  ) AS b
$$;

-- Tests imported together share a folder in the sidebar's Tests section, named after the batch.
CREATE TABLE IF NOT EXISTS test_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX IF NOT EXISTS test_folders_name ON test_folders (lower(name));

ALTER TABLE tests ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES test_folders (id) ON DELETE SET NULL;

-- An imported test's subtask in the weekly mission its import added; passing the test at 100%
-- ticks it.
ALTER TABLE tests ADD COLUMN IF NOT EXISTS subtask_id UUID REFERENCES subtasks (id);

-- Papers: PDFs (scientific papers) shown in the sidebar's Papers section, optionally filed in a
-- folder. Their details are read from the PDF when it's added and can be edited. The bytes are
-- kept apart, so listing papers never reads them; the same file is stored once.
CREATE TABLE IF NOT EXISTS paper_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX IF NOT EXISTS paper_folders_name ON paper_folders (lower(name));

CREATE TABLE IF NOT EXISTS papers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  authors TEXT NOT NULL DEFAULT '',
  year INTEGER,
  doi TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  byte_size INTEGER NOT NULL,
  pages INTEGER,
  sha256 TEXT NOT NULL UNIQUE,
  folder_id UUID REFERENCES paper_folders (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS paper_files (
  paper_id UUID PRIMARY KEY REFERENCES papers (id) ON DELETE CASCADE,
  data BYTEA NOT NULL
);
