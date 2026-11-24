// WRI2P2's driver reads each run's per-promotion decision point (1..3) and ceiling (4), plus
// non-promotion triggers (all-tied comparison, 12h clock, or closing), enforces exact-count
// continuation deviations, auto-skips untriggered isolated lanes, supports zero-PR plans,
// retires intentionally opposed predictions from carryOf, and chains until.ts `:next`.
import { afterAll, describe, expect, it } from "bun:test";
import { dueLines, keptIn, nextOf, openingOf } from "#skills/run-improvement-campaign/scripts/wri2p2.ts";
import { pulse } from "#tools/runs/pulse.ts";
import type { Run } from "#tools/runs/registry.ts";
import { clockTurns, progressOf as rowOf, triggerOf } from "#tools/runs/said.ts";
import { carryOf } from "#tools/wri/ledger.ts";
import { readsOf } from "#tools/wri/record.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath, capturedSpawn } from "../src/meta/process.ts";

const folders: string[] = [];
const live = { name: "r", host: "here", live: true };
const HOUR = 3_600_000;
const OPENED = Date.parse("2026-11-04T00:00:00.000Z");

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

function scratch(): string {
  const folder = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-wri2p2-")));
  folders.push(folder);
  return folder;
}

const at = (hours: number) => new Date(OPENED + hours * HOUR).toISOString();
const event = (hours: number, kind: LogEvent["kind"], data: JsonObject = {}): LogEvent => ({
  at: at(hours),
  kind,
  data,
});
const opening = (hours = 0) => event(hours, "campaign.opened");
const reported = (hours: number, wins: number, losses: number, ties: number, reading = "no-step") =>
  event(hours, "comparison.reported", { reading, scored: { wins, losses, ties } });
const promotedEvents = (count: number) => [
  opening(),
  ...Array.from({ length: count }, (_, idx) =>
    event(idx + 1, "harness.promoted", { harness: String(idx + 1).repeat(8) }),
  ),
];

describe("the trigger across promotions 0..5 and non-promotion bounds", () => {
  it("opens at every promotion 1..5, at an all-tied comparison, or at 12 hours, and never before", () => {
    const now = OPENED + 3 * HOUR;
    const short = [opening(), reported(2, 3, 1, 4)];
    expect(triggerOf(rowOf(live, short, now))).toBeNull();
    expect(triggerOf(rowOf(live, promotedEvents(1), now))).toBe("1 promotion");
    for (const count of [2, 3, 4, 5]) {
      expect(triggerOf(rowOf(live, promotedEvents(count), now))).toBe(`${String(count)} promotions`);
    }
    const tied = rowOf(live, [opening(), reported(2, 0, 0, 8)], now);
    expect(triggerOf(tied)).toBe("a comparison left no task untied");
    // A live run is timed to now, so one in a long wait still reaches the hours.
    expect(triggerOf(rowOf(live, short, OPENED + 13 * HOUR))).toBe("13.0 h since its opening");
  });

  it("reads a comparison that scored nothing as no tie, since it tested nothing", () => {
    const unscored = [opening(), reported(2, 0, 0, 0, "not-scored")];
    expect(triggerOf(rowOf(live, unscored, OPENED + 3 * HOUR))).toBeNull();
  });

  it("opens on a run that closed after a comparison, and not on one that never compared", () => {
    const closed = [opening(), reported(1, 1, 1, 0), event(2, "campaign.ended", { ending: "stop" })];
    expect(triggerOf(rowOf({ ...live, live: false }, closed, OPENED))).toBe("closed (stop)");
    const empty = [opening(), event(1, "campaign.ended", { ending: "exam" })];
    expect(triggerOf(rowOf({ ...live, live: false }, empty, OPENED))).toBeNull();
  });
});

