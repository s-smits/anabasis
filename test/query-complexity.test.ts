import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import type { CaseRecordRow } from "../src/claim/case-record.ts";
import { caseRecordRow } from "./helpers/case-record-row.ts";
import {
  ANCHOR_SHA256,
  STRUCTURE_KEYS,
  TIERS,
  TIER_ORDER,
  leafPaths,
  loadBundle,
  numericLeaves,
  readBattery,
  structureOf,
  unitsOf,
} from "../.claude/skills/whole-run-investigation/classifier/query-complexity.mjs";
import {
  VELOCITY_SCHEMA,
  numericDriftOf,
  outcomesOf,
  readCampaign,
  render,
  sourceMovesOf,
  topTierOf,
  velocityOf,
  placementOf,
  verdictOf,
} from "../.claude/skills/whole-run-investigation/scripts/climb-velocity.mjs";

/** The bundle fields these fixtures write. The module reads a bundle as parsed JSON, so the test
 *  names the shape it authors rather than borrowing one from the reader. */
interface TruthCheck {
  id: string;
  assertion: string;
  citedDecisionIds: string[];
  execution: {
    families: "all" | string[];
    artifactPaths: string[];
    publicInputPaths: string[];
    requiredToolIds?: string[];
  };
  numericBoundaries?: { publicInputPath: string; constantName: string }[];
}
interface Brief {
  domain: string;
  decisions: string[];
  truthChecks: TruthCheck[];
}
interface Task {
  taskId: string;
  family: string;
  publicInput: typeof HEAVY_INPUT | { limits: { mass: number } };
}
type Structure = ReturnType<typeof structureOf>;

const dirs: string[] = [];
/** The heavy task's public input, named so the fixture writer can take it without widening to
 *  `unknown`: a parameter that admits any public input admits everything. */
const HEAVY_INPUT = { limits: { mass: 100 }, scenarios: [{ id: "s1" }, { id: "s2" }] };
const heavy: Task = { taskId: "heavy-01", family: "heavy", publicInput: HEAVY_INPUT };
const light: Task = { taskId: "light-01", family: "light", publicInput: { limits: { mass: 100 } } };

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const write = (path: string, value: Brief | Task[] | typeof HEAVY_INPUT | { createdAt: string }): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value), "utf8");
};

/** One axis per tier, scored by word overlap with that tier's real anchors. It is not a language
 *  model, but it embeds against the anchors the module actually ships, so a renamed or reworded
 *  anchor is visible here rather than only at the far end of a model download. */
const wordsOf = (text: string): Set<string> => new Set(text.toLowerCase().match(/[a-z-]+/g) ?? []);
const TIER_WORDS = TIER_ORDER.map((name) => {
  const words = new Set<string>();
  const anchors = new Map(Object.entries(TIERS)).get(name) ?? [];
  for (const anchor of anchors) for (const word of wordsOf(anchor)) words.add(word);
  return words;
});

function fakeEmbed(texts: string[]): Promise<number[][]> {
  return Promise.resolve(
    texts.map((text) => {
      const own = wordsOf(text);
      const raw = TIER_WORDS.map((words) => {
        let shared = 0;
        for (const word of own) if (words.has(word)) shared += 1;
        return shared / Math.max(1, own.size);
      });
      const length = Math.sqrt(raw.reduce((sum, value) => sum + value * value, 0)) || 1;
      return raw.map((value) => value / length);
    }),
  );
}

const check = (id: string, assertion: string, over: Partial<TruthCheck> = {}): TruthCheck => ({
  id,
  assertion,
  citedDecisionIds: ["rule-a"],
  execution: { families: "all", artifactPaths: ["$.design"], publicInputPaths: ["$.limits.mass"] },
  ...over,
});

