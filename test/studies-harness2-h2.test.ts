// The TypeScript port of Harness²'s k=1 JobBench path (`studies/harness2/h2/`) against the pilot's
// own Python run of it: the prompts Python renders, and a replay of the whole recorded sweep in
// which every rollout returns the pilot's recorded deliverable and every improver session the
// pilot's recorded reply, so each mission, evidence tree, harness, selection, summary and library
// entry the port writes is set beside the one Python wrote. It needs the fork, its venv and its
// recorded runs, so it runs only where `HARNESS2_FORK` names them and `HARNESS2_JB_SHARED` names
// the sections file the pilot read; elsewhere it is skipped.
import { afterAll, describe, expect, it } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { capturedJsonParse } from "../src/meta/json-runtime.ts";
import { isNumber, isRecord, isString, type JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";
import { callKey, REFUSED, summarize, type Claude } from "../studies/harness2/h2/claude.ts";
import { Library } from "../studies/harness2/h2/library.ts";
import { prompt, readSections, type Job } from "../studies/harness2/h2/prompts.ts";
import { pyDumps, walkFiles } from "../studies/harness2/h2/py.ts";
import { NAMESPACE, runDomain, type Bench } from "../studies/harness2/h2/recursion.ts";
import { jobBench } from "../studies/harness2/jobbench.ts";

const FORK = runtimeProcess.env.HARNESS2_FORK ?? "";
const SECTIONS = runtimeProcess.env.HARNESS2_JB_SHARED ?? "";
const PYTHON = join(FORK, ".venv", "bin", "python");
const RUNS = join(FORK, "runs", "jb");
const JB = join(FORK, "dependencies", "job-bench-eval");
const RECORDED = join(RUNS, "adapt", NAMESPACE);
const AUDIT = join(RUNS, "adapt", "_audit", NAMESPACE);
const LIBRARY = join("library", "jb", "k1-cc", "agg");
const present =
  FORK !== "" &&
  SECTIONS !== "" &&
  [PYTHON, RECORDED, AUDIT, join(JB, "eval", "judge.py"), SECTIONS].every((path) => existsSync(path));
const JOBS: readonly Job[] = ["propose INV", "propose DOM", "aggregate", "experience"];
const LABELS = ["base1", "inv1", "dom1", "agg1"];
/** Each improver call of a task, with the evidence tree its recorded mission was keyed on. */
const CALLS = new Map([
  ["inv1.a1", "context/inv1"],
  ["dom1.a1", "context/dom1"],
  ["agg1.a1", "context/agg1"],
  ["experience.agg1", "reflection/agg1.experience"],
]);
/** Python renders the four prompts as `_run_stage` and `reflect_adoption` ask for them. */
const RENDER = `import json, sys
sys.path.insert(0, sys.argv[1])
from harness2.benchmarks.jobbench import jobbench_prompts
from harness2.core import prompts as P
bp, st = jobbench_prompts(), P._st("claude_code")
print(json.dumps({
    "propose INV": P._tts_propose(bp, "INV", st, k=1, index=1),
    "propose DOM": P._tts_propose(bp, "DOM", st, k=1, index=1),
    "aggregate": P._tts_aggregate(bp, st, k=1, index=1),
    "experience": P.experience(bp),
}))
`;
/** Summary fields that differ by design (`recursion.ts` head): a clock, and two sha256 digests. */
const VOLATILE = new Set(["selected_at", "inputs", "harness_fingerprint"]);

const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-study-harness2-h2-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const readJson = (path: string): JsonValue => capturedJsonParse(readFileSync(path, "utf8"));
/** How many files the replay set side by side, so an empty comparison cannot pass. */
let compared = 0;

/** Every file that differs between the port's tree and Python's, the port's paths read as Python's. */
function treeDifferences(ours: string, theirs: string, name: string, skip: readonly string[] = []): string[] {
  const files = [...new Set([...walkFiles(ours), ...walkFiles(theirs)])].filter(
    (rel) => !skip.some((tail) => rel.endsWith(tail)),
  );
  compared += files.length;
  return files.flatMap((rel) => {
    const [a, b] = [join(ours, rel), join(theirs, rel)];
    if (!existsSync(a) || !existsSync(b)) {
      return [`${name}/${rel}: only in ${existsSync(a) ? "ours" : "Python's"}`];
    }
    const [left, right] = [readFileSync(a), readFileSync(b)];
    if (left.equals(right) || left.toString("utf8").replaceAll(root, RUNS) === right.toString("utf8")) {
      return [];
    }
    return [`${name}/${rel}: differs`];
  });
}

/** A record with the named fields dropped at every depth, for a structural comparison. */
function without(value: JsonValue, drop: ReadonlySet<string>): JsonValue {
  if (Array.isArray(value)) return value.map((each) => without(each, drop));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, each]) => (drop.has(key) ? [] : [[key, without(each, drop)]])),
  );
}

