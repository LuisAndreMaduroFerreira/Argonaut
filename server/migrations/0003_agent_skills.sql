-- A third section of groups beside Notes and Works: Agent Skills, folders of instructions for
-- AI agents, one note per skill.
ALTER TABLE note_groups DROP CONSTRAINT IF EXISTS note_groups_section_check;
ALTER TABLE note_groups ADD CONSTRAINT note_groups_section_check CHECK (
  (parent_id IS NULL AND section IN ('notes', 'works', 'skills')) OR (parent_id IS NOT NULL AND section IS NULL)
);
