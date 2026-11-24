// Domain protocol, gitignored `.wri/domains/<domain>/` extensions, `minPromo` gating,
// deterministic external-benchmark regression joins, and `bun run wri` lane-guard boundaries.
import { afterAll, describe, expect, it } from "bun:test";
import { conditionId } from "../src/kernel/condition.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { benchesOf } from "../tools/runs/host-config.ts";
import {
  DEFAULT_MIN_PROMO,
  domainReadinessOf,
  findPairedArm,
  formatDomainCheck,
  packMatches,
  REGRESSION_LANE,
} from "../tools/wri/domains.ts";
import { refusalOf } from "../tools/wri/lane-guard.ts";
import { analyzeRegressions, formatRegressionReport } from "../tools/wri/regressions.ts";
import { conditionOf } from "./helpers/logged-round.ts";

const AT = "2026-11-24T00:00:00.000Z";
const STARTER = "a".repeat(64);
const PROMO_1 = "b".repeat(64);
const PROMO_2 = "c".repeat(64);
const SOC_TASK = "soc/task2";
const scratch: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function writeJson(file: string, value: JsonValue): void {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function syntheticLog(promotions: readonly string[]): LogEvent[] {
  const cond = conditionOf("t-1", PROMO_2);
  const condId = conditionId(cond);
  const events: LogEvent[] = [
    { at: AT, kind: "campaign.opened", data: { starter: STARTER } },
    {
      at: AT,
      kind: "condition.recorded",
      data: { id: condId, condition: requireJsonValue(cond) },
    },
    {
      at: AT,
      kind: "solve.started",
      data: { solve: "s-1", task: "t-1", condition: condId },
    },
    {
      at: AT,
      kind: "solve.call",
      data: {
        solve: "s-1",
        turn: 1,
        tool: "bash",
        args: { command: "inspect-workspace && pystat run" },
        isError: false,
        text: "ok",
      },
    },
    {
      at: AT,
      kind: "solve.finished",
      data: { solve: "s-1", outcome: "passed", harness: PROMO_2 },
    },
  ];
  let prev = STARTER;
  for (const harness of promotions) {
    events.push({ at: AT, kind: "harness.promoted", data: { harness, from: prev, rests: [] } });
    prev = harness;
  }
  return events;
}

function writeBenchArm(
  store: string,
  arm: string,
  harness: string,
  runtime: string,
  tasks: readonly {
    readonly task: string;
    readonly points: number;
    readonly total: number;
    readonly cut?: readonly { readonly file: string; readonly chars: number }[];
    readonly rubrics?: readonly {
      readonly index: number;
      readonly weight: number;
      readonly passed: boolean;
      readonly cPassed: number;
      readonly cTotal: number;
    }[];
    readonly commands?: readonly string[];
  }[],
): void {
  for (const item of tasks) {
    const slug = item.task.replace("/", "__");
    writeJson(join(store, "judged", arm, `${slug}.json`), {
      arm,
      task: item.task,
      harness,
      runtime,
      points: item.points,
      total: item.total,
      solveUsd: 1.25,
      judgeUsd: 4.5,
      seconds: 120,
      delivered: true,
      cut: item.cut ?? [],
    });
    const [group = "", name = ""] = item.task.split("/");
    if (item.rubrics !== undefined) {
      writeJson(
        join(
          store,
          "dataset",
          group,
          name,
          "eval_result",
          `eval_${arm}__${group}__${name}`,
          "judge_judge.json",
        ),
        {
          rubrics: item.rubrics.map((rubric) => ({
            index: rubric.index,
            weight: rubric.weight,
            result: {
              passed: rubric.passed,
              criteria_passed: rubric.cPassed,
              criteria_count: rubric.cTotal,
            },
          })),
        },
      );
    }
    if (item.commands !== undefined) {
      const trajDir = join(store, "dataset", group, name, "model_traj", `${arm}__${group}__${name}`);
      mkdirSync(trajDir, { recursive: true });
      const lines = item.commands.map((command) =>
        JSON.stringify({ kind: "solve.call", data: { tool: "bash", args: { command } } }),
      );
      writeFileSync(join(trajDir, "attempt1.jsonl"), `${lines.join("\n")}\n`);
    }
  }
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe("EVAL_RUNNER minPromo and domain matching", () => {
  it("validates optional minPromo on EVAL_RUNNER entries", () => {
    const base = {
      name: "statbench",
      store: "bench/store",
      sitting: "bin/sitting.sh",
      packs: ["jobstat"],
    };
    expect(benchesOf({ EVAL_RUNNER: JSON.stringify([{ ...base, minPromo: 2 }]) })[0]?.minPromo).toBe(2);
    expect(benchesOf({ EVAL_RUNNER: JSON.stringify([{ ...base, minPromo: 0 }]) })[0]?.minPromo).toBe(0);
    expect(() => benchesOf({ EVAL_RUNNER: JSON.stringify([{ ...base, minPromo: -1 }]) })).toThrow(
      /minPromo takes a non-negative integer/u,
    );
    expect(() => benchesOf({ EVAL_RUNNER: JSON.stringify([{ ...base, minPromo: 1.5 }]) })).toThrow(
      /minPromo takes a non-negative integer/u,
    );
  });

  it("matches pack prefixes without matching unrelated packs", () => {
    expect(packMatches("jobstat", "jobstat")).toBe(true);
    expect(packMatches("jobstat-anabasis-v9", "jobstat")).toBe(true);
    expect(packMatches("jobstatx", "jobstat")).toBe(false);
    expect(packMatches("esp32", "jobstat")).toBe(false);
  });
});

describe("domain extensions, minPromo gate, and paired arm discovery", () => {
  it("loads gitignored domain config and custom 2-digit lanes while rejecting invalid lane IDs", () => {
    const root = tempDir("wri-domain-");
    const extRoot = join(root, ".wri", "domains");
    const espDir = join(extRoot, "esp32");
    mkdirSync(espDir, { recursive: true });
    writeJson(join(espDir, "config.json"), { minPromo: 2 });
    writeFileSync(
      join(espDir, "lanes.md"),
      [
        "**31. ESP32 firmware timing.**",
        "Label: `exam`.",
        "Importance: 0.7.",
        "Marks: `standing`.",
        "",
        "Starts from ESP32 hardware eval logs.",
        "",
        "Check timing regressions against hardware traces.",
      ].join("\n"),
    );

    const log = join(root, "esp32-fresh-opus", "log.jsonl");
    const ready = domainReadinessOf({
      campaign: "esp32-fresh-opus",
      log,
      events: syntheticLog([PROMO_1]),
      repo: root,
      benches: [],
      extensionsRoot: extRoot,
    });
    expect(ready.domain).toBe("esp32");
    expect(ready.minPromo).toBe(2);
    expect(ready.meetsMinPromo).toBe(false);
    expect(ready.customLanes.map((lane) => lane.number)).toEqual([31]);
    expect(formatDomainCheck(ready)).toContain("31 (ESP32 firmware timing)");

    // Invalid custom lane numbers (core 1..20 or reserved 90) are rejected cleanly.
    writeFileSync(
      join(espDir, "lanes.md"),
      [
        "**90. Reserved collision.**",
        "Label: `exam`.",
        "Importance: 0.5.",
        "Marks: none.",
        "",
        "Starts from reserved number.",
      ].join("\n"),
    );
    expect(() =>
      domainReadinessOf({
        campaign: "esp32-fresh-opus",
        log,
        events: syntheticLog([PROMO_1]),
        repo: root,
        benches: [],
        extensionsRoot: extRoot,
      }),
    ).toThrow(/2-digit number in 21–99/u);
  });

  it("gates ablation and regression lane on minPromo and prefers newest pi-durable arm", () => {
    const root = tempDir("wri-gate-");
    const store = join(root, "bench");
    const bench = {
      name: "jobbench",
      host: undefined,
      store,
      sitting: "~/bin/bench.sh",
      packs: ["jobstat"],
      minPromo: DEFAULT_MIN_PROMO,
    };
    const log = join(root, "jobstat-anabasis-v9-fresh-opus", "log.jsonl");

    // 0 promotions -> below minPromo, no ablation required.
    const zero = domainReadinessOf({
      campaign: "jobstat-anabasis-v9-fresh-opus",
      log,
      events: syntheticLog([]),
      repo: root,
      benches: [bench],
      extensionsRoot: join(root, ".wri", "domains"),
    });
    expect(zero.meetsMinPromo).toBe(false);
    expect(zero.ablationNeeded).toBe(false);
    expect(zero.regressionLane).toBeNull();

    // 1 promotion with empty store -> ablationNeeded = true with exact `runs bench --pi` command.
    const one = domainReadinessOf({
      campaign: "jobstat-anabasis-v9-fresh-opus",
      log,
      events: syntheticLog([PROMO_1]),
      repo: root,
      benches: [bench],
      extensionsRoot: join(root, ".wri", "domains"),
    });
    expect(one.meetsMinPromo).toBe(true);
    expect(one.ablationNeeded).toBe(true);
    expect(one.ablationCommand).toBe("bun run runs bench jobstat-anabasis-v9-fresh-opus --pi");

    // Multiple paired arms: prefers newest promotion (PROMO_2) and pi-durable over claude-code.
    writeBenchArm(store, "cc-p1", PROMO_1, "claude-code", [{ task: "stats/t1", points: 30, total: 50 }]);
    writeBenchArm(store, "starter-cc-p1", STARTER, "claude-code", [
      { task: "stats/t1", points: 35, total: 50 },
    ]);
    writeBenchArm(store, "cc-p2", PROMO_2, "claude-code", [{ task: "stats/t1", points: 32, total: 50 }]);
    writeBenchArm(store, "starter-cc-p2", STARTER, "claude-code", [
      { task: "stats/t1", points: 35, total: 50 },
    ]);
    writeBenchArm(store, "pi-p2", PROMO_2, "pi-durable", [{ task: "stats/t1", points: 34, total: 50 }]);
    writeBenchArm(store, "starter-pi-p2", STARTER, "pi-durable", [
      { task: "stats/t1", points: 35, total: 50 },
    ]);

    expect(findPairedArm(store, [PROMO_1, PROMO_2])).toMatchObject({
      arm: "pi-p2",
      starterArm: "starter-pi-p2",
      harness: PROMO_2,
      runtime: "pi-durable",
    });

    const two = domainReadinessOf({
      campaign: "jobstat-anabasis-v9-fresh-opus",
      log,
      events: syntheticLog([PROMO_1, PROMO_2]),
      repo: root,
      benches: [bench],
      extensionsRoot: join(root, ".wri", "domains"),
    });
    expect(two.ablationNeeded).toBe(false);
    expect(two.regressionLane?.number).toBe(REGRESSION_LANE);
  });
});

describe("deterministic regression evals analyzer and lane-guard", () => {
  it("joins external rubric misses and inside-vs-outside toolchain counts", () => {
    const root = tempDir("wri-reg-");
    const campaignDir = join(root, "jobstat-anabasis-v9-fresh-opus");
    const binDir = join(campaignDir, "states", PROMO_2, ".toolchain", "bin");
    const agentDir = join(campaignDir, "states", PROMO_2, "agent");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(binDir, "inspect-workspace"), "#!/bin/sh\n");
    writeFileSync(join(binDir, "pystat"), "#!/bin/sh\n");
    writeFileSync(join(agentDir, "BUILT_AGENTS.md"), "# Guide\n");

    const store = join(root, "bench");
    writeBenchArm(store, "pi-p2", PROMO_2, "pi-durable", [
      {
        task: SOC_TASK,
        points: 38,
        total: 66,
        rubrics: [
          { index: 0, weight: 8, passed: false, cPassed: 2, cTotal: 3 },
          { index: 1, weight: 10, passed: true, cPassed: 4, cTotal: 4 },
        ],
        commands: ["inspect-workspace"],
      },
      {
        task: "stat/task1",
        points: 36,
        total: 116,
        cut: [{ file: "memo.docx", chars: 205_000 }],
        commands: ["python3 run.py"],
      },
    ]);
    writeBenchArm(store, "starter-pi-p2", STARTER, "pi-durable", [
      { task: SOC_TASK, points: 66, total: 66 },
      { task: "stat/task1", points: 16, total: 116, cut: [{ file: "memo.docx", chars: 300_000 }] },
    ]);

    const events = syntheticLog([PROMO_1, PROMO_2]);
    const ready = domainReadinessOf({
      campaign: "jobstat-anabasis-v9-fresh-opus",
      log: join(campaignDir, "log.jsonl"),
      events,
      repo: root,
      benches: [{ name: "jobbench", host: undefined, store, sitting: "~/s.sh", packs: ["jobstat"] }],
      extensionsRoot: join(root, ".wri", "domains"),
    });
    const report = analyzeRegressions(ready, events, campaignDir);
    expect(report.status).toBe("scored");
    expect(report.delta).toBe(-8);
    expect([report.wins, report.losses, report.ties]).toEqual([1, 1, 0]);
    expect(report.tasks[0]?.task).toBe(SOC_TASK);
    expect(report.tasks[0]?.builtRubricMisses).toEqual([{ index: 1, weight: 8, passed: 2, total: 3 }]);
    expect(report.tools).toEqual([
      { tool: "inspect-workspace", campaignSolves: 1, externalTasks: 1 },
      { tool: "pystat", campaignSolves: 1, externalTasks: 0 },
    ]);

    const text = formatRegressionReport(report);
    expect(text).toContain("R1(w8,2/3)");
    expect(text).toContain("inspect-workspace: campaign 1/1 solves | external 1/2 tasks");
    expect(text).toContain("pystat: campaign 1/1 solves | external 0/2 tasks");
    expect(text).toContain("Cross-version cohort backtrack");
    expect(text).toContain("insufficient-baseline");
  });

  it("stratifies cross-version cohort stats by runtime and computes fair-uncut spread and verdict", () => {
    const root = tempDir("wri-cohort-");
    const store = join(root, "bench");
    const campaignDir = join(root, "jobstat-anabasis-v9-fresh-opus");
    mkdirSync(campaignDir, { recursive: true });
    // Two claude-code paired arms + one pi-durable paired arm
    writeBenchArm(store, "cc-old", PROMO_1, "claude-code", [
      { task: SOC_TASK, points: 60, total: 66 },
      { task: "stat/task1", points: 30, total: 116, cut: [{ file: "m.docx", chars: 210_000 }] },
    ]);
    writeBenchArm(store, "starter-cc-old", STARTER, "claude-code", [
      { task: SOC_TASK, points: 50, total: 66 },
      { task: "stat/task1", points: 20, total: 116, cut: [{ file: "m.docx", chars: 210_000 }] },
    ]);
    writeBenchArm(store, "cc-new", PROMO_2, "claude-code", [
      { task: SOC_TASK, points: 30, total: 66 },
      { task: "stat/task1", points: 36, total: 116, cut: [{ file: "m.docx", chars: 210_000 }] },
    ]);
    writeBenchArm(store, "starter-cc-new", STARTER, "claude-code", [
      { task: SOC_TASK, points: 60, total: 66 },
      { task: "stat/task1", points: 20, total: 116, cut: [{ file: "m.docx", chars: 210_000 }] },
    ]);
    writeBenchArm(store, "pi-new", PROMO_2, "pi-durable", [
      { task: SOC_TASK, points: 55, total: 66 },
      { task: "stat/task1", points: 36, total: 116 },
    ]);
    writeBenchArm(store, "starter-pi-new", STARTER, "pi-durable", [
      { task: SOC_TASK, points: 55, total: 66 },
      { task: "stat/task1", points: 20, total: 116 },
    ]);

    const events = syntheticLog([PROMO_1, PROMO_2]);
    const ready = domainReadinessOf({
      campaign: "jobstat-anabasis-v9-fresh-opus",
      log: join(campaignDir, "log.jsonl"),
      events,
      repo: root,
      armName: "cc-new",
      benches: [{ name: "jobbench", host: undefined, store, sitting: "~/s.sh", packs: ["jobstat"] }],
      extensionsRoot: join(root, ".wri", "domains"),
    });
    const report = analyzeRegressions(ready, events, campaignDir);
    expect(report.cohorts.map((cohort) => cohort.runtime)).toEqual(["claude-code", "pi-durable"]);
    const cc = report.cohorts[0];
    expect(cc?.uncutTaskCount).toBe(1);
    expect(cc?.starterUncutRange).toEqual([50, 60]);
    expect(cc?.bestByDelta?.arm).toBe("cc-old");
    expect(cc?.baselineLabel).toBe("baseStarter");
    expect(cc?.targetVerdict).toContain("below baseStarter band");
    expect(formatRegressionReport(report)).toContain(
      "pair: builtSolver cc-new vs baseStarter starter-cc-new",
    );

    // Verify bareSolver baseline classification when build.of === "base".
    const bareFile = join(store, "judged", "starter-pi-new", "soc__task2.json");
    writeFileSync(
      bareFile,
      `${JSON.stringify({
        arm: "starter-pi-new",
        task: SOC_TASK,
        harness: STARTER,
        runtime: "pi-durable",
        points: 55,
        total: 66,
        build: { of: "base", usd: 0 },
      })}\n`,
    );
    const bareReport = analyzeRegressions(ready, events, campaignDir);
    expect(bareReport.cohorts[1]?.baselineLabel).toBe("bareSolver");
  });

  it("blocks primary bun run wri steps in lane-guard while permitting check, regressions, and 2-digit custom reports", () => {
    expect(refusalOf("Bash", { command: "bun run wri start --log x --out y" })).toBe("the primary's step");
    expect(refusalOf("Bash", { command: "bun run wri lanes --out y" })).toBe("the primary's step");
    expect(refusalOf("Bash", { command: "bun run wri check --log x" })).toBeNull();
    expect(refusalOf("Bash", { command: "bun run wri regressions --log x" })).toBeNull();
    expect(
      refusalOf("Write", { file_path: "/Users/x/anabasis/.ana/wri/2026-11-24-run/lanes/90-report.md" }),
    ).toBeNull();
    expect(
      refusalOf("Write", { file_path: "/Users/x/anabasis/.ana/wri/2026-11-24-run/lanes/31-report.md" }),
    ).toBeNull();
  });
});
