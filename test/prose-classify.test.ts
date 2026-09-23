import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
// biome-ignore format: the directive below only reaches the specifier while this import is one line
// @ts-expect-error plain-JS skill script without type declarations
import { ANCHOR_SHA256, CLASSES, EVIDENCE_FLOOR, TRANSFORMERS_VERSION, classifyTarget, excerptOf, gradeEvidence, parseArgs, renderPosture, segmentsOf, solvePosture, submitPosture, summarise } from "../.claude/skills/whole-run-investigation/classifier/prose-classify.mjs";
// biome-ignore format: the directive below only reaches the specifier while this import is one line
// @ts-expect-error plain-JS skill script without type declarations
import { caseOutcome, censusSolves, hasCaseRecord } from "../.claude/skills/whole-run-investigation/classifier/solve-input.mjs";
// biome-ignore format: the directive below only reaches the specifier while this import is one line
// @ts-expect-error plain-JS skill script without type declarations
import { buildPriors, renderPriors } from "../.claude/skills/whole-run-investigation/classifier/posture-priors.mjs";

const dirs: string[] = [];
const classEntries: Array<[string, string[]]> = Object.entries(CLASSES);
const anchorClass = new Map<string, number>();
type Submit = { kind: string; turn: number; atMs: number; outcome: string; stage?: string | null };
type Row = { turn: number; atMs: number; kind: "message" | "reasoning"; text: string };
/**
 * The execution-record fields a test may override; the session outcome decides whether its rows
 * count as evidence.
 */
type Execution = { outcome: string };

const ROWS: Row[] = [
  { turn: 1, atMs: 1000, kind: "reasoning", text: "row one: planning" },
  { turn: 1, atMs: 2000, kind: "message", text: "row two: diagnosing" },
  { turn: 1, atMs: 3000, kind: "reasoning", text: "row three: disputing" },
  { turn: 1, atMs: 5000, kind: "reasoning", text: "**Running tests** **Removing the advisor**" },
  { turn: 1, atMs: 9000, kind: "message", text: "row five:   after the\nlast submit" },
];
const SUBMITS: Submit[] = [
  { kind: "candidate", turn: 1, atMs: 3500, outcome: "refused", stage: "bundle" },
  { kind: "controller-terminal", turn: 1, atMs: 3600, outcome: "refused" },
  { kind: "candidate", turn: 1, atMs: 6000, outcome: "accepted", stage: null },
];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const classNames = classEntries.map(([name]) => name);
for (const [index, [, anchors]] of classEntries.entries()) {
  for (const text of anchors) anchorClass.set(text, index);
}

/** A stand-in for the model: each anchor lands on its class axis, a row lands where its fixture says. */
function fakeEmbed(rows: Map<string, number[]>): (texts: string[]) => Promise<number[][]> {
  return async (texts) =>
    texts.map((text) => {
      const index = anchorClass.get(text);
      if (index !== undefined) return classNames.map((_, at) => (at === index ? 1 : 0));
      const fixture = rows.get(text);
      if (fixture === undefined) throw new Error(`no fixture vector for: ${text}`);
      return fixture;
    });
}

function axis(name: string): number[] {
  return classNames.map((candidate) => (candidate === name ? 1 : 0));
}

function writeEpoch(rows: Row[], submits: Submit[], extra: Partial<Execution> = {}): string {
  const epochDir = temp("hb4-posture-");
  const captureId = "6f1d2c3b-4a5e-4f60-8b71-9c0d1e2f3a4b";
  const header = {
    schema: "builder-prose-capture/v1",
    captureId,
    file: "builder-prose.jsonl",
    executionFile: "builder-execution.json",
    rows: rows.length,
    omitted: 0,
  };
  const lines = rows.map((row, index) => ({
    schema: "builder-prose/v1",
    sequence: index + 1,
    ...row,
    chars: row.text.length,
    truncated: false,
  }));
  writeFileSync(
    join(epochDir, "builder-prose.jsonl"),
    `${[header, ...lines].map((line) => JSON.stringify(line)).join("\n")}\n`,
  );
  writeFileSync(
    join(epochDir, "builder-execution.json"),
    JSON.stringify({
      schema: "builder-execution/v5",
      proseCapture: {
        schema: "builder-prose-capture/v1",
        captureId,
        file: "builder-prose.jsonl",
        rows: rows.length,
        omitted: 0,
      },
      proseOmitted: 0,
      submits,
      ...extra,
    }),
  );
  return epochDir;
}

