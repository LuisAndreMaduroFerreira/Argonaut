import { useCallback, useEffect, useState } from "react";
import type { NoteGroup, Section } from "../types";
import {
  createGroupRemote,
  deleteGroupRemote,
  fetchGroups,
  moveGroupRemote,
  renameGroupRemote,
} from "../lib/groupsApi";
import { readStorage, writeStorage } from "../lib/storage";

const CACHE_KEY = "knowledge-vault.groups";

function readCache(): NoteGroup[] {
  try {
    const parsed: unknown = JSON.parse(readStorage(CACHE_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as NoteGroup[]) : [];
  } catch {
    return [];
  }
}

// The sidebar's groups. The database holds them; the browser keeps a copy only so the
// sidebar draws at once. Every change answers with the full list, which replaces this one.
export function useGroups() {
  const [groups, setGroups] = useState<NoteGroup[]>(readCache);

  useEffect(() => {
    let cancelled = false;
    fetchGroups()
      .then((list) => {
        if (!cancelled) setGroups(list);
      })
      .catch(() => {
        // Offline: the cached copy stands in.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    writeStorage(CACHE_KEY, JSON.stringify(groups));
  }, [groups]);

  const createGroup = useCallback(
    async (name: string, parentId: string | null, section: Section = "notes"): Promise<NoteGroup> => {
      const result = await createGroupRemote(name, parentId, section);
      setGroups(result.groups);
      return result.group;
    },
    [],
  );

  const renameGroup = useCallback(async (id: string, name: string) => {
    setGroups(await renameGroupRemote(id, name));
  }, []);

  // parentId null moves it to the top level of `section`.
  const moveGroup = useCallback(async (id: string, parentId: string | null, section: Section = "notes") => {
    setGroups(await moveGroupRemote(id, parentId, section));
  }, []);

  // Answers with the parent that took over the group's notes and subgroups.
  const deleteGroup = useCallback(async (id: string): Promise<string | null> => {
    const result = await deleteGroupRemote(id);
    setGroups(result.groups);
    return result.parentId;
  }, []);

  return { groups, createGroup, renameGroup, moveGroup, deleteGroup };
}
