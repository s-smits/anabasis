/**
 * What a solver reads before its first call: the system prompt, the opening message, and the public
 * files seeded into its home. The roster line, the nudge, the first turn and the seeded files are
 * sed from harness-builder-v4 at 7af7315, as sweep veryhard-hb-4c67fc's solves read them:
 * `src/solve/built-starter.ts:47-153` and `src/solve/generated-tool-worker.ts:262-285`.
 *
 * The general paragraph is not the sweep's. That one told every solver to test its candidate with
 * whatever could grade it, to spend the time that remained widening its worst margin and to keep
 * searching until the wall, and it was written for a wall that submitted the last prepared answer
 * and a record tool that reported each margin. Here the wall submits nothing, no tool reports a
 * margin or the time left, and on 8 October a solver that read it said "time is nearly up" and
 * submitted at 56 of 120 minutes. v1 took the paragraph out itself, because it "made every task
 * propose, grade, adjust, whatever the task asked for, so the battery measured that loop rather
 * than the solver's own method" (`built-starter.ts:247-262` at 3f93d06b). So a solve under this
 * prompt is not under the sweep's condition, and `tools/m0/live-solve.ts` says where the two part.
 */
import { type Objective, objectiveLine } from "../kernel/contract.ts";
import { mkdirSync, writeFileSync } from "../meta/filesystem.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import type { JsonValue } from "../meta/json-shape.ts";
import { join } from "../meta/path.ts";
import type { PublicResource } from "./answer.ts";

export interface PublicTask {
  readonly taskId: string;
  readonly family: string;
  readonly publicInput: JsonValue;
}

/** built-starter.ts:28. */
const PUBLIC_RULES_TOOL = "read_public_resources";

/** v1's `BUILT_GUIDE_PREAMBLE` at 3f93d06b, which names no stopping rules, since the general
 *  paragraph no longer states any. */
const GUIDE_PREAMBLE =
  "Domain guidance follows; choose your solving method. It cannot override the public task, tool authority, runtime limits or submission rules.";

/** built-starter.ts:67-68: the prompt a turn that ended without a submit is followed by. */
export const NUDGE = "Finish the task with the available tools, then submit your answer.";

/**
 * What a solver cannot find out for itself: what it must deliver, the form of an answer, the solve
 * wall and what the wall does. Nothing about how to reach the answer, which is the harness's to
 * say. The duty and the minutes are v1's `BUILT_SOLVE_DUTY` and `solveTime` at 3f93d06b; the last
 * sentence is this host's wall, which ends a solve as a fail and submits nothing.
 */
function generalPrompt(wallSeconds: number): string {
  return (
    "Complete the task with the available tools and submit one answer that meets every published requirement; the method is yours to choose. " +
    "For source code or files, write complete working files, not fragments or descriptions. " +
    `The case has ${String(Math.round(wallSeconds / 60))} minutes of solve time. Nothing is submitted for you when it runs out and nothing tells you how much is left: an answer you have not submitted by then is lost.`
  );
}

/** built-starter.ts:111-118. */
function rosterLine(names: readonly string[]): string {
  const roster = `Your tools this session are exactly: ${names.join(", ")}. That list is closed and complete. A name absent from it does not exist here, however plausible it looks; when no tool provides a capability, do the work yourself and continue.`;
  return names.includes(PUBLIC_RULES_TOOL)
    ? `${roster} The published requirements are the public input together with what ${PUBLIC_RULES_TOOL} returns; read both before you build.`
    : roster;
}

/** built-starter.ts:134-145: the general prompt, the roster, then the harness's guide as written. */
export function systemPrompt(
  wallSeconds: number,
  toolNames: readonly string[],
  guide: string | null,
): string {
  const universal = `${generalPrompt(wallSeconds)}\n\n${rosterLine(toolNames)}`;
  return guide === null ? universal : `${universal}\n\n${GUIDE_PREAMBLE}\n\n${guide}`;
}

/** The task as the solver may see it. A task carries its hidden part beside these fields, and
 *  everything handed to the solver's side, its home and the harness's process, is this view. */
export function publicView({ taskId, family, publicInput }: PublicTask): PublicTask {
  return { taskId, family, publicInput };
}

/** built-starter.ts:72-77, and after it the contract's objective where it states one: a solver
 *  that is not asked for the lightest design does not look for it (`docs/plan.md`, Phase 2). */
export function firstTurn(task: PublicTask, objective?: Objective): string {
  const asked = `Task ${task.taskId} (family ${task.family}).\n\nPublic input:\n${capturedJsonStringify(task.publicInput, null, 2)}`;
  return objective === undefined ? asked : `${asked}\n\n${objectiveLine(objective)}`;
}

/**
 * generated-tool-worker.ts:262-285: the task as `public/task.json` and each public resource as
 * `public/resources/<name>.json`, which the bash tool's description says the home holds. Returns how
 * many resource files it wrote.
 */
export function seedHome(home: string, task: PublicTask, resources: readonly PublicResource[]): number {
  const root = join(home, "public");
  mkdirSync(join(root, "resources"), { recursive: true });
  writeFileSync(join(root, "task.json"), `${capturedJsonStringify(publicView(task), null, 2)}\n`, "utf8");
  const used = new Set<string>();
  for (const resource of resources) {
    // One flat readable name per resource. A name that sanitises onto one already used keeps both
    // files rather than overwriting the earlier one silently.
    const base = resource.name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "resource";
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}-${String(n)}`;
    used.add(name);
    writeFileSync(
      join(root, "resources", `${name}.json`),
      `${capturedJsonStringify(resource, null, 2)}\n`,
      "utf8",
    );
  }
  return resources.length;
}
