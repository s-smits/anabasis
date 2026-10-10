// The climb, simulated: a campaign run by its log over the fixture pack with a script in each
// model seat, where a task's difficulty is its base and a harness's strength is a number its guide
// carries. A solve passes where the base is at most the strength, and gives no answer otherwise;
// each Builder session raises the strength by two; each Examiner session asked for room reads the
// reference harness's strength from its kept state and writes tasks on either side of it, as an
// Examiner that hears which tasks were answered would. What this proves is the controller's part
// of the climb and nothing of a model: that a campaign promotes a harness, has harder tasks
// written, promotes a harder one on them, and ends on its budget of moves and not before. Run by
// name, since its solves run under the real wall and take minutes:
//
//   ANA_CLIMB=1 bun run test -- test/climb.test.ts
//
// The operator's question of 10 October: does the system climb, epoch after epoch, where an
// epoch ends with a promotion and the next one's tasks are harder?

import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { examine } from "../src/examiner/session.ts";
import { type LogEvent, read } from "../src/kernel/log.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { ANSWER_FILE } from "../src/solve/answer.ts";
import { GUIDE_FILE } from "../src/meta/bundle-layout.ts";
import { harnessBuilder, type Seats } from "../tools/d2/harness-builder.ts";
import { type Epoch, epochLine, epochsOf } from "../src/builder/climb.ts";
import { fixtureTasks, layOutPack, scriptedModel } from "./helpers/fixture-pack.ts";

const REPO = resolve(import.meta.dir, "..");
const FIXTURE = join(REPO, "test", "fixtures", "harness-min");
const NAME = `test-climb-${String(runtimeProcess.pid)}`;
const TASKS = fixtureTasks(7);
/** The starter's strength: it answers a base of three and under. */
const STARTER_STRENGTH = 3;
/** What one Builder session adds. */
const RAISE = 2;
/** Tasks an Examiner asked for writes, by how far above the reference's strength each is: all
 *  harder than what the reference answers, as room asks, and some past any harness so far. */
const ABOVE = [1, 1, 2, 2, 3, 4];
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-climb-")));
const bundle = join(root, "bundle");
const folder = join(REPO, ".ana", "d2", NAME);

setDefaultTimeout(1_800_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  // `ANA_CLIMB_KEEP=1` keeps the campaign's folder for reading, under `.ana/d2/`.
  if (runtimeProcess.env.ANA_CLIMB_KEEP === undefined) rmSync(folder, { recursive: true, force: true });
});

/** The strength a harness's guide carries, its last line of the kind, or the starter's where it
 *  carries none: each session appends one, so the last is the session's. */
function strengthOf(dir: string): number {
  const guide = join(dir, "agent", GUIDE_FILE);
  const found = existsSync(guide)
    ? [...readFileSync(guide, "utf8").matchAll(/strength: (\d+)/g)].at(-1)
    : undefined;
  return found === undefined ? STARTER_STRENGTH : Number(found[1]);
}

/** What a campaign's log holds of one kind, in order. */
const of = (kind: string): JsonObject[] =>
  read(join(folder, "log.jsonl")).flatMap((event: LogEvent) => (event.kind === kind ? [event.data] : []));

