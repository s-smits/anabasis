import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject, JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { adviceIssueId } from "../src/author/rebuild-advice.ts";
import { required } from "./helpers/doubles.ts";
import {
  buildHandoffs,
  classifyFamily,
  renderHandoffs,
} from "../.claude/skills/whole-run-investigation/scripts/handoffs.mjs";

const RUN = "run-20260919T000000000Z-aaaaaa";
const SECOND = `${RUN}-i02`;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

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
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wri-handoffs-")));
  roots.push(root);
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
      "Climb readout (run): read starter-pack/difficulty-ladder.md",
      "Standing issues, largest first.",
      "Write EXPERIMENT.json before preview or submit as {...}",
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
    { start: Date.parse("2026-09-19T00:00:00.000Z"), trials: ["fail"], target: null },
    { start: Date.parse("2026-09-19T02:00:00.000Z"), trials: ["pass", "pass"], target: 1 },
  ];
  rounds.forEach((round, index) => {
    const epoch = join(dir, required(epochs[index], "epoch").key);
    const hour = 3_600_000;
    const submit: JsonObject = { outcome: "accepted", atMs: hour - 1_000 };
    if (round.target !== null) {
      submit.experimentProposal = { target: { comparator: "at-most", verifiedPasses: round.target } };
    }
    const record: JsonObject = {
      schema: "builder-execution/v5",
      writtenAt: new Date(round.start + hour).toISOString(),
      durationMs: hour,
      customCalls: [
        ...round.trials.map((verdict, n) => ({
          tool: "harness_trial",
          action: "run",
          startedAtMs: 60_000 * (n + 1),
          semantic: { truthVerdict: verdict },
        })),
        ...(index === 1 ? [{ tool: "harness_inspect", action: "history", startedAtMs: 1_000 }] : []),
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
        ...(index === 1
          ? [
              {
                capability: "read",
                at: at(2),
                resolved: `${epoch}/workspace/starter-pack/difficulty-ladder.md`,
              },
              { capability: "write", at: at(20), resolved: `${epoch}/workspace/EXPERIMENT.json` },
            ]
          : []),
      ]),
    );
    writeText(join(epoch, "workspace", "starter-pack", "difficulty-ladder.md"), "ladder");
  });
  const claims = [
    { runId: RUN, createdAt: "2026-09-19T01:30:00.000Z" },
    { runId: SECOND, createdAt: "2026-09-19T03:30:00.000Z" },
  ];
  for (const claim of claims) {
    write(join(dir, "claims", `${claim.runId}.json`), { schema: "run-claim/v1", ...claim });
  }
  write(join(dir, "difficulty-decisions", `${SECOND}-x.json`), {
    difficulty: {
      rows: [
        { runId: RUN, passed: 1, verified: 3, unaccepted: 0, zone: "on-aim", target: null, operation: null },
        {
          runId: SECOND,
          passed: 3,
          verified: 3,
          unaccepted: 0,
          zone: "too-easy",
          target: { result: "missed", missedBy: 2 },
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

describe("family joins", () => {
  it("separates identical, partial and name-only task sets", () => {
    expect(classifyFamily(["a", "b"], ["b", "a"])).toBe("identical-tasks");
    expect(classifyFamily(["a", "b"], ["a", "c"])).toBe("partially-shared");
    expect(classifyFamily(["a"], ["a", "c"])).toBe("partially-shared");
    expect(classifyFamily(["a"], ["c"])).toBe("name-only");
    expect(classifyFamily([], ["c"])).toBe("absent-before");
    expect(classifyFamily(["a"], [])).toBe("absent-after");
  });
});

describe("round hand-offs", () => {
  it("counts a channel served but never read, and one read back through the path record", () => {
    const report = buildHandoffs({ campaign: campaign(), runId: RUN });
    expect(report.state).toBe("read");
    const second = report.census[1];
    const cell = (name: string) => second.channels.find((c: { name: string }) => c.name === name);
    expect(cell("rebuild-advice")).toMatchObject({ present: true, served: true, read: null });
    expect(cell("ladder")).toMatchObject({ served: true, read: 1 });
    expect(cell("memory")).toMatchObject({ present: true, served: false, read: 1, acted: true });
    expect(cell("climb-readout")).toMatchObject({ served: true, read: 1, acted: true });
    expect(second.servedNotRead.map((u: { name: string }) => u.name)).toContain("rebuild-advice");
    expect(second.servedNotRead.map((u: { name: string }) => u.name)).not.toContain("ladder");
    // The first round's prompt carries no readout, and its memory note was written, not handed on.
    expect(report.census[0].channels.find((c: { name: string }) => c.name === "climb-readout").served).toBe(
      false,
    );
    expect(second.bashCalls).toBe(6);
  });

  it("reports the calibration error per round and what was opened before the battery was authored", () => {
    const calibration = required(
      buildHandoffs({ campaign: campaign(), runId: RUN }).calibration,
      "calibration",
    );
    expect(calibration.rounds[0]).toMatchObject({ battery: RUN, rehearsals: 1, target: null, error: null });
    expect(calibration.rounds[1]).toMatchObject({
      battery: SECOND,
      rehearsalVerdicts: ["pass", "pass"],
      target: { comparator: "at-most", verifiedPasses: 1 },
      error: 2,
      result: "missed",
      // The history call and both trials precede the proposal write twenty minutes into the round.
      beforeAuthoring: { history: 1, rehearsals: 2, traceReads: 0 },
      perTaskPredictions: null,
    });
    expect(calibration).toMatchObject({ errorTrend: "insufficient", onAim: 1, placed: 2 });
  });

  it("follows a disputed family to an evaluation correction and flags its retirement on names alone", () => {
    const report = buildHandoffs({ campaign: campaign(), runId: RUN });
    const triage = required(report.triage, "triage");
    const sameTask = required(report.sameTask, "sameTask");
    expect(triage.families).toEqual([
      expect.objectContaining({
        family: "alpha",
        status: "disputed",
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
    const [pair] = sameTask.pairs;
    expect(pair.families).toEqual([
      { family: "alpha", join: "absent-after" },
      { family: "beta", join: "absent-before" },
    ]);
    expect(pair.renamedTasks).toBe(2);
    expect(pair.transitions).toEqual([
      expect.objectContaining({ family: "alpha", from: "disputed", to: "retired", onNamesAlone: true }),
    ]);
    expect(sameTask.producer).toEqual({ issues: 2, familyKeyed: 2 });
    expect(renderHandoffs(report)).toContain("2 tasks reappear under another family name");
  });

  it("reads an absent field as unobservable, never as zero", () => {
    const report = buildHandoffs({ campaign: campaign({ toolCalls: false }), runId: RUN });
    expect(report.census[0].bashCalls).toBeNull();
    expect(renderHandoffs(report)).toContain("bash unobservable");
  });

  it("refuses to invent a round for a campaign with neither epochs nor claims", () => {
    const root = mkdtempSync(join(tmpdir(), "wri-handoffs-empty-"));
    roots.push(root);
    expect(buildHandoffs({ campaign: root, runId: null })).toMatchObject({ state: "empty" });
  });
});
