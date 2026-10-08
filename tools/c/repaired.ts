/**
 * Phase C, after a repair and without a model: what a repaired checker makes of the answers a
 * campaign's log holds.
 *
 *   bun tools/c/repaired.ts --log .ana/d2/truss/log.jsonl \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-repaired
 *
 * `--bundle` is the repaired pack, laid out as the one the campaign was opened over: its check
 * program, its tasks and its tool tree. Every answer the log holds a checker's verdict for is
 * graded again under it (`regraded` in `src/kernel/acceptance.ts`), and each verdict that moved is
 * printed with the tasks they belong to. No solve is run and nothing is written: the log stays the
 * frozen checker's, and the repaired one takes a campaign of its own (`accept.ts`), where these
 * tasks go through the gates again.
 *
 * It answers one question before that campaign is opened: which of the old campaign's results
 * rested on the checks that were repaired. A fail that turns into a pass was a refusal the repair
 * withdrew, and a pass that turns into a fail an answer the old checker should not have let through.
 * The plan's gate GC asks for this reading between a repair and the next decision.
 *
 * It needs the repaired pack and its tool tree on disk, and the Mac's verifier wall.
 */
import { frozenChecker, regraded } from "#src/kernel/acceptance.ts";
import { read } from "#src/kernel/log.ts";
import { checkProgramVersion, openVerifier } from "#src/kernel/verify.ts";
import { mkdtempSync, rmSync } from "#src/meta/filesystem.ts";
import { tmpdir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { checkProgram, readPack } from "../m0/stored-sweep.ts";

const { values } = parseArgs({
  options: {
    log: { type: "string" },
    bundle: { type: "string" },
    jobs: { type: "string", default: "4" },
  },
});

async function main(): Promise<void> {
  const { log, bundle } = values;
  if (log === undefined || bundle === undefined) throw new Error("name --log and --bundle");
  const events = read(log);
  const dir = mkdtempSync(join(tmpdir(), "ana-repaired-"));
  try {
    const checks = checkProgram(bundle, join(dir, "checks"));
    const verify = openVerifier({ checks, tools: join(bundle, ".toolchain") });
    const rows = await regraded(events, readPack(bundle).tasks, verify, Number(values.jobs));
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
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await main();
