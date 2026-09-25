/**
 * The census gate's record of a tool run that reached no completed run, and its public code.
 *
 * The census gate settles a tool run that timed out, crashed or was refused at the sandbox as a
 * repairable `correctness-model` finding and writes the host's own record beside the iteration
 * (`settleNonResult` in census-gate.ts). The public code of that record, one per failure family,
 * is derived from the host's own measured fields; it is the family label a reader groups by.
 *
 * Only host-measured facts and public authoring identities cross to the author: tool id, check id,
 * counts. Tool stdout and stderr stay in the protected record.
 */
// Gate audit 2026-09-25 (docs/gate-audit.md, tool-non-result-ceiling): commented out (unsure): a tool that cannot run is an environment fact each run records, not a Builder stall
// import { existsSync, readFileSync, readdirSync, writeFileSync } from "../meta/filesystem.ts";
// import { join } from "../meta/path.ts";
// import { POLICY } from "../critic/policy.ts";
// import { isString } from "../meta/json-shape.ts";
// import { parseJsonAs, capturedJsonStringify } from "../meta/json-runtime.ts";
// import { controllerValidatedFinding } from "../truth/brief.ts";
import type { VerifierExecutionEvidence } from "../verify/verifier-port.ts";
// Gate audit 2026-09-25 (docs/gate-audit.md, tool-non-result-ceiling): commented out (unsure): a tool that cannot run is an environment fact each run records, not a Builder stall
// import { EVALUATOR_FILE } from "../meta/bundle-layout.ts";

/** The census gate's own no-result record, written once per refused census. Its presence in a
 *  settled iteration directory *is* the refusal. */
export const TOOL_NON_RESULT_FILE = "verifier-non-result.json";

// Gate audit 2026-09-25 (docs/gate-audit.md, tool-non-result-ceiling): commented out (unsure): a tool that cannot run is an environment fact each run records, not a Builder stall
// interface ToolNonResultStrike {
//   toolId: string;
//   /** Refused censuses this campaign has now charged to this tool id, this one included. */
//   count: number;
//   /** True exactly when the count reached POLICY.loop.toolNonResultRefusals. */
//   terminal: boolean;
// }
//
// /** Refused control censuses per tool id: the campaign's durable count. */
// export type ToolNonResultCounts = Record<string, number>;
//
// /** Written into a gate run directory when its record is charged. It names the run rather than
//  *  marking the directory, so a copy of the directory into an iteration is recognised as the same
//  *  charge and counted once, while a trial run no iteration ever recorded is still counted after a
//  *  relaunch. */
// const CHARGE_FILE = "verifier-non-result-charge.json";

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

