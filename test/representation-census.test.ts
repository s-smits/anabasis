/**
 * A harness can pass every gate it has and still measure nothing, and live-run-06 is the recorded
 * case of it. Its retained traces show F2 passing 25 of 25, every submit accepted and the accept
 * controls passing 3 of 3, which is as clean a run-up to a battery as the gates can produce. The
 * battery then measured 0 of 25. The whole difference was a spelling: the reference answer writes
 * `accessionCode: "n/a"` for a record with no local code and the agent wrote `""` instead, 95 times
 * across all 25 cases. Nothing was wrong with the agent's reasoning and nothing was wrong with the
 * checks; the two sides simply never agreed on how to write "absent", and no gate was looking.
 *
 * So the census looks for that disagreement before a battery is paid for, and it looks for a second
 * shape beside it — an artifact root that just copies its public input, which is a root the checks
 * cannot fail on and therefore a capability nobody measured. Both findings block, because a run
 * that passes its batteries with copied answer roots has proved only that it can copy.
 *
 * The harder half of the file is the quiet cases, and they are the ones to read before trusting a
 * pass. A root derived from public input rather than copied stays quiet, as does a copy whose
 * source differs between tasks, a single task copying the whole collection when its sibling does
 * not, nested ordered pairs that were each reversed, and a real domain value that merely resembles
 * an absence marker. Reordered rows still block, because reordering is not a different answer.
 *
 * One limitation is recorded rather than fixed: a copy wrapped in a new object is not detected,
 * because the enclosing structure differs and these comparisons work on structure. The authoring
 * instructions forbid that representation, but forbidding is not detecting, and the case below says
 * so plainly rather than leaving a later reader to assume the ground is held.
 */
import type { JsonValue } from "../src/meta/json-shape.ts";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import { double } from "./helpers/doubles.ts";
import type { BuiltHarness } from "../src/author/campaign-types.ts";
import {
  BLOCKING_CODES,
  type Witness,
  censusRepresentation,
  inputInsensitivity,
  observe,
} from "../src/run/representation-census.ts";
import { compilePublicArtifactSchema } from "../src/solve/public-artifact-schema.ts";
import { makeSolvabilityCensusGate } from "../src/run/solvability-gate.ts";
import { probeReturning } from "./helpers/solvability-probe.ts";
import { keysIf } from "../src/meta/optional-key.ts";

const SCRATCH = mkdtempSync(join(tmpdir(), "ana-representation-"));
const CATALOG = [
  { recordId: "DOC-ALPHA", medium: "digital", accessionCodeOptions: ["A-104", "A-105"] },
  { recordId: "MAP-BETA", medium: "external", accessionCodeOptions: ["n/a", "none"] },
];

afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

/** A root that transcribes the catalogue, beside an answer that spells "n/a". */
function runSix(taskId: string): Witness {
  return {
    taskId,
    publicInput: { catalogue: CATALOG, shelfCapacity: 100 },
    artifact: {
      catalogueFacts: CATALOG,
      selection: {
        records: [
          { recordId: "DOC-ALPHA", accessionCode: "A-104" },
          { recordId: "MAP-BETA", accessionCode: "n/a" },
        ],
      },
    },
  };
}

const codes = (witnesses: Witness[]) => censusRepresentation(witnesses).findings.map((f) => f.code);