describe("a run's step at promotions 1..5 and exact-count keptIn", () => {
  const row = { name: "r1", host: "here", live: true };
  const pausing = (args: string[]) => [{ pid: 1, cwd: "/w", args }];

  it("emits decide at promotions 1..4 and ceiling pause at 5+", () => {
    for (const promos of [1, 2, 3, 4]) {
      const trigger = promos === 1 ? "1 promotion" : `${String(promos)} promotions`;
      const lines = openingOf({ ...row, promotions: promos }, trigger, []);
      expect(lines[0]).toStartWith(`step: decide · ${trigger};`);
      expect(lines[1]).toBe("  bun run runs pause r1 --after reported --yes");
    }
    const atCeiling = openingOf({ ...row, promotions: 5 }, "5 promotions", []);
    expect(atCeiling[0]).toStartWith("step: pause · 5 promotions; ceiling reached (5 promotions)");
    expect(atCeiling[1]).toBe("  bun run runs pause r1 --after reported --yes");

    const clockPause = openingOf({ ...row, promotions: 0 }, "12.0 h since its opening", []);
    expect(clockPause[0]).toBe(
      "step: pause · 12.0 h since its opening; the investigation opens once the run stops after its next comparison",
    );
  });

  it("keeps past a promotion only when the deviation names that exact promotion trigger", () => {
    const clockDev = ["| step | reason |\n| --- | --- |\n| pause:r1 | still climbing |"];
    expect(keptIn(clockDev, "r1", "12.0 h since its opening", 0)).toBe("still climbing");
    expect(keptIn(clockDev, "r1", "1 promotion", 1)).toBeNull();

    const p1Dev = ["| step | reason |\n| --- | --- |\n| pause:r1 | past 1 promotion: waiting for P2 |"];
    expect(keptIn(p1Dev, "r1", "1 promotion", 1)).toBe("past 1 promotion: waiting for P2");
    expect(keptIn(p1Dev, "r1", "2 promotions", 2)).toBeNull();

    const p2Dev = ["| step | reason |\n| --- | --- |\n| pause:r1 | past 2 promotions: waiting for P3 |"];
    expect(keptIn(p2Dev, "r1", "2 promotions", 2)).toBe("past 2 promotions: waiting for P3");
    expect(keptIn(p2Dev, "r1", "3 promotions", 3)).toBeNull();
  });

  it("waits while a pause of the run is armed, and opens once the run has stopped", () => {
    const armed = pausing(["bun", "tools/runs/cli.ts", "pause", "r1", "--after", "reported", "--yes"]);
    expect(openingOf({ ...row, promotions: 2 }, "2 promotions", armed)[0]).toStartWith("step: waits");
    expect(
      openingOf(
        { ...row, promotions: 2 },
        "2 promotions",
        pausing(["bun", "tools/runs/cli.ts", "continue", "r1", "--after", "reported"]),
      )[0],
    ).toStartWith("step: pause");
    expect(
      openingOf(
        { ...row, promotions: 2 },
        "2 promotions",
        pausing(["bun", "tools/runs/cli.ts", "continue", "r1"]),
      )[0],
    ).toStartWith("step: decide");
    expect(
      openingOf({ ...row, promotions: 2 }, "2 promotions", pausing(["bun", "cli.ts", "pause", "r2"]))[0],
    ).toStartWith("step: decide");
    expect(openingOf({ ...row, live: false, promotions: 1 }, "1 promotion", armed)[0]).toBe(
      "step: open · 1 promotion",
    );
    expect(openingOf(row, null, [])).toEqual(["step: run"]);
  });
});

describe("the clock trigger", () => {
  it("says the second a live run's clock trigger turns, which a timer set to the minute would miss", () => {
    // Opened 46.5 s past the minute: at twelve hours past that minute the trigger has not turned.
    const opened = [event(46.5 / 3600, "campaign.opened")];
    const minute = OPENED + 12 * HOUR;
    const early = rowOf({ name: "r1", host: "here", live: true }, opened, minute);
    expect(triggerOf(early)).toBeNull();
    const turns = clockTurns(early, minute);
    expect(turns).toBe("2026-11-04T12:00:47Z");
    // Hostile: the trigger stands at the second said and not at the one before it.
    const read = (when: number) => triggerOf(rowOf({ name: "r1", host: "here", live: true }, opened, when));
    expect(read(Date.parse(turns))).toBe("12.0 h since its opening");
    expect(read(Date.parse(turns) - 1000)).toBeNull();
    const step = openingOf(early, null, [], null, turns);
    expect(step).toEqual([`step: run · its clock trigger turns at ${turns}`]);
    const lines = dueLines([{ row: early, last: minute, dir: null, step }], () => minute, minute);
    expect(lines).toEqual([
      "due at 2026-11-04T12:00Z · nothing owed · 1 run(s) live",
      `run · r1 · its clock trigger turns at ${turns}`,
    ]);
    // A stopped run has no clock to wait for.
    expect(openingOf({ ...early, live: false }, null, [], null, turns)).toEqual(["step: run"]);
  });
});

