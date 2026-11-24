import { afterAll, describe, expect, it } from "bun:test";
import { openHarness } from "../src/harness/open.ts";
import { writeBare } from "../src/harness/starter.ts";
import { conditionId } from "../src/kernel/condition.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { join } from "../src/meta/path.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { placeHarness, sourceNamed } from "../studies/shared/bundle.ts";
import { benchesOf } from "../tools/runs/host-config.ts";
import {
  DEFAULT_MIN_PROMO,
  domainReadinessOf,
  findPairedArm,
  formatDomainCheck,
  packMatches,
} from "../tools/wri/domains.ts";
import { refusalOf } from "../tools/wri/lane-guard.ts";
import { analyzeRegressions, formatRegressionReport } from "../tools/wri/regressions.ts";
import { conditionOf } from "./helpers/logged-round.ts";

const AT = "2026-11-24T00:00:00.000Z";
const STARTER = "a".repeat(64);
const PROMO_1 = "b".repeat(64);
const PROMO_2 = "c".repeat(64);
const SOC_TASK = "soc/task2";
const STAT_TASK = "stat/task1";
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

function writeBenchArm(spec: {
  readonly store: string;
  readonly arm: string;
  readonly harness: string;
  readonly runtime: string;
  readonly buildOf?: string;
  readonly tasks: readonly {
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
  }[];
}): void {
  const { store, arm, harness, runtime, tasks, buildOf } = spec;
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
      ...keyIfDefined("build", buildOf === undefined ? undefined : { of: buildOf, usd: 0 }),
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

describe("bareSolver (--arm pi:base) harness placement", () => {
  it("writes a guide-free, toolchain-free bareSolver harness that opens cleanly", async () => {
    const dir = tempDir("bare-harness-");
    writeBare(dir);
    const opened = await openHarness(dir);
    expect(opened.guide).toBeNull();
    expect(opened.toolTree).toBeNull();
    expect(opened.presets).toEqual(["read", "bash", "edit", "write"]);

    const bundled = tempDir("bare-bundle-");
    expect(sourceNamed("base", undefined)).toBe("base");
    expect(() => sourceNamed("base", PROMO_1)).toThrow(/base is one harness/u);
    const origin = await placeHarness(bundled, "base");
    expect(origin).toEqual({ campaign: null, ending: null, confirmed: null });
    expect((await openHarness(bundled)).guide).toBeNull();
  });
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

    writeFileSync(
      join(espDir, "lanes.md"),
      [
        "**12. Core collision.**",
        "Label: `exam`.",
        "Importance: 0.5.",
        "Marks: none.",
        "",
        "Starts from core number.",
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

  it("gates ablation on minPromo and prefers bareSolver then pi-durable newest promotion", () => {
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

    const zero = domainReadinessOf({
      campaign: "jobstat-anabasis-v9-fresh-opus",
      log,
      events: syntheticLog([]),
      repo: root,
      benches: [bench],
      extensionsRoot: join(root, ".wri", "domains"),
    });
    expect(zero.meetsMinPromo).toBe(false);
    expect(zero.evalsActive).toBe(false);
    expect(zero.ablationNeeded).toBe(false);

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
    expect(one.ablationCommand).toBe("bun run runs bench jobstat-anabasis-v9-fresh-opus");

    const taskOne = "stats/t1";
    writeBenchArm({
      store,
      arm: "cc-p2",
      harness: PROMO_2,
      runtime: "claude-code",
      tasks: [{ task: taskOne, points: 32, total: 50 }],
    });
    writeBenchArm({
      store,
      arm: "base-cc-p2",
      harness: "",
      runtime: "claude-code",
      buildOf: "base",
      tasks: [{ task: taskOne, points: 35, total: 50 }],
    });
    writeBenchArm({
      store,
      arm: "pi-p2-starter",
      harness: PROMO_2,
      runtime: "pi-durable",
      tasks: [{ task: taskOne, points: 33, total: 50 }],
    });
    writeBenchArm({
      store,
      arm: "starter-pi-p2-starter",
      harness: STARTER,
      runtime: "pi-durable",
      buildOf: "starter",
      tasks: [{ task: taskOne, points: 31, total: 50 }],
    });
    expect(findPairedArm(store, [PROMO_1, PROMO_2])).toMatchObject({
      arm: "pi-p2-starter",
      baselineArm: "starter-pi-p2-starter",
      baselineTier: "baseStarter",
      runtime: "pi-durable",
    });

    writeBenchArm({
      store,
      arm: "pi-p2",
      harness: PROMO_2,
      runtime: "pi-durable",
      tasks: [{ task: taskOne, points: 34, total: 50 }],
    });
    writeBenchArm({
      store,
      arm: "base-pi-p2",
      harness: "",
      runtime: "pi-durable",
      buildOf: "base",
      tasks: [{ task: taskOne, points: 31, total: 50 }],
    });

    expect(findPairedArm(store, [PROMO_1, PROMO_2])).toMatchObject({
      arm: "pi-p2",
      baselineArm: "base-pi-p2",
      builtTier: "builtSolver",
      baselineTier: "bareSolver",
      harness: PROMO_2,
      runtime: "pi-durable",
    });

    writeBenchArm({
      store,
      arm: "pi-p2-full",
      harness: PROMO_2,
      runtime: "pi-durable",
      tasks: [
        { task: taskOne, points: 34, total: 50 },
        { task: "stats/t2", points: 42, total: 50 },
      ],
    });
    writeBenchArm({
      store,
      arm: "starter-pi-p2-full",
      harness: STARTER,
      runtime: "pi-durable",
      buildOf: "starter",
      tasks: [
        { task: taskOne, points: 31, total: 50 },
        { task: "stats/t2", points: 38, total: 50 },
      ],
    });
    writeBenchArm({
      store,
      arm: "pi-p2-cross",
      harness: PROMO_2,
      runtime: "pi-durable",
      tasks: [
        { task: taskOne, points: 34, total: 50 },
        { task: "stats/t2", points: 42, total: 50 },
        { task: "stats/t3", points: 44, total: 50 },
      ],
    });
    writeBenchArm({
      store,
      arm: "base-pi-p2-cross",
      harness: "",
      runtime: "claude-code",
      buildOf: "base",
      tasks: [
        { task: taskOne, points: 31, total: 50 },
        { task: "stats/t2", points: 38, total: 50 },
        { task: "stats/t3", points: 40, total: 50 },
      ],
    });
    expect(findPairedArm(store, [PROMO_1, PROMO_2])).toMatchObject({
      arm: "pi-p2-full",
      baselineArm: "starter-pi-p2-full",
      tasks: 2,
    });
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
    writeBenchArm({
      store,
      arm: "pi-p2",
      harness: PROMO_2,
      runtime: "pi-durable",
      tasks: [
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
          task: STAT_TASK,
          points: 36,
          total: 116,
          cut: [{ file: "memo.docx", chars: 205_000 }],
          commands: ["python3 run.py"],
        },
      ],
    });
    writeBenchArm({
      store,
      arm: "base-pi-p2",
      harness: "",
      runtime: "pi-durable",
      buildOf: "base",
      tasks: [
        { task: SOC_TASK, points: 66, total: 66 },
        { task: STAT_TASK, points: 16, total: 116, cut: [{ file: "memo.docx", chars: 300_000 }] },
      ],
    });
    const brokenJudge = join(store, "dataset", "stat", "task1", "eval_result", "eval_pi-p2__stat__task1");
    mkdirSync(brokenJudge, { recursive: true });
    writeFileSync(join(brokenJudge, "judge_judge.json"), "{truncated");
    writeFileSync(
      join(store, "dataset", "stat", "task1", "model_traj", "pi-p2__stat__task1", "attempt1.jsonl"),
      `${JSON.stringify({ kind: "solve.call", data: { tool: "bash", args: { command: "python3 run.py" } } })}\n{"kind":"truncated`,
    );

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
    expect(text).toContain("base-pi-p2 (bareSolver");
    expect(text).toContain("R1(w8,2/3)");
    expect(text).toContain("inspect-workspace: campaign 1/1 solves | external 1/2 tasks");
    expect(text).toContain("pystat: campaign 1/1 solves | external 0/2 tasks");
    expect(text).toContain("Cross-version cohort backtrack");
    expect(text).toContain("insufficient-baseline (k=1 same-runtime bareSolver");
  });

  it("stratifies cross-version cohort stats by runtime and baseline tier", () => {
    const root = tempDir("wri-cohort-");
    const store = join(root, "bench");
    const campaignDir = join(root, "jobstat-anabasis-v9-fresh-opus");
    mkdirSync(campaignDir, { recursive: true });
    writeBenchArm({
      store,
      arm: "cc-old",
      harness: PROMO_1,
      runtime: "claude-code",
      tasks: [
        { task: SOC_TASK, points: 60, total: 66 },
        { task: STAT_TASK, points: 30, total: 116, cut: [{ file: "m.docx", chars: 210_000 }] },
      ],
    });
    writeBenchArm({
      store,
      arm: "starter-cc-old",
      harness: STARTER,
      runtime: "claude-code",
      buildOf: "starter",
      tasks: [
        { task: SOC_TASK, points: 50, total: 66 },
        { task: STAT_TASK, points: 20, total: 116, cut: [{ file: "m.docx", chars: 210_000 }] },
      ],
    });
    writeBenchArm({
      store,
      arm: "cc-new",
      harness: PROMO_2,
      runtime: "claude-code",
      tasks: [
        { task: SOC_TASK, points: 30, total: 66 },
        { task: STAT_TASK, points: 36, total: 116, cut: [{ file: "m.docx", chars: 210_000 }] },
      ],
    });
    writeBenchArm({
      store,
      arm: "starter-cc-new",
      harness: STARTER,
      runtime: "claude-code",
      buildOf: "starter",
      tasks: [
        { task: SOC_TASK, points: 60, total: 66 },
        { task: STAT_TASK, points: 20, total: 116, cut: [{ file: "m.docx", chars: 210_000 }] },
      ],
    });
    writeBenchArm({
      store,
      arm: "pi-new",
      harness: PROMO_2,
      runtime: "pi-durable",
      tasks: [
        { task: SOC_TASK, points: 55, total: 66 },
        { task: STAT_TASK, points: 36, total: 116 },
      ],
    });
    writeBenchArm({
      store,
      arm: "base-pi-new",
      harness: "",
      runtime: "pi-durable",
      buildOf: "base",
      tasks: [
        { task: SOC_TASK, points: 52, total: 66 },
        { task: STAT_TASK, points: 20, total: 116 },
      ],
    });

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
    expect(report.cohorts.map((cohort) => `${cohort.runtime}:${cohort.baselineTier}`)).toEqual([
      "claude-code:baseStarter",
      "pi-durable:bareSolver",
    ]);
    const cc = report.cohorts[0];
    expect(cc?.uncutTaskCount).toBe(1);
    expect(cc?.baselineUncutRange).toEqual([50, 60]);
    expect(cc?.bestByDelta?.arm).toBe("cc-old");
    expect(cc?.targetVerdict).toContain("below baseStarter band");
  });

  it("blocks primary bun run wri steps in lane-guard while permitting check, regressions, and 2-digit custom reports", () => {
    expect(refusalOf("Bash", { command: "bun run wri start --log x --out y" })).toBe("the primary's step");
    expect(refusalOf("Bash", { command: "bun run wri lanes --out y" })).toBe("the primary's step");
    expect(refusalOf("Bash", { command: "bun run wri check --log x" })).toBeNull();
    expect(refusalOf("Bash", { command: "bun run wri regressions --log x" })).toBeNull();
    expect(
      refusalOf("Write", { file_path: "/Users/x/anabasis/.ana/wri/2026-11-24-run/lanes/31-report.md" }),
    ).toBeNull();
  });
});