describe("the representation census", () => {
  it("reports both representation findings in the run 6 fixture and names the affected field", () => {
    const { findings } = censusRepresentation([runSix("t1"), runSix("t2")]);
    const found = findings.map((f) => f.code);
    expect(found).toContain("REFERENCE_ANSWER_SPELLS_ABSENCE");
    expect(found).toContain("ARTIFACT_ROOT_TRANSCRIBES_PUBLIC_INPUT");
    const absence = findings.find(
      (f) => f.code === "REFERENCE_ANSWER_SPELLS_ABSENCE" && f.path.includes("records"),
    );
    expect(absence?.path).toBe(
      "correctness-model/brief.json#artifactSchema.selection.records[].accessionCode",
    );
    expect(absence?.detail).toContain('"n/a"');
    expect(absence?.detail).toContain("all 2 authored tasks");
  });

  it("keeps both census kinds blocking", () => {
    const blocking = censusRepresentation([runSix("t1")]).findings.filter((f) => BLOCKING_CODES.has(f.code));
    expect(new Set(blocking.map((f) => f.code))).toEqual(
      new Set(["REFERENCE_ANSWER_SPELLS_ABSENCE", "ARTIFACT_ROOT_TRANSCRIBES_PUBLIC_INPUT"]),
    );
    expect(BLOCKING_CODES.has("ARTIFACT_ROOT_TRANSCRIBES_PUBLIC_INPUT")).toBe(true);
  });

  /**
   * Why the admission rule is strict rather than advisory. A bundle that transcribes
   * `publicInput.requiredStops` into root `routeFacts` beside a derived `itinerary` can pass every
   * task it is measured on, and the finding then fires on every reference witness of every task set
   * while each iteration is still admitted. A battery passing in full does not resolve a
   * copied-root finding, because the copied root is exactly the part the battery never tested.
   * Admission now refuses that representation: the Builder must remove routeFacts or derive its
   * value, as the finding detail explains. The fixture below checks the refusal itself.
   */
  it("blocks an artifact root that copies the same public input on every task", () => {
    const stops = [{ stopId: "ST-01", zoneId: "north" }];
    const itFive = (taskId: string): Witness => ({
      taskId,
      publicInput: { requiredStops: stops },
      artifact: { routeFacts: stops, itinerary: [{ routeId: "R-0" }] },
    });
    const { findings } = censusRepresentation([itFive("t1"), itFive("t2")]);
    expect(findings.map((f) => f.code)).toEqual(["ARTIFACT_ROOT_TRANSCRIBES_PUBLIC_INPUT"]);
    expect(findings.filter((f) => BLOCKING_CODES.has(f.code))).toHaveLength(1);
  });

  // A passing artifact can hold the copied rows in another order, and one reordered reference
  // witness would then silence the every-witness aggregate. Copy detection therefore ignores row
  // order in the compared collection.
  it("still blocks a copy whose rows are reordered, on every witness or on one", () => {
    const stops = [
      { stopId: "ST-01", zoneId: "north" },
      { stopId: "ST-02", zoneId: "south" },
    ];
    const copied = (taskId: string, rows: JsonValue): Witness => ({
      taskId,
      publicInput: { requiredStops: stops },
      artifact: { routeFacts: rows, itinerary: [{ routeId: "R-0" }] },
    });
    const reversed = stops.toReversed();
    expect(codes([copied("t1", reversed), copied("t2", reversed)])).toEqual([
      "ARTIFACT_ROOT_TRANSCRIBES_PUBLIC_INPUT",
    ]);
    expect(codes([copied("t1", stops), copied("t2", reversed)])).toEqual([
      "ARTIFACT_ROOT_TRANSCRIBES_PUBLIC_INPUT",
    ]);
  });

  // Row order is ignored only in the compared collection. A nested array can be an ordered value — a
  // directed edge, a coordinate pair — and an artifact that reverses each one has transformed the
  // data. Sorting recursively used to read that transformation as a copy.
  it("stays quiet on rows whose nested ordered pairs were each reversed", () => {
    const edges = [
      ["source", "relay"],
      ["relay", "sink"],
    ];
    const witness = (taskId: string): Witness => ({
      taskId,
      publicInput: { edges },
      artifact: { flow: edges.map((pair) => pair.toReversed()), itinerary: [{ routeId: "R-0" }] },
    });
    expect(codes([witness("t1"), witness("t2")])).toEqual([]);
  });

  // One root copied from one source is transcription; a root that copies publicInput.left on one
  // task and publicInput.right on another is choosing which public collection applies. The
  // aggregate used to merge the sources and claim a single one was copied on every task.
  it("stays quiet when the copied source differs across tasks", () => {
    const left = [{ stopId: "ST-01", zoneId: "north" }];
    const right = [{ stopId: "ST-02", zoneId: "south" }];
    const chooses = (taskId: string, picked: JsonValue): Witness => ({
      taskId,
      publicInput: { left, right },
      artifact: { result: picked, itinerary: [{ routeId: "R-0" }] },
    });
    expect(codes([chooses("t1", left), chooses("t2", right)])).toEqual([]);
    expect(codes([chooses("t1", left), chooses("t2", left)])).toEqual([
      "ARTIFACT_ROOT_TRANSCRIBES_PUBLIC_INPUT",
    ]);
  });

  // This census misses a copy wrapped in a new object because the enclosing structure differs.
  // The authoring instructions forbid that representation, but these comparisons do not detect
  // it. This test records the limitation without claiming that the prompt enforces the rule.
  it("does not detect a copy wrapped in a new object", () => {
    const stops = [{ stopId: "ST-01", zoneId: "north" }];
    const wrapped = (taskId: string): Witness => ({
      taskId,
      publicInput: { requiredStops: stops },
      artifact: { routePlan: { rows: stops }, itinerary: [{ routeId: "R-0" }] },
    });
    expect(codes([wrapped("t1"), wrapped("t2")])).toEqual([]);
  });

  it("stays quiet on a root derived from public input rather than copied", () => {
    const derived = (taskId: string, budget: number): Witness => ({
      taskId,
      publicInput: { catalogue: CATALOG, recordLimit: budget },
      artifact: { selection: CATALOG.slice(0, budget), recordCount: budget },
    });
    expect(codes([derived("t1", 1), derived("t2", 2)])).toEqual([]);
  });

  it("does not report copying when only one task copies the full collection", () => {
    // The first task selects the whole catalog; the second selects only part of it.
    const witnesses: Witness[] = [
      { taskId: "t1", publicInput: { catalogue: CATALOG }, artifact: { selection: CATALOG } },
      { taskId: "t2", publicInput: { catalogue: CATALOG }, artifact: { selection: [CATALOG[0]] } },
    ];
    expect(codes(witnesses)).toEqual([]);
  });

  it("does not mistake real domain values for absence spellings", () => {
    // "Na" is sodium and "nil" is a legitimate token in some domains; the vocabulary omits both
    // precisely because this check blocks. A census that refuses adoption may not guess.
    const chemistry = (taskId: string): Witness => ({
      taskId,
      publicInput: { elements: ["Na", "K"] },
      artifact: { chosen: "Na", fallback: "nil" },
    });
    expect(codes([chemistry("t1"), chemistry("t2")])).toEqual([]);
  });

  it("reads absence spellings as one convention regardless of case and padding", () => {
    const witness: Witness = { taskId: "t1", publicInput: {}, artifact: { note: " N/A " } };
    expect(observe(witness)).toEqual([
      { kind: "absence-sentinel", taskId: "t1", path: "note", note: " N/A " },
    ]);
  });

  it("declines on an artifact that is not an object, rather than guessing", () => {
    expect(observe({ taskId: "t1", publicInput: { a: [1] }, artifact: [1] })).toEqual([]);
    expect(observe({ taskId: "t1", publicInput: { a: [1] }, artifact: null })).toEqual([]);
    expect(censusRepresentation([]).findings).toEqual([]);
  });
});

