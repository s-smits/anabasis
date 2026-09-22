/**
 * Counts census refusals caused by a tool run that reached no completed run.
 *
 * It owns two rules: the public code of a no-result record, one per failure family (a grouping
 * label, not the stall identity), and the durable per-campaign, per-tool count with the ceiling
 * at which the campaign settles instead of opening another authoring round.
 *
 * Only tool ids, check ids and counts reach the author; tool output stays in the protected record.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { POLICY } from "../critic/policy.ts";
import { isString } from "../meta/json-shape.ts";
import { parseJsonAs, capturedJsonStringify } from "../meta/json-runtime.ts";
import { controllerValidatedFinding } from "../truth/brief.ts";
import type { VerifierExecutionEvidence } from "../verify/verifier-port.ts";
import { EVALUATOR_FILE } from "../meta/bundle-layout.ts";

/** The census gate's no-result record, written once per refused census; its presence is the
 *  refusal. */
export const TOOL_NON_RESULT_FILE = "verifier-non-result.json";

interface ToolNonResultStrike {
  toolId: string;
  /** Refused censuses this campaign has now charged to this tool id, this one included. */
  count: number;
  /** True exactly when the count reached POLICY.loop.toolNonResultRefusals. */
  terminal: boolean;
}

/** Refused control censuses per tool id: the campaign's durable count. */
export type ToolNonResultCounts = Record<string, number>;

/** Marks a gate run directory as charged and names its run, so copies count once and uncopied
 *  trial runs still count after a relaunch. */
const CHARGE_FILE = "verifier-non-result-charge.json";

/** The public code for one no-result record: the host-measured outcome family. */
export function toolNonResultCode(evidence: Pick<VerifierExecutionEvidence, "outcome">): string {
  switch (evidence.outcome) {
    case "timeout":
      return "tool-timeout";
    case "crash":
      return "tool-crash";
    case "sandbox":
      return "tool-wall-refusal";
    case "verifierUnavailable":
      return "tool-unavailable";
    case "executed":
    case "protocol":
    case "provider":
    case "transport":
      return "tool-no-result";
  }
}

/**
 * The tool a settled iteration's recorded census refusal names, or null when it recorded none.
 * An unreadable record counts as no refusal, since this counter can end a campaign.
 */
function sealedNonResultToolId(iterationDir: string): string | null {
  const file = join(iterationDir, TOOL_NON_RESULT_FILE);
  if (!existsSync(file)) return null;
  try {
    const row = parseJsonAs<{ toolId?: unknown }>(readFileSync(file, "utf8"));
    return isString(row.toolId) && row.toolId !== "" ? row.toolId : null;
  } catch {
    return null;
  }
}

/**
 * Cumulative per-tool-id counter over one campaign. Keyed by tool rather than candidate, because
 * the tree changes on every repair while the failing tool does not.
 */
export class ToolNonResultStrikes {
  private readonly counts: Map<string, number>;
  /** Seeded from the campaign's settled iterations, so a restart continues the count. */
  constructor(seed: Readonly<ToolNonResultCounts> = {}) {
    this.counts = new Map(Object.entries(seed));
  }
  strike(toolId: string): ToolNonResultStrike {
    const count = (this.counts.get(toolId) ?? 0) + 1;
    this.counts.set(toolId, count);
    return { toolId, count, terminal: count >= POLICY.loop.toolNonResultRefusals };
  }
}

/**
 * Charges a strike to the tool named by this run's no-result record and returns it. Null when the
 * run recorded no census refusal, so an ordinary reject never counts toward the ceiling.
 */
export function chargeSealedNonResult(
  strikes: ToolNonResultStrikes,
  runDir: string,
): ToolNonResultStrike | null {
  const toolId = sealedNonResultToolId(runDir);
  if (toolId === null) return null;
  writeFileSync(join(runDir, CHARGE_FILE), `${capturedJsonStringify({ run: runDir })}\n`);
  return strikes.strike(toolId);
}

/** The run a directory's charge belongs to: its marker's run, or the directory itself. */
function chargedRunOf(dir: string): string {
  try {
    const row = parseJsonAs<{ run?: unknown }>(readFileSync(join(dir, CHARGE_FILE), "utf8"));
    return isString(row.run) ? row.run : dir;
  } catch {
    return dir;
  }
}

/** Every charged gate run directory under `<campaignDir>/trials/<condition>/`. */
export function chargedTrialRunDirs(campaignDir: string): string[] {
  const trials = join(campaignDir, "trials");
  if (!existsSync(trials)) return [];
  return readdirSync(trials)
    .sort()
    .flatMap((condition) =>
      readdirSync(join(trials, condition))
        .sort()
        .map((run) => join(trials, condition, run))
        .filter((run) => existsSync(join(run, CHARGE_FILE))),
    );
}

/** Count the recorded no-result refusals of a campaign's settled iterations and charged trial
 *  runs, one per charged run however many directories hold its copy. */
export function replayNonResultRefusals(dirs: readonly string[]) {
  const counts: ToolNonResultCounts = {};
  const counted = new Set<string>();
  for (const dir of dirs) {
    const toolId = sealedNonResultToolId(dir);
    const run = chargedRunOf(dir);
    if (toolId === null || counted.has(run)) continue;
    counted.add(run);
    counts[toolId] = (counts[toolId] ?? 0) + 1;
  }
  return counts;
}

/**
 * What the author is told about the strike: the count below the ceiling, the settlement at it.
 * Both name only the tool id and the counts.
 */
export function toolNonResultFinding(strike: ToolNonResultStrike) {
  const ceiling = POLICY.loop.toolNonResultRefusals;
  const detail = strike.terminal
    ? `Runs of tool "${strike.toolId}" reached no completed run in ${strike.count} refused census run(s) of this campaign, which is the declared ceiling of ${ceiling}. This domain needs a verifier whose tool runs complete; the campaign settles here instead of opening another authoring round against the same tool`
    : `Runs of tool "${strike.toolId}" have now reached no completed run in ${strike.count} refused census run(s) of this campaign — attempt ${strike.count} of ${ceiling}. Change the inputs, arguments or timeout the evaluator gives this tool, or ground the check with a different installed tool; the campaign ends at ${ceiling}`;
  return controllerValidatedFinding({
    code: strike.terminal ? "tool-non-result-ceiling" : "tool-non-result-repeat",
    path: EVALUATOR_FILE,
    detail,
  });
}
