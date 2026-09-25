import { existsSync, readdirSync } from "../../../../src/meta/filesystem.ts";
import { join } from "../../../../src/meta/path.ts";
import { DIFFICULTY_DECISION_SCHEMA } from "../../../../src/run/difficulty-decision.ts";
import type { EvidenceIssue, RunRequest, RunStory, DifficultyDecision } from "../models.js";
import { readJson } from "./files.js";
import { bool, number, object, objectArray, text } from "./json.js";

export const NO_STORY: RunStory = { request: null, difficulty: null };
function fileNames(directory: string): string[] {
  if (!existsSync(directory)) return [];
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export function readRequest(
  repoRoot: string,
  slug: string,
  runId: string,
  issues: EvidenceIssue[],
): RunRequest | null {
  const path = `campaigns/${slug}/controller/${runId}/opening.json`;
  const root = object(readJson(repoRoot, path, issues));
  if (root === null) return null;
  const runtime = object(root.runtime);
  const source = object(root.source);
  const project = object(root.project);
  const slots = object(root.modelSlots);
  const version = text(runtime?.version);
  const name = text(runtime?.name);
  const platform = text(runtime?.platform);
  const arch = text(runtime?.arch);
  return {
    runId: text(root.runId) ?? runId,
    command: text(object(root.command)?.name),
    openedAt: text(root.writtenAt),
    requestDigest: text(project?.requestDigest),
    origin: text(project?.origin),
    // The third slot was recorded as `judge` before 2026-08-19 and as `review` after it. This reads
    // recorded bytes, not configuration, so an opening written by an older run stays readable.
    slots: ["builder", "built", "review", "judge"].flatMap((slot) => {
      const row = object(slots?.[slot]);
      if (row === null) return [];
      return [
        {
          slot,
          enabled: bool(row.enabled) ?? true,
          kind: text(row.kind),
          model: text(row.model),
          effort: text(row.reasoningEffort),
        },
      ];
    }),
    host:
      name === null || version === null
        ? null
        : `${name} ${version}${platform === null ? "" : ` on ${platform}`}${arch === null ? "" : ` ${arch}`}`,
    commit: text(source?.commit),
    dirty: bool(source?.dirty),
    continuedFrom: text(root.continuation),
    source: path,
  };
}

export function readDifficulty(
  repoRoot: string,
  slug: string,
  runId: string,
  issues: EvidenceIssue[],
): DifficultyDecision | null {
  const directory = `campaigns/${slug}/difficulty-decisions`;
  const name = fileNames(join(repoRoot, directory)).findLast(
    (item) => item.startsWith(`${runId}-`) && item.endsWith(".json"),
  );
  if (name === undefined) return null;
  const path = `${directory}/${name}`;
  const root = object(readJson(repoRoot, path, issues));
  if (root === null) return null;
  // An older record is refused on screen rather than read: its vocabulary was replaced without
  // every word changing, so its fields would render as though they meant what they mean now.
  const schema = text(root.schema);
  if (schema !== DIFFICULTY_DECISION_SCHEMA) {
    issues.push({
      level: "warning",
      source: path,
      message: `difficulty decision is ${schema ?? "unversioned"}, not ${DIFFICULTY_DECISION_SCHEMA}; refused`,
    });
    return null;
  }
  const record = object(root.difficulty);
  const decision = object(record?.decision);
  if (decision === null) return null;
  // A current record names each excluded run beside its reason, so the two are joined into one
  // line apiece rather than shown as a bare count.
  const excludedRuns = objectArray(record?.excluded).flatMap((item) => {
    const excludedRun = text(item.runId);
    const reason = text(item.reason);
    return excludedRun === null || reason === null ? [] : [`${excludedRun}: ${reason}`];
  });
  return {
    action: text(decision.action),
    standing: text(object(decision.placement)?.zone),
    rationale: text(decision.rationale),
    admitted: number(record?.admitted),
    excluded: excludedRuns,
    source: path,
  };
}
