// One run of the campaign command over the fixture pack with a script in each seat, in its own process
// so `test/campaign-kill.test.ts` can SIGKILL it and run it again: `bun test/helpers/killed-campaign.ts
// <root> <name> <moves>`. Each script is a function of the log alone, so the run after a kill is seated
// as the first was. While `<root>/<name>.hold` exists, an Examiner session waits inside its first
// request, so a kill from outside lands before its tasks.

import { examine } from "../../src/examiner/session.ts";
import { existsSync } from "../../src/meta/filesystem.ts";
import { dirname, join } from "../../src/meta/path.ts";
import { runtimeProcess } from "../../src/meta/process.ts";
import { campaignLog } from "../../tools/campaign/campaign.ts";
import type { Seats } from "../../tools/campaign/campaign-terms.ts";
import { harnessBuilder } from "../../tools/campaign/harness-builder.ts";
import { scriptedSeats } from "../../tools/runs/rehearse.ts";
import { fixtureTasks, gradedOf, layOutPack, OPENED_FROM, scriptedModel } from "./fixture-pack.ts";

export const PACK_TASKS = fixtureTasks(16);
const WRITTEN = 8;
/** The base of session `id`'s first task: a session's tasks are its own, whatever a killed one wrote. */
const baseOf = (id: string): number => 1000 * Number(id.replaceAll(/\D/gu, ""));

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
  if (!existsSync(campaignLog(name))) layOutPack(dirname(campaignLog(name)), PACK_TASKS);
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
      "--name",
      name,
      "--project",
      "fixture-products",
      ...OPENED_FROM,
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
