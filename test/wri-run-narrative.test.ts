import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { CASE_TRACE_SCHEMA } from "../src/backends/trace-capture.ts";
import { sha256 } from "../src/meta/digest.ts";
import { caseRecordRow } from "./helpers/case-record-row.ts";
import { CLASS_NAMES, type ProseRow, anchorVector, axis, writeSession } from "./helpers/prose-session.ts";
import { selectCampaignEpoch } from "../src/author/campaign-epoch.ts";
import {
  ADRIFT,
  DRIFT_RUN,
  consecutive,
  driftRuns,
} from "../.claude/skills/whole-run-investigation/classifier/prose-classify.mjs";
import {
  RESTATED_COSINE,
  buildNarrative,
  renderNarrative,
  uuidV7Ms,
} from "../.claude/skills/whole-run-investigation/classifier/run-narrative.mjs";
import {
  buildTimeline,
  classifyTimeline,
} from "../.claude/skills/whole-run-investigation/scripts/timeline.mjs";

const dirs: string[] = [];
const RUN = "r1";
const KICKOFF = "one line";
// The key is a digest of the epoch's binding, so every campaign opened with this kickoff shares it.
const EPOCH = selectCampaignEpoch(temp("hb4-epoch-key-"), { kickoff: KICKOFF }).key;
const OPENED = "2026-09-19T10:00:00.000Z";
const SESSION_MS = 60 * 60 * 1000;

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A stand-in for the model: an anchor lands on its own class axis, and any other text lands on the
 *  axis its own first word names, so a fixture says what it means in the text itself. A first word
 *  that names no class takes a fixed axis of its own, which is what makes two findings that open
 *  the same way read as one restated claim. */
const fakeEmbed = async (texts: string[]): Promise<number[][]> =>
  texts.map((text) => {
    const anchor = anchorVector(text);
    if (anchor !== undefined) return anchor;
    const word = text.split(" ")[0] ?? "";
    if (CLASS_NAMES.includes(word)) return axis(word);
    const sum = word.split("").reduce((total, character) => total + character.charCodeAt(0), 0);
    return CLASS_NAMES.map((_, at) => (at === sum % CLASS_NAMES.length ? 1 : 0));
  });

