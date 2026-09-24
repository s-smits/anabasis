/**
 * What `outcomeReport` projects from a recorded campaign, and what it refuses to project.
 *
 * Every rule here needs a campaign tree on disk, because that is what the reader reads. The cost
 * is not the reading, it is writing the tree: a controller terminal is nine fields deep and most
 * rules differ from the ordinary one in exactly one of them. So one builder writes the tree a
 * controller would actually write, and each test states only its difference — `amend` for a field
 * a controller could have written, `drop` for evidence that never arrived. Nine tests here used to
 * spell out an all-zero denominator to say nothing about it; now they say nothing about it.
 *
 * The reader's own contract is that absence stays absent. A missing claim is null chronology, a
 * drifted trace is null telemetry, a missing bundle is a null census — never a zero, which would
 * read as a measurement that happened to come out empty.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { CASE_TRACE_SCHEMA } from "../src/backends/trace-capture.ts";
import { type CaseRecordRow, tracePointer } from "../src/claim/case-record.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import { type OutcomeMetrics, outcomeReport } from "../tools/outcome/metrics.ts";
import { MATCHING_BRIEF } from "./helpers/matching-fixture.ts";
import { caseRecordRow as baseRow } from "./helpers/case-record-row.ts";
import { ControllerLedger } from "../src/run/controller-ledger.ts";
import { LIMIT_MARGIN_PAIRING, LIMIT_MARGIN_SCHEMA, limitMarginFile } from "../src/run/limit-margin.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";

const RUN = "run-07";
const EPOCH = "epoch-000000000000";
const BUDGET = { turnBudget: null, turnsUsed: 0, status: "active" };

afterEach(cleanupScratch);

const SOURCE = { commit: "a".repeat(40), dirty: false, sourceDigest: "b".repeat(64) };
/** One recorded solve trace. `schema` is a parameter because a trace recorded before the recorder
 *  had a clock carries the older one and must still be read. */
function traceJson(toolNames: string[], turns: number, schema: string = CASE_TRACE_SCHEMA): string {
  return JSON.stringify({
    schema,
    backend: "claude",
    turns: Array.from({ length: turns }, (_, i) => ({ turn: i + 1 })),
    toolCalls: toolNames.map((toolName, i) => ({ seq: i + 1, turn: 1, toolName })),
    droppedRawEvents: 0,
    truncated: false,
  });
}

/** A campaign tree under a scratch root, at `campaigns/<name>` where the controller puts it, so the
 *  battery-record join derives its candidate paths inside the fixture and not beside the root. */