/**
 * The candidate's own public schema declares `compensation` as the closed set
 * {none, flat, reactive}, and the census refused the submit because the reference answer wrote the
 * declared "none". A state the schema names is not a spelling the answer invented; a check reading
 * that field evaluates the state, so there is nothing to repair. The guard the rule was built for
 * stays: where the schema promises null or a free string, the same word is still an invented
 * sentinel, because the agent could as reasonably have written "" or "-".
 */
describe("a value the public schema declares as a closed state", () => {
  const witness = (taskId: string): Witness => ({
    taskId,
    publicInput: { loads: [{ loadId: "L-1", amps: 4 }] },
    artifact: { compensation: "none", plan: [{ loadId: "L-1", branch: "B-1" }] },
  });
  const accepts: JsonValue[] = [
    { compensation: "flat", plan: [{ loadId: "L-1", branch: "B-2" }] },
    { compensation: "reactive", plan: [{ loadId: "L-1", branch: "B-3" }] },
  ];

  it("passes when the field's allowedValues list it", () => {
    const schema = compilePublicArtifactSchema(
      [{ name: "compensation", allowedValues: ["none", "flat", "reactive"] }, { name: "plan" }],
      accepts,
    );
    expect(schema.root.properties.compensation).toMatchObject({ kind: "closed" });
    expect(censusRepresentation([witness("t1"), witness("t2")], schema).findings).toEqual([]);
  });

  it("still refuses the same word where the schema promises null or a free string", () => {
    const open: JsonValue[] = [
      { compensation: null, plan: [{ loadId: "L-1", branch: "B-2" }] },
      { compensation: "flat", plan: [{ loadId: "L-1", branch: "B-3" }] },
    ];
    const schema = compilePublicArtifactSchema([{ name: "compensation" }, { name: "plan" }], open);
    // The specimen is the original defect's shape, so pin it: null beside an open string.
    expect(schema.root.properties.compensation).toEqual({
      kind: "union",
      anyOf: [{ kind: "null" }, { kind: "string" }],
    });
    const { findings } = censusRepresentation([witness("t1"), witness("t2")], schema);
    expect(findings.map((f) => f.code)).toEqual(["REFERENCE_ANSWER_SPELLS_ABSENCE"]);
    expect(findings[0]?.path).toBe("correctness-model/brief.json#artifactSchema.compensation");
  });

  it("exempts nothing when no public schema is supplied", () => {
    expect(censusRepresentation([witness("t1"), witness("t2")]).findings.map((f) => f.code)).toEqual([
      "REFERENCE_ANSWER_SPELLS_ABSENCE",
    ]);
  });
});

