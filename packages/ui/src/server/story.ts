import { existsSync, readdirSync } from "../../../../src/meta/filesystem.ts";
import { join } from "../../../../src/meta/path.ts";
import type { EvidenceIssue, RunRequest, RunStory, DifficultyDecision } from "../models.js";
import { readJson } from "./files.js";
import { bool, number, object, objectArray, stringArray, text } from "./json.js";

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
  const located = ["difficulty-decisions", "rung-decisions"]
    .flatMap((directory) => {
      const name = fileNames(join(repoRoot, `campaigns/${slug}/${directory}`)).findLast(
        (item) => item.startsWith(`${runId}-`) && item.endsWith(".json"),
      );
      return name === undefined ? [] : [{ directory: `campaigns/${slug}/${directory}`, name }];
    })
    .at(0);
  if (located === undefined) return null;
  const { directory, name } = located;
  const path = `${directory}/${name}`;
  const root = object(readJson(repoRoot, path, issues));
  // `rung` is the earlier field name. Current records use `difficulty`.
  const record = object(root?.difficulty) ?? object(root?.rung);
  const decision = object(record?.decision);
  if (decision === null) return null;
  // Levels and string exclusions are the earlier shapes. A current record places the battery in a
  // zone and names each excluded run beside its reason; reading only the old fields showed "—" and
  // no exclusions for every record written since the levels went.
  const excludedRuns = objectArray(record?.excluded).flatMap((item) => {
    const excludedRun = text(item.runId);
    const reason = text(item.reason);
    return excludedRun === null || reason === null ? [] : [`${excludedRun}: ${reason}`];
  });
  const level = number(decision.currentLevel);
  return {
    action: text(decision.action),
    standing: text(object(decision.placement)?.zone) ?? (level === null ? null : `L${level}`),
    rationale: text(decision.rationale),
    admitted: number(record?.admitted),
    excluded: [...stringArray(record?.excluded), ...excludedRuns],
    source: path,
  };
}