function campaign(prefix: string = "outcome-") {
  const root = scratchDir(prefix);
  const dir = join(root, "campaigns", "fixture");
  mkdirSync(join(dir, "traces"), { recursive: true });
  const terminalPath = join(dir, "controller", RUN, "terminal.json");
  const openingPath = join(dir, "controller", RUN, "opening.json");

  const write = (path: string, value: JsonValue): void => writeFileSync(path, JSON.stringify(value));

  return {
    root,
    dir,
    /** Write a trace and take its pointer; the digest binds these bytes, so rewriting the file
     *  afterwards is what drift looks like. */
    trace(name: string, toolNames: string[], turns: number, schema?: string) {
      writeFileSync(join(dir, "traces", `${name}.json`), traceJson(toolNames, turns, schema));
      return tracePointer(dir, `traces/${name}.json`);
    },
    rewriteTrace(name: string, toolNames: string[], turns: number): void {
      writeFileSync(join(dir, "traces", `${name}.json`), traceJson(toolNames, turns));
    },
    rows(...rows: CaseRecordRow[]): void {
      const lines = rows.map((row, i) => JSON.stringify({ seq: i + 1, row }));
      writeFileSync(join(dir, "case-record.jsonl"), rows.length === 0 ? "" : `${lines.join("\n")}\n`);
    },
    unreadableRows(): void {
      writeFileSync(join(dir, "case-record.jsonl"), "{not-json\n");
    },
    /** The opening and terminal a completed controller writes, for one round that did or did not
     *  measure a battery. The terminal carries no counts; the reader derives them from the rows. */
    controller(wasMeasured = false): void {
      mkdirSync(join(dir, "controller", RUN), { recursive: true });
      write(join(dir, "epochs.json"), {
        schema: "campaign-epochs/v1",
        current: EPOCH,
        epochs: [{ key: EPOCH }],
      });
      const opening = {
        schema: "campaign-opening/v2",
        runId: RUN,
        epoch: { key: EPOCH },
        source: SOURCE,
        continuation: null,
        abandonedRuns: [],
        budget: BUDGET,
      };
      write(openingPath, opening);
      write(terminalPath, {
        schema: "campaign-terminal/v4",
        source: SOURCE,
        budget: BUDGET,
        epoch: EPOCH,
        openingDigest: hashJsonValue(opening),
        iterations: [{ runId: RUN, terminal: null, buildClauses: [], measured: wasMeasured }],
        absentSteps: [],
        outcome: "completed",
        abortClause: null,
        terminalReason: "completed",
        writtenAt: "2026-09-18T12:00:00.000Z",
        runEnd: { climb: null, provenance: [] },
        lock: { token: "recorded-lock", ownedAtRecord: true },
      });
    },
    /** Change one field of already-written evidence. Damaged identities and retired clauses can
     *  only be forged this way, and the digest must follow when the opening moves. */
    amend(file: "terminal" | "opening", change: (value: Record<string, JsonValue>) => void): void {
      const path = file === "terminal" ? terminalPath : openingPath;
      const value: Record<string, JsonValue> = JSON.parse(readFileSync(path, "utf8"));
      change(value);
      write(path, value);
    },
    rebindOpening(): void {
      const opening: JsonValue = JSON.parse(readFileSync(openingPath, "utf8"));
      this.amend("terminal", (terminal) => {
        terminal["openingDigest"] = hashJsonValue(opening);
      });
    },
    drop(what: "terminal" | "opening" | "lock"): void {
      const path =
        what === "lock" ? join(dir, ".controller.lock") : what === "terminal" ? terminalPath : openingPath;
      rmSync(path);
    },
    lock(token: string): void {
      write(join(dir, ".controller.lock"), { token });
    },
    claim(runId: string, createdAt: string, statement: JsonValue | null = null): void {
      mkdirSync(join(dir, "claims"), { recursive: true });
      const claim =
        statement === null ? { ok: false, repairable: false, clauses: [] } : { ok: true, statement };
      write(join(dir, "claims", `${runId}.json`), { schema: "run-claim/v1", runId, createdAt, claim });
    },
    promotion(name: string, record: JsonValue): void {
      mkdirSync(join(dir, "promotions"), { recursive: true });
      write(join(dir, "promotions", `${name}.json`), record);
    },
    /** Publish a battery record where the controller's join derives it: the join opens the bytes
     *  the run manifest attests, so it goes through the evidence log, never in place. */
    batteryRecord(area: string, battery: string, record: JsonValue): void {
      const log = new EvidenceLog(join(dir, area, RUN, "runs", battery));
      log.write("battery.json", record);
      log.record();
    },
    report(selector: string = RUN, bundleDir: string | null = null) {
      return outcomeReport(dir, selector, bundleDir);
    },
    battery(bundleDir: string | null = null, selector: string = RUN): OutcomeMetrics {
      const metrics = this.report(selector, bundleDir).batteries[selector];
      if (metrics === undefined) throw new Error("fixture battery missing from report");
      return metrics;
    },
  };
}

/** The ordinary battery: a pass with an intact trace, a fail whose trace drifted after the run, an
 *  unaccepted attempt and a provider non-result — one of each case kind the denominators separate.
 *  t1's calls include an MCP-prefixed name that must normalise to its declared bare name, and one
 *  name no spec declares, which must stay a violation. */
function measured(prefix?: string) {
  const c = campaign(prefix);
  const t1 = {
    ...baseRow("t1", "alpha"),
    traces: [c.trace("t1", ["query", "mcp__harness__query", "rogue", "submit"], 2)],
  };
  const t2 = {
    ...baseRow("t2", "alpha"),
    truthOk: false,
    pass: false,
    traces: [c.trace("t2", ["query"], 1)],
  };
  c.rewriteTrace("t2", ["query", "query"], 3);
  const t3 = { ...baseRow("t3", "beta"), acceptedSubmit: false, truthOk: null, pass: false };
  const t4 = {
    ...baseRow("t4", "beta"),
    acceptedSubmit: false,
    truthOk: null,
    pass: null,
    runtimeNonResult: "provider 529",
    runtimeNonResultKind: "provider" as const,
  };
  c.rows(t1, t2, t3, t4);
  return c;
}