/** The solve reads fields nobody authored, so its derived root is the same (empty) value on every
 *  task while the authored inputs all differ. */
const runTwelve = (taskId: string, requests: string[]): Witness => ({
  taskId,
  publicInput: { requestedItems: requests.map((requestId) => ({ requestId })) },
  artifact: { allocationPlan: [], requestFacts: requests },
});

describe("the input-insensitivity observation", () => {
  it("names the constant root with both denominators on run 12's shape, and only that root", () => {
    const findings = inputInsensitivity([runTwelve("t1", ["U01"]), runTwelve("t2", ["U01", "U02"])]);
    expect(findings.map((f) => f.code)).toEqual(["REFERENCE_SOLVE_IGNORES_PUBLIC_INPUT"]);
    expect(findings[0]?.path).toBe("correctness-model/reference/index.ts#solve");
    expect(findings[0]?.detail).toContain('"allocationPlan"');
    expect(findings[0]?.detail).toContain("all 2 failed reference solves");
    expect(findings[0]?.detail).toContain("2 distinct public inputs");
    // The varying root (requestFacts) is the solve responding to input — never reported.
    expect(findings.some((f) => f.detail.includes("requestFacts"))).toBe(false);
  });

  it("stays quiet when the inputs themselves are constant: constant output proves nothing", () => {
    expect(inputInsensitivity([runTwelve("t1", ["U01"]), runTwelve("t2", ["U01"])])).toEqual([]);
  });

  it("declines below two witnesses, and skips a root missing from any artifact", () => {
    expect(inputInsensitivity([runTwelve("t1", ["U01"])])).toEqual([]);
    const partial: Witness = {
      taskId: "t2",
      publicInput: { requestedItems: [{ requestId: "REQ-09" }] },
      artifact: { requestFacts: [] },
    };
    expect(inputInsensitivity([runTwelve("t1", ["U01"]), partial])).toEqual([]);
  });
});

const HARNESS = double<BuiltHarness>({ fingerprint: { taskSetHash: "tsh-1" } });

/** F2 as one row per witness, carrying its artifact; the status is the scenario's to choose. */
const probeOver = (witnesses: Witness[], status: "passed" | "failed" = "passed") =>
  probeReturning(
    witnesses.map((w) => ({
      taskId: w.taskId,
      status,
      artifact: w.artifact,
      ...keysIf(status === "failed", () => ({ error: "[engine] rejected on hidden-check" })),
    })),
  );

/** A slug tree carrying only what the census reads: the recorded bare task array. */
function slugWith(name: string, witnesses: Witness[]): string {
  const slugDir = join(SCRATCH, name, "slug");
  mkdirSync(join(slugDir, "correctness-model"), { recursive: true });
  writeFileSync(
    join(slugDir, "correctness-model", "tasks.json"),
    JSON.stringify(
      witnesses.map((w) => ({
        taskId: w.taskId,
        family: "archive-allocation",
        publicInput: w.publicInput,
        hidden: [{ expect: "protected" }],
      })),
    ),
  );
  return slugDir;
}

async function runGate(name: string, witnesses: Witness[], status: "passed" | "failed" = "passed") {
  const dir = join(SCRATCH, name);
  const gate = makeSolvabilityCensusGate({}, probeOver(witnesses, status));
  const feedback = await gate(HARNESS, dir, slugWith(name, witnesses));
  return { feedback, evidence: JSON.parse(readFileSync(join(dir, "solvability.json"), "utf8")) };
}

