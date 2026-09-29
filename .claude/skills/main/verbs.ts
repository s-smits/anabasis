/**
 * The run readers the skills own, each reachable as `bun run runs <verb> <target> [options]`.
 *
 * A row names a script under `.claude/skills/` and the arguments that select its view, and nothing
 * else: the script keeps its own options, target resolution, refusals and output, and
 * `tools/runs/cli.ts` only chooses which one to start. A row is admitted when its script takes one
 * run target, writes nothing under `campaigns/`, spends no provider turn, launches nothing, and
 * answers a question no other verb answers. The WRI rows are exactly the lanes with an in-process
 * `read`, which `test/runs-cli.test.ts` holds in both directions, so renaming a script or a lane
 * moves its row in the same commit and the verb keeps its name.
 */

/** Which script a verb starts, the arguments in front of the operator's, and what it answers. */
export interface RunVerb {
  script: string;
  lead: readonly string[];
  summary: string;
}

const WRI = "whole-run-investigation/scripts/wri.ts";

/** A WRI single-lane reader, whose verb is its lane's name. */
function lane(name: string, summary: string): [string, RunVerb] {
  return [name, { script: WRI, lead: [name], summary }];
}

export const RUN_VERBS: ReadonlyMap<string, RunVerb> = new Map([
  lane("delta", "the measured source against the previous run's, and the safeguards it reached"),
  lane("climb", "whether each battery edge escalated what the solver has to reason about"),
  lane("yield", "whether each review component's output reached something the controller recorded"),
  lane("timeline", "where the wall-clock went: phases, the longest gaps and their recorded causes"),
  lane("walls", "which of the harness's declared solve budgets actually bound its cases"),
  lane("handoff", "what each round handed the next, and whether the next round used it"),
  lane("gates", "what each gate component cost and bought, refusal by refusal"),
  lane("target", "whether the run is about physical hardware, and which runs asked the same"),
]);
