// Ruling prose is bounded for display after evidence passes; the call retains the full explanation.
import { afterAll, expect, it } from "bun:test";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { Contract } from "../src/kernel/contract.ts";
import { append, read } from "../src/kernel/log.ts";
import { unfinished } from "../src/kernel/trace.ts";
import type { Task, Verdict } from "../src/kernel/verify.ts";
import { boundText } from "../src/meta/bounded-text.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { asRecord, type JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { referee } from "../src/referee/referee.ts";

const TASK: Task = { taskId: "t-1", family: "span", publicInput: {}, hidden: {} };
const CONTRACT: Contract = {
  answerFormat: {},
  conventions: "SI units.",
  rules: [{ id: "R1", statement: "The span is at most 10 m." }],
  scope: "Spans.",
};
const LONG_REASON = "The span exceeds the declared limit. ".repeat(40);
const scratches: string[] = [];
const toolUse = { stopReason: "toolUse" } as const;
const PROBE = fauxAssistantMessage(
  fauxToolCall("probe_check", { changes: [{ path: "$.span", value: "9" }] }),
  toolUse,
);

afterAll(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

function ruling(reason: string, rest: JsonObject = {}) {
  return { ruling: "earned", rule: "R1", field: "$.span", probes: [1], reason, ...rest };
}

function record(args: JsonObject) {
  return fauxAssistantMessage(fauxToolCall("record_ruling", args), toolUse);
}

async function run(responses: ReturnType<typeof fauxAssistantMessage>[]) {
  const scratch = mkdtempSync(join(tmpdir(), "ana-ruling-prose-"));
  scratches.push(scratch);
  const checks = join(scratch, "checks");
  mkdirSync(checks);
  writeFileSync(
    join(checks, "brief.json"),
    JSON.stringify({
      correctnessContract: "check-program/v1",
      truthChecks: [
        {
          id: "span",
          citedDecisionIds: ["R1"],
          execution: {
            families: "all",
            artifactPaths: ["$.span"],
            publicInputPaths: [],
            hidden: "none",
            evidence: { kind: "authored" },
          },
        },
      ],
    }),
  );
  const faux = fauxProvider({
    models: [
      {
        id: "faux-ruling-prose",
        contextWindow: 200_000,
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
    ],
  });
  let turns = 0;
  faux.setResponses(
    responses.map((message) => () => {
      turns += 1;
      return message;
    }),
  );
  const models = createModels();
  models.setProvider(faux.provider);
  const log = join(scratch, "log.jsonl");
  append(log, "verdict", {
    solve: "s-1",
    task: TASK.taskId,
    kind: "fail",
    blocking: ["span"],
    answer: { span: 12 },
  });
  const finding = await referee(
    { model: faux.getModel(), effort: "medium", models: () => models },
    {
      solve: "s-1",
      task: TASK,
      contract: CONTRACT,
      checks,
      log,
      verify: async (_task, answer): Promise<Verdict> =>
        asRecord(answer)?.span === 9 ? { kind: "pass" } : { kind: "fail", blocking: ["span"] },
    },
  );
  const events = read(log);
  return {
    finding,
    events,
    turns,
    calls: events.filter(({ kind, data }) => kind === "referee.call" && data.tool === "record_ruling"),
  };
}

it.each(["earned", "check-defect"])(
  "the Referee accepts a long %s explanation on its first ruling and completes the reading",
  async (kind) => {
    const args = ruling(LONG_REASON, { ruling: kind, check: "span" });
    const s = await run([PROBE, record(args)]);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]?.data).toMatchObject({ args, isError: false });
    expect(s.finding).toEqual({
      ruling: kind,
      check: kind === "check-defect" ? "span" : null,
      rule: kind === "earned" ? "R1" : null,
      field: kind === "earned" ? "$.span" : null,
      probes: [1],
      reason: boundText(LONG_REASON, 700).shown,
    });
    expect(s.events.filter(({ kind: event }) => event === "referee.finding")).toHaveLength(1);
    expect(s.events.at(-1)?.data).toMatchObject({ ...s.finding, turns: 2 });
    expect(s.events.filter(({ kind: event }) => event === "referee.refused")).toHaveLength(0);
    expect(s.turns).toBe(2);
    expect(unfinished(s.events)).toEqual([]);
  },
);

it.each([{ rule: "uncited-rule", probes: [1] }, { probes: [] }])(
  "the Referee refuses long prose with invalid evidence %j before accepting a ruling",
  async (rest) => {
    const asked = ruling(LONG_REASON, rest);
    const s = await run([PROBE, record(asked), record(ruling("The span exceeds the limit."))]);
    expect(s.calls).toHaveLength(2);
    expect(s.calls[0]?.data).toMatchObject({ args: asked, isError: true });
    expect(s.calls[1]?.data.isError).toBe(false);
    const refused = s.events.filter(({ kind }) => kind === "referee.refused");
    expect(refused).toHaveLength(1);
    expect(refused[0]?.data).toMatchObject({ asked, why: expect.stringContaining("an earned ruling") });
    expect(s.events.findIndex(({ kind }) => kind === "referee.refused")).toBeLessThan(
      s.events.findIndex(({ kind }) => kind === "referee.finding"),
    );
    expect(s.events.filter(({ kind }) => kind === "referee.finding")).toHaveLength(1);
    expect(s.finding).toMatchObject({ ruling: "earned", reason: "The span exceeds the limit." });
    expect(s.turns).toBe(3);
  },
);

it.each([`${"x".repeat(699)}${"🧪".repeat(200)}`, "  The span exceeds the limit.  "])(
  "the Referee preserves original prose and uses the shared bounded display for %#",
  async (reason) => {
    const args = ruling(reason);
    const s = await run([PROBE, record(args)]);
    const bounded = boundText(reason, 700);
    expect(s.calls[0]?.data).toMatchObject({ args, isError: false });
    expect(s.finding.reason).toBe(bounded.shown);
    expect(new TextEncoder().encode(bounded.text).byteLength).toBeLessThanOrEqual(700);
    expect(bounded.text.isWellFormed()).toBe(true);
    if (bounded.truncated) expect(s.finding.reason).toContain("bytes omitted]");
    else expect(s.finding.reason).toBe(reason.trim());
  },
);

it("the Referee still requires a nonempty string reason", async () => {
  const { reason: _reason, ...missing } = ruling("unused");
  const s = await run([
    PROBE,
    record(missing),
    record(ruling("")),
    record(ruling("The span exceeds the limit.")),
  ]);
  expect(s.calls.map(({ data }) => data.isError)).toEqual([true, true, false]);
  expect(s.events.filter(({ kind }) => kind === "referee.refused")).toHaveLength(0);
  expect(s.finding.ruling).toBe("earned");
});
