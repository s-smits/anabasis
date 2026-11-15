// One run of the campaign command over the fixture pack with a script in each seat, in a process of
// its own so that `test/campaign-kill.test.ts` can end it with SIGKILL and run it again:
//
//   bun test/helpers/killed-campaign.ts <root> <name> <moves>
//
// Each script is a function of the campaign's log and of nothing the process holds, so the run after
// a kill is seated as the first was. While `<root>/<name>.hold` exists, an Examiner session waits
// inside its first request, as a model's answer is waited for: a scripted session otherwise ends
// within milliseconds, and a kill aimed at it from outside landed after its tasks on a loaded runner.

import { examine } from "../../src/examiner/session.ts";
import { existsSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { runtimeProcess } from "../../src/meta/process.ts";
import type { Seats } from "../../tools/d2/campaign-terms.ts";
import { harnessBuilder } from "../../tools/d2/harness-builder.ts";
import { scriptedSeats } from "../../tools/runs/rehearse.ts";
import { fixtureTasks, gradedOf, scriptedModel } from "./fixture-pack.ts";

/** The pack's tasks: fourteen held once two are released, as `test/harness-builder.test.ts` holds. */
export const PACK_TASKS = fixtureTasks(16);
/** The tasks one scripted Examiner session proposes. */
const WRITTEN = 8;
/** The base of session `id`'s first task: a session's tasks are its own, whatever a killed one wrote. */
const baseOf = (id: string): number => 1000 * Number(id.replaceAll(/\D/gu, ""));

/** The accepted answer to each task a session up to the twelfth may write, by the id its gate gives it. */
const written = Array.from({ length: 12 * WRITTEN }, (_, index) => {
  const [session, task] = [Math.floor(index / WRITTEN) + 1, (index % WRITTEN) + 1];
  return {
    taskId: `x-${String(session)}-${String(task).padStart(3, "0")}`,
    answer: { answer: String((1000 * session + task) * 6) },
    refusedBy: null,
  };
});
if (import.meta.main) {
  const [root = "", name = "", moves = ""] = runtimeProcess.argv.slice(2);
  const strayed: string[] = [];
  const seats: Seats = {
    seated: scriptedSeats(
      { held: { old: "none", fresh: "pass" }, starter: "none" },
      [...gradedOf(PACK_TASKS), ...written],
      strayed,
    ),
    examine: (request) => {
      const tasks = Array.from({ length: WRITTEN }, (_, index) => ({
        family: "fixture",
        public_input: { base: baseOf(request.id) + index + 1 },
        hidden: null,
      }));
      const note = "Eight more.";
      return examine({
        ...request,
        ...scriptedModel([
          {
            wait: async () => {
              while (existsSync(join(root, `${name}.hold`))) await Bun.sleep(5);
              return ["propose_tasks", { tasks }];
            },
          },
          ["finish", { note }],
          ["finish", { note }],
        ]),
      });
    },
  };
  await harnessBuilder(
    [
      "--root",
      root,
      "--sweep",
      "s",
      "--cycle",
      "c01",
      "--bundle",
      `${root}/bundle`,
      "--name",
      name,
      "--project",
      "fixture-products",
      "--admit",
      "check-product",
      "--practice",
      "2",
      "--target",
      "8",
      "--patience",
      "1",
      "--moves",
      moves,
    ],
    seats,
  );
  if (strayed.length > 0) throw new Error(`solves that ended otherwise than scripted: ${strayed.join("; ")}`);
  // A faux provider's handles would hold the process open.
  runtimeProcess.exit(0);
}