/** An agent bundle: a spec, one source file and one document the loc owner excludes. */
function bundle(
  tools: JsonValue = [
    { name: "query", kind: "reader", description: "Query." },
    { name: "advisor", kind: "advisor", description: "Advise." },
  ],
  presets: string[] = [],
) {
  const dir = scratchDir("outcome-bundle-");
  writeFileSync(
    join(dir, "tools-spec.json"),
    JSON.stringify({ presets, declined: { files: "fixture without a shell" }, tools }),
  );
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "tools.ts"), "export function query(a: number) {\n  return a + 1;\n}\n");
  writeFileSync(join(dir, "notes.md"), "one line\n\ntwo lines\n");
  return dir;
}

describe("what one battery counts", () => {
  it("separates the three case kinds and rates only the scored ones", () => {
    const metrics = measured().battery();
    expect(metrics.cases).toEqual({
      total: 4,
      verified: 2,
      passed: 1,
      failed: 1,
      unaccepted: 1,
      nonResults: { total: 1, byKind: { provider: 1 }, environmentOwnedKinds: ["provider"] },
    });
    // The non-result leaves the denominator; the unaccepted attempt does not.
    expect(metrics.passRate.n).toBe(3);
    expect(metrics.passRate.rate).toBeCloseTo(1 / 3);
    expect(metrics.passRate.wilson).not.toBeNull();
    expect(metrics.cases.verified + metrics.cases.unaccepted + metrics.cases.nonResults.total).toBe(
      metrics.cases.total,
    );
  });

  it("reports each family's own denominators and the identities the rows carry", () => {
    const metrics = measured().battery();
    expect(metrics.families).toEqual({
      alpha: { total: 2, verified: 2, passed: 1, unaccepted: 0, nonResults: 0 },
      beta: { total: 2, verified: 0, passed: 0, unaccepted: 1, nonResults: 1 },
    });
    expect(metrics.identity.backendPins).toEqual(["claude/claude-opus-5"]);
    expect(metrics.identity.variants).toEqual(["repair-off"]);
    expect(metrics.identity.isolationUnproven).toBe(4);
  });

  it("projects an admitted battery that wrote no row as a real zero, not as an absence", () => {
    // `skipped-precase` contributes no case row on purpose, but the iteration still admitted the
    // condition, so the battery must appear with every count at zero and every rate null.
    const c = campaign("outcome-zero-row-");
    const battery = RUN;
    c.rows();
    c.controller(true);
    c.batteryRecord("candidates", battery, { disposition: "skipped-precase", cases: [] });
    expect(Object.keys(c.report().batteries)).toEqual([battery]);
    expect(c.report().batteries[battery]).toMatchObject({
      cases: {
        total: 0,
        verified: 0,
        passed: 0,
        failed: 0,
        unaccepted: 0,
        nonResults: { total: 0, byKind: {}, environmentOwnedKinds: [] },
      },
      passRate: { successes: 0, n: 0, rate: null, wilson: null },
      telemetry: { cases: [], recorded: 0, meanTurns: null, meanToolCalls: null },
    });
  });

  it("admits no battery when the terminal admitted none", () => {
    const c = campaign("outcome-no-battery-");
    c.rows();
    c.controller();
    expect(c.report().batteries).toEqual({});
  });

  it("keeps rows belonging to another run out of the projection", () => {
    expect(measured().report("run-other").batteries).toEqual({});
  });
});