// Gate audit 2026-09-25 (docs/gate-audit.md, tool-non-result-ceiling): commented out (unsure): a tool that cannot run is an environment fact each run records, not a Builder stall
// /**
//  * The tool a settled iteration's recorded census refusal names, or null when it recorded none. A
//  * damaged or unreadable record counts as no refusal: this counter ends a campaign outright, so it
//  * must never fire on bytes it could not read.
//  */
// function sealedNonResultToolId(iterationDir: string): string | null {
//   const file = join(iterationDir, TOOL_NON_RESULT_FILE);
//   if (!existsSync(file)) return null;
//   try {
//     const row = parseJsonAs<{ toolId?: unknown }>(readFileSync(file, "utf8"));
//     return isString(row.toolId) && row.toolId !== "" ? row.toolId : null;
//   } catch {
//     return null;
//   }
// }
//
// /**
//  * Per-tool-id counter over one campaign. Keyed by tool rather than by candidate identity, because
//  * the tree changes on every repair while the failing tool run does not; cumulative rather than
//  * consecutive, because a campaign alternating two broken tool runs is not making progress either.
//  * A different tool id keeps its own count, so switching tools is a fresh start for the new one
//  * while the old one's count stands as evidence.
//  */
// export class ToolNonResultStrikes {
//   private readonly counts: Map<string, number>;
//   /** Seeded from the campaign's own settled iterations and charged trial runs, so a continuation
//    *  invocation continues the count instead of buying the whole ceiling again. A campaign's refused
//    *  submits are spread over however many invocations it took. */
//   constructor(seed: Readonly<ToolNonResultCounts> = {}) {
//     this.counts = new Map(Object.entries(seed));
//   }
//   strike(toolId: string): ToolNonResultStrike {
//     const count = (this.counts.get(toolId) ?? 0) + 1;
//     this.counts.set(toolId, count);
//     return { toolId, count, terminal: count >= POLICY.loop.toolNonResultRefusals };
//   }
// }
//
// /**
//  * The whole per-iteration decision in one call: read the host's own record for this settled run,
//  * charge the strike to the tool it names, and return what the campaign must now do. Null when the
//  * run recorded no census refusal, so an ordinary reject -- a verdict the census did not like --
//  * never counts toward the ceiling.
//  */
// export function chargeSealedNonResult(
//   strikes: ToolNonResultStrikes,
//   runDir: string,
// ): ToolNonResultStrike | null {
//   const toolId = sealedNonResultToolId(runDir);
//   if (toolId === null) return null;
//   writeFileSync(join(runDir, CHARGE_FILE), `${capturedJsonStringify({ run: runDir })}\n`);
//   return strikes.strike(toolId);
// }
//
// /** The run a directory's charge belongs to: the run its marker names, or the directory itself when
//  *  no readable marker is there. The fallback keys an uncharged directory by itself, so a record
//  *  written but never charged still counts exactly once. */
// function chargedRunOf(dir: string): string {
//   try {
//     const row = parseJsonAs<{ run?: unknown }>(readFileSync(join(dir, CHARGE_FILE), "utf8"));
//     return isString(row.run) ? row.run : dir;
//   } catch {
//     return dir;
//   }
// }
//
// /** Every charged gate run directory under `<campaignDir>/trials/<condition>/`. */
// export function chargedTrialRunDirs(campaignDir: string): string[] {
//   const trials = join(campaignDir, "trials");
//   if (!existsSync(trials)) return [];
//   return readdirSync(trials)
//     .sort()
//     .flatMap((condition) =>
//       readdirSync(join(trials, condition))
//         .sort()
//         .map((run) => join(trials, condition, run))
//         .filter((run) => existsSync(join(run, CHARGE_FILE))),
//     );
// }
//
// /** Count the recorded no-result refusals of a campaign's settled iterations and charged trial
//  *  runs, one per charged run however many directories hold its copy. */
// export function replayNonResultRefusals(dirs: readonly string[]) {
//   const counts: ToolNonResultCounts = {};
//   const counted = new Set<string>();
//   for (const dir of dirs) {
//     const toolId = sealedNonResultToolId(dir);
//     const run = chargedRunOf(dir);
//     if (toolId === null || counted.has(run)) continue;
//     counted.add(run);
//     counts[toolId] = (counts[toolId] ?? 0) + 1;
//   }
//   return counts;
// }
//
// /**
//  * What the author is told about the strike. Below the ceiling it is the running count, with the
//  * repairs that are worth trying; at the ceiling it is the settlement sentence. Both name only the
//  * tool id and the counts.
//  */
// export function toolNonResultFinding(strike: ToolNonResultStrike) {
//   const ceiling = POLICY.loop.toolNonResultRefusals;
//   const detail = strike.terminal
//     ? `Runs of tool "${strike.toolId}" reached no completed run in ${strike.count} refused census run(s) of this campaign, which is the declared ceiling of ${ceiling}. This domain needs a verifier whose tool runs complete; the campaign settles here instead of opening another authoring round against the same tool`
//     : `Runs of tool "${strike.toolId}" have now reached no completed run in ${strike.count} refused census run(s) of this campaign — attempt ${strike.count} of ${ceiling}. Change the inputs, arguments or timeout the evaluator gives this tool, or ground the check with a different installed tool; the campaign ends at ${ceiling}`;
//   return controllerValidatedFinding({
//     code: strike.terminal ? "tool-non-result-ceiling" : "tool-non-result-repeat",
//     path: EVALUATOR_FILE,
//     detail,
//   });
// }