const brief: Brief = {
  domain: "test",
  decisions: ["one decision"],
  truthChecks: [
    check("mass", "the reported total stays under one published limit"),
    check("loss", "every limit holds and in each single-loss scenario", {
      execution: {
        families: ["heavy"],
        artifactPaths: ["$.results"],
        publicInputPaths: ["$.limits.mass", "$.scenarios"],
        requiredToolIds: ["solver"],
      },
      numericBoundaries: [{ publicInputPath: "$.limits.mass", constantName: "mass" }],
      citedDecisionIds: ["rule-a", "rule-b"],
    }),
  ],
};
describe("query complexity", () => {
  it.concurrent("scopes a check by its declared families and counts what the family carries", () => {
    expect(structureOf(heavy, brief)).toEqual({
      checks: 2,
      limits: 1,
      coupled: 1,
      tooled: 1,
      rules: 2,
      roots: 2,
      inputs: 2,
      scenarios: 2,
    });
    // "all" reaches every family; the named list does not reach this one, so the tooled check is gone.
    expect(structureOf(light, brief)).toMatchObject({
      checks: 1,
      limits: 0,
      coupled: 0,
      tooled: 0,
      roots: 1,
    });
  });

  it.concurrent("reports every structural key it declares", () => {
    expect(Object.keys(structureOf(heavy, brief)).sort()).toEqual([...STRUCTURE_KEYS].sort());
  });

  it.concurrent("indexes list positions so two batteries line up leaf by leaf", () => {
    expect(numericLeaves({ limits: { mass: 100 }, cases: [{ load: 2 }, { load: 5 }] })).toEqual({
      "limits.mass": 100,
      "cases[0].load": 2,
      "cases[1].load": 5,
    });
    // leafPaths answers a different question and collapses the list, so a catalogue is one input.
    expect(leafPaths({ cases: [{ load: 2 }, { load: 5 }] })).toEqual(["cases[].load"]);
  });

  it.concurrent("takes one unit per applicable assertion, never one blob", () => {
    expect(unitsOf("heavy", brief)).toHaveLength(2);
    expect(unitsOf("light", brief)).toEqual(["the reported total stays under one published limit"]);
  });

  // The ladder moved down one rung on 2026-09-19, so these two checks read one tier lower than they
  // did against the old anchors: the single-loss assertion was the top tier and is now `hard`, and
  // the one-limit assertion was `medium` and is now `easy`. That is the whole point of the shift,
  // and this is where it is visible on a fixture that did not change.
  it.concurrent("labels a family by the strongest tier one of its checks reaches", async () => {
    const reading = await readBattery({ brief, tasks: [heavy, light] }, { embed: fakeEmbed });
    const byTask = new Map(reading.rows.map((row) => [row.taskId, row]));
    expect(byTask.get("heavy-01")).toMatchObject({ tier: "hard", reached: 1 });
    expect(byTask.get("light-01")).toMatchObject({ tier: "easy", reached: 1 });
    // The check histogram is what separates two batteries whose strongest check is the same tier.
    expect(reading.checkTiers).toMatchObject({ hard: 1, easy: 2 });
  });

  // A new top tier nobody can reach would read as "every battery is hard" and hide the next climb.
  // The frontier properties are what a hard check does not assert: a worst case searched rather
  // than handed over, and a margin that must survive its neighbours.
  it.concurrent("keeps the new frontier tier reachable by a check that asserts its properties", async () => {
    const frontierBrief: Brief = {
      domain: "test",
      decisions: ["one decision"],
      truthChecks: [
        check(
          "searched",
          "the reported worst case is the worst case over the whole declared set, and the verifier's own search of that set finds nothing worse",
        ),
        check(
          "neighbour",
          "no admissible neighbour of the submitted answer improves one reported margin without costing another more than the published trade rule allows",
        ),
      ],
    };
    const reading = await readBattery({ brief: frontierBrief, tasks: [light] }, { embed: fakeEmbed });
    expect(reading.rows[0]).toMatchObject({ tier: "frontier" });
    expect(reading.checkTiers).toMatchObject({ frontier: 2 });
  });

  it.concurrent("reads a campaign version and an exported query pack the same way", () => {
    const dir = temp("ana-query-pack-");
    write(join(dir, "pack", "brief.json"), brief);
    write(join(dir, "pack", "heavy-01", "input.json"), HEAVY_INPUT);
    write(join(dir, "version", "correctness-model", "brief.json"), brief);
    write(join(dir, "version", "correctness-model", "tasks.json"), [heavy]);
    expect(loadBundle(join(dir, "pack")).tasks).toEqual([heavy]);
    expect(loadBundle(join(dir, "version")).tasks).toEqual([heavy]);
  });

  it.concurrent("keeps the anchor set digested and ordered weakest to strongest", () => {
    expect(TIER_ORDER).toEqual(["easy", "medium", "hard", "frontier"]);
    expect(ANCHOR_SHA256).toHaveLength(64);
    // Every tier carries both registers, so a check assertion never scores against a task statement.
    for (const anchors of Object.values(TIERS)) expect(anchors.length).toBeGreaterThanOrEqual(8);
  });
});

/** Write rows the way the case-record writer does: one `{seq, row}` line each, seq from 1. */
function writeCaseRecord(dir: string, rows: CaseRecordRow[]): void {
  const lines = rows.map((row, index) => JSON.stringify({ seq: index + 1, row }));
  writeFileSync(join(dir, "case-record.jsonl"), `${lines.join("\n")}\n`, "utf8");
}