describe("the claim a battery carries", () => {
  it("reads chronology and condition identity from the battery's own claim", () => {
    const c = measured();
    c.claim(RUN, "2026-09-03T01:39:17.424Z", {
      runId: RUN,
      taskSetHash: "374b83f105aa7cbb",
      agentHash: "9f2c40ab6e1d8c73",
      correctnessModelHash: "51a0dd7e4b28f96c",
    });
    expect(c.battery().claim).toEqual({
      createdAt: "2026-09-03T01:39:17.424Z",
      taskSetHash: "374b83f105aa7cbb",
      agentHash: "9f2c40ab6e1d8c73",
      correctnessModelHash: "51a0dd7e4b28f96c",
    });
  });

  it("states null chronology rather than inferring one from the run id", () => {
    const c = measured();
    expect(c.battery().claim).toEqual({
      createdAt: null,
      taskSetHash: null,
      agentHash: null,
      correctnessModelHash: null,
    });
    // A refused claim carries no statement, and still supplies its own createdAt.
    c.claim(RUN, "2026-09-03T01:39:17.424Z");
    expect(c.battery().claim).toEqual({
      createdAt: "2026-09-03T01:39:17.424Z",
      taskSetHash: null,
      agentHash: null,
      correctnessModelHash: null,
    });
  });

  it("orders batteries by their claims' createdAt, never by run id", () => {
    // truss-13 sorted a later battery before one that had run 22 minutes earlier.
    const c = campaign("outcome-order-");
    const first = { ...baseRow("t1", "alpha"), runId: `${RUN}-i02` };
    const second = { ...baseRow("t1", "alpha"), runId: RUN };
    c.rows(first, second);
    c.controller();
    c.drop("terminal");
    c.claim(first.runId, "2026-09-03T20:07:44Z");
    c.claim(second.runId, "2026-09-03T20:29:06Z");
    expect(Object.keys(c.report().batteries)).toEqual([first.runId, second.runId]);
  });

  it("tables the host-only limit margin by family with the within-5% share beside its count", () => {
    const c = measured();
    expect(c.battery().limitMargin).toBeNull();
    const row = { family: "alpha", tasks: 3, paired: 8, within1pct: 2, within5pct: 6, unpaired: 1 };
    mkdirSync(join(c.dir, "analysis"), { recursive: true });
    writeFileSync(
      limitMarginFile(c.dir, RUN),
      JSON.stringify({
        schema: LIMIT_MARGIN_SCHEMA,
        runId: RUN,
        pairing: LIMIT_MARGIN_PAIRING,
        families: [{ ...row, medianRelativeDistance: 0.03 }],
      }),
    );
    const table = c.battery().limitMargin;
    expect(table?.pairing).toMatch(/^heuristic pairing/);
    expect(table?.families[0]).toMatchObject({ ...row, shareWithin5pct: 0.75 });
    expect(table?.families[0]?.reading).toBe(
      "alpha: 6 of 8 paired limits within 5% of the reference (75%), 2 within 1%, 1 unpaired, over 3 task(s); heuristic pairing",
    );
  });
});

describe("telemetry read from traces", () => {
  it("demotes a drifted trace to a stated absence and keeps it out of the means", () => {
    const metrics = measured().battery();
    const byTask = new Map(metrics.telemetry.cases.map((c) => [c.taskId, c]));
    expect(byTask.get("t1")).toMatchObject({ telemetry: "recorded", turns: 2, toolCalls: 4 });
    expect(byTask.get("t2")).toMatchObject({ telemetry: "trace-drifted", turns: null, toolCalls: null });
    expect(byTask.get("t3")).toMatchObject({ telemetry: "no-trace-pointer", turns: null, toolCalls: null });
    // Means run over recorded cases only: a drifted trace never contributes a fabricated zero.
    expect(metrics.telemetry.recorded).toBe(1);
    expect(metrics.telemetry.meanToolCalls).toBe(4);
    expect(metrics.telemetry.meanTurns).toBe(2);
  });

  it("reads no telemetry from an intact trace in an earlier schema", () => {
    const c = campaign("outcome-v3-");
    // Written as v3 before the pointer is taken, so the digest binds v3 bytes and only the version
    // gate refuses them.
    const row = {
      ...baseRow("t1", "alpha"),
      traces: [c.trace("t1", ["query", "submit"], 2, "case-trace/v3")],
    };
    c.rows(row);
    expect(c.battery().telemetry.cases[0]).toMatchObject({ taskId: "t1", telemetry: "no-trace-pointer" });
  });

  it("resolves a pointer under the adopted tree, so a run that measured current is not trace-missing", () => {
    // Run 8 measured the adopted tree, so its traces sit under domains/<slug>/runs/, a sibling of
    // the campaign dir. Probing campaign-side roots alone reported all 50 intact traces missing.
    const c = campaign("outcome-adopted-");
    const adopted = join(c.root, "domains", "fixture");
    mkdirSync(join(adopted, "runs", RUN), { recursive: true });
    writeFileSync(join(adopted, "runs", RUN, "trace.json"), traceJson(["query", "submit"], 4));
    c.rows({ ...baseRow("t1", "alpha"), traces: [tracePointer(adopted, `runs/${RUN}/trace.json`)] });
    expect(c.battery().telemetry.cases[0]).toMatchObject({ telemetry: "recorded", turns: 4, toolCalls: 2 });
  });
});