const VECTORS = new Map<string, number[]>([
  ["row one: planning", axis("planning")],
  ["row two: diagnosing", axis("diagnosing")],
  // Nearly equidistant from two classes: a low-margin label.
  [
    "row three: disputing",
    classNames.map((name) => (name === "disputing-verifier" ? 0.72 : name === "diagnosing" ? 0.69 : 0)),
  ],
  ["Running tests", axis("running-checks")],
  ["Removing the advisor", axis("workaround")],
  ["row five:   after the\nlast submit", axis("reporting-status")],
]);

describe("prose posture classifier", () => {
  it("pins the same transformers release as the root package.json", async () => {
    const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json();
    expect(manifest.dependencies["@huggingface/transformers"]).toBe(TRANSFORMERS_VERSION);
  });

  it("splits a headline run into segments and keeps a prose row whole", () => {
    expect(segmentsOf("**Running tests** **Removing the advisor**")).toEqual([
      "Running tests",
      "Removing the advisor",
    ]);
    expect(segmentsOf("The **schema** is fine; I will submit now and explain the result at length.")).toEqual(
      ["The **schema** is fine; I will submit now and explain the result at length."],
    );
    expect(excerptOf("**Running tests**\n  after   regeneration", 20)).toBe("Running tests after ");
  });

  it("labels rows by their last segment, keeps text out of rows and joins labels, reactions and excerpts to each submit", async () => {
    const epochDir = writeEpoch(ROWS, SUBMITS);
    const result = await classifyTarget(epochDir, {
      embed: fakeEmbed(VECTORS),
      window: 2,
      priorsFile: join(epochDir, "none.json"),
    });
    expect(result.state).toBe("classified");
    expect(result.model.embed).toBe("injected");
    expect(result.calibration.priors).toEqual({ state: "absent" });
    expect(
      result.rows.map((row: { class: string; lowMargin: boolean; segments: number }) => [
        row.class,
        row.lowMargin,
        row.segments,
      ]),
    ).toEqual([
      ["planning", false, 1],
      ["diagnosing", false, 1],
      ["disputing-verifier", true, 1],
      ["workaround", false, 2],
      ["reporting-status", false, 1],
    ]);
    expect(result.rows[3].segmentClasses).toEqual(["running-checks", "workaround"]);
    expect(result.rows.every((row: { text?: string }) => row.text === undefined)).toBe(true);
    expect("rows" in result.input).toBe(false);
    // The controller-terminal row is not a submit; the second candidate sees only rows since the first.
    expect(
      result.submits.map(
        (submit: {
          outcome: string;
          rowsSincePrevious: number;
          dominant: string;
          recent: Array<{ class: string; excerpt: string }>;
          after: { rows: number; dominant: string | null };
          repeatsRefusedPosture: boolean;
        }) => [
          submit.outcome,
          submit.rowsSincePrevious,
          submit.dominant,
          submit.recent.map((row) => row.class),
          submit.after,
          submit.repeatsRefusedPosture,
        ],
      ),
    ).toEqual([
      [
        "refused",
        3,
        "diagnosing",
        ["diagnosing", "disputing-verifier"],
        { rows: 1, dominant: "workaround" },
        false,
      ],
      ["accepted", 1, "workaround", ["workaround"], { rows: 1, dominant: "reporting-status" }, false],
    ]);
    expect(result.submits[1].recent[0].excerpt).toBe("Running tests Removing the advisor");
    expect(result.summary.find((row: { class: string }) => row.class === "disputing-verifier")).toEqual({
      class: "disputing-verifier",
      count: 1,
      reasoning: 1,
      message: 0,
      solve: 0,
      meanChars: 20,
      lowMargin: 1,
    });
    expect(result.sessions).toHaveLength(1);
    const text = renderPosture(result).join("\n");
    expect(text).toContain(
      "refused (bundle): 3 rows since previous, dominant diagnosing, recent diagnosing → disputing-verifier?",
    );
    expect(text).toContain("after: 1 rows, dominant workaround");
    expect(text).toContain("#3 disputing-verifier?: row three: disputing");
    expect(text).toContain("[running-checks → workaround]");
  });

  it("attaches corpus priors bound to the anchor digest and marks other priors stale", async () => {
    const epochDir = writeEpoch(ROWS, SUBMITS);
    const table = { diagnosing: { accepted: 2, refused: 6, refusedRate: 0.75 } };
    const current = join(epochDir, "current.json");
    writeFileSync(
      current,
      JSON.stringify({
        anchorSha256: ANCHOR_SHA256,
        corpus: { campaigns: 3 },
        byDominant: table,
        byLast: {},
      }),
    );
    const applied = await classifyTarget(epochDir, { embed: fakeEmbed(VECTORS), priorsFile: current });
    expect(applied.calibration.priors).toEqual({ state: "applied", corpus: { campaigns: 3 } });
    expect(applied.submits[0].prior).toEqual({ table: "pooled", dominant: table.diagnosing, last: null });
    expect(renderPosture(applied).join("\n")).toContain(
      "prior (pooled table): dominant 6/8 refused in corpus; last label no corpus row",
    );
    // A backend table wins over the pooled one when the execution record names that backend.
    const scoped = join(epochDir, "scoped.json");
    writeFileSync(
      scoped,
      JSON.stringify({
        anchorSha256: ANCHOR_SHA256,
        corpus: {},
        byDominant: table,
        byLast: {},
        byBackend: {
          codex: { dominant: { diagnosing: { accepted: 1, refused: 0, refusedRate: 0 } }, last: {} },
        },
      }),
    );
    const record = JSON.parse(await Bun.file(join(epochDir, "builder-execution.json")).text());
    writeFileSync(join(epochDir, "builder-execution.json"), JSON.stringify({ ...record, backend: "codex" }));
    const own = await classifyTarget(epochDir, { embed: fakeEmbed(VECTORS), priorsFile: scoped });
    expect(own.submits[0].prior).toEqual({
      table: "codex",
      dominant: { accepted: 1, refused: 0, refusedRate: 0 },
      last: null,
    });
    const stale = join(epochDir, "stale.json");
    writeFileSync(
      stale,
      JSON.stringify({
        anchorSha256: "0".repeat(64),
        corpus: { campaigns: 1 },
        byDominant: table,
        byLast: {},
      }),
    );
    const ignored = await classifyTarget(epochDir, { embed: fakeEmbed(VECTORS), priorsFile: stale });
    expect(ignored.calibration.priors).toEqual({ state: "stale", corpus: { campaigns: 1 } });
    expect("prior" in ignored.submits[0]).toBe(false);
  });

  it("reports an epoch without captured prose as no-prose instead of classifying", async () => {
    const epochDir = temp("hb4-posture-");
    mkdirSync(join(epochDir, "epoch-0123456789ab"));
    writeFileSync(
      join(epochDir, "epoch-0123456789ab", "builder-execution.json"),
      JSON.stringify({ schema: "builder-execution/v5", proseOmitted: 0, submits: [] }),
    );
    const result = await classifyTarget(epochDir, { embed: fakeEmbed(new Map()) });
    expect(result.state).toBe("no-prose");
    expect(result.input.totals.unavailable).toBe(1);
    expect(renderPosture(result)[0]).toBe("no-prose: 1 sessions, 0 prose rows");
  });

  it("orders submits by their own session clock, tolerates a submit with no rows and flags a repeated refused posture", () => {
    const row = (sequence: number, atMs: number, cls: string) => ({
      epoch: "e",
      session: 1,
      sequence,
      turn: 1,
      atMs,
      kind: "message",
      class: cls,
      lowMargin: false,
      chars: 5,
    });
    const submit = (atMs: number, outcome: string) => ({
      epoch: "e",
      session: 1,
      turn: 1,
      atMs,
      outcome,
      stage: null,
    });
    const rows = [row(1, 10, "planning"), row(2, 30, "planning"), row(3, 50, "diagnosing")];
    const posture = submitPosture(
      rows,
      [submit(5, "refused"), submit(20, "refused"), submit(40, "refused"), submit(60, "accepted")],
      5,
    );
    expect(
      posture.map(
        (entry: { rowsSincePrevious: number; dominant: string | null; repeatsRefusedPosture: boolean }) => [
          entry.rowsSincePrevious,
          entry.dominant,
          entry.repeatsRefusedPosture,
        ],
      ),
    ).toEqual([
      [0, null, false],
      [1, "planning", false],
      [1, "planning", true],
      [1, "diagnosing", false],
    ]);
    expect(summarise([])).toEqual([]);
  });

  it("builds priors from every campaign's submits under each submit's own backend", async () => {
    const root = temp("hb4-priors-");
    // The opening names codex, but the submits' own records name both: the records win.
    for (const name of ["alpha", "beta", "gamma"]) {
      mkdirSync(join(root, name, "controller", "run-1"), { recursive: true });
    }
    writeFileSync(
      join(root, "alpha", "controller", "run-1", "opening.json"),
      JSON.stringify({ modelSlots: { builder: { kind: "codex" } } }),
    );
    mkdirSync(join(root, "loose-file-holder"));
    type Labelled = { class: string; kind: "reasoning" | "message"; lowMargin: boolean };
    type Joined = {
      outcome: string | null;
      backend: string | null;
      dominant: string;
      recent: Array<{ class: string }>;
    };
    type Fake = { state: string; rows?: Labelled[]; submits?: Joined[] };
    const results = new Map<string, Fake>([
      [
        "alpha",
        {
          state: "classified",
          rows: [{ class: "planning", kind: "reasoning", lowMargin: false }],
          submits: [
            { outcome: "refused", backend: "codex", dominant: "planning", recent: [{ class: "submitting" }] },
            {
              outcome: "accepted",
              backend: "claude",
              dominant: "planning",
              recent: [{ class: "submitting" }],
            },
            { outcome: null, backend: "codex", dominant: "planning", recent: [] },
          ],
        },
      ],
      [
        "beta",
        {
          state: "classified",
          rows: [{ class: "workaround", kind: "message", lowMargin: true }],
          submits: [{ outcome: "refused", backend: null, dominant: "workaround", recent: [] }],
        },
      ],
      ["gamma", { state: "no-prose" }],
    ]);
    const classify = async (campaign: string) => results.get(campaign.slice(campaign.lastIndexOf("/") + 1));
    const priors = await buildPriors(root, { classify });
    expect(priors.anchorSha256).toBe(ANCHOR_SHA256);
    expect(priors.corpus).toMatchObject({
      campaigns: 3,
      states: { classified: 2, "no-prose": 1 },
      byBackend: { codex: 2, claude: 1, unknown: 1 },
      rows: 2,
      submits: 4,
    });
    expect(priors.byDominant).toEqual({
      planning: { accepted: 1, refused: 1, refusedRate: 0.5 },
      workaround: { accepted: 0, refused: 1, refusedRate: 1 },
    });
    expect(priors.byLast).toEqual({ submitting: { accepted: 1, refused: 1, refusedRate: 0.5 } });
    expect(priors.byBackend).toEqual({
      claude: {
        dominant: { planning: { accepted: 1, refused: 0, refusedRate: 0 } },
        last: { submitting: { accepted: 1, refused: 0, refusedRate: 0 } },
      },
      codex: {
        dominant: { planning: { accepted: 0, refused: 1, refusedRate: 1 } },
        last: { submitting: { accepted: 0, refused: 1, refusedRate: 1 } },
      },
    });
    expect(priors.perClass.workaround).toEqual({
      rows: 1,
      reasoning: 0,
      message: 1,
      lowMargin: 1,
      lowMarginRate: 1,
    });
    expect(renderPriors(priors).join("\n")).toContain("workaround: refused 1/1 (100%)");
    // Campaign order changes nothing: swapping which campaign holds which submits gives the same tables.
    const swapped = new Map([
      ["alpha", results.get("beta")!],
      ["beta", results.get("alpha")!],
      ["gamma", results.get("gamma")!],
    ]);
    const reordered = await buildPriors(root, {
      classify: async (campaign: string) => swapped.get(campaign.slice(campaign.lastIndexOf("/") + 1)),
    });
    expect(reordered.byBackend).toEqual(priors.byBackend);
    expect(reordered.corpus.byBackend).toEqual(priors.corpus.byBackend);
  });

  it("scopes a campaign to the sessions one run started, including a shared epoch", async () => {
    const campaign = temp("hb4-run-scope-");
    const epoch = join(campaign, "epoch-0123456789ab");
    mkdirSync(epoch);
    const open = (runId: string, writtenAt: string) => {
      mkdirSync(join(campaign, "controller", runId), { recursive: true });
      writeFileSync(
        join(campaign, "controller", runId, "opening.json"),
        JSON.stringify({ runId, writtenAt }),
      );
    };
    const session = (n: number, text: string, writtenAt: string, durationMs: number, submit: Submit) => {
      const suffix = n === 1 ? "" : `-${String(n).padStart(2, "0")}`;
      const captureId = `6f1d2c3b-4a5e-4f60-8b71-9c0d1e2f3a4${String(n)}`;
      const file = `builder-prose${suffix}.jsonl`;
      const executionFile = `builder-execution${suffix}.json`;
      const header = {
        schema: "builder-prose-capture/v1",
        captureId,
        file,
        executionFile,
        rows: 1,
        omitted: 0,
      };
      const row = {
        schema: "builder-prose/v1",
        sequence: 1,
        turn: 1,
        atMs: 1000,
        kind: "message",
        text,
        chars: text.length,
        truncated: false,
      };
      writeFileSync(join(epoch, file), `${JSON.stringify(header)}\n${JSON.stringify(row)}\n`);
      writeFileSync(
        join(epoch, executionFile),
        JSON.stringify({
          schema: "builder-execution/v5",
          backend: "codex",
          writtenAt,
          durationMs,
          proseCapture: { schema: "builder-prose-capture/v1", captureId, file, rows: 1, omitted: 0 },
          proseOmitted: 0,
          submits: [submit],
        }),
      );
    };
    const vectors = new Map([
      ["run A planning", axis("planning")],
      ["run B workaround", axis("workaround")],
    ]);
    open("run-a", "2026-09-14T00:00:00.000Z");
    // A's session started at 00:10 but its last checkpoint landed after B opened.
    session(1, "run A planning", "2026-09-14T01:30:00.000Z", 80 * 60_000, {
      kind: "candidate",
      turn: 1,
      atMs: 2000,
      outcome: "refused",
      stage: "bundle",
    });
    const before = await classifyTarget(campaign, { embed: fakeEmbed(vectors), runId: "run-a" });
    open("run-b", "2026-09-14T01:00:00.000Z");
    session(2, "run B workaround", "2026-09-14T01:40:00.000Z", 30 * 60_000, {
      kind: "candidate",
      turn: 1,
      atMs: 2000,
      outcome: "accepted",
      stage: null,
    });
    const after = await classifyTarget(campaign, { embed: fakeEmbed(vectors), runId: "run-a" });
    expect(after.state).toBe("classified");
    expect(after.summary).toEqual(before.summary);
    expect(after.submits).toEqual(before.submits);
    expect(after.input.scope).toEqual({
      kind: "run",
      runId: "run-a",
      otherRunSessions: 1,
      unattributedSessions: 0,
    });
    const b = await classifyTarget(campaign, { embed: fakeEmbed(vectors), runId: "run-b" });
    expect(b.rows.map((row: { class: string }) => row.class)).toEqual(["workaround"]);
    expect(b.submits.map((submit: { outcome: string }) => submit.outcome)).toEqual(["accepted"]);
    const whole = await classifyTarget(campaign, { embed: fakeEmbed(vectors) });
    expect(whole.input.scope).toEqual({ kind: "campaign" });
    expect(whole.rows).toHaveLength(2);
    await expect(classifyTarget(campaign, { embed: fakeEmbed(vectors), runId: "run-c" })).rejects.toThrow(
      "no opening for run run-c",
    );
  });

  it("grades a reading against the row floor instead of calling four rows classified", () => {
    const thin = Array.from({ length: 4 }, () => ({ lowMargin: false }));
    const wide = Array.from({ length: EVIDENCE_FLOOR.rows }, () => ({ lowMargin: false }));
    const blurred = wide.map((row, index) => ({ ...row, lowMargin: index <= EVIDENCE_FLOOR.rows / 2 }));
    expect(gradeEvidence([], "Builder").grade).toBe("empty");
    expect(gradeEvidence(thin, "Builder")).toMatchObject({
      grade: "thin",
      rows: 4,
      reasons: [`4 classified Builder rows, under the ${EVIDENCE_FLOOR.rows}-row floor`],
    });
    expect(gradeEvidence(wide, "Builder")).toMatchObject({ grade: "sufficient", lowMargin: 0, reasons: [] });
    expect(gradeEvidence(blurred, "solver").grade).toBe("thin");
  });

  it("reads no posture from a session the controller closed as a typed non-result", async () => {
    // Run truss-opus-20260916T151117729Z-064960 captured one row in its second epoch: the
    // provider's own "You've hit your session limit". v4 labelled it as Builder reasoning.
    const limit = "You've hit your session limit · resets 8:50pm (Europe/Amsterdam)";
    const dir = writeEpoch([{ turn: 1, atMs: 10, kind: "message", text: limit }], [], {
      outcome: "turn-non-result",
    });
    const result = await classifyTarget(dir, {
      embed: fakeEmbed(new Map([[limit, axis("blocked-environment")]])),
    });
    expect(result.state).toBe("no-prose");
    expect(result.excludedNonResultRows).toBe(1);
    expect(result.input.totals.nonEvidenceSessions).toBe(1);
  });

  it("says from the tool record whether a correctness_check returned before each submit", () => {
    const rows = [
      {
        epoch: "e",
        session: 1,
        sequence: 1,
        atMs: 10,
        kind: "message",
        chars: 3,
        class: "planning",
        lowMargin: false,
      },
    ];
    const submits = [
      { epoch: "e", session: 1, turn: 1, atMs: 20, outcome: "refused" },
      { epoch: "e", session: 1, turn: 2, atMs: 60, outcome: "accepted" },
    ];
    const posture = submitPosture(rows, submits, 5, new Map(), [{ epoch: "e", session: 1, atMs: 40 }]);
    expect(posture.map((submit: { checkedSincePrevious: boolean }) => submit.checkedSincePrevious)).toEqual([
      false,
      true,
    ]);
  });

  it("reads the Built solver's own rows only from a trace whose bytes match the case record", () => {
    const campaign = temp("hb4-solves-");
    const caseDir = join(campaign, "versions", "v1", "runs", "r1", "cases");
    const write = (taskId: string, preview: string) => {
      mkdirSync(join(caseDir, taskId), { recursive: true });
      const trace = JSON.stringify({
        schema: "trace/v1",
        turns: [{ turn: 1, assistantChars: preview.length, assistantPreview: preview, status: "ended" }],
      });
      writeFileSync(join(caseDir, taskId, "trace.json"), trace);
      return new Bun.CryptoHasher("sha256").update(trace).digest("hex");
    };
    const good = write("t-pass", "All checks pass. Recording the artifact.");
    write("t-stale", "Diagnosing the refusal before retrying.");
    const record = [
      {
        schema: "case-record/v1",
        runId: "r1",
        taskId: "t-pass",
        family: "f",
        truthOk: true,
        pass: true,
        traces: [{ path: "runs/r1/cases/t-pass/trace.json", sha256: good }],
      },
      {
        schema: "case-record/v1",
        runId: "r1",
        taskId: "t-stale",
        family: "f",
        truthOk: null,
        pass: null,
        traces: [{ path: "runs/r1/cases/t-stale/trace.json", sha256: "0".repeat(64) }],
      },
      {
        schema: "case-record/v1",
        runId: "r1",
        taskId: "t-cut",
        family: "f",
        truthOk: null,
        pass: null,
        runtimeNonResultKind: "provider",
        traces: [],
      },
      {
        schema: "case-record/v1",
        runId: "other",
        taskId: "t-elsewhere",
        family: "f",
        truthOk: true,
        pass: true,
        traces: [],
      },
    ];
    writeFileSync(
      join(campaign, "case-record.jsonl"),
      `${record.map((row) => JSON.stringify({ seq: 1, row })).join("\n")}\n`,
    );

    expect(hasCaseRecord(campaign)).toBe(true);
    expect(caseOutcome(record[2])).toBe("non-result");
    const census = censusSolves(campaign, { runId: "r1" });
    expect(census.ok).toBe(false);
    expect(census.issues).toEqual([
      "t-stale: the case trace on disk does not match the digest the case record published",
    ]);
    expect(census.totals).toMatchObject({
      cases: 3,
      verified: 1,
      unaccepted: 1,
      nonResult: 1,
      tracesRead: 1,
      rows: 1,
    });
    expect(census.rows.map((row: { taskId: string }) => row.taskId)).toEqual(["t-pass"]);
    const posture = solvePosture(
      [
        {
          taskId: "t-pass",
          outcome: "verified",
          kind: "solve-message",
          class: "confident",
          lowMargin: false,
          chars: 40,
        },
      ],
      census.cases,
    );
    expect(
      posture.byOutcome.map((entry: { outcome: string; dominant: string | null }) => [
        entry.outcome,
        entry.dominant,
      ]),
    ).toEqual([
      ["verified", "confident"],
      ["unaccepted", null],
      ["non-result", null],
    ]);
    expect(posture.cases[2]).toMatchObject({
      taskId: "t-cut",
      outcome: "non-result",
      nonResultKind: "provider",
      trace: "unlisted",
      rows: 0,
    });
  });

  it("scopes a run whose opening carries no parseable clock instead of refusing the whole reading", async () => {
    // The clock attributes sessions to their run; an opening without one still names a run that
    // exists, and the required view must report what it found rather than fail the snapshot.
    const campaign = temp("hb4-clockless-");
    mkdirSync(join(campaign, "controller", "44"), { recursive: true });
    writeFileSync(
      join(campaign, "controller", "44", "opening.json"),
      JSON.stringify({ runId: "44", source: { commit: "0".repeat(40) } }),
    );
    const result = await classifyTarget(campaign, { runId: "44", embed: fakeEmbed(new Map()) });
    expect(result.state).toBe("no-prose");
    expect(result.input).toMatchObject({
      ok: true,
      scope: { kind: "run", runId: "44", unattributedSessions: 0 },
      totals: { sessions: 0 },
    });
  });

  it("parses its options and refuses malformed ones", () => {
    expect(parseArgs(["/campaign", "--json", "--window", "3"])).toMatchObject({
      target: "/campaign",
      json: true,
      window: 3,
      minMargin: 0.5,
      batchSize: 16,
    });
    expect(parseArgs(["/campaign", "--run", "run-a"])).toMatchObject({ target: "/campaign", runId: "run-a" });
    expect(() => parseArgs(["/campaign", "--run"])).toThrow("--run needs a value");
    expect(() => parseArgs([])).toThrow("missing target");
    expect(() => parseArgs(["/campaign", "--window", "0"])).toThrow("--window must be a positive integer");
    expect(() => parseArgs(["/campaign", "--min-margin", "-1"])).toThrow("minimum margin");
    expect(() => parseArgs(["/campaign", "--batch"])).toThrow("--batch needs a value");
    expect(() => parseArgs(["/campaign", "--else"])).toThrow("unknown option: --else");
  });
});
