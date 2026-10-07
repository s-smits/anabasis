/**
 * M0's exit test: regrade an experiment's stored answers with this verifier and compare each verdict
 * with the one v1 recorded in the sweep's `grades.tsv`, and report each stored solve's metered
 * dollars beside the billed ones v1 recorded.
 *
 *   bun tools/m0/regrade.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc
 *
 * A row matches when both say pass, or both say fail and name the same blocking checks. The answer
 * is the solve's own `work/answer.json`, and the tree is the fixture v1's report names as its
 * candidate. A row v1 decided without its verifier is counted apart, since there is no verdict of
 * v1's verifier to compare. Exits 1 on any mismatch. The dollars are compared, not matched: see
 * `stored-sweep.ts` for why the two differ.
 */
import { openVerifier, type Task, type Verdict, type Verifier } from "#src/kernel/verify.ts";
import { readFileSync } from "#src/meta/filesystem.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { pricedRows, type Row, storedAnswer, sweepRows } from "./stored-sweep.ts";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    sweep: { type: "string", multiple: true },
    jobs: { type: "string", default: "4" },
  },
});

function spelled(verdict: Verdict): string {
  if (verdict.kind === "fail") return `fail ${[...verdict.blocking].sort().join(",")}`;
  return verdict.kind === "pass" ? "pass" : `non-result ${verdict.reason}`;
}

async function main(): Promise<number> {
  const root = values.root;
  const sweeps = values.sweep ?? [];
  if (root === undefined || sweeps.length === 0) throw new Error("name --root and at least one --sweep");
  const verifiers = new Map<string, Verifier>();
  const tasks = new Map<string, Task[]>();
  const queue: Row[] = [];
  for (const sweep of sweeps) {
    const { rows, apart } = sweepRows(root, sweep);
    const { priced } = pricedRows(rows);
    const billed = priced.reduce((total, solve) => total + solve.billed, 0);
    const metered = priced.reduce((total, solve) => total + solve.metered, 0);
    console.log(`${sweep}: ${rows.length} verifier rows, ${apart} decided apart`);
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
      const checks = join(report.candidate, "correctness-model");
      let verify = verifiers.get(report.candidate);
      if (verify === undefined) {
        verify = openVerifier({ checks, tools: join(report.candidate, ".toolchain") });
        verifiers.set(report.candidate, verify);
        tasks.set(report.candidate, parseJsonAs<Task[]>(readFileSync(join(checks, "tasks.json"), "utf8")));
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
  await Promise.all(Array.from({ length: Number(values.jobs) }, work));
  for (const line of mismatches.sort()) console.log(line);
  const seconds = ((performance.now() - started) / 1000).toFixed(0);
  console.log(`${matched} of ${total} verdicts match v1's, in ${seconds} s`);
  return mismatches.length === 0 ? 0 : 1;
}

runtimeProcess.exitCode = await main();
