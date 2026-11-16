import { useCallback } from "react";
import type { GenerateOptions, TestFolder, TestSummary } from "../types";
import {
  deleteTestFolder,
  fetchTestFolders,
  fetchTests,
  generateTest,
  importTests,
  removeTest,
  renameTestFolder,
  type GeneratedTest,
  type ImportResult,
} from "../lib/testsApi";
import { useResource } from "./useResource";

interface TestsData {
  tests: TestSummary[];
  folders: TestFolder[];
}

const loadTests = async (): Promise<TestsData> => {
  const [tests, folders] = await Promise.all([fetchTests(), fetchTestFolders()]);
  return { tests, folders };
};

// The tests and their folders, shared by the Tests tab and the sidebar's Tests section. Each
// change goes through here and answers with the lists, which replace these, as with papers.
export function useTests() {
  const { data, error, setData, refresh } = useResource(loadTests, { failure: "Failed to load tests" });

  const setTests = useCallback(
    (tests: TestSummary[]) => setData((prev) => ({ tests, folders: prev?.folders ?? [] })),
    [setData],
  );
  const setFolders = useCallback(
    (folders: TestFolder[]) => setData((prev) => ({ tests: prev?.tests ?? [], folders })),
    [setData],
  );

  const importBatch = useCallback(
    async (payload: unknown): Promise<ImportResult> => {
      const result = await importTests(payload);
      setData({ tests: result.tests, folders: result.folders });
      return result;
    },
    [setData],
  );

  const generate = useCallback(
    async (options: GenerateOptions): Promise<GeneratedTest> => {
      const result = await generateTest(options);
      setTests(result.tests);
      return result;
    },
    [setTests],
  );

  const remove = useCallback(async (id: string) => setTests(await removeTest(id)), [setTests]);

  const renameFolder = useCallback(
    async (id: string, name: string) => setFolders(await renameTestFolder(id, name)),
    [setFolders],
  );

  // The folder goes; its tests move to the top of the Tests section.
  const deleteFolder = useCallback(
    async (id: string) => {
      const result = await deleteTestFolder(id);
      setData({ tests: result.tests, folders: result.folders });
    },
    [setData],
  );

  return {
    tests: data?.tests ?? null,
    folders: data?.folders ?? [],
    loadError: error,
    setTests,
    refresh,
    importBatch,
    generate,
    remove,
    renameFolder,
    deleteFolder,
  };
}

export type TestsState = ReturnType<typeof useTests>;