describe("the tool census", () => {
  it("gives every declared tool a row at zero and states an undeclared call as a violation", () => {
    const metrics = measured().battery(bundle());
    // No brief sits beside this bundle, so the runtime never registered the reserved
    // public-resources reader; listing it anyway would classify a hallucinated call as declared.
    expect(metrics.tools.declaredCalls).toEqual({
      query: 2,
      advisor: 0,
      save_candidate: 0,
      restore_candidate: 0,
      inspect_draft: 0,
      preview_artifact: 0,
      submit: 1,
    });
    expect(metrics.tools.neverCalled).toEqual([
      "advisor",
      "inspect_draft",
      "preview_artifact",
      "restore_candidate",
      "save_candidate",
    ]);
    expect(metrics.tools.undeclaredCalls).toEqual({ rogue: 1 });
  });

  it("counts the solves that reached each tool, not only the calls", () => {
    const metrics = measured().battery(bundle());
    // One of the four cases delivers tool calls: two carry no trace at all, and t2's bytes were
    // rewritten after its pointer was taken, so the digest demotes it. A case with no recorded
    // call is neither a solve that declined a tool nor one that used it, and stays out of both
    // sides.
    expect(metrics.tools.tracedSolves).toBe(1);
    // That solve called `query` and `mcp__harness__query`, which are one tool over one transport,
    // so it counts once.
    expect(metrics.tools.solvesUsing).toEqual({ query: 1, rogue: 1, submit: 1 });
    // The call aggregate cannot make this distinction: two calls to `query` could be one solve.
    expect(metrics.tools.declaredCalls).toMatchObject({ query: 2 });
  });

  it("declares the reserved public-resources reader only where the brief carries public resources", () => {
    // The recorded slug layout: the agent bundle beside the correctness model whose brief keyed
    // registration.
    const slugRoot = scratchDir("outcome-slug-");
    const agent = join(slugRoot, "agent");
    mkdirSync(agent);
    writeFileSync(
      join(agent, "tools-spec.json"),
      JSON.stringify({
        presets: [],
        declined: { files: "fixture without a shell" },
        tools: [{ name: "query", kind: "reader", description: "Query." }],
      }),
    );
    mkdirSync(join(slugRoot, "correctness-model"));
    writeFileSync(join(slugRoot, "correctness-model", "brief.json"), JSON.stringify(MATCHING_BRIEF));
    const metrics = measured().battery(agent);
    expect(metrics.tools.declaredCalls).toMatchObject({ read_public_resources: 0 });
    // Registered by the controller, not authored prompt space: silence here is not a finding.
    expect(metrics.tools.neverCalled).not.toContain("read_public_resources");
  });

  it("counts a selected preset's tools as declared without their being listed in the spec", () => {
    const metrics = measured().battery(bundle([], ["files"]));
    expect(metrics.tools.declaredCalls).toMatchObject({
      submit: 1,
      read: 0,
      write: 0,
      edit: 0,
      materialize_files: 0,
    });
    expect(metrics.tools.undeclaredCalls).toEqual({ query: 1, mcp__harness__query: 1, rogue: 1 });
  });

  it("states a missing bundle as a null census, never as an empty success", () => {
    const report = measured().report();
    expect(report.batteries[RUN]?.tools.declaredCalls).toBeNull();
    expect(report.bundle).toBeNull();
  });
});

