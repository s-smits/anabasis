import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject, JsonValue } from "../src/meta/json-shape.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import { adviceIssueId } from "../src/author/rebuild-advice.ts";
import { required } from "./helpers/doubles.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import {
  CHANNELS,
  buildHandoffs,
  classifyFamily,
  renderHandoffs,
} from "../.claude/skills/whole-run-investigation/scripts/handoffs.ts";

const RUN = "run-20260919T000000000Z-aaaaaa";
const SECOND = `${RUN}-i02`;

afterAll(cleanupScratch);

function writeText(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

const write = (path: string, value: JsonValue) => writeText(path, JSON.stringify(value));

const jsonl = (rows: unknown[]) => `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;

function issue(family: string, dispute: string | null) {
  return {
    id: adviceIssueId("verified-fail", family, null),
    kind: "verified-fail",
    family,
    detail: null,
    count: 2,
    denominator: 3,
    firstSeenRunId: RUN,
    lastSeenRunId: RUN,
    absentBatteries: 0,
    returned: false,
    retired: false,
    diagnosis: null,
    dispute,
  };
}

/** Two rounds and two batteries. Round 2's battery measures round 1's `alpha` inputs again under
 *  the family name `beta`, so the packet retires `alpha` on a comparison of names alone. */
function campaign(options: { toolCalls?: boolean } = {}): string {
  // Trace roots must match their realpath, and the host temp directory may sit behind a link.
  const root = realpathSync(scratchDir("wri-handoffs-"));
  const dir = join(root, "campaigns", "handoffs");
  const epochs = [
    { key: "epoch-aaaaaaaaaaaa", createdAt: "2026-09-19T00:00:00.000Z" },
    { key: "epoch-bbbbbbbbbbbb", createdAt: "2026-09-19T02:00:00.000Z" },
  ] as const;
  write(join(dir, "epochs.json"), { schema: "campaign-epochs/v1", current: epochs[1].key, epochs });
  const prompts = [
    `Work in ${dir}/${epochs[0].key}/workspace\nTask count: 3\nUser context: no files supplied.`,
    [
      `Work in ${dir}/${epochs[1].key}/workspace`,
      "Task count: 3",
      "Recorded batteries (controller-derived data, oldest first):",
      "Standing issues, largest first.",
    ].join("\n"),
  ];
  writeText(
    join(dir, "observability", `${RUN}.jsonl`),
    jsonl(
      prompts.map((prompt) => ({ type: "prompt-ingested", contract: "builder", role: "builder", prompt })),
    ),
  );
  // Round 1 runs 00:00-01:00 and its accepted submit feeds battery 1, claimed at 01:30.
  // Round 2 runs 02:00-03:00 and feeds battery 2, claimed at 03:30.
  const rounds = [
    { start: Date.parse("2026-09-19T00:00:00.000Z"), trials: ["fail"] },
    { start: Date.parse("2026-09-19T02:00:00.000Z"), trials: ["pass", "pass"] },
  ];
  rounds.forEach((round, index) => {
    const epoch = join(dir, required(epochs[index], "epoch").key);
    const hour = 3_600_000;
    const submit: JsonObject = { outcome: "accepted", atMs: hour - 1_000 };
    const record: JsonObject = {
      schema: "builder-execution/v7",
      writtenAt: new Date(round.start + hour).toISOString(),
      durationMs: hour,
      customCalls: [
        ...round.trials.map((verdict, n) => ({
          tool: "harness_trial",
          action: "run",
          startedAtMs: 60_000 * (n + 1),
          semantic: { truthVerdict: verdict },
        })),
        // The second round opens the history and one trace before its first preview, another after.
        ...(index === 1
          ? [
              {
                tool: "context",
                action: "page",
                target: { contextId: "history/batteries" },
                startedAtMs: 1_000,
              },
              {
                tool: "context",
                action: "page",
                target: { contextId: `traces/${RUN}/t1/artifact` },
                startedAtMs: 2_000,
              },
              {
                tool: "context",
                action: "page",
                target: { contextId: `traces/${RUN}/t2/artifact` },
                startedAtMs: 40 * 60_000,
              },
            ]
          : []),
        { tool: "correctness_check", action: "run", startedAtMs: 30 * 60_000 },
        { tool: "submit", action: "submit", startedAtMs: hour - 1_000 },
      ],
      submits: [submit],
    };
    // An older record has no tool tally at all, so that shape omits the key.
    if (options.toolCalls !== false) record.toolCalls = { byName: { bash: 5 + index } };
    write(join(epoch, "builder-execution.json"), record);
    const at = (minutes: number) => new Date(round.start + minutes * 60_000).toISOString();
    writeText(
      join(epoch, "builder-path-record.jsonl"),
      jsonl([
        { capability: "read", at: at(1), resolved: `${epoch}/workspace/MEMORY.md` },
        { capability: "write", at: at(50), resolved: `${epoch}/workspace/MEMORY.md` },
      ]),
    );
  });
  const claims = [
    { runId: RUN, createdAt: "2026-09-19T01:30:00.000Z" },
    { runId: SECOND, createdAt: "2026-09-19T03:30:00.000Z" },
  ];
  for (const claim of claims) {
    write(join(dir, "claims", `${claim.runId}.json`), { schema: "run-claim/v1", ...claim });
  }
  write(join(dir, "difficulty-decisions", `${SECOND}-x.json`), {
    schema: "difficulty-decision/v10",
    difficulty: {
      rows: [
        { runId: RUN, passed: 1, verified: 3, unaccepted: 0, zone: "on-aim", operation: null },
        {
          runId: SECOND,
          passed: 3,
          verified: 3,
          unaccepted: 0,
          zone: "too-easy",
          operation: "evaluation-correction",
        },
      ],
    },
  });
  const disputed = issue("alpha", "the check reads an unpublished rule");
  write(join(dir, "analysis", `${RUN}-rebuild-advice.json`), {
    schema: "rebuild-advice/v4",
    issues: [disputed],
  });
  write(join(dir, "analysis", `${SECOND}-rebuild-advice.json`), {
    schema: "rebuild-advice/v4",
    issues: [{ ...disputed, retired: true, dispute: null }],
  });
  write(join(dir, "analysis", `${RUN}-epoch-review.json`), {
    status: "completed",
    findings: [{}],
    probes: [{ baseline: { outcome: "pass" }, movedCheckIds: [], refused: null }],
    disputes: [{ issueId: disputed.id, reason: "unpublished rule" }],
  });
  // The second battery's review no longer finds the first review's advisory defect.
  write(join(dir, "analysis", `${SECOND}-epoch-review.json`), {
    status: "completed",
    findings: [],
    earlierAdvisory: [{ owner: "correctness-model/tasks.json", subject: "span", disposition: "absent" }],
  });
  // An authoring review at 02:40, after round 2's preview (02:30) and before its submit (02:59).
  write(join(dir, "analysis", "authoring-01a0b788-f000-7000-8000-000000000000-epoch-review.json"), {});
  const cases = (battery: string, family: string, inputs: number[]) =>
    inputs.forEach((value, n) =>
      write(join(dir, "versions", battery, "runs", battery, "cases", `t-${n}`, "public-task.json"), {
        taskId: `t-${n}`,
        family,
        publicTask: { taskId: `t-${n}`, family, publicInput: { span: value } },
      }),
    );
  cases(RUN, "alpha", [1, 2]);
  cases(SECOND, "beta", [1, 2]);
  return dir;
}

it.each([
  [["a", "b"], ["b", "a"], "identical-tasks"],
  [["a", "b"], ["a", "c"], "partially-shared"],
  [["a"], ["a", "c"], "partially-shared"],
  [["a"], ["c"], "name-only"],
  [[], ["c"], "absent-before"],
  [["a"], [], "absent-after"],
] as const)("joins a family's tasks %p before and %p after as %s", (before, after, kind) => {
  expect(classifyFamily(before, after)).toBe(kind);
});

describe("round hand-offs", () => {
  const report = buildHandoffs({ campaign: campaign(), runId: RUN });

  it("counts a channel served but never read, and one read back through the path record", () => {
    expect(report.state).toBe("read");
    const census = required(report.census, "census");
    const second = required(census[1], "second round");
    const cell = (name: string) => second.channels.find((c: { name: string }) => c.name === name);
    expect(cell("rebuild-advice")).toMatchObject({ present: true, served: true, read: null });
    expect(cell("memory")).toMatchObject({ present: true, served: false, read: 1, acted: true });
    expect(cell("climb-readout")).toMatchObject({ served: true, read: 1, acted: null });
    // Both traces were opened through the context tool, and neither counts as reading the user's files.
    expect(cell("traces")).toMatchObject({ read: 2 });
    expect(cell("context")).toMatchObject({ read: 0 });
    expect(second.servedNotRead).toContainEqual(
      expect.objectContaining({ name: "rebuild-advice", readRoute: false }),
    );
    // The round's own battery review no longer finds the earlier review's defect. That is the
    // successor's disposition, reported as such; it is not an acted mark.
    expect(cell("epoch-review")).toMatchObject({ read: null, acted: null });
    expect(second.carriedDispositions).toEqual(["span absent"]);
    expect(census[0]?.carriedDispositions).toEqual([]);
    // The first round's prompt carries no readout, and its memory note was written, not handed on.
    expect(census[0]?.channels.find((c: { name: string }) => c.name === "climb-readout")?.served).toBe(false);
    expect(second.bashCalls).toBe(6);
  });

  it("reports each round's rehearsals and zone, and what was opened before the battery was authored", () => {
    const calibration = required(report.calibration, "calibration");
    expect(calibration.rounds[0]).toMatchObject({ battery: RUN, rehearsals: 1 });
    expect(calibration.rounds[0]).not.toHaveProperty("target");
    expect(calibration.rounds[1]).toMatchObject({
      battery: SECOND,
      rehearsalVerdicts: ["pass", "pass"],
      // The history page, one trace and both trials precede the first preview thirty minutes in.
      beforeAuthoring: { history: 1, rehearsals: 2, traceReads: 1 },
    });
    expect(calibration.rounds[1]).not.toHaveProperty("predictions");
    expect(calibration).toMatchObject({ onAim: 1, placed: 2 });
  });

  it("follows a disputed family to an evaluation correction and flags its retirement on names alone", () => {
    const triage = required(report.triage, "triage");
    const sameTask = required(report.sameTask, "sameTask");
    expect(triage.families).toEqual([
      expect.objectContaining({
        family: "alpha",
        status: `first seen ${RUN}, last seen ${RUN}, disputed`,
        adviceWithheld: true,
        triagedSide: "evaluation",
        successorOperation: "evaluation-correction",
        repairedNamedSide: true,
        review: expect.objectContaining({ unmovedProbes: 1, disputedThisIssue: true }),
      }),
    ]);
    expect(triage.timing).toEqual({
      previews: 2,
      previewsAfterReview: 0,
      submits: 2,
      submitsAfterReview: 1,
      firstFailingBattery: RUN,
      minutesToFirstReview: 70,
    });
    const pair = required(sameTask.pairs[0], "first pair");
    expect(pair.families).toEqual([
      { family: "alpha", join: "absent-after" },
      { family: "beta", join: "absent-before" },
    ]);
    expect(pair.renamedTasks).toBe(2);
    expect(pair.transitions).toEqual([
      expect.objectContaining({
        family: "alpha",
        from: `first seen ${RUN}, last seen ${RUN}, disputed`,
        to: `first seen ${RUN}, last seen ${RUN}, family left the task set`,
        onNamesAlone: true,
      }),
    ]);
    expect(sameTask.producer).toEqual({ issues: 2, familyKeyed: 2 });
    expect(renderHandoffs(report)).toContain("2 tasks reappear under another family name");
    expect(renderHandoffs(report)).toMatch(/served, no read route: round-facts .*; rebuild-advice/);
    expect(renderHandoffs(report)).toContain(
      "earlier review's advisory defects in this battery's review: span absent",
    );
  });

  it("reads an absent field as unobservable, never as zero", () => {
    const older = buildHandoffs({ campaign: campaign({ toolCalls: false }), runId: RUN });
    expect(required(older.census, "census")[0]?.bashCalls).toBeNull();
    expect(renderHandoffs(older)).toContain("bash unobservable");
  });

  it("refuses an execution record or a difficulty decision of another schema by name", () => {
    const stale = campaign();
    const record = join(stale, "epoch-aaaaaaaaaaaa", "builder-execution.json");
    write(record, { ...JSON.parse(readFileSync(record, "utf8")), schema: "builder-execution/v5" });
    expect(() => buildHandoffs({ campaign: stale, runId: RUN })).toThrow(
      "epoch-aaaaaaaaaaaa/builder-execution.json is not builder-execution/v7",
    );
    const unversioned = campaign();
    write(join(unversioned, "difficulty-decisions", `${SECOND}-x.json`), { difficulty: { rows: [] } });
    expect(() => buildHandoffs({ campaign: unversioned, runId: RUN })).toThrow(
      `difficulty-decisions/${SECOND}-x.json is not difficulty-decision/v10`,
    );
  });

  it("names the one round that reads no notes as the one that stays in its workspace", () => {
    // roundPrompt reads the notes whenever the workspace moved, which every measured round's
    // resumed session does, so a resumed session is not the gap.
    const source = readFileSync(join(import.meta.dir, "..", "src", "author", "builder-session.ts"), "utf8");
    expect(source).toContain("const moved = previous === null || previous.workspace !== input.workspace;");
    const memory = CHANNELS.find((channel) => channel.name === "memory");
    expect(memory?.alternative).toContain("stays in the same workspace");
    expect(memory?.alternative).not.toContain("resumed session");
  });

  it("refuses to invent a round for a campaign with neither epochs nor claims", () => {
    expect(buildHandoffs({ campaign: scratchDir("wri-handoffs-empty-"), runId: null })).toMatchObject({
      state: "empty",
    });
  });
});
