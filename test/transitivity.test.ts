// The study reads several comparisons from one snapshot, keeping the bill out of its predictions.
import { expect, it } from "bun:test";
import { compared, fixedIn, solvesUnder, wrongAsFailed } from "../src/campaign/comparison.ts";
import { differenceOf, type Paired } from "../src/kernel/compare.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import { asRecord } from "../src/meta/json-shape.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { runSync } from "../src/meta/subprocess.ts";
import { roundSolves } from "./helpers/logged-round.ts";

it("reads two comparisons from one stream, each with its whole draw, and scores each with and without the bill", () => {
  const pair: Paired = {
    task: "v1",
    old: [true, true],
    fresh: [true, true],
    used: { old: [{ billed: 2 }, { billed: 2 }], fresh: [{ billed: 1 }, { billed: 1 }] },
  };
  const events: LogEvent[] = [
    { at: "2026-10-26T00:00:00Z", kind: "task.proposed", data: { taskId: pair.task, version: pair.task } },
    {
      at: "2026-10-26T00:00:00Z",
      kind: "task.gate",
      data: { version: pair.task, gate: 1, outcome: "passed" },
    },
  ];
  for (const session of ["r-1", "f-1"]) {
    const { events: solves, terms } = roundSolves(session, ["old", "fresh"], { [pair.task]: "PP PP" });
    events.push(
      {
        at: "2026-10-26T00:00:00Z",
        kind: "comparison.started",
        // A retained task the comparison excluded leaves its report `unmeasured`, but stays in its draw.
        data: {
          session,
          old: "old",
          fresh: "fresh",
          starter: "old",
          setting: "s",
          solves: 2,
          level: 0.02,
          tasks: [pair.task, "v2"],
          retained: ["v2"],
        },
      },
      ...solves.map((event, at) =>
        event.kind === "solve.finished"
          ? { ...event, data: { ...event.data, billed: at < solves.length / 2 ? 2 : 1 } }
          : event,
      ),
      {
        at: "2026-10-26T00:00:00Z",
        kind: "comparison.reported",
        data: {
          session,
          old: "old",
          fresh: "fresh",
          ...terms,
          level: 0.02,
          reading: "no-step",
          scored: {},
          frontier: { tasks: [pair.task], of: [pair.task], differences: [differenceOf(pair)] },
          retained: "unmeasured",
        },
      },
    );
  }
  const result = runSync(
    [
      capturedExecPath,
      "--no-env-file",
      "studies/transitivity/read.ts",
      "--log",
      "/dev/stdin",
      "--id",
      "r-1",
      "--id",
      "f-1",
    ],
    {
      cwd: new URL("..", import.meta.url).pathname,
      input: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    },
  );
  const output = new TextDecoder().decode(result.stdout);
  expect(output.match(/reading as recorded/g)).toHaveLength(2);
  expect(output.match(/of 2 tasks/g)).toHaveLength(2);
  expect(new TextDecoder().decode(result.stderr)).toBe("");
  expect(result.exitCode).toBe(0);
  expect(differenceOf(pair, "unbilled")).toBe(0);
  expect(output.match(/frontier without the bill  0-0-1/g)).toHaveLength(2);
  expect(output.match(/frontier with the bill     1-0-0/g)).toHaveLength(2);
  expect(output.match(/frontier yes, retained yes/g)).toHaveLength(2);
});

it("reads settled wrong passes as failures and matches the settled report's tally", () => {
  const tasks = Array.from({ length: 6 }, (_, at) => `v${String(at)}`);
  const { events: solves, terms } = roundSolves(
    "r-1",
    ["old", "fresh"],
    Object.fromEntries(tasks.map((task) => [task, "PP PP"])),
  );
  const events: LogEvent[] = tasks.flatMap((task) => [
    { at: "2026-10-26T00:00:00Z", kind: "task.proposed", data: { taskId: task, version: task } },
    { at: "2026-10-26T00:00:00Z", kind: "task.gate", data: { version: task, gate: 1, outcome: "passed" } },
  ]);
  const data = { session: "r-1", old: "old", fresh: "fresh", starter: "old", ...terms, level: 0.02 };
  events.push(
    { at: "2026-10-26T00:00:00Z", kind: "comparison.started", data: { ...data, tasks, retained: [] } },
    ...solves,
  );
  const fixed = fixedIn(events, "r-1")!;
  const original = compared(events, fixed, new Map());
  expect(original.scored).toMatchObject({ wins: 0, losses: 0, ties: 6, p: 1 });
  events.push({
    at: "2026-10-26T00:00:00Z",
    kind: "comparison.reported",
    data: { ...data, ...asRecord(original) },
  });
  const passes = Object.fromEntries(
    solvesUnder(events, fixed).flatMap(({ id, under }) => (under.harness === "old" ? [[id, "wrong"]] : [])),
  );
  const failed = wrongAsFailed(events, new Map(), passes);
  const settled = compared(failed.events, fixed, failed.labels);
  expect(settled.scored).toMatchObject({ wins: 6, losses: 0, ties: 0, p: 0.015625 });
  events.push({
    at: "2026-10-26T00:00:00Z",
    kind: "comparison.reported",
    data: { ...data, ...asRecord(settled), settled: { passes } },
  });
  const result = runSync(
    [capturedExecPath, "--no-env-file", "studies/transitivity/read.ts", "--log", "/dev/stdin", "--id", "r-1"],
    {
      cwd: new URL("..", import.meta.url).pathname,
      input: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    },
  );
  expect(new TextDecoder().decode(result.stderr)).toBe("");
  expect(result.exitCode).toBe(0);
  const output = new TextDecoder().decode(result.stdout);
  expect(output).toContain("frontier without the bill  6-0-0, untied 6, p 0.0156");
  expect(output).toContain("frontier with the bill     6-0-0, untied 6, p 0.0156");
  expect(output).toContain("frontier yes, retained yes");
});
