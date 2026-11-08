import { afterAll, describe, expect, test } from "bun:test";
import type { EventKind, LogEvent } from "#src/kernel/log.ts";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import type { JsonObject } from "#src/meta/json-shape.ts";
import { tmpdir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";
import { buildPackets, type Campaign, joinPackets } from "#tools/wri/packets.ts";

const STARTER = "s".repeat(64);
const HIDDEN = "a hidden value no packet may hold";
const PRACTISED = "a question only ever practised";
const room = mkdtempSync(join(tmpdir(), "wri-packets-"));
afterAll(() => {
  rmSync(room, { recursive: true, force: true });
});

const event = (at: string, kind: EventKind, data: JsonObject): LogEvent => ({ at, kind, data });

function campaign(name: string, at: string, tasks: number, answered: readonly number[]): Campaign {
  const proposed = Array.from({ length: tasks }, (_, nth) =>
    event(at, "task.proposed", {
      version: `v-${name}-${String(nth)}`,
      taskId: `ex-${String(nth)}`,
      task: {
        taskId: `ex-${String(nth)}`,
        family: "family",
        publicInput: { asks: `the question numbered ${String(nth)}` },
        hidden: { value: HIDDEN },
      },
    }),
  );
  const solves = answered.flatMap((nth) =>
    ["1", "2"].flatMap((solve) => {
      const id = `s-${String(nth)}-${solve}`;
      return [
        event(at, "solve.started", { solve: id, task: `ex-${String(nth)}` }),
        event(at, "solve.finished", {
          solve: id,
          harness: STARTER,
          ending: { outcome: "pass", kind: "pass" },
        }),
      ];
    }),
  );
  return {
    name,
    log: join(room, name, "log.jsonl"),
    events: [
      ...proposed,
      event(at, "task.proposed", {
        version: `v-${name}-practice`,
        taskId: "ex-practice",
        task: {
          taskId: "ex-practice",
          family: "family",
          publicInput: { asks: PRACTISED },
          hidden: { value: HIDDEN },
        },
      }),
      event(at, "task.gate", { version: `v-${name}-practice`, gate: 1, outcome: "passed" }),
      event(at, "task.state", { version: `v-${name}-practice`, state: "released" }),
      event(at, "comparison.started", {
        session: "g-1",
        starter: STARTER,
        fresh: STARTER,
        tasks: proposed.map(({ data }) => data.version ?? ""),
      }),
      ...solves,
    ],
  };
}

const campaigns = [
  campaign("oldest-run", "2026-11-01T00:00:00.000Z", 8, [0]),
  campaign("older-run", "2026-11-02T00:00:00.000Z", 8, []),
  campaign("newer-run", "2026-11-03T00:00:00.000Z", 8, []),
  campaign("newest-run", "2026-11-04T00:00:00.000Z", 8, []),
];
const first = campaigns[0];
if (first === undefined) throw new Error("no campaign");
const out = join(room, "investigation");
const made = buildPackets(campaigns, out, 2);
const packet = (grader: string) => readFileSync(join(out, `packet-${grader}-tasks.md`), "utf8");
// SAFETY: `buildPackets` and `joinPackets` wrote this file, in this shape.
const key = JSON.parse(readFileSync(join(out, "key.json"), "utf8")) as {
  campaigns: Record<string, { name: string; grader: string }>;
  graders: Record<string, { tasks: string[]; anchors: string[] }>;
};
const labelOf = (name: string) =>
  Object.entries(key.campaigns).find(([, one]) => one.name === name)?.[0] ?? "";
const read = (log: string) => campaigns.find((one) => one.log === log)?.events ?? [];

describe("the packets", () => {
  test("a packet holds the scored tasks alone, leaving out one only practised", () => {
    for (const grader of ["a", "b"]) {
      expect(packet(grader)).toContain("the question numbered 0");
      expect(packet(grader)).not.toContain(PRACTISED);
    }
  });

  test("each grader holds half the campaigns, old and new alternating", () => {
    expect(made).toHaveLength(2);
    const graderOf = (name: string) => key.campaigns[labelOf(name)]?.grader;
    expect(graderOf("oldest-run")).toBe(graderOf("newer-run"));
    expect(graderOf("older-run")).toBe(graderOf("newest-run"));
    expect(graderOf("oldest-run")).not.toBe(graderOf("older-run"));
  });

  test("a packet and a prompt hold no campaign's name, no hidden value and no outcome", () => {
    for (const grader of ["a", "b"]) {
      const text = `${packet(grader)}${readFileSync(join(out, `grader-${grader}.md`), "utf8")}`;
      for (const { name } of campaigns) {
        expect(text).not.toContain(name);
      }
      expect(text).not.toContain(HIDDEN);
      expect(text).not.toContain('"pass"');
    }
  });

  test("a label's order does not follow a campaign's age or the order it was named", () => {
    expect(Object.keys(key.campaigns).toSorted()).toEqual(["r1", "r2", "r3", "r4"]);
    expect(labelOf("oldest-run")).toMatch(/^r\d$/u);
  });

  test("a value past the limit says it was cut, and a short one stays whole", () => {
    const long = campaign("long-run", "2026-11-05T00:00:00.000Z", 1, []);
    const task = long.events[0];
    if (task === undefined) throw new Error("no task");
    const padded = {
      ...task,
      data: {
        ...task.data,
        task: {
          taskId: "ex-0",
          family: "family",
          publicInput: { short: "kept whole", table: "x".repeat(9000) },
        },
      },
    };
    const there = join(room, "long");
    buildPackets([{ ...long, events: [padded, ...long.events.slice(1)] }, first], there, 2);
    const text = `${readFileSync(join(there, "packet-a-tasks.md"), "utf8")}${readFileSync(join(there, "packet-b-tasks.md"), "utf8")}`;
    expect(text).toContain('short: "kept whole"');
    expect(text).toContain("[cut after 1500 of 9002 characters]");
  });

  test("a public part that is no record is shown whole, and a task with none says so", () => {
    const plain = campaign("plain-run", "2026-11-05T00:00:00.000Z", 2, []);
    const withInput = (nth: number, input: JsonObject[string]) => {
      const task = plain.events[nth];
      if (task === undefined) throw new Error("no task");
      return {
        ...task,
        data: { ...task.data, task: { taskId: `ex-${String(nth)}`, family: "family", publicInput: input } },
      };
    };
    const there = join(room, "plain");
    buildPackets(
      [
        { ...plain, events: [withInput(0, "one sentence"), withInput(1, null), ...plain.events.slice(2)] },
        first,
      ],
      there,
      2,
    );
    const text = `${readFileSync(join(there, "packet-a-tasks.md"), "utf8")}${readFileSync(join(there, "packet-b-tasks.md"), "utf8")}`;
    expect(text).toContain('public: "one sentence"');
    expect(text).toContain('public: "none in the log"');
  });

  test("each grader holds the others' tasks unmarked, and none of its own as an anchor", () => {
    for (const [grader, held] of Object.entries(key.graders)) {
      expect(held.anchors).toHaveLength(6);
      for (const anchor of held.anchors) {
        expect(held.tasks).not.toContain(anchor);
        expect(key.campaigns[anchor.split("\t")[0] ?? ""]?.grader).not.toBe(grader);
        expect(packet(grader)).toContain(`task ${anchor.replace("\t", " ")}`);
      }
    }
  });

  test("one grader is refused, since it has no one to differ from", () => {
    expect(() => buildPackets(campaigns, join(room, "alone"), 1)).toThrow("--graders");
  });

  test("the manifest gives a grader its prompt and its report, and the report's path passes the lane guard's shape", () => {
    // SAFETY: `buildPackets` and `joinPackets` wrote this file, in this shape.
    const manifest = JSON.parse(readFileSync(join(out, "launch.json"), "utf8")) as {
      sessions: { name: string; ownedPaths: string[] }[];
    };
    expect(manifest.sessions.map(({ name }) => name)).toEqual(["grader_a", "grader_b"]);
    expect(manifest.sessions[0]?.ownedPaths[0]).toEndWith("/lanes/34a-report.md");
  });
});

describe("the join", () => {
  const rowsFor = (grader: string, grade: (row: string) => number) => {
    const held = key.graders[grader];
    return [...(held?.tasks ?? []), ...(held?.anchors ?? [])].map(
      (row) => `task\t${row}\t${String(grade(row))}`,
    );
  };
  const oldest = `${labelOf("oldest-run")}\tex-0`;
  const owner = key.campaigns[labelOf("oldest-run")]?.grader ?? "";
  const other = owner === "a" ? "b" : "a";
  writeFileSync(join(out, "lanes", `34${owner}-report.md`), rowsFor(owner, () => 5).join("\n"));
  writeFileSync(
    join(out, "lanes", `34${other}-report.md`),
    ["not a row", "task\tr9\tex-9\tnone", ...rowsFor(other, () => 3)].join("\n"),
  );
  const lines = joinPackets(out, read);
  const grades = () => readFileSync(join(out, "grades.tsv"), "utf8");

  test("rows take the campaign's name and the grade of the grader who owns the campaign", () => {
    expect(grades()).toContain("task\toldest-run\tex-0\t5");
    expect(grades()).not.toContain("task\toldest-run\tex-0\t3");
    expect(grades()).not.toContain("r9");
  });

  test("it says how far the graders differ on the anchors they share", () => {
    const line = lines.find((one) => one.startsWith(`grader ${owner}:`));
    expect(line).toContain("mean difference from their grader 2.00");
    expect(lines.find((one) => one.startsWith(`grader ${other}:`))).toContain(
      "mean difference from their grader -2.00",
    );
  });

  test("it owes a regrade of a high grade the Starter answered every time, and of no other", () => {
    const prompt = readFileSync(join(out, `regrade-${owner}.md`), "utf8");
    expect(prompt).toContain(oldest.replace("\t", " "));
    expect(prompt).not.toContain("ex-1\n");
    expect(existsSync(join(out, `regrade-${other}.md`))).toBe(false);
    // SAFETY: `buildPackets` and `joinPackets` wrote this file, in this shape.
    const manifest = JSON.parse(readFileSync(join(out, "launch-regrade.json"), "utf8")) as {
      sessions: { name: string }[];
    };
    expect(manifest.sessions.map(({ name }) => name)).toEqual([`grader_${owner}`]);
  });

  test("a regrade replaces the grade, and is not owed again", () => {
    const path = join(out, "lanes", `34${owner}-report.md`);
    writeFileSync(path, `${readFileSync(path, "utf8")}\nregrade\t${oldest}\t2`);
    const again = joinPackets(out, read);
    expect(grades()).toContain("task\toldest-run\tex-0\t2");
    expect(grades()).not.toContain("task\toldest-run\tex-0\t5");
    expect(again.find((one) => one.startsWith(`grader ${owner}:`))).toContain("owes 0 regrades");
  });
});