describe("the climb", () => {
  it.skipIf(runtimeProcess.env.ANA_CLIMB === undefined)(
    "promotes a harness, has harder tasks written, and promotes a harder one on them, epoch after epoch",
    async () => {
      layOutPack(root, bundle, TASKS, FIXTURE);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "seed.json"), `${JSON.stringify({ from: null, events: 0 })}\n`);
      const flags = [
        "--root",
        root,
        "--sweep",
        "s",
        "--cycle",
        "c01",
        "--bundle",
        bundle,
        "--name",
        NAME,
        "--admit",
        "check-product",
        "--practice",
        "2",
        "--solves",
        "1",
        "--sessions",
        "1",
        // Every held-out task is scored. The scored set is drawn by hash from the tasks of every
        // epoch (`scoredSet`), so a target of 8 over the 19 tasks the third epoch holds drew two or
        // three the reference fails and left the comparison one win short three times (climb-9,
        // 10 October): the draw's part in the climb is the operator's open row, and no result of
        // this test says anything about it.
        "--target",
        "24",
        "--exam-tasks",
        "6",
        "--patience",
        "3",
        // The operator's word, given once, for the promotions (AGENTS.md, section 3).
        "--unattended",
      ];
      let written = 0;
      const seats: Seats = {
        seated: (campaign) => ({
          // A Builder session raises the strength of the harness it starts from by two, and
          // finishes. The seat is made for every command, a comparison's too, so the strength is
          // read from the log: the sessions that began before this one.
          builder: (() => {
            const before = read(campaign.log).filter(({ kind }) => kind === "build.started").length;
            const strength = STARTER_STRENGTH + (before + 1) * RAISE;
            return scriptedModel([
              [
                "bash",
                {
                  command: `printf '\\nstrength: ${String(strength)}\\n' >> "$HOME/harness/agent/${GUIDE_FILE}"`,
                },
              ],
              ["finish", { note: `Strength ${String(strength)}.` }],
            ]);
          })(),
          setting: campaign.setting({ ...campaign.test, ...scriptedModel([]) }),
          // A solve passes where the task's base is at most the harness's strength.
          solve: async (task, harness, kill, comparison) => {
            const base = asRecord(task.publicInput)?.base;
            const passes = isNumber(base) && base <= strengthOf(harness.dir);
            const answer = JSON.stringify({ answer: String(Number(base) * 6) });
            const by = scriptedModel(
              [
                ...(passes ? [["bash", { command: `printf %s '${answer}' > ${ANSWER_FILE}` }] as const] : []),
                ["submit", {}],
              ],
              campaign.limits.turns + 1,
            );
            return campaign.solveOnce(task, harness, { ...campaign.test, ...by }, kill, comparison);
          },
        }),
        // An Examiner writes tasks harder than the reference harness answers: each a fresh
        // instance (`n`, which no check reads, makes it one), at a base above the reference's
        // strength. It knows the reference from the log, as the outcomes it hears tell a real one
        // which tasks were answered; it knows nothing of the harness the Builder is making.
        examine: (request) => {
          const promoted = of("harness.promoted").at(-1)?.harness;
          const reference = isString(promoted) ? join(folder, "states", promoted) : FIXTURE;
          const strength = strengthOf(reference);
          written += 1;
          const tasks = ABOVE.map((above, index) => ({
            family: "fixture",
            public_input: { base: strength + above, n: written * 100 + index },
            hidden: null,
          }));
          return examine({
            ...request,
            ...scriptedModel([
              ["propose_tasks", { tasks }],
              ["finish", { note: `Bases ${ABOVE.map((above) => strength + above).join(", ")}.` }],
            ]),
          });
        },
      };
      // Three epochs take 21 moves with every task scored (climb-10, 10 October: four promotions
      // in 36 moves and still climbing). A campaign that ends on its moves has not stopped.
      const ending = await harnessBuilder([...flags, "--moves", "24"], seats);
      const moves = of("campaign.move").map(({ move }) => (isString(move) ? move : "?"));
      const promotions = of("harness.promoted");
      const log = read(join(folder, "log.jsonl"));
      const epochs = epochsOf(log);
      console.log(moves.join(" "));
      for (const epoch of epochs) console.log(epochLine(epoch));
      // Each comparison by the bases it scored, for reading where a climb stalls.
      const baseOf = new Map(
        log.flatMap(({ kind, data }) => {
          const base = asRecord(asRecord(data.task)?.publicInput)?.base;
          return kind === "task.proposed" && isString(data.version) && isNumber(base)
            ? [[data.version, base] as const]
            : [];
        }),
      );
      const said = (value: unknown) => (isString(value) ? value.slice(0, 8) : "?");
      for (const { kind, data } of log) {
        if (kind === "comparison.started" && Array.isArray(data.tasks)) {
          const scored = data.tasks.map((version) =>
            isString(version) ? (baseOf.get(version) ?? "?") : "?",
          );
          console.log(
            `${said(data.session)}: ${said(data.old)} vs ${said(data.fresh)} on bases ${scored.join(",")}`,
          );
        }
        if (kind === "comparison.reported") {
          console.log(
            `  ${said(data.session)} ${said(data.reading)} ${JSON.stringify(data.scored)} valid ${JSON.stringify(data.valid)}`,
          );
        }
      }
      // The highest base held out in an epoch: what the test knows of difficulty.
      const hardest = (epoch: Epoch) =>
        Math.max(0, ...epoch.tasks.map((version) => baseOf.get(version) ?? 0));
      // Two promotions at least, each on tasks harder than the last epoch's: the second epoch's
      // tasks reach higher bases, the starter answers fewer of them, and the promoted harness of
      // each epoch is stronger than the one before.
      expect(promotions.length).toBeGreaterThanOrEqual(2);
      expect(epochs.length).toBeGreaterThanOrEqual(3);
      const [first, second] = epochs;
      if (first === undefined || second === undefined) throw new Error("fewer than two epochs");
      expect(hardest(second)).toBeGreaterThan(hardest(first));
      const strengths = promotions.map(({ harness }) =>
        strengthOf(join(folder, "states", isString(harness) ? harness : "")),
      );
      expect(strengths).toEqual([...strengths].sort((one, other) => one - other));
      expect(strengths[1] ?? 0).toBeGreaterThan(strengths[0] ?? 0);
      expect(ending.move === "end" ? ending.ending : "moves").not.toBe("stop");
    },
  );
});