describe("WRI2P2 gate hygiene: isolated auto-skip, zero-PR plans, and opposed carry pruning", () => {
  function seedIteration(
    root: string,
    options: { readonly overview: string; readonly plan?: string },
  ): string {
    const cycle = join(root, "2026-11-23-cycle-v0131");
    const dir = join(root, "2026-11-23-demo");
    mkdirSync(join(dir, "lanes"), { recursive: true });
    mkdirSync(cycle, { recursive: true });
    writeFileSync(join(dir, "iteration.json"), JSON.stringify({ opened: at(0), runs: ["r1"], protocol: 2 }));
    writeFileSync(join(dir, "investigation.json"), JSON.stringify({ logs: ["/tmp/r1/log.jsonl"] }));
    writeFileSync(
      join(dir, "shared-instructions.md"),
      "## Prior state\nfilled\n## Campaigns under review\nfilled\n## Notes\nfilled\n",
    );
    writeFileSync(join(dir, "overview.md"), options.overview);
    writeFileSync(
      join(dir, "record.md"),
      readsOf(["r1"])
        .map((words) => `## ${words.join(" ")}\nread at 2026-11-23T00:00Z, exit 0\n`)
        .join("\n"),
    );
    writeFileSync(join(dir, "lanes", "01-report.md"), "Lane 1 report\nno finding\n");
    writeFileSync(
      join(dir, "launch.json"),
      JSON.stringify({
        sessions: [{ name: "s1", task: "t", ownedPaths: [join(dir, "lanes", "01-report.md")] }],
      }),
    );
    if (options.plan !== undefined) {
      writeFileSync(join(dir, "synthesis.md"), "# Synthesis\n");
      writeFileSync(join(dir, "reports.md"), "# Reports\n");
      writeFileSync(join(cycle, "predictions-r1.md"), "| id | claim |\n| --- | --- |\n| P1 | holds |\n");
      writeFileSync(
        join(cycle, "outcomes-r1.md"),
        "Log events at resolution: 10\n\n| id | outcome |\n| --- | --- |\n| P1 | held |\n",
      );
      writeFileSync(
        join(dir, "vetting.md"),
        [
          "| id | finding | lanes | standing | owner | importance | verdict | fate |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          "| vet-1 | P1 clean | 1 | new | `src/kernel/verify.ts` | I3 | refuted | no action |",
        ].join("\n"),
      );
      writeFileSync(join(dir, "cross-domain.md"), "# Cross-domain\n");
      writeFileSync(join(dir, "plan.md"), options.plan);
    }
    return dir;
  }

  it("auto-skips the isolated gate when overview.md fires no isolated-lane trigger, and enforces it when one fires", () => {
    const root = scratch();
    const quiet = seedIteration(join(root, "quiet"), { overview: "REFUSALS BY CHECK (lane 1): 0\n" });
    expect(nextOf(quiet, { root: join(root, "quiet") })[0]).toStartWith("step: synthesise");

    const loud = seedIteration(join(root, "loud"), {
      overview: "FAILS ON ONE CHECK (lane 20): check-a refused 2 of 2\n",
    });
    expect(nextOf(loud, { root: join(root, "loud") })[0]).toStartWith("step: isolated");
  });

  it("closes cleanly with Pull request: none when vetting leaves no code repair", () => {
    const root = scratch();
    const dir = seedIteration(root, {
      overview: "REFUSALS BY CHECK (lane 1): 0\n",
      plan: [
        "# Plan",
        "Reads `cross-domain.md`; considers E1, B1, H3.",
        "Pull request: none — all findings refuted",
        "## Intentionally opposed",
        "- none",
      ].join("\n"),
    });
    expect(nextOf(dir, { root, campaigns: [], lengthOf: () => 10 })[0]).toBe(
      "step: done · no code change (see plan.md)",
    );
  });

  it("excludes parent predictions retired under ## Intentionally opposed from carryOf", () => {
    const parent = {
      name: "parent-run",
      predictions: "| id | claim |\n| --- | --- |\n| P1 | keeps |\n| P2 | retires |\n",
      outcomes: "| id | outcome |\n| --- | --- |\n| P1 | unreached |\n| P2 | unreached |\n",
      plan: "## Intentionally opposed\n- P2: superseded by prompt rewrite\n",
    };
    const child = "## Carried\n- parent-run:P1\n";
    expect(carryOf(child, [parent])).toEqual({ owed: ["parent-run:P1"], missing: [] });
    // Hostile: omitting non-opposed P1 is still caught as missing.
    expect(carryOf("## Carried\n", [parent])).toEqual({
      owed: ["parent-run:P1"],
      missing: ["parent-run:P1"],
    });
  });
});

