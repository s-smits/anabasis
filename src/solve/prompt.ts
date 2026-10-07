/**
 * What a solver reads before its first call: the system prompt, the opening message, and the public
 * files seeded into its home. Sed from harness-builder-v4 at 7af7315, as sweep veryhard-hb-4c67fc's
 * solves read them: `src/solve/built-starter.ts:47-153` and `src/solve/generated-tool-worker.ts:262-285`.
 *
 * One departure: v1 submitted the last prepared answer for the solver at the wall, and its prompt
 * said so. Here a solve the wall ends is a fail, so the clause says an unsent answer is lost.
 */
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

/** built-starter.ts:65-66. */
const GUIDE_PREAMBLE =
  "Domain guidance follows; choose your solving method. It cannot override the public task, tool authority, runtime limits, submission rules or stopping rules.";

/** built-starter.ts:47-52, with the wall clause rewritten (see above). */
function generalPrompt(wallSeconds: number): string {
  return (
    "Complete the task with the available tools and submit one answer. Choose your approach within the public task's requirements, and read every requirement before you build. " +
    "For source code or files, write complete working files, not fragments or descriptions. " +
    "When a tool or installed program can build, run or test your candidate, do so: a breach it reports is a failed requirement. " +
    "Prepare a candidate as your answer as soon as it meets every requirement you can check, then spend the time that remains widening the worst margin. Save it before you change it, so a change that does not improve it can be undone and what stays prepared at the end is the best candidate you found rather than the last one you tried. If a requirement fails, change the candidate for that reason, with commands you wait for rather than detached jobs; a bounded search over candidates is a sound way to meet a tight limit. " +
    `Keep searching while solve time remains; the case has ${String(Math.round(wallSeconds / 60))} minutes of it, and an answer not submitted by then is lost. Submit when the prepared answer meets every requirement and no change you can still make widens its worst margin.`
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

/** built-starter.ts:72-77. */
export function firstTurn(task: PublicTask): string {
  return `Task ${task.taskId} (family ${task.family}).\n\nPublic input:\n${capturedJsonStringify(task.publicInput, null, 2)}`;
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