const STARTED = Date.parse(OPENED);
/** A UUIDv7 minted at `ms`: the leading 48 bits are the timestamp the reviewer's id carries. */
function uuidAt(ms: number, tail: string): string {
  const hex = ms.toString(16).padStart(12, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${tail}-8${tail}-${tail.repeat(4)}`;
}

/** One campaign holding one run, one Builder session and whatever reviews the caller names. */
function campaignWith(rows: ProseRow[], reviews: Array<{ atMs: number; claims: string[] }>): string {
  const campaign = temp("hb4-narrative-");
  mkdirSync(join(campaign, "controller", RUN), { recursive: true });
  writeFileSync(join(campaign, "controller", RUN, "opening.json"), JSON.stringify({ writtenAt: OPENED }));

  const { dir: epoch } = selectCampaignEpoch(campaign, { kickoff: KICKOFF });
  writeSession(epoch, 1, rows, {
    outcome: "recorded",
    durationMs: SESSION_MS,
    writtenAt: new Date(STARTED + SESSION_MS).toISOString(),
  });

  const analysis = join(campaign, "analysis");
  mkdirSync(analysis, { recursive: true });
  for (const [index, review] of reviews.entries()) {
    const id = uuidAt(STARTED + review.atMs, String(index + 1).repeat(3));
    writeFileSync(
      join(analysis, `authoring-${id}-epoch-review.json`),
      JSON.stringify({
        status: "completed",
        probes: [],
        findings: review.claims.map((claim) => ({
          kind: "harness-defect",
          proposedOwner: "tools-spec",
          claim,
        })),
      }),
    );
  }
  return campaign;
}

/** A case whose trace bytes match the digest the case record publishes, so the census reads it. */
function withCase(campaign: string, taskId: string, previews: string[], window: [string, string]): void {
  const dir = join(campaign, "versions", "v1", "runs", RUN, "cases", taskId);
  mkdirSync(dir, { recursive: true });
  const trace = JSON.stringify({
    schema: CASE_TRACE_SCHEMA,
    turns: previews.map((preview, index) => ({
      turn: index + 1,
      assistantChars: preview.length,
      assistantPreview: preview,
      status: "ended",
    })),
    toolCalls: [],
  });
  writeFileSync(join(dir, "trace.json"), trace);
  const row = caseRecordRow(taskId, "f", {
    runId: RUN,
    truthOk: false,
    pass: false,
    solverStartedAt: window[0],
    solverEndedAt: window[1],
    traces: [{ path: `runs/${RUN}/cases/${taskId}/trace.json`, sha256: sha256(trace) }],
  });
  writeFileSync(join(campaign, "case-record.jsonl"), `${JSON.stringify({ seq: 1, row })}\n`);
}

/** A classified narrative's slots. A run that left no prose has none, and here that is a failure. */
function slotsOf(narrative: Awaited<ReturnType<typeof buildNarrative>>) {
  if (narrative.slots === null) throw new Error(`expected a classified narrative, got ${narrative.state}`);
  return narrative.slots;
}

describe("consecutive stretches", () => {
  it("names maximal runs of one kind and keeps the two drift kinds apart", () => {
    const units = [
      { class: "planning", lowMargin: false },
      ...Array.from({ length: 5 }, () => ({ class: "uncertain", lowMargin: false })),
      { class: "editing", lowMargin: false },
      ...Array.from({ length: 6 }, () => ({ class: "confident", lowMargin: true })),
    ];
    const found = driftRuns(units);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ kind: "adrift", from: 1, to: 5, length: 5 });
    expect(found[1]).toMatchObject({ kind: "unreadable", from: 7, to: 12, length: 6 });
    // A low-margin row is the classifier failing, so it never also counts as an adrift row.
    expect(found[0]?.classes.every((name: string) => ADRIFT.has(name))).toBe(true);
    expect(driftRuns(units.slice(0, 5))).toEqual([]);
    expect(consecutive(units, (unit: { class: string }) => unit.class === "uncertain", 6)).toEqual([]);
    expect(DRIFT_RUN).toBe(5);
  });

  it("reads a review id's own mint time out of its UUIDv7", () => {
    expect(uuidV7Ms("01a0ac65-9249-7115-a4e3-936d78f45429")).toBe(Date.parse("2026-09-16T22:45:32.873Z"));
    expect(uuidV7Ms(uuidAt(STARTED, "111"))).toBe(STARTED);
  });
});

describe("run narrative", () => {
  it("places every slot on the run clock and names the stretch where the Builder stopped progressing", async () => {
    const rows: ProseRow[] = [
      { turn: 1, atMs: 0, text: "intro reading the starter" },
      { turn: 1, atMs: 60_000, text: "planning the task families" },
      ...Array.from({ length: 5 }, (_, index) => ({
        turn: 2,
        atMs: 120_000 + index * 60_000,
        text: `uncertain attempt ${index + 1}`,
      })),
      { turn: 3, atMs: 480_000, text: "submitting the candidate" },
    ];
    const campaign = campaignWith(rows, [
      { atMs: 300_000, claims: ["alpha the writer tool cannot express a null"] },
      {
        atMs: 900_000,
        claims: ["alpha the writer tool still cannot express a null", "beta the brief omits the units"],
      },
    ]);
    withCase(
      campaign,
      "t-01",
      ["blocked-environment the toolchain is missing", "blocked-environment still missing"],
      ["2026-09-19T10:20:00.000Z", "2026-09-19T10:35:00.000Z"],
    );

    const narrative = await buildNarrative({ campaign, runId: RUN, embed: fakeEmbed });
    expect(narrative.state).toBe("classified");
    expect(narrative.calibration).toMatchObject({ driftRun: 5, restatedCosine: RESTATED_COSINE });

    const slots = slotsOf(narrative);
    const [session] = slots.builder.sessions;
    expect(session).toMatchObject({
      where: `${EPOCH}/s01`,
      anchor: "execution-record",
      startedMs: STARTED,
      endedMs: STARTED + SESSION_MS,
      dominant: "uncertain",
    });
    expect(session.units[0]).toMatchObject({
      sequence: 1,
      turn: 1,
      offsetMs: 0,
      atMs: STARTED,
      class: "intro",
    });
    expect(session.units[2].atMs).toBe(STARTED + 120_000);

    // The solve turn carries no time of its own, so its unit is placed by the case window alone.
    const [entry] = slots.built.cases;
    expect(entry).toMatchObject({
      taskId: "t-01",
      outcome: "verified",
      dominant: "blocked-environment",
      startedMs: Date.parse("2026-09-19T10:20:00.000Z"),
    });
    expect(entry.units.map((unit: { atMs: number | null; turn: number }) => [unit.atMs, unit.turn])).toEqual([
      [null, 1],
      [null, 2],
    ]);

    expect(
      slots.review.reviews.map((review: { where: string; repeats: number }) => [
        review.where,
        review.repeats,
      ]),
    ).toEqual([
      [`${EPOCH}/s01`, 0],
      [`${EPOCH}/s01`, 1],
    ]);
    expect(slots.review.units).toBe(3);

    expect(narrative.drift).toHaveLength(1);
    expect(narrative.drift[0]).toMatchObject({
      slot: "builder",
      where: `${EPOCH}/s01`,
      kind: "adrift",
      length: 5,
      from: { sequence: 3, turn: 2, atMs: STARTED + 120_000 },
      to: { sequence: 7, turn: 2, atMs: STARTED + 360_000 },
    });
    expect(renderNarrative(narrative)).toContain(`builder ${EPOCH}/s01 adrift x5`);
  });

  it("names a stretch of restated review findings at the run the operator asks for", async () => {
    const campaign = campaignWith(
      [{ turn: 1, atMs: 0, text: "editing the evaluator" }],
      [
        { atMs: 300_000, claims: ["alpha the writer tool cannot express a null"] },
        { atMs: 900_000, claims: ["alpha the writer tool cannot express a null either"] },
        { atMs: 1_500_000, claims: ["alpha the writer tool remains unable to express a null"] },
      ],
    );
    const narrative = await buildNarrative({ campaign, runId: RUN, embed: fakeEmbed, run: 2 });
    expect(slotsOf(narrative).review.reviews.map((review: { repeats: number }) => review.repeats)).toEqual([
      0, 1, 1,
    ]);
    expect(
      narrative.drift.map((entry: { slot: string; kind: string; length: number }) => [
        entry.slot,
        entry.kind,
        entry.length,
      ]),
    ).toEqual([["review", "restated", 2]]);
    expect(narrative.drift[0]?.from.atMs).toBe(STARTED + 900_000);
  });

  it("returns the classifier's own state when a run left no prose, and reads no model to say so", async () => {
    const campaign = campaignWith([], []);
    const narrative = await buildNarrative({ campaign, runId: RUN, embed: fakeEmbed });
    expect(narrative).toMatchObject({ state: "no-prose", slots: null, drift: [] });
    expect(renderNarrative(narrative)).toBe(`run ${RUN}: the run has no classifiable prose (no-prose)`);
    await expect(buildNarrative({ campaign, runId: "../escape", embed: fakeEmbed })).rejects.toThrow(
      "invalid run selector",
    );
  });
});

describe("timeline with the narrative attached", () => {
  it("resolves each stretch to the phase the run held at that moment", async () => {
    const rows: ProseRow[] = [
      ...Array.from({ length: 5 }, (_, index) => ({
        turn: 1,
        atMs: 600_000 + index * 60_000,
        text: `uncertain attempt ${index + 1}`,
      })),
      { turn: 2, atMs: 1_200_000, text: "submitting the candidate" },
    ];
    const campaign = campaignWith(rows, []);
    mkdirSync(join(campaign, "observability"), { recursive: true });
    const stream = [
      {
        schema: "ana-observation/v2",
        runId: RUN,
        id: `${RUN}:1`,
        seq: 1,
        type: "phase-transition",
        at: OPENED,
        phase: "input",
      },
      {
        schema: "ana-observation/v2",
        runId: RUN,
        id: `${RUN}:2`,
        seq: 2,
        type: "phase-transition",
        at: "2026-09-19T10:05:00.000Z",
        phase: "build",
      },
      {
        schema: "ana-observation/v2",
        runId: RUN,
        id: `${RUN}:3`,
        seq: 3,
        type: "phase-transition",
        at: "2026-09-19T10:50:00.000Z",
        phase: "measure-on",
      },
    ];
    writeFileSync(
      join(campaign, "observability", `${RUN}.jsonl`),
      `${stream.map((row) => JSON.stringify(row)).join("\n")}\n`,
    );

    const timeline = buildTimeline({ campaign, runId: RUN });
    expect(timeline.transitions?.map((mark: { phase: string }) => mark.phase)).toEqual([
      "input",
      "build",
      "measure-on",
    ]);
    const classified = await classifyTimeline(timeline, { campaign, runId: RUN, embed: fakeEmbed });
    expect(classified.narrative.drift).toHaveLength(1);
    expect(classified.narrative.drift[0]).toMatchObject({ slot: "builder", kind: "adrift", phase: "build" });
    expect(classified.phases).toEqual(timeline.phases);
    expect(renderNarrative(classified.narrative)).toContain("[phase build]");
  });

  it("skips an observation stream this reader cannot accept instead of failing the whole lane", () => {
    const campaign = temp("hb4-narrative-");
    mkdirSync(join(campaign, "observability"), { recursive: true });
    writeFileSync(
      join(campaign, "observability", `${RUN}.jsonl`),
      `${JSON.stringify({ schema: "ana-observation/v1", runId: RUN })}\n`,
    );
    const timeline = buildTimeline({ campaign, runId: RUN });
    expect(timeline.state).toBe("unavailable");
    expect(timeline.reason).toContain("misshapen observation row");
    expect(timeline.inputs[0]?.sha256).not.toBeNull();
  });
});