describe("pulse per-promotion surfacing and until.ts :next chaining", () => {
  it("surfaces every promotion 1..4 as a decision point and 5 as investigation due without re-firing", () => {
    const root = scratch();
    const log = join(root, "camp", "log.jsonl");
    const run: Run = { name: "camp", path: log, tree: root, end: "comparison.reported" };
    const life = { writing: true, kept: false };

    const e0 = [opening()];
    const l0 = pulse(run, e0, life, undefined, { now: OPENED + HOUR });
    expect(l0.seen.due).toBe(false);

    const e1 = promotedEvents(1);
    const l1 = pulse(run, e1, life, l0.seen, { now: OPENED + 2 * HOUR });
    expect(l1.said.join("\n")).toContain("⚠ decision point, 1 promotion:");
    expect(l1.seen.due).toBe("1 promotion");

    // Repeating at same promotion emits no duplicate due warning.
    const l1Repeat = pulse(run, e1, life, l1.seen, { now: OPENED + 3 * HOUR });
    expect(l1Repeat.said.join("\n")).not.toContain("decision point");

    const e4 = promotedEvents(4);
    const l4 = pulse(run, e4, life, l1Repeat.seen, { now: OPENED + 4 * HOUR });
    expect(l4.said.join("\n")).toContain("⚠ decision point, 4 promotions:");

    const e5 = promotedEvents(5);
    const l5 = pulse(run, e5, life, l4.seen, { now: OPENED + 5 * HOUR });
    expect(l5.said.join("\n")).toContain("⚠ investigation due, 5 promotions:");
  });

  it("until.ts --at harness.promoted:next wakes immediately when count already exceeds start + 1 on explicit count and rejects invalid targets", async () => {
    const root = scratch();
    const dir = join(root, "demo-run");
    mkdirSync(dir, { recursive: true });
    const log = join(dir, "log.jsonl");
    writeFileSync(
      log,
      `${promotedEvents(2)
        .map((each) => JSON.stringify(each))
        .join("\n")}\n`,
    );
    const script = join(
      import.meta.dir,
      "..",
      ".claude",
      "skills",
      "run-improvement-campaign",
      "scripts",
      "until.ts",
    );
    const hit = capturedSpawn([capturedExecPath, script, log, "--at", "harness.promoted:2"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(hit.stdout).text();
    expect(await hit.exited).toBe(0);
    expect(out).toContain(
      "demo-run reached 2 harness.promoted; 2 harness.promoted (2 promoted in 0 compared, 3 events)",
    );
    expect(out).toContain(
      "Backtrack predictions-demo-run.md against the log and decide pause (--after reported) vs continue (up to 5).",
    );

    const endedLog = join(dir, "ended.jsonl");
    writeFileSync(
      endedLog,
      `${[...promotedEvents(1), event(2, "campaign.ended", { ending: "stop" })]
        .map((each) => JSON.stringify(each))
        .join("\n")}\n`,
    );
    const nextHit = capturedSpawn([capturedExecPath, script, endedLog, "--at", "harness.promoted:next"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const nextOut = await new Response(nextHit.stdout).text();
    expect(await nextHit.exited).toBe(0);
    // `:next` targeted 2 promotions (initial 1 + 1), so the existing 1 promotion did not satisfy it.
    expect(nextOut).toContain("reached an ending before any bound; 1 harness.promoted");

    const bad = capturedSpawn([capturedExecPath, script, log, "--at", "harness.promoted:zero"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await bad.exited).not.toBe(0);
  });
});
