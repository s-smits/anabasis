import { spawnTextSync as spawnSync } from "./helpers/bun-spawn-sync.ts";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { aggregateCoverage, functionSpans, parseUnifiedDiff } from "../tools/run-triage/coverage.ts";
import { JUDGE_REVIEWS_SCHEMA } from "../src/analyse/judge-reviews.ts";
import {
  loopNarrative,
  observabilityCensus,
  readAnalysis,
  readBatteries,
} from "../tools/run-triage/evidence.ts";

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("function spans", () => {
  const source = [
    "export function outer(): number {",
    "  const inner = (): number => {",
    "    return 1;",
    "  };",
    "  return inner();",
    "}",
  ].join("\n");

  it("finds line ranges for declared functions and const arrows, including nested functions", () => {
    const spans = functionSpans(source);
    const byName = new Map(spans.map((s) => [s.name, s]));
    expect(byName.get("outer")).toEqual({ name: "outer", start: 1, end: 6 });
    expect(byName.get("inner")).toEqual({ name: "inner", start: 2, end: 4 });
  });
});

describe("unified diff parsing", () => {
  it("keeps new-side ranges and anchors pure deletions to their line", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -10,2 +12,3 @@ context",
      "@@ -30 +40,0 @@ pure deletion",
      "+++ b/src/b.ts",
      "@@ -1 +1 @@",
    ].join("\n");
    const ranges = parseUnifiedDiff(diff);
    expect(ranges.get("src/a.ts")).toEqual([
      [12, 14],
      [40, 40],
    ]);
    expect(ranges.get("src/b.ts")).toEqual([[1, 1]]);
  });
});

describe("coverage aggregation", () => {
  it("sums per-function counts across processes and keeps only repo source files", () => {
    const script = (url: string, count: number) => ({
      url,
      functions: [{ functionName: "go", ranges: [{ count }] }],
    });
    const rows = aggregateCoverage(
      [
        script("file:///repo/src/run/x.ts", 2),
        script("file:///repo/src/run/x.ts", 3),
        script("file:///repo/node_modules/dep/i.js", 9),
        script("file:///elsewhere/src/y.ts", 9),
      ],
      "/repo",
    );
    expect(rows).toEqual([{ file: "src/run/x.ts", name: "go", count: 5 }]);
  });
});

describe("battery walk", () => {
  it("skips dangling symlinks and continues reading batteries", () => {
    // Every 2026-09-05 run worktree carries domains/*/.toolchain as a broken symlink; triage
    // exited 1 on 11 of 11 window runs.
    const camp = mkdtempSync(join(tmpdir(), "triage-camp-"));
    const runDir = join(camp, "candidates", "r1", "runs", "r1");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "battery.json"), JSON.stringify({ runId: "r1", cases: [] }));
    symlinkSync(join(camp, "missing"), join(camp, "dangling"));
    expect(readBatteries(join(camp, "no-run-dir"), camp).map((battery) => battery.runId)).toEqual(["r1"]);
  });
});

describe("judge review reader", () => {
  it("reads the review the controller writes and names any other schema", () => {
    // The reader took census as a map of repair-on/off variants, so a current review listed its
    // runId and evidence keys as two variants with decision "?".
    const camp = mkdtempSync(join(tmpdir(), "triage-judges-"));
    scratch.push(camp);
    mkdirSync(join(camp, "analysis"), { recursive: true });
    const current = {
      schema: JUDGE_REVIEWS_SCHEMA,
      census: {
        runId: "r1",
        evidence: {
          judge: "unvalidated",
          offered: 6,
          verdicts: 5,
          abstentions: 1,
          disagreementDenominator: 5,
        },
      },
      contested: [{ taskId: "t1" }, { taskId: "t2" }],
      coverage: { reviewable: 6, reviewed: 5 },
      provisional: "the judge review is incomplete",
    };
    writeFileSync(join(camp, "analysis", "r1-judges.json"), JSON.stringify(current));
    const earlier = {
      schema: "judge-reviews/v10",
      census: { on: { evidence: { decision: "advisory-comparison" } } },
    };
    writeFileSync(join(camp, "analysis", "r0-judges.json"), JSON.stringify(earlier));
    const judges = readAnalysis(camp).judges.toSorted((a, b) => a.name.localeCompare(b.name));
    expect(judges).toEqual([
      {
        name: "r0-judges",
        decision: `not read: schema judge-reviews/v10 is not ${JUDGE_REVIEWS_SCHEMA}`,
        abstained: null,
        reviewed: "—",
        contested: null,
        provisional: null,
      },
      {
        name: "r1-judges",
        decision: "incomplete-census",
        abstained: 1,
        reviewed: "5/6",
        contested: 2,
        provisional: "the judge review is incomplete",
      },
    ]);
  });
});

