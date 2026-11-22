// A seed is a campaign's folder under another name with its log cut where a question starts. A
// rehearsal's script takes each task's answers from what is on record, writes the one its side was
// scripted to into the answer file with what the harness selects, and names a solve that ended
// otherwise. Its scripted Examiner proves each task it can through try_answer and puts its tasks to
// the gate, which reads their packages alone.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { normalizeContext } from "@earendil-works/pi-ai";
import { LOG_FILE } from "../src/kernel/log.ts";
import type { TaskPackage } from "../src/kernel/task.ts";
import type { Ending } from "../src/kernel/solve.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import type { Campaign } from "../tools/d2/round.ts";
import { scriptedSeats, sidesOf } from "../tools/runs/rehearse.ts";
import { sweep } from "./helpers/examiner-seat.ts";
import { seedCampaign, snapshotCampaign } from "../tools/runs/seed.ts";

const FIXTURE = new URL("fixtures/harness-min", import.meta.url).pathname;
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-rehearse-")));
const AT = "2026-10-08T00:00:00.000Z";
const line = (kind: string, data: JsonObject) => JSON.stringify({ at: AT, kind, data });
const LINES = [
  line("task.proposed", { version: "v1" }),
  line("build.started", { session: "b-1" }),
  line("build.finished", { session: "b-1", ended: "finished" }),
  line("exam.started", { session: "x-1" }),
  line("build.started", { session: "b-2" }),
];

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  sweep();
});

/** A minimal campaign log; seed artefacts are built only by the seed compartment. */
function campaignAt(name: string, lines: readonly string[], tail = ""): string {
  const folder = join(root, name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, LOG_FILE), `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}${tail}`);
  return folder;
}

describe("a seed", () => {
  let from: string;
  beforeAll(() => {
    from = campaignAt("source", LINES, '{"at":"2026');
    for (const [path, content] of [
      ["checks/brief.json", "{}"],
      ["exams/f32e9cd8/checks/evaluator.ts", "export const checks = {};\n"],
      ["states/abc/agent/BUILT_AGENTS.md", "guide\n"],
      ["launch-b-1.json", "{}"],
      ["memory/b-1/MEMORY.md", "notes of b-1\n"],
      ["memory/b-2/MEMORY.md", "notes of b-2\n"],
    ] as const) {
      mkdirSync(dirname(join(from, path)), { recursive: true });
      writeFileSync(join(from, path), content);
    }
  });
  it("refuses a snapshot folder that holds the campaign or lies inside it, and leaves the campaign whole", () => {
    const before = readFileSync(join(from, LOG_FILE), "utf8");
    expect(() => snapshotCampaign(from, from)).toThrow("holds the campaign");
    expect(() => snapshotCampaign(from, dirname(from))).toThrow("holds the campaign");
    expect(() => snapshotCampaign(from, join(from, "snapshot", "source"))).toThrow("holds the campaign");
    expect(readFileSync(join(from, LOG_FILE), "utf8")).toBe(before);
    expect(existsSync(join(from, "launch-b-1.json"))).toBe(true);
  });

  it("refuses a name that is taken and a folder with no log, and leaves nothing of a copy that does not read", () => {
    expect(() => seedCampaign(from, from, {})).toThrow("is there already");
    expect(() => seedCampaign(join(root, "nowhere"), join(root, "seed-2"), {})).toThrow("holds no log.jsonl");
    expect(() => seedCampaign(from, join(root, "seed-3"), { before: "b-9" })).toThrow("holds no session");
    expect(existsSync(join(root, "seed-3"))).toBe(false);
    const strange = campaignAt("source-3", [...LINES, line("round.imagined", {})]);
    expect(() => seedCampaign(strange, join(root, "seed-4"), {})).toThrow("is not a log event");
    expect(existsSync(join(root, "seed-4"))).toBe(false);
  });
});

const pack = (taskId: string): TaskPackage => ({
  taskId,
  family: "fixture",
  publicInput: { base: 2 },
  hidden: null,
  ruleIds: ["R1"],
  checks: join(root, "no-checks"),
});
const [other, held] = [pack("t-1"), pack("t-2")];
const graded = [other, held].flatMap(({ taskId }) => [
  { taskId, answer: { answer: `${taskId} right` }, refusedBy: null },
  { taskId, answer: { answer: `${taskId} wrong` }, refusedBy: "check-product" },
]);
const SCRIPT = { held: sidesOf("fail:pass"), starter: "fail" } as const;

/** A campaign over `folder` whose solves end as `ending`, and each solve's first scripted call. */
function campaignOver(folder: string, ending?: Ending) {
  const log = join(folder, LOG_FILE);
  const calls: unknown[] = [];
  /** The comparison each solve was made for, as the seat handed it on. */
  const named: unknown[] = [];
  // SAFETY: a rehearsal's seats read a campaign's log, its test solver and `solveOnce`, and no more.
  const campaign = {
    log,
    states: join(folder, "kept"),
    test: { effort: "medium", side: "test" },
    limits: { turns: 24 },
    setting: () => "scripted",
    solveOnce: async (...asked: Parameters<Campaign["solveOnce"]>) => {
      const by = asked[2];
      named.push(asked[4]);
      const context = normalizeContext({ messages: [{ role: "user", content: "Solve.", timestamp: 0 }] });
      const turn = await by.models?.("").streamSimple(by.model, context).result();
      calls.push(turn?.content.find((part) => part.type === "toolCall"));
      return {
        solve: `s-${String(calls.length)}`,
        ending:
          ending ??
          (turn?.content.some((part) => part.type === "toolCall" && part.name === "submit") === true
            ? { outcome: "fail", kind: "turns-ended" }
            : { outcome: "pass" }),
      };
    },
  } as unknown as Campaign;
  return { campaign, calls, named, log };
}

describe("scripted solves", () => {
  it("are refused on a campaign that is no seed, whose next round would count their solves", () => {
    const { campaign } = campaignOver(campaignAt("real", []), { outcome: "pass" });
    expect(() =>
      scriptedSeats(SCRIPT, graded, [])(campaign, { builder: undefined, reference: FIXTURE }),
    ).toThrow("is no seed");
  });
});