describe("representation findings in the solvability gate", () => {
  it("routes an absence-marker refusal to brief even when both reference solves pass", async () => {
    const { feedback, evidence } = await runGate("blocked", [runSix("t1"), runSix("t2")]);
    // Every reference solve passed, but the representation finding still refuses adoption.
    const blocking = feedback.filter((row) => row.severity === "blocking");
    expect(blocking).toHaveLength(1);
    expect(blocking[0]).toMatchObject({ owner: "brief" });
    expect(JSON.stringify(blocking[0])).toContain("accessionCode");
    // Both compared sides are the Builder's own public facts, so the finding crosses in full.
    expect(blocking[0]?.findings?.[0]?.disclosure).toEqual({ class: "authored" });
    // Transcription also blocks admission, so it shares this blocking row and no advisory row
    // remains for this fixture.
    expect(JSON.stringify(blocking[0])).toContain("ARTIFACT_ROOT_TRANSCRIBES_PUBLIC_INPUT");
    expect(feedback.filter((row) => row.severity === "advisory")).toHaveLength(0);
    // No hidden expectation leaves with either.
    expect(JSON.stringify(feedback)).not.toContain("protected");
    expect(evidence.representation.length).toBeGreaterThan(0);
  });

  it("returns no findings for derived answer roots and records an empty census", async () => {
    const honest = (taskId: string, shelf: number): Witness => ({
      taskId,
      publicInput: { catalogue: CATALOG },
      artifact: { selection: [{ recordId: "DOC-ALPHA", shelf }] },
    });
    const { feedback, evidence } = await runGate("clean", [honest("t1", 4), honest("t2", 7)]);
    expect(feedback).toEqual([]);
    expect(evidence.representation).toEqual([]);
  });

  it("counts reference solves the per-task wall stopped, apart from rejected ones, without task ids", async () => {
    const honest = (taskId: string, shelf: number): Witness => ({
      taskId,
      publicInput: { catalogue: CATALOG, shelf },
      artifact: { selection: [{ recordId: "DOC-ALPHA", shelf }] },
    });
    const witnesses = [honest("t1", 4), honest("t2", 7)];
    const dir = join(SCRATCH, "timeouts");
    const probe = probeReturning([
      { taskId: "t1", status: "failed", artifact: null, error: "reference solve child exceeded 120000ms" },
      {
        taskId: "t2",
        status: "failed",
        artifact: null,
        error: "reference solve child exceeded the stdout cap; stderr=",
      },
    ]);
    const feedback = await makeSolvabilityCensusGate({}, probe)(
      HARNESS,
      dir,
      slugWith("timeouts", witnesses),
    );
    const detail = feedback[0]?.findings?.find((f) => f.code === "SOLVABILITY_CENSUS_BLOCKED")?.detail ?? "";
    expect(detail).toContain("2 of 2 reference solves failed");
    expect(detail).toContain("1 of those stopped at the per-task reference solve wall");
    expect(detail).not.toMatch(/\d+-second/);
    expect(detail).not.toContain("t1");
  });

  it("declines instead of throwing when the recorded task file is unreadable", async () => {
    const dir = join(SCRATCH, "notasks");
    mkdirSync(dir, { recursive: true });
    const gate = makeSolvabilityCensusGate({}, probeOver([runSix("t1")]));
    expect(await gate(HARNESS, dir, join(dir, "slug"))).toEqual([]);
  });

  /**
   * Run 12's regression check. Its reference solve read absent publicInput fields and produced
   * the same allocationPlan for 25 different tasks. Two later iterations received only a failure
   * count. The refusal now identifies the constant root while withholding task ids and verifier text.
   */
  it("reports constant reference output to the correctness-model author without task ids or verifier text", async () => {
    const witnesses = [runTwelve("t1", ["U01"]), runTwelve("t2", ["U01", "U02"])];
    const { feedback, evidence } = await runGate("insensitive", witnesses, "failed");
    expect(feedback).toHaveLength(1);
    expect(feedback[0]).toMatchObject({ owner: "correctness-model", severity: "blocking" });
    expect(feedback[0]?.findings?.map((f) => f.code)).toEqual([
      "SOLVABILITY_CENSUS_BLOCKED",
      "REFERENCE_SOLVE_IGNORES_PUBLIC_INPUT",
    ]);
    const visible = JSON.stringify(feedback);
    expect(visible).toContain("allocationPlan");
    expect(visible).toContain("2 distinct public inputs");
    expect(visible).not.toContain("t1"); // no per-task localisation
    expect(visible).not.toContain("[engine]"); // no engine words
    expect(visible).not.toContain("hidden-check");
    // The full record persists host-side, protected, as before.
    expect(JSON.stringify(evidence)).toContain("hidden-check");
  });
});
