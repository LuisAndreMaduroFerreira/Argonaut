-- Three starter tasks for the Missions tab. Not part of the schema: a new database starts with
-- no tasks, and this file adds these when you want them (see the README). The tests load it as
-- their fixture. Fixed ids make it safe to run twice.
INSERT INTO tasks (id, title, subtext, cadence) VALUES
  ('5eed7a5c-0000-4000-8000-000000000001', 'French learning', '', 'DAILY'),
  ('5eed7a5c-0000-4000-8000-000000000002', 'Book Continuation', 'Write 3 optimized pages today', 'DAILY'),
  ('5eed7a5c-0000-4000-8000-000000000003', 'Application Development', 'Proceed with Argonaut development', 'DAILY')
ON CONFLICT (id) DO NOTHING;

INSERT INTO subtasks (id, task_id, title, subtext) VALUES
  ('5eed57b0-0000-4000-8000-000000000001', '5eed7a5c-0000-4000-8000-000000000001',
   'Prepositions', 'Transcribe and learn French prepositions')
ON CONFLICT (id) DO NOTHING;
