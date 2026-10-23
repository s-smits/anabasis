/**
 * Phase C, after a repair and without a model: what a repaired checker makes of the answers a
 * campaign's log holds, and whether the repair stands on what was read of them.
 *
 *   bun tools/c/repaired.ts --log .ana/d2/truss/log.jsonl \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-repaired [--labels labels.json]
 *
 * `--bundle` is the repaired pack, laid out as the one the campaign was opened over: its check
 * program, its tasks, its controls and its tool tree. The tasks an Examiner session wrote are taken
 * from the log, since no pack holds them. Three readings, none of which writes anything:
 *
 * - Every answer the log holds a checker's verdict for is graded again under the repaired checker
 *   (`regraded` in `src/kernel/acceptance.ts`), and each verdict that moved is printed.
 * - The moved verdicts are set against what was ruled of the old ones (`repairReading` in
 *   `src/referee/rejections.ts`): the Referee's rulings in the log, and a person's labels with
 *   `--labels`, which stand over them. A refusal may be withdrawn only from an answer ruled a check
 *   defect. One withdrawn from an answer ruled earned, or from one nobody read, and an accepted
 *   answer newly refused, each count against the repair.
 * - The repaired pack's own controls are put to it twice, and to the old checker, whose staged
 *   check program stands beside the log. A control that held under the old checker and does not
 *   under the repaired one counts against the repair: it passes a reject control or refuses an
 *   accept control. One that held under neither is stale and is counted apart.
 *
 * It exits 1 when anything counts against the repair. That is a reading and no refusal: the log
 * stays the frozen checker's, the repaired one takes a campaign of its own (`accept.ts --freeze`),
 * and whether to open it is the operator's. `carry.ts` then takes the old campaign's tasks into it
 * with no solve.
 *
 * It needs the repaired pack and its tool tree on disk, and the Mac's verifier wall.
 */
import { controlFault, frozenChecker, regraded, runControls } from "#src/kernel/acceptance.ts";
import { read } from "#src/kernel/log.ts";
import { checkProgramVersion, openVerifier } from "#src/kernel/verify.ts";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { tmpdir } from "#src/meta/os.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { plural } from "#src/meta/text.ts";
import { RULINGS } from "#src/referee/agreement.ts";
import { labelled, repairReading } from "#src/referee/rejections.ts";
import { writtenTasks } from "#src/kernel/history.ts";
import { checkProgram, packControls, readPack } from "../m0/stored-sweep.ts";

const { values } = parseArgs({
  options: {
    log: { type: "string" },
    bundle: { type: "string" },
    jobs: { type: "string", default: "4" },
    labels: { type: "string" },
  },
});

async function main(): Promise<number> {
  const { log, bundle } = values;
  if (log === undefined || bundle === undefined) throw new Error("name --log and --bundle");
  const events = read(log);
  const dir = mkdtempSync(join(tmpdir(), "ana-repaired-"));
  try {
    const checks = checkProgram(bundle, join(dir, "checks"));
    const verify = openVerifier({ checks, tools: join(bundle, ".toolchain"), packRoots: [bundle] });
    // The tasks an Examiner session wrote are in the log and in no pack; the repaired pack's own
    // stand where both name one.
    const held = [...writtenTasks(events), ...readPack(bundle).tasks];
    const rows = await regraded(events, held, verify, Number(values.jobs));
    const moved = rows.filter(({ was, now }) => was !== now);
    console.log(`${String(rows.length)} logged verdicts, ${String(moved.length)} moved`);
    if (moved.length > 0) console.log("solve\ttask\twas\tnow");
    for (const { solve, task, was, now } of moved) console.log(`${solve}\t${task}\t${was}\t${now}`);
    const tasks = [...new Set(moved.map(({ task }) => task))].sort((left, right) =>
      left.localeCompare(right),
    );
    if (tasks.length > 0) console.log(`tasks with a moved verdict: ${tasks.join(", ")}`);
    const frozen = frozenChecker(events)?.checks ?? "none";
    console.log(
      `check program: the log froze ${frozen}, this one is ${hashJsonValue(checkProgramVersion(checks))}`,
    );
    const { labels } = labelled(
      values.labels === undefined ? {} : capturedJsonParse(readFileSync(values.labels, "utf8")),
      RULINGS,
    );
    const reading = repairReading(rows, events, labels);
    console.log(capturedJsonStringify(reading, null, 2));
    // The repaired pack's controls under both checkers. A control counts against the repair when
    // it held under the old checker and does not under this one: the repair broke it. One that did
    // not hold before says nothing of the repair: on 8 October all 35 of the truss pack's accept
    // controls had gone stale, and counted here they refused every repair of it.
    const pack = readPack(bundle).tasks;
    const controls = packControls(bundle);
    const jobs = Number(values.jobs);
    const now = await runControls(verify, pack, controls, jobs);
    const old = join(dirname(log), "checks");
    const before = existsSync(old)
      ? await runControls(
          openVerifier({ checks: old, tools: join(bundle, ".toolchain"), packRoots: [bundle] }),
          pack,
          controls,
          jobs,
        )
      : null;
    const heldBefore = (index: number) => {
      const run = before?.[index];
      return run === undefined || controlFault(run) === null;
    };
    const failing = now.flatMap((run, index) => {
      const fault = controlFault(run);
      return fault === null ? [] : [{ fault, broken: heldBefore(index) }];
    });
    const faults = failing.flatMap(({ fault, broken }) => (broken ? [fault] : []));
    for (const fault of faults) console.log(`fault: ${fault}`);
    const stale = failing.length - faults.length;
    if (stale > 0) {
      console.log(
        `${plural(stale, "control")} did not hold under the old checker either, and ${stale === 1 ? "says" : "say"} nothing of the repair`,
      );
    }
    if (before === null) console.log(`no check program beside ${log}: every control fault is counted`);
    const against = reading.against.length + faults.length;
    console.log(
      against === 0
        ? "the repair stands on what was read: it moves only answers ruled a check defect, and its controls hold"
        : `${plural(against, "finding")} against the repair`,
    );
    return against === 0 ? 0 : 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

runtimeProcess.exitCode = await main();