describe("climb velocity", () => {
  const reading = (mass: number) => ({ rows: [{ taskId: "heavy-01", numerics: { "limits.mass": mass } }] });

  it.concurrent("reports no movement when the numbers are unchanged", () => {
    expect(numericDriftOf(reading(100), reading(100))).toEqual({ median: 0, moved: 0 });
  });

  it.concurrent("measures how far a published number was pulled in", () => {
    expect(numericDriftOf(reading(100), reading(90))).toEqual({ median: 0.1, moved: 1 });
    // Direction is absent on purpose: a loosened limit moved just as far as a tightened one.
    expect(numericDriftOf(reading(100), reading(110))).toEqual({ median: 0.1, moved: 1 });
  });

  const counts = (passed: number, verified: number, unaccepted = 0) => ({
    passed,
    verified,
    unaccepted,
    nonResult: 0,
  });

  // The placement is the controller's: its deciding sample, read by its band owner.
  it.concurrent("places a battery with the same interval the controller uses", () => {
    expect(placementOf(counts(24, 25))).toMatchObject({ zone: "too-easy", population: "whole-battery" });
    expect(placementOf(counts(24, 25))?.lo).toBeCloseTo(0.8046, 4);
    expect(placementOf(counts(0, 0, 25))).toBeNull();
  });

  // Once any case is verified, a refused submit is a difficulty failure. Read as passed over
  // verified, five passes beside twenty refused submits placed at a rate of 1, far above the band
  // the controller placed that same battery on.
  it.concurrent("keeps unaccepted attempts in the denominator, as the controller does", () => {
    expect(placementOf(counts(5, 5, 20))).toMatchObject({ passes: 5, n: 25, rate: 0.2, zone: "on-aim" });
  });

  it.concurrent("reads the changed subset when the host recorded one", () => {
    const measured = { items: [], changedSubset: { attempts: 5, passes: 0 } };
    expect(placementOf(counts(20, 25), measured)).toMatchObject({
      population: "changed-subset",
      passes: 0,
      n: 5,
    });
  });

  it.concurrent("refuses a rate change it cannot draw from two verified batteries", () => {
    const one = { batteries: [{ counts: { verified: 25 }, placement: placementOf(counts(24, 25)) }] };
    expect(velocityOf(one)).toMatchObject({ reason: "one verified battery: a rate change needs two" });
    expect(velocityOf({ batteries: [{ counts: { verified: 0 }, placement: null }] })).toMatchObject({
      reason: "no battery verified a case",
    });
  });

  // The reading the velocity line cannot give. A rate needs two measured batteries; the newest edge
  // needs none, because both task-side rows come from the authored bytes under `versions/`. Campaign
  // 3fd52f9e-10 read `widened` then `adjusted` on its second and third rounds and paid about four
  // hours of solves each to confirm a 6 of 6 that settled nothing, with both verdicts already in the
  // adopted bytes.
  it.concurrent("ends on the newest edge, whether or not the later battery measured a case", () => {
    const zeros: Structure = {
      checks: 0,
      limits: 0,
      coupled: 0,
      tooled: 0,
      rules: 0,
      roots: 0,
      inputs: 0,
      scenarios: 0,
    };
    const battery = (runId: string) => ({
      runId,
      dir: runId,
      createdAt: null,
      claimed: false,
      reading: {
        schema: "",
        tasks: 0,
        families: [],
        histogram: {},
        checkTiers: { easy: 0, medium: 0, hard: 0, frontier: 0 },
        medians: zeros,
        rows: [],
        familyVectors: {},
      },
      counts: { passed: 0, verified: 0, unaccepted: 0, nonResult: 0 },
      placement: null,
    });
    const report = (verdict: ReturnType<typeof verdictOf>) => ({
      schema: VELOCITY_SCHEMA,
      campaign: "/c",
      model: {},
      batteries: [battery("i03"), battery("i04")],
      // `source` is required on an Edge, and null is its own reading: the two bundles were not read.
      edges: [
        {
          from: "i03",
          to: "i04",
          verdict,
          novelty: null,
          drift: { median: 0, moved: 0 },
          delta: zeros,
          source: null,
          outcome: "unobservable",
        },
      ],
    });

    expect(render(report("escalated"))).toContain(
      "latest edge: i03 -> i04 escalated — the checks reached a higher tier, so this battery can find a limit the last one missed",
    );
    expect(render(report("widened"))).toContain(
      "widened — the checks held their tier, so this battery asks the solver for nothing the last one did not",
    );
    expect(render(report("eased"))).toContain(
      "eased — the checks fell down the tier order, so this battery asks for less than the last one",
    );
    expect(render({ ...report("escalated"), edges: [] })).toContain(
      "latest edge: none, because an edge needs two batteries",
    );
  });

  it.concurrent("says a flat rate is flat rather than projecting a climb", () => {
    const flat = {
      batteries: [
        { counts: { verified: 25 }, placement: placementOf(counts(24, 25)) },
        { counts: { verified: 14 }, placement: placementOf(counts(14, 14)) },
      ],
    };
    expect(velocityOf(flat)).toMatchObject({
      reason: "the measured rate has not fallen across the verified batteries",
    });
  });

  // An unaccepted attempt is recorded with pass=false, so a reader that asks only about `pass`
  // counts a battery the solver never submitted to as 0/25 verified and places it. That battery
  // reached no verdict either way: it has no rate, and the attempts belong in their own column.
  it.concurrent("separates an unaccepted attempt from a case the verifier failed", () => {
    const dir = temp("ana-climb-outcomes-");
    writeCaseRecord(dir, [
      caseRecordRow("t1", "f", { runId: "run-a" }),
      caseRecordRow("t2", "f", { runId: "run-a", truthOk: false, pass: false }),
      caseRecordRow("t3", "f", { runId: "run-a", acceptedSubmit: false, truthOk: null, pass: false }),
      caseRecordRow("t4", "f", {
        runId: "run-a",
        acceptedSubmit: false,
        truthOk: null,
        pass: null,
        runtimeNonResult: "provider stopped",
        runtimeNonResultKind: "provider",
      }),
    ]);
    expect(outcomesOf(dir).get("run-a")).toEqual({ passed: 1, verified: 2, unaccepted: 1, nonResult: 1 });
  });

  // The case record's writer has always stored `acceptedSubmit`, so a row without it is not an older
  // spelling of a verdict but a row the writer never produced. Guessing true for it once read such a
  // row as verified; the strict reader refuses it instead of choosing a column for it.
  it.concurrent("refuses a row without acceptedSubmit rather than guessing its verdict", () => {
    const dir = temp("ana-climb-legacy-");
    const { acceptedSubmit: _dropped, ...row } = caseRecordRow("t1", "f", { runId: "run-a" });
    writeFileSync(join(dir, "case-record.jsonl"), `${JSON.stringify({ seq: 1, row })}\n`, "utf8");
    expect(() => outcomesOf(dir)).toThrow();
  });

  // A battery that fell down the tier order, and one that dropped a check, both read as `adjusted`
  // — the one verdict that names no direction. A retreat reported as neutral is the reading this
  // script exists to prevent.
  it.concurrent("names a retreat instead of reporting it as adjusted", () => {
    const flat = { checks: 0, limits: 0, coupled: 0, tooled: 0, rules: 0, roots: 0, inputs: 0, scenarios: 0 };
    const still = { median: 0, moved: 0 };
    const tiers = (medium: number, hard: number) => ({ checkTiers: { easy: 0, medium, hard, frontier: 0 } });
    expect(verdictOf(tiers(0, 2), tiers(2, 0), null, flat, still)).toBe("eased");
    expect(verdictOf(tiers(2, 0), tiers(0, 2), null, flat, still)).toBe("escalated");
    expect(verdictOf(tiers(2, 0), tiers(2, 0), null, { ...flat, checks: -1 }, still)).toBe("narrowed");
    expect(verdictOf(tiers(2, 0), tiers(2, 0), null, { ...flat, checks: 1 }, still)).toBe("widened");
    expect(verdictOf(tiers(2, 0), tiers(2, 0), null, flat, still)).toBe("restated");
  });

  // Five more checks at a tier a battery already occupies is a wider battery, not a harder one. A
  // rank-weighted total rose with the count; the mean that replaced it moved with the count too,
  // downwards when a check was added below it and upwards when one was dropped, so a wider battery
  // read `eased` and a shorter one `escalated`. The top tier moves for neither.
  it.concurrent("reads the tier a battery reaches, not how many checks sit below it", () => {
    expect(topTierOf({ easy: 0, medium: 2, hard: 0, frontier: 0 })).toBe(1);
    expect(topTierOf({ easy: 0, medium: 7, hard: 0, frontier: 0 })).toBe(1);
    expect(topTierOf({ easy: 9, medium: 1, hard: 1, frontier: 0 })).toBe(2);
    expect(topTierOf({ easy: 0, medium: 1, hard: 0, frontier: 1 })).toBe(3);
    expect(topTierOf({ easy: 0, medium: 0, hard: 0, frontier: 0 })).toBeNull();
  });

  const wider: Brief = {
    ...brief,
    truthChecks: [
      ...brief.truthChecks,
      check("mass-b", "the reported total stays under one published limit"),
    ],
  };

  /** Two adopted versions a day apart, each with its brief and the same two tasks. */
  function twoVersions(
    prefix: string,
    briefs: [Brief, Brief],
    each?: (model: string, index: number) => void,
  ) {
    const dir = temp(prefix);
    ["run-a", "run-b"].forEach((runId, index) => {
      const model = join(dir, "versions", runId, "correctness-model");
      write(join(model, "brief.json"), briefs[index] ?? brief);
      write(join(model, "tasks.json"), [heavy, light]);
      each?.(model, index);
      write(join(dir, "claims", `${runId}.json`), { createdAt: `2026-09-0${index + 1}T00:00:00Z` });
    });
    return dir;
  }

  // A wider battery at the same tiers once read "escalated" as a rank-weighted total, which is the
  // one verdict claiming the solver has something new to reason about; the reverse edge is narrowed.
  it.concurrent.each([
    ["restated", [brief, brief]],
    ["widened", [brief, wider]],
    ["narrowed", [wider, brief]],
  ] as const)("calls an edge at unchanged tiers %s", async (verdict, briefs) => {
    const dir = twoVersions(`ana-climb-${verdict}-`, [...briefs]);
    if (verdict === "restated") {
      writeCaseRecord(
        dir,
        [heavy, light].map((task) => caseRecordRow(task.taskId, "f", { runId: "run-a" })),
      );
    }
    const report = await readCampaign(dir, { embed: fakeEmbed });
    expect(report.edges).toHaveLength(1);
    expect(report.edges[0]).toMatchObject({ verdict, outcome: "unobservable" });
    if (verdict === "restated") expect(report.edges[0]?.novelty?.mean).toBeCloseTo(0, 6);
  });

  // Both task-side rows read brief.json and tasks.json only. The truss run published a new
  // requirement in rules.ts under an existing check, left evaluator.ts byte-identical, and the edge
  // read `novelty 0.0000 ... rules +0` — a renumbering. The digest row is what says otherwise.
  it.concurrent("names the correctness-model file that moved when brief and tasks did not", async () => {
    const rules = [
      "export const LIMITS = 1;\n",
      "export const LIMITS = 1;\nexport const CLEARANCE = 0.05;\n",
    ];
    const dir = twoVersions("ana-climb-source-", [brief, brief], (model, index) => {
      writeFileSync(join(model, "rules.ts"), rules[index] ?? "", "utf8");
      writeFileSync(join(model, "evaluator.ts"), "export const checks = [];\n", "utf8");
      mkdirSync(join(model, "reference"), { recursive: true });
      writeFileSync(join(model, "reference", "index.ts"), "export const solve = () => ({});\n", "utf8");
    });
    const report = await readCampaign(dir, { embed: fakeEmbed });
    // The verdict is deliberately unmoved: a digest cannot tell a requirement from a comment.
    expect(report.edges[0]).toMatchObject({
      verdict: "restated",
      source: { changed: ["rules.ts"], added: [], removed: [], unchanged: 2, read: 3 },
    });
    expect(render(report, [0.2, 0.5])).toContain(
      "correctness-model source, digests only, unread by the two rows above: rules.ts moved, 2 of 3 unchanged",
    );
  });

  // The hostile half: two identical bundles must not read as a moved correctness model.
  it.concurrent("says no file moved rather than implying one did", () => {
    const dir = temp("ana-climb-same-");
    for (const runId of ["run-a", "run-b"]) {
      const model = join(dir, "versions", runId, "correctness-model");
      mkdirSync(model, { recursive: true });
      writeFileSync(join(model, "evaluator.ts"), "export const checks = [];\n", "utf8");
      // brief.json and tasks.json are scored by the other two rows, so a change here is not this
      // row's to report: only `evaluator.ts` is counted, and it is identical.
      write(join(model, "tasks.json"), [runId === "run-a" ? heavy : light]);
    }
    expect(sourceMovesOf(join(dir, "versions", "run-a"), join(dir, "versions", "run-b"))).toEqual({
      changed: [],
      added: [],
      removed: [],
      unchanged: 1,
      read: 1,
    });
    // A battery whose bundle is gone reads no correctness model at all, and says nothing.
    expect(sourceMovesOf(join(dir, "versions", "absent"), join(dir, "versions", "gone"))).toBeNull();
  });
});
