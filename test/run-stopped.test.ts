// An investigation refuses a campaign that may still write its log (operator, 3 November). A peer's
// copy is read by the observation its last fetch kept; this machine's by its own processes, never
// by a stale observation file beside its log.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import { tmpdir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";
import type { EventKind, LogEvent } from "#src/kernel/log.ts";
import type { JsonObject } from "#src/meta/json-shape.ts";
import { stillRunning } from "../tools/runs/diagnosis.ts";
import { stateOf } from "../tools/runs/state.ts";
import type { Run } from "../tools/runs/registry.ts";

let dir = "";

function copy(
  name: string,
  observation: { open: boolean; kept?: boolean; stderr: null } | null,
  archived?: string,
): Run {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "log.jsonl"), "");
  if (observation !== null) writeFileSync(join(dir, name, "observation.json"), JSON.stringify(observation));
  const run: Run = { name, tree: dir, path: join(dir, name, "log.jsonl"), end: "comparison.reported" };
  return archived === undefined ? run : { ...run, archived };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ana-run-stopped-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("whether a campaign may still write its log", () => {
  it("reads a peer's copy by the observation its last fetch kept", () => {
    expect(stillRunning(copy("wri-test-open", { open: true, stderr: null }, "peer"), [])).toBe(true);
    expect(stillRunning(copy("wri-test-closed", { open: false, stderr: null }, "peer"), [])).toBe(false);
  });

  it("reads a peer's run whose keeper waits between two starts as still running", () => {
    const waiting = { open: false, kept: true, stderr: null };
    expect(stillRunning(copy("wri-test-kept", waiting, "peer"), [])).toBe(true);
    expect(stillRunning(copy("wri-test-unkept", { ...waiting, kept: false }, "peer"), [])).toBe(false);
  });

  it("reads this machine's own campaign by its processes, not a stale observation beside it", () => {
    expect(stillRunning(copy("wri-test-local", { open: true, stderr: null }), [])).toBe(false);
    expect(stillRunning(copy("wri-test-here", { open: true, stderr: null }, "here"), [])).toBe(false);
    const run = copy("wri-test-written", null);
    const writer = { pid: 1, cwd: dir, args: ["bun", "/x/tools/d2/harness-builder.ts", "--name", run.name] };
    expect(stillRunning({ ...run, tree: "/x" }, [writer])).toBe(true);
  });

  it("reads a run whose keeper waits between two starts as running, and another run's keeper as nothing", () => {
    const run = copy("wri-test-kept", null);
    const keeper = (name: string) => ({
      pid: 2,
      cwd: dir,
      args: ["bun", "/x/tools/runs/cli.ts", "keep", name, "--here"],
    });
    expect(stillRunning(run, [keeper(run.name)])).toBe(true);
    expect(stillRunning(run, [keeper("another-run")])).toBe(false);
  });
});

describe("where a run stands, in one fold every reader shares", () => {
  const NOW = Date.parse("2026-11-09T12:00:00.000Z");
  const MINUTE = 60_000;
  const at = (minutesAgo: number) => new Date(NOW - minutesAgo * MINUTE).toISOString();
  const event = (minutesAgo: number, kind: EventKind, data: JsonObject = {}): LogEvent => ({
    at: at(minutesAgo),
    kind,
    data,
  });
  const writing = { writing: true, kept: false };
  const provider = (minutesAgo: number, untilIn: number) =>
    event(minutesAgo, "campaign.waited", {
      for: "provider",
      until: new Date(NOW + untilIn * MINUTE).toISOString(),
    });

  it("reads a writer before its log, and the log only once nothing writes", () => {
    const ended = [event(1, "campaign.ended", { ending: "budget" })];
    expect(stateOf(ended, writing, NOW)).toEqual({ kind: "live", kept: false });
    expect(stateOf([event(1, "build.started")], { writing: true, kept: true }, NOW)).toEqual({
      kind: "live",
      kept: true,
    });
    expect(stateOf([], { writing: false, kept: true }, NOW)).toEqual({ kind: "kept" });
    const cut = [event(1, "campaign.ended", { ending: "environment" })];
    expect(stateOf(cut, { writing: false, kept: true }, NOW)).toEqual({
      kind: "kept",
      ending: "environment",
    });
    expect(stateOf(ended, { writing: false, kept: false }, NOW)).toEqual({ kind: "ended", ending: "budget" });
    expect(stateOf([event(1, "build.started")], { writing: false, kept: false }, NOW)).toEqual({
      kind: "stopped",
    });
  });

  it("reads a wait as standing through calls and failed turns, until its bound, within the current launch", () => {
    const calls = [event(4, "exam.call"), event(3, "exam.turn", { stopReason: "error" })];
    expect(stateOf([provider(5, 90), ...calls], writing, NOW)).toMatchObject({
      kind: "waiting",
      wait: { for: "provider", until: NOW + 90 * MINUTE },
    });
    expect(stateOf([provider(5, 90), event(1, "build.started")], writing, NOW).kind).toBe("live");
    // A wait the launch before this one recorded is that launch's, however its calls run on.
    expect(stateOf([provider(5, 90), ...calls], writing, NOW, 1).kind).toBe("live");
    // A network wait is recorded before it starts, and stands for its length.
    const network = event(5, "campaign.waited", { for: "network", ms: 10 * MINUTE });
    expect(stateOf([network], writing, NOW)).toMatchObject({
      kind: "waiting",
      wait: { until: NOW + 5 * MINUTE },
    });
    // A load wait is recorded once it is over, so it stands for nothing.
    expect(stateOf([event(5, "campaign.waited", { load: 9, cores: 4, ms: MINUTE })], writing, NOW).kind).toBe(
      "live",
    );
  });

  it("bounds a wait that names no end, and counts quiet from the last event or the end of a wait", () => {
    // A provider wait with no reset lapses after an hour instead of holding the run as waiting for good.
    const unbounded = event(70, "campaign.waited", { for: "provider" });
    expect(stateOf([unbounded], writing, NOW)).toEqual({ kind: "live", kept: false });
    expect(stateOf([unbounded], writing, NOW + 30 * MINUTE)).toEqual({
      kind: "quiet",
      kept: false,
      since: NOW - 10 * MINUTE,
    });
    expect(stateOf([event(25, "build.started")], writing, NOW)).toEqual({
      kind: "quiet",
      kept: false,
      since: NOW - 25 * MINUTE,
    });
    expect(stateOf([provider(60, -5)], writing, NOW).kind).toBe("live");
    expect(stateOf([provider(60, -25)], writing, NOW)).toMatchObject({
      kind: "quiet",
      since: NOW - 25 * MINUTE,
    });
    expect(stateOf([], writing, NOW).kind).toBe("live");
  });
});
