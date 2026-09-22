import { existsSync, readFileSync, readdirSync } from "../meta/filesystem.ts";
import { campaignDir } from "../meta/campaign-root.ts";
import { join } from "../meta/path.ts";
import { isString } from "../meta/json-shape.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { safeguardLogDir } from "../meta/safeguard.ts";

/** The two files a run records under its controller directory, named once so the readers, the
 *  writers and the relative paths reported to a reader cannot drift apart. */
export const OPENING_FILE = "opening.json";
export const TERMINAL_FILE = "terminal.json";

/** The newest recorded run whose evidence a new opening continues from. */
export type ContinuationEvidence = {
  predecessorRunId: string;
  terminalDigest: string;
};

export function controllerEvidenceDir(campaign: string, runId: string): string {
  return join(campaign, "controller", runId);
}

export function latestRecordedContinuation(campaign: string): ContinuationEvidence | null {
  const controllerDir = join(campaign, "controller");
  if (!existsSync(controllerDir)) return null;
  let latest: ContinuationEvidence | null = null;
  let latestWrittenAt = "";
  for (const runId of readdirSync(controllerDir)) {
    const terminalPath = join(controllerEvidenceDir(campaign, runId), TERMINAL_FILE);
    if (!existsSync(terminalPath)) continue;
    const terminal = parseJsonAs<{ writtenAt?: unknown }>(readFileSync(terminalPath, "utf8"));
    const writtenAt = isString(terminal.writtenAt) ? terminal.writtenAt : "";
    if (
      latest === null ||
      writtenAt > latestWrittenAt ||
      (writtenAt === latestWrittenAt && runId > latest.predecessorRunId)
    ) {
      latest = { predecessorRunId: runId, terminalDigest: hashJsonValue(terminal) };
      latestWrittenAt = writtenAt;
    }
  }
  return latest;
}

/**
 * Resolve a launch id against existing openings and diagnostic identity while the caller holds
 * the campaign lock. A pre-opening failure may leave only a safeguard log, which also reserves
 * the id so a retry cannot append to the failed attempt's record.
 */
export function resolveLaunchRunId(repoRoot: string, projectId: string, runId: string): string {
  const campaign = campaignDir(repoRoot, projectId);
  const taken = (id: string): boolean =>
    existsSync(join(controllerEvidenceDir(campaign, id), OPENING_FILE)) ||
    existsSync(safeguardLogDir(campaign, id));
  if (!taken(runId)) return runId;
  const free = "bcdefghijklmnopqrstuvwxyz"
    .split("")
    .map((letter) => `${runId}${letter}`)
    .find((id) => !taken(id));
  if (free === undefined) {
    throw new Error(
      `run "${runId}" and every continuation suffix b-z are already taken in project "${projectId}" — relaunch with a different --run id`,
    );
  }
  return free;
}