describe("observation stream readers", () => {
  /** One campaign whose base stream holds a started span, a failed one and a warning event. */
  function campaignWith(rows: JsonValue[]): string {
    const camp = mkdtempSync(join(tmpdir(), "triage-stream-"));
    scratch.push(camp);
    mkdirSync(join(camp, "observability"), { recursive: true });
    writeFileSync(join(camp, "observability", "r1.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n"));
    return camp;
  }

  const STREAM = [
    {
      kind: "span",
      type: "phase-transition",
      phase: "build",
      state: "started",
      level: "default",
      summary: "Build step",
    },
    {
      kind: "span",
      type: "phase-transition",
      phase: "build",
      state: "failed",
      level: "error",
      summary: "Build step",
    },
    { kind: "event", type: "iteration-settled", level: "warning", ordinal: 4, claim: "gates-blocked" },
  ];

  it("keeps the state and level, so a failed step does not read as a finished one", () => {
    // Both spans carry the same phase and summary: without the state they printed as one line
    // twice, and the run that failed its build looked like the run that completed it.
    expect(loopNarrative(campaignWith(STREAM)).map((row) => [row.phase, row.state, row.level])).toEqual([
      ["build", "started", "default"],
      ["build", "failed", "error"],
      ["", "", "warning"],
    ]);
  });

  it("counts a started and a settled span apart in the census", () => {
    expect(
      observabilityCensus(campaignWith(STREAM)).map((row) => [row.phase, row.state, row.level, row.count]),
    ).toEqual([
      ["", "", "warning", 1],
      ["build", "started", "default", 1],
      ["build", "failed", "error", 1],
    ]);
  });
});

describe("CLI launch guidance", () => {
  it("emits zsh-safe coverage guidance with the frozen environment keys", () => {
    const runDir = mkdtempSync(join(tmpdir(), "ana run-triage-"));
    scratch.push(runDir);
    mkdirSync(join(runDir, "campaigns", "demo"), { recursive: true });

    const cli = join(import.meta.dirname, "..", "tools", "run-triage", "cli.ts");
    const bun = Bun.argv[0];
    if (bun === undefined) throw new Error("Bun executable path is absent");
    const result = spawnSync(bun, [cli, "--run-dir", runDir]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("operator-filled Sol launch template");
    expect(result.stdout).toContain("not ready to execute");

    const map = /not ready to execute\): (`[^`]+`)/.exec(result.stdout)?.[1];
    expect(map).toBeDefined();
    if (map === undefined) return;
    const command = map.slice(1, -1);
    const syntax = spawnSync("/bin/zsh", ["-n", "-c", `: ${command}`]);
    expect(syntax.status).toBe(0);
    expect(command).not.toContain("<dir>");

    const assignments = [...command.matchAll(/--env "([^"]+)"/g)].map((match) => match[1]);
    expect(assignments).toContain(`NODE_V8_COVERAGE=${join(runDir, ".coverage")}`);
    for (const key of ["HOME", "CODEX_HOME", "TMPDIR", "PATH", "NODE_V8_COVERAGE"]) {
      expect(assignments.filter((assignment) => assignment?.startsWith(`${key}=`) === true)).toHaveLength(1);
      expect(assignments.find((assignment) => assignment?.startsWith(`${key}=`) === true)).toMatch(
        /^\w+=\/.+/,
      );
    }
  });
});