describe("the bundle record", () => {
  it("reports size through the loc and token-facts readers and scores nothing", () => {
    const report = measured().report(RUN, bundle());
    // notes.md lands in the loc owner's docs exclusion: counted as excluded, never as source.
    expect(report.bundle).toMatchObject({
      files: 2,
      excluded: { docs: 1 },
      functions: 1,
      worstFunction: { file: "src/tools.ts" },
      byTopDir: { src: 3 },
    });
    expect(report.bundle?.worstFunction.name).toContain("query");
  });
});

describe("promotion decisions", () => {
  /** Commit one decision the way promotion does, beside a registered retained version. */
  function decide(ledger: ControllerLedger, id: string, row: Record<string, JsonValue>): void {
    ledger.recordProductDecision({
      id,
      version: "retained",
      previous: null,
      adopt: false,
      evidence: JSON.stringify({ schema: "product-promotion/v1", runId: id, ...row }),
      admission: null,
    });
  }

  // Run w12's legibility finding: a `candidate-held` terminal read as a lost comparison because
  // the decision and its clauses reached no view.
  it("surfaces each committed decision with its clauses, for this run's iterations alone", () => {
    const c = measured();
    using ledger = ControllerLedger.open(c.dir);
    ledger.registerProduct("retained", "manifest");
    decide(ledger, RUN, { decision: "held", experiment: "build", clauses: ["candidate-zero-verified"] });
    // Similar prefixes and malformed iteration ids are different conditions, not this run.
    for (const runId of ["run-070", `${RUN}-next`, `${RUN}-i02-other`, `${RUN}-i002`]) {
      decide(ledger, runId, { decision: "held", experiment: "build", clauses: [] });
    }
    decide(ledger, `${RUN}-i02`, { decision: "held", experiment: null, clauses: [] });
    expect(c.report().promotions).toEqual([
      { runId: RUN, decision: "held", experiment: "build", clauses: ["candidate-zero-verified"] },
      { runId: `${RUN}-i02`, decision: "held", experiment: null, clauses: [] },
    ]);
  });

  it("reads the committed decision, and ignores a JSON export that disagrees", () => {
    const c = measured();
    using ledger = ControllerLedger.open(c.dir);
    ledger.registerProduct("retained", "manifest");
    decide(ledger, RUN, { decision: "held", experiment: "build", clauses: ["candidate-zero-verified"] });
    const settled = c.report().promotions;
    expect(settled).toEqual([
      { runId: RUN, decision: "held", experiment: "build", clauses: ["candidate-zero-verified"] },
    ]);
    c.promotion(RUN, { schema: "product-promotion/v1", runId: RUN, decision: "promoted", clauses: [] });
    expect(c.report().promotions).toEqual(settled);
  });

  it("refuses a committed decision in the row shape before product-promotion/v1", () => {
    const c = measured();
    using ledger = ControllerLedger.open(c.dir);
    ledger.registerProduct("retained", "manifest");
    ledger.recordProductDecision({
      id: RUN,
      version: "retained",
      previous: null,
      adopt: false,
      evidence: JSON.stringify({
        runId: RUN,
        decision: "held",
        clauses: [],
        comparison: { wins: 2, losses: 1, ties: 22, tiesPass: 19, tiesFail: 3 },
      }),
      admission: null,
    });
    expect(() => c.report()).toThrow(`promotion decision ${RUN} is not a product-promotion/v1 row`);
  });
});

