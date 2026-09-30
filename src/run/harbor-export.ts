/**
 * The Harbor task format (harborframework.com) for an exported bundle: one directory per recorded
 * task, written by Harbor's own `harbor task init` ported to TypeScript (`vendor/harbor/init.ts`),
 * canary strings included, with `instruction.md` and an `environment/` that holds the public task
 * and the published requirements alone. It runs on Bun, not in a container: `environment/task.json`
 * is a task file the export's own `solve` and `check` take, with the bundle's tool tree and the OS
 * wall, so no Dockerfile or Linux image is written.
 */
import { join } from "../meta/path.ts";
import { writeJsonFile } from "../meta/completed-json.ts";
import type { Brief } from "../correctness-bundle/brief.ts";
import { harnessSettings } from "../correctness-bundle/harness-config.ts";
import { briefPublicResources } from "../correctness-bundle/public-resources.ts";
import { commitPublicTask, type PublicTask } from "../correctness-bundle/task-split.ts";
import {
  BUILT_SOLVE_DUTY,
  builtFirstTurnPrompt,
  publishedRequirements,
  solveTime,
} from "../solve/built-starter.ts";
import { _init_task } from "../../vendor/harbor/init.ts";
import { loadRecordedTasks } from "./run-driver.ts";

/** The Built solver's opening, without its toolkit: the task, its duty, where the published
 *  requirements are, and the form and place of the answer. */
function instruction(task: PublicTask<unknown>, resources: readonly string[], solveMs: number): string {
  return [
    builtFirstTurnPrompt(task),
    `${BUILT_SOLVE_DUTY} ${publishedRequirements(`environment/public-resources.json (${resources.join(", ")})`)} environment/task.json holds the same public input.`,
    `Submit by writing the answer to artifact.json, as a single JSON object whose fields follow the artifact-schema resource; an answer with fields outside it is refused. ${solveTime(solveMs)}.`,
    "",
  ].join("\n\n");
}

/** Write one Harbor task directory per recorded task under `harborDir`. */
export function writeHarborTasks(bundleDir: string, harborDir: string, slug: string, brief: Brief): void {
  const resources = briefPublicResources(brief);
  const names = resources.map(({ name }) => name);
  const { solveMs } = harnessSettings(bundleDir);
  for (const task of loadRecordedTasks(bundleDir)) {
    const view = commitPublicTask(task).view();
    const dir = _init_task(`${slug}/${task.taskId}`, harborDir, {
      instruction: instruction(view, names, solveMs),
      include_canary_strings: true,
      description: `Task ${task.taskId} (family ${task.family}) of the Anabasis Built Harness ${slug}`,
      metadata_template: { metadata: { family: task.family }, agent: { timeout_sec: solveMs / 1000 } },
    });
    writeJsonFile(join(dir, "environment", "task.json"), view);
    writeJsonFile(join(dir, "environment", "public-resources.json"), resources);
  }
}
