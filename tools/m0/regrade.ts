/**
 * M0's exit test: regrade an experiment's stored answers with this verifier and compare each verdict
 * with the one v1 recorded in the sweep's `grades.tsv`, and report each stored solve's metered
 * dollars beside the billed ones v1 recorded.
 *
 *   bun tools/m0/regrade.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc
 *
 * A row matches when both say pass, or both say fail and name the same blocking checks. The answer
 * is the solve's own `work/answer.json`, and the tree is the fixture v1's report names as its
 * candidate, without its battery (`checkProgram`). A solve v1's verifier did not decide is counted by
 * its ending apart, since there is no verdict of v1's verifier to compare. Exits 1 on any mismatch. The dollars are compared, not matched: see
 * `stored-sweep.ts` for why the two differ.
 */
import { openVerifier, spelled, type Task, type Verdict, type Verifier } from "#src/kernel/verify.ts";
import { TASKS_FILE } from "#src/meta/bundle-layout.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { mkdtempSync, readFileSync, rmSync } from "#src/meta/filesystem.ts";
import { tmpdir } from "#src/meta/os.ts";
import { countBy } from "#src/meta/tally.ts";
import { checkProgram, pricedRows, type Row, storedAnswer, sweepRows } from "./stored-sweep.ts";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    sweep: { type: "string", multiple: true },
    jobs: { type: "string", default: "4" },
  },
});

async function main(): Promise<number> {
  const root = values.root;
  const sweeps = values.sweep ?? [];
  if (root === undefined || sweeps.length === 0) throw new Error("name --root and at least one --sweep");
  const verifiers = new Map<string, Verifier>();
  const tasks = new Map<string, Task[]>();
  const queue: (Row & { readonly expected: Verdict })[] = [];
  const scratch = mkdtempSync(join(tmpdir(), "ana-regrade-"));
  for (const sweep of sweeps) {
    const all = sweepRows(root, sweep);
    const rows = all.flatMap(({ expected, ...row }) => (expected === null ? [] : [{ ...row, expected }]));
    const apart = countBy(
      all.filter((row) => row.expected === null),
      ({ ending }) => (ending.outcome === "pass" ? "pass" : `${ending.outcome} ${ending.kind}`),
    );
    const { priced } = pricedRows(rows);
    const billed = priced.reduce((total, solve) => total + solve.billed, 0);
    const metered = priced.reduce((total, solve) => total + solve.metered, 0);
    const spelledApart = Object.entries(apart).map(([kind, count]) => `${count} ${kind}`);
    console.log(`${sweep}: ${rows.length} verifier rows; apart: ${spelledApart.join(", ") || "none"}`);
    console.log(
      `  ${priced.length} with a recorded cost: billed $${billed.toFixed(2)}, ` +
        `metered $${metered.toFixed(2)} (${(metered / billed).toFixed(2)}x)`,
    );
    queue.push(...rows);
  }
  const mismatches: string[] = [];
  let matched = 0;
  const started = performance.now();
  const work = async (): Promise<void> => {
    for (let row = queue.shift(); row !== undefined; row = queue.shift()) {
      const report = parseJsonAs<{ candidate: string }>(
        readFileSync(join(root, "grades", row.sweep, row.taskId, "report", "report.json"), "utf8"),
      );
      let verify = verifiers.get(report.candidate);
      if (verify === undefined) {
        const checks = checkProgram(report.candidate, join(scratch, String(verifiers.size)));
        verify = openVerifier({ checks, tools: join(report.candidate, ".toolchain") });
        verifiers.set(report.candidate, verify);
        const battery = join(report.candidate, TASKS_FILE);
        tasks.set(report.candidate, parseJsonAs<Task[]>(readFileSync(battery, "utf8")));
      }
      const task = tasks.get(report.candidate)?.find((candidate) => candidate.taskId === row.taskId);
      if (task === undefined) throw new Error(`${report.candidate} has no task ${row.taskId}`);
      const verdict = await verify(task, storedAnswer(row));
      if (spelled(verdict) === spelled(row.expected)) {
        matched += 1;
      } else {
        const line = `${row.sweep}\t${row.cycle}\t${row.taskId}`;
        mismatches.push(`${line}\tv1 ${spelled(row.expected)}\tnow ${spelled(verdict)}`);
      }
    }
  };
  const total = queue.length;
  try {
    await Promise.all(Array.from({ length: Number(values.jobs) }, work));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  for (const line of mismatches.sort()) console.log(line);
  const seconds = ((performance.now() - started) / 1000).toFixed(0);
  console.log(`${matched} of ${total} verdicts match v1's, in ${seconds} s`);
  return mismatches.length === 0 ? 0 : 1;
}

runtimeProcess.exitCode = await main();