describe("controller evidence", () => {
  it("takes the admitted battery set from the terminal, separating siblings and unadmitted rows", () => {
    const c = campaign("outcome-controller-set-");
    const battery = RUN;
    c.rows(
      { ...baseRow("verified", "alpha"), runId: battery },
      {
        ...baseRow("unaccepted", "alpha"),
        runId: battery,
        acceptedSubmit: false,
        truthOk: null,
        pass: false,
      },
      {
        ...baseRow("non-result", "alpha"),
        runId: battery,
        acceptedSubmit: false,
        truthOk: null,
        pass: null,
        runtimeNonResult: "provider unavailable",
        runtimeNonResultKind: "provider" as const,
      },
      { ...baseRow("sibling", "alpha"), runId: `${RUN}-next` },
      { ...baseRow("unadmitted", "alpha"), runId: `${RUN}-i02` },
    );
    c.controller(true);
    c.batteryRecord("candidates", battery, {
      disposition: "completed",
      cases: ["verified", "unaccepted", "non-result"].map((taskId) => ({ taskId })),
    });
    const report = c.report();
    expect(report.controller).toMatchObject({
      state: "recorded",
      batteryRunIds: [battery],
      denominator: { state: "recorded", total: 3, verified: 1, unaccepted: 1, nonResults: 1 },
      budget: { turnBudget: null, turnsUsed: 0, status: "active" },
    });
    expect(Object.keys(report.batteries)).toEqual([battery]);
  });

  it("groups exact iteration batteries separately while the run is unfinished", () => {
    const c = campaign("outcome-variants-");
    const admitted = [RUN, `${RUN}-i02`, `${RUN}-i10`, `${RUN}-i100`];
    const excluded = [
      "run-070",
      `${RUN}-next`,
      `${RUN}-i01`,
      `${RUN}-i002`,
      `${RUN}-i02-other`,
      `${RUN}-i02-i02`,
      `${RUN}-repair-on`,
      `${RUN}-i03-confirm-cand-repair-on`,
    ];
    const failed = { ...baseRow("t2", "alpha"), runId: `${RUN}-i10`, truthOk: false, pass: false };
    c.rows(failed, ...[...admitted, ...excluded].map((runId) => ({ ...baseRow("t1", "alpha"), runId })));
    c.controller();
    c.drop("terminal");
    const report = c.report();
    expect(report.controller.state).toBe("unfinished");
    expect(Object.keys(report.batteries)).toEqual([...admitted].sort());
    expect(report.batteries[`${RUN}-i10`]?.passRate).toMatchObject({ successes: 1, n: 2 });
    expect(report.batteries[`${RUN}-i02`]?.cases).toMatchObject({ total: 1, verified: 1, passed: 1 });
    c.drop("opening");
    expect(Object.keys(c.report().batteries)).toEqual(Object.keys(report.batteries));
  });

  it("reads a typed abort and refuses a retired clause, a null clause or another reason head", () => {
    const c = measured("outcome-abort-clause-");
    c.controller(true);
    c.batteryRecord("candidates", RUN, {
      disposition: "completed",
      cases: [1, 2, 3, 4].map((n) => ({ taskId: `t${String(n)}` })),
    });
    c.amend("terminal", (terminal) => {
      terminal["outcome"] = "aborted";
      terminal["abortClause"] = "environment-blocked";
      terminal["terminalReason"] = "environment-blocked: no credential is configured";
    });
    expect(c.report().controller).toMatchObject({ state: "recorded", abortClause: "environment-blocked" });
    // Terminals up to 2026-09-18 led with `aborted: `, and two clauses have since been retired;
    // neither spelling is read any more.
    const refused: Array<[JsonValue, string]> = [
      ["environment-blocked", "aborted: environment-blocked — no credential is configured"],
      ["whole-child-wall-expired", "whole-child-wall-expired: recorded"],
      ["budget-recovery-required", "aborted: budget-recovery-required — recorded"],
      [null, "aborted: fullrun received SIGTERM"],
      ["unknown-wall", "unknown-wall: recorded"],
    ];
    for (const [clause, reason] of refused) {
      c.amend("terminal", (terminal) => {
        terminal["abortClause"] = clause;
        terminal["terminalReason"] = reason;
      });
      expect(() => c.report()).toThrow("outcome, terminalReason and abortClause disagree");
    }
  });

  it("keeps an absent denominator absent after a sibling run writes case rows", () => {
    const c = campaign("outcome-absent-");
    c.rows({ ...baseRow("sibling", "alpha"), runId: `${RUN}b` });
    c.controller();
    c.amend("terminal", (terminal) => {
      terminal["outcome"] = "aborted";
      terminal["abortClause"] = "signal-terminated";
      terminal["terminalReason"] = "signal-terminated: fullrun received SIGTERM";
    });
    const report = c.report();
    expect(report.controller).toMatchObject({
      state: "recorded",
      terminalReason: "signal-terminated: fullrun received SIGTERM",
      batteryRunIds: [],
      denominator: { state: "absent" },
    });
    expect(report.batteries).toEqual({});
  });

  it("counts only the run's own rows and ignores a copied count left in the terminal", () => {
    const c = campaign("outcome-denominator-hostile-");
    const battery = RUN;
    c.rows(
      { ...baseRow("own", "alpha"), runId: battery },
      { ...baseRow("sibling", "alpha"), runId: `${RUN}b` },
    );
    c.controller(true);
    c.batteryRecord("candidates", battery, { disposition: "completed", cases: [{ taskId: "own" }] });
    c.amend("terminal", (terminal) => {
      terminal["denominator"] = { state: "recorded", total: 2, verified: 2, unaccepted: 0, nonResults: 0 };
    });
    expect(c.report().controller).toMatchObject({
      denominator: { state: "recorded", total: 1, verified: 1, unaccepted: 0, nonResults: 0 },
    });
  });

  it("carries a typed invalid denominator instead of failing on an unreadable case record", () => {
    const c = campaign("outcome-invalid-record-");
    c.unreadableRows();
    c.controller(true);
    expect(c.report().controller).toMatchObject({
      state: "recorded",
      denominator: { state: "invalid", error: "case-record unreadable" },
    });
  });

  it("accepts a later lock but refuses damaged identities and run names", () => {
    // This fixture names no battery, so battery-record validation cannot mask the identity
    // refusals being tested.
    const c = campaign("outcome-hostile-");
    c.rows();
    c.controller();
    c.lock("recorded-lock");
    expect(() => c.report()).toThrow(/lock from the recorded terminal remains held/);
    c.lock("later-controller");
    expect(c.report().controller).toMatchObject({ state: "recorded" });

    c.amend("opening", (opening) => {
      opening["source"] = { ...SOURCE, commit: "falsified" };
    });
    expect(() => c.report()).toThrow(/campaign-opening/);
    c.amend("opening", (opening) => {
      opening["source"] = SOURCE;
      opening["epoch"] = { key: "epoch-ffffffffffff" };
    });
    expect(() => c.report()).toThrow(/campaign-opening/);

    c.amend("opening", (opening) => {
      opening["epoch"] = { key: EPOCH };
    });
    c.rebindOpening();
    c.amend("terminal", (terminal) => {
      terminal["iterations"] = [{ runId: `${RUN}-i02`, terminal: null, buildClauses: [], measured: false }];
    });
    expect(() => c.report()).toThrow(/iterations\[0\] is malformed/);

    // The retired battery-id list is not read as a measured flag.
    c.amend("terminal", (terminal) => {
      terminal["iterations"] = [{ runId: RUN, terminal: null, buildClauses: [], batteryRunIds: [RUN] }];
    });
    expect(() => c.report()).toThrow(/iterations\[0\] is malformed/);
  });

  it("states an opened run as unfinished and reports the lock without inferring a process", () => {
    const c = campaign("outcome-unfinished-");
    c.rows();
    c.controller(true);
    c.drop("terminal");
    c.lock("still-running");
    expect(c.report().controller).toEqual({
      state: "unfinished",
      lockHeld: true,
      // A lock record without a pid does not establish whether its holder is alive.
      holder: "held",
      evidence: { opening: join("controller", RUN, "opening.json") },
    });
    c.drop("lock");
    expect(c.report().controller).toMatchObject({ state: "unfinished", lockHeld: false, holder: "absent" });
    // Without its opening the run recorded nothing a reader may attribute to it.
    c.drop("opening");
    expect(c.report().controller).toEqual({ state: "absent" });
  });

  it("invents no controller evidence from unrelated historical files", () => {
    const c = campaign("outcome-historical-");
    mkdirSync(join(c.dir, "epoch-old", "01-domain"), { recursive: true });
    writeFileSync(join(c.dir, "epoch-old", "01-domain", "iteration.json"), "{}\n");
    const report = c.report("run-31");
    expect(report.controller).toEqual({ state: "absent" });
    expect(report.caseRecord).toBe("absent");
  });
});
