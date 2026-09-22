import { join } from "../../../../src/meta/path.ts";
import { EVIDENCE_PAGE_SIZE, type EvidencePage, type FileRef } from "../models.js";
import { controllerRuns, hydrateControllerRun } from "./current.js";
import { walkRunFiles } from "./files.js";

/** One evidence page request: which run, how far in, and the two filters the page applies. */
type EvidencePageRequest = {
  readonly project: string;
  readonly runId: string;
  readonly offset: number;
  readonly query: string;
  readonly category: string;
};

/** Search before slicing, with one look-ahead row; no total-count walk or full JSON inventory. */
export function evidencePage(
  files: Iterable<FileRef>,
  offset: number,
  query: string,
  category: string,
): EvidencePage {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid evidence page offset.");
  const page: FileRef[] = [];
  const seen = new Set<string>();
  let matched = 0;
  for (const file of files) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    if (
      !file.path.toLowerCase().includes(query.toLowerCase()) ||
      (category !== "all" && file.category !== category)
    ) {
      continue;
    }
    if (matched++ < offset) continue;
    if (page.length === EVIDENCE_PAGE_SIZE) return { files: page, offset, hasMore: true };
    page.push(file);
  }
  return { files: page, offset, hasMore: false };
}

export function readEvidencePage(repoRoot: string, request: EvidencePageRequest): EvidencePage {
  const { project, runId, offset, query, category } = request;
  const run = controllerRuns(repoRoot).find(
    (candidate) => candidate.projectId === project && candidate.title === runId,
  );
  if (run === undefined) throw new Error("Run not found.");
  hydrateControllerRun(repoRoot, run);
  function* files(): Generator<FileRef> {
    yield* run!.files;
    yield* walkRunFiles(repoRoot, join(repoRoot, "campaigns", project, "controller", runId));
  }
  return evidencePage(files(), offset, query, category);
}