/** Which recorded audit call each (task, label) was: Harness²'s key over the recorded evidence. */
function auditCalls(tasks: readonly string[]): Map<string, string> {
  const missions = walkFiles(AUDIT).filter((name) => name.endsWith(".mission.md"));
  const calls = new Map<string, string>();
  for (const task of tasks) {
    for (const [label, tree] of CALLS) {
      const dir = join(RECORDED, task.replaceAll("/", "__"), tree);
      const stem = missions
        .map((name) => name.slice(0, -".mission.md".length))
        .find(
          (each) =>
            each.startsWith(`${label}.`) &&
            each.slice(label.length + 1) ===
              callKey(label, readFileSync(join(AUDIT, `${each}.mission.md`), "utf8"), dir),
        );
      if (stem !== undefined) calls.set(`${task} ${label}`, stem);
    }
  }
  return calls;
}

describe.skipIf(!present)("Harness²'s k=1 JobBench path in TypeScript, against the pilot", () => {
  const config = present ? readJson(join(RECORDED, "config.json")) : null;
  const tasks =
    isRecord(config) && Array.isArray(config.tasks)
      ? config.tasks.flatMap((row) => (Array.isArray(row) && isString(row[1]) ? [row[1]] : []))
      : [];

  it("renders the four improver prompts byte for byte as Python does", () => {
    const ran = runSync([PYTHON, "-I", "-c", RENDER, FORK], {
      env: { PATH: runtimeProcess.env.PATH ?? "", HARNESS2_JB_SHARED: SECTIONS },
    });
    expect(ran.exitCode).toBe(0);
    const rendered = capturedJsonParse(decodeOutput(ran.stdout));
    const sections = readSections(SECTIONS);
    for (const job of JOBS) {
      const python = isRecord(rendered) ? rendered[job] : undefined;
      expect(prompt(job, sections)).toBe(isString(python) ? python : "(Python rendered no such prompt)");
    }
  });

  it("names every recorded improver call as Harness² named it", () => {
    expect(auditCalls(tasks).size).toBe(tasks.length * CALLS.size);
  });

  it("replays the recorded sweep to the same missions, evidence, harnesses, summaries and library", async () => {
    const calls = auditCalls(tasks);
    const store = join(root, "dataset");
    const runs = tasks.flatMap((task) =>
      ["model_output", "model_traj"].flatMap((kind) =>
        LABELS.map((label) => join(task, kind, `${NAMESPACE}__${task.replaceAll("/", "__")}__${label}`)),
      ),
    );
    for (const rel of runs.filter((each) => existsSync(join(RUNS, "dataset", each)))) {
      cpSync(join(RUNS, "dataset", rel), join(store, rel), { recursive: true, preserveTimestamps: true });
    }
    const differences: string[] = [];
    const missions: string[] = [];
    const unused: Claude = { bin: "false", model: "", effort: "", budgetUsd: "", timeoutS: 0, env: {} };
    const bench: Bench = {
      ...jobBench(JB, store, unused),
      sections: readSections(SECTIONS),
      execute: async (task, harnessDir, runId) => {
        const label = runId.split("/").at(-1) ?? "";
        const taskDir = join(RECORDED, task.replaceAll("/", "__"));
        if (harnessDir !== null) {
          differences.push(
            ...treeDifferences(harnessDir, join(taskDir, "harnesses", label), `${task} harness ${label}`),
          );
        }
        return await Promise.resolve({
          runDir: join(store, task, "model_output", runId.replaceAll("/", "__")),
          usd: 0,
        });
      },
      improve: async (call) => {
        const parts = call.contextDir.slice(root.length + 1).split("/");
        const task = (parts[2] ?? "").replace("__", "/");
        const stem = calls.get(`${task} ${call.label}`) ?? "";
        missions.push(`${task} ${call.label}`);
        if (readFileSync(join(AUDIT, `${stem}.mission.md`), "utf8") !== call.mission) {
          differences.push(`${task} ${call.label}: mission differs`);
        }
        const recordedTree = join(RECORDED, parts[2] ?? "", CALLS.get(call.label) ?? "");
        differences.push(...treeDifferences(call.contextDir, recordedTree, `${task} ${call.label} evidence`));
        const meta = readJson(join(AUDIT, `${stem}.meta.json`));
        const workspace = join(AUDIT, `${stem}.workspace`);
        return await Promise.resolve({
          text: readFileSync(join(AUDIT, `${stem}.response.md`), "utf8"),
          costUsd: isRecord(meta) && isNumber(meta.cost_usd) ? meta.cost_usd : 0,
          attempts: isRecord(meta) && isNumber(meta.attempts) ? meta.attempts : 0,
          workspace: call.harvest !== null && existsSync(workspace) ? workspace : null,
        });
      },
    };
    const streams = Map.groupBy(tasks, (task) => task.split("/")[0] ?? "");
    const domains = await Promise.all(
      [...streams].map(
        async ([domain, list]) =>
          await runDomain(bench, domain, list, join(root, "adapt"), new Library(join(root, LIBRARY), domain)),
      ),
    );
    expect(domains.map((domain) => domain.failed)).toEqual([...streams].map(() => 0));
    expect(missions.toSorted()).toEqual([...calls.keys()].toSorted());
    for (const task of tasks) {
      const [ours, theirs] = [
        join(root, "adapt", NAMESPACE, task.replaceAll("/", "__")),
        join(RECORDED, task.replaceAll("/", "__")),
      ];
      differences.push(
        ...treeDifferences(ours, theirs, task, ["summary.json", "summary.lock", "selection.json"]),
      );
      for (const rel of ["summary.json", join("selection", "agg1", "selection.json")]) {
        const [a, b] = [readJson(join(ours, rel)), readJson(join(theirs, rel))];
        const read = (value: JsonValue): string => pyDumps(without(value, VOLATILE)).replaceAll(root, RUNS);
        if (read(a) !== read(b)) differences.push(`${task} ${rel}: differs`);
      }
    }
    differences.push(...treeDifferences(join(root, LIBRARY), join(RUNS, LIBRARY), "library"));
    expect(differences).toEqual([]);
    console.log(`  replay: ${compared} files compared, ${missions.length} missions`);
    expect(compared).toBeGreaterThan(tasks.length * 100);
    const changed = join(root, "changed");
    cpSync(join(RECORDED, tasks[0]?.replaceAll("/", "__") ?? "", "context", "inv1"), changed, {
      recursive: true,
    });
    writeFileSync(join(changed, "task.md"), `${readFileSync(join(changed, "task.md"), "utf8")} `);
    expect(
      treeDifferences(changed, join(RECORDED, tasks[0]?.replaceAll("/", "__") ?? "", "context", "inv1"), "x"),
    ).toEqual(["x/task.md: differs"]);
  }, 1_800_000);
});

describe("a rollout's result", () => {
  const events = (result: Record<string, JsonValue>) => {
    const path = join(root, `trajectory-${String(Math.random()).slice(2)}.jsonl`);
    writeFileSync(
      path,
      `${JSON.stringify({ type: "system", subtype: "init" })}\n${JSON.stringify({ type: "result", ...result })}\n`,
    );
    return summarize(path).subtype;
  };

  it("is refused where the API ended the session, and keeps the arm's own limits and a success", () => {
    expect(events({ subtype: "success", is_error: true, result: "limit reached" })).toBe(REFUSED);
    expect(events({ subtype: "error_during_execution", is_error: true })).toBe(REFUSED);
    expect(events({ subtype: "success", is_error: false })).toBe("success");
    expect(events({ subtype: "error_max_turns", is_error: true })).toBe("error_max_turns");
    expect(events({ subtype: "error_max_budget_usd", is_error: true })).toBe("error_max_budget_usd");
  });
});
