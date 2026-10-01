import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import type { CaseRecordRow } from "../src/claim/case-record.ts";
import { type CaseDisposition, EPOCH_REVIEW_SCHEMA } from "../src/review/epoch-review-findings.ts";
import { SOLVE_WALL_MESSAGE } from "../src/backends/backend-types.ts";
import { caseRecordRow } from "./helpers/case-record-row.ts";
import { recordDigestBattery } from "./helpers/digest-battery.ts";
import { double } from "./helpers/doubles.ts";
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
} from "../.claude/skills/whole-run-investigation/classifier/query-complexity.ts";
import {
  type ClimbReport,
  VELOCITY_SCHEMA,
  numericDriftOf,
  outcomesOf,
  readCampaign,
  render,
  sourceMovesOf,
  topTierOf,
  lineOf,
  placementOf,
  verdictOf,
} from "../.claude/skills/whole-run-investigation/scripts/climb-velocity.ts";

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
    evidence?: { kind: "authored" } | { kind: "external"; requiredToolIds: string[] };
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

  it.concurrent("counts an external check's instrument as tooled, and an authored one without a tool as not", () => {
    const external = check("states", "the nonlinear states hold", {
      execution: {
        families: "all",
        artifactPaths: ["$.design"],
        publicInputPaths: [],
        evidence: { kind: "external", requiredToolIds: ["truss-python"] },
      },
    });
    const authored = check("mass", "the mass stays under its cap", {
      execution: {
        families: "all",
        artifactPaths: ["$.design"],
        publicInputPaths: [],
        evidence: { kind: "authored" },
      },
    });
    expect(structureOf(light, { ...brief, truthChecks: [external, authored] }).tooled).toBe(1);
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

  it.concurrent("keeps the anchor set digested, with both registers in every tier", () => {
    expect(ANCHOR_SHA256).toMatch(/^[0-9a-f]{64}$/);
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

  // Direction is absent on purpose: a loosened limit moved just as far as a tightened one.
  it.concurrent.each([
    [100, { median: 0, moved: 0, joined: 1, tasks: 1 }],
    [90, { median: 0.1, moved: 1, joined: 1, tasks: 1 }],
    [110, { median: 0.1, moved: 1, joined: 1, tasks: 1 }],
  ])("measures how far a published number of 100 moved to %d", (after, drift) => {
    expect(numericDriftOf(reading(100), reading(after))).toEqual(drift);
  });

  // Renaming every task once read as "numbers moved 0" and so as `restated`, over batteries whose
  // limits had moved 3.75 times: the join found nothing and reported nothing as no change.
  it.concurrent("names a battery whose task ids all changed as replaced, not restated", () => {
    const renamed = { rows: [{ taskId: "heavy-02", numerics: { "limits.mass": 375 } }] };
    const drift = numericDriftOf(reading(100), renamed);
    expect(drift).toEqual({ median: 0, moved: 0, joined: 0, tasks: 1 });
    const flat = { checks: 0, limits: 0, coupled: 0, tooled: 0, rules: 0, roots: 0, inputs: 0, scenarios: 0 };
    const tiers = { checkTiers: { easy: 0, medium: 2, hard: 0, frontier: 0 } };
    expect(verdictOf(tiers, tiers, null, flat, drift)).toBe("replaced");
  });

  // A renumbered battery keeps one id by chance, and that one task's unchanged numbers once read
  // as the whole battery standing still: 1 of 25 joined, 0 moved, `restated`. A battery adding one
  // new task to 24 unchanged ones still asked for something the last did not, so it is not restated.
  it.concurrent("reads a mostly renumbered or partly new battery as moved, not restated", () => {
    const flat = { checks: 0, limits: 0, coupled: 0, tooled: 0, rules: 0, roots: 0, inputs: 0, scenarios: 0 };
    const tiers = { checkTiers: { easy: 0, medium: 2, hard: 0, frontier: 0 } };
    const rows = (ids: string[]) => ({
      rows: ids.map((taskId) => ({ taskId, numerics: { "limits.mass": 100 } })),
    });
    const ids = Array.from({ length: 25 }, (_, at) => `truss-${at}`);
    const renumbered = numericDriftOf(
      rows(ids.slice(0, 5)),
      rows(["truss-0", ...ids.slice(5).map((id) => `${id}b`)]),
    );
    expect(renumbered).toEqual({ median: 0, moved: 0, joined: 1, tasks: 21 });
    expect(verdictOf(tiers, tiers, null, flat, renumbered)).toBe("replaced");
    const oneNew = numericDriftOf(rows(ids.slice(0, 24)), rows(ids));
    expect(verdictOf(tiers, tiers, null, flat, oneNew)).toBe("adjusted");
    expect(verdictOf(tiers, tiers, null, flat, numericDriftOf(rows(ids), rows(ids)))).toBe("restated");
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

  /** A line of claimed batteries, one per pair of passed and verified counts, in that order. */
  const line = (...batteries: (readonly [number, number])[]) =>
    lineOf({
      batteries: batteries.map(([passed, verified], at) => ({
        runId: `i${String(at + 1).padStart(2, "0")}`,
        createdAt: `2026-09-01T${String(at).padStart(2, "0")}:00:00Z`,
        claimed: true,
        settlement: null,
        placement: placementOf(counts(passed, verified)),
        earned: null,
      })),
    });
  const repeat = (times: number, passed: number, verified: number) =>
    Array.from({ length: times }, () => [passed, verified] as const);

  // The velocity is the line's. It once was the slope from the first placed battery to the last,
  // which read a line of thirteen 7/7 batteries and one holding a 6/7 and a 10/11 alike ("the rate
  // has not fallen"), and gave the line with the most partial batteries a projection to the band
  // from its endpoints alone. Only a battery between 1/n and n-1/n can locate a limit, so that count
  // orders the lines, and a full pass adds nothing to it however it places.
  it.concurrent("orders lines by the batteries that landed between 1/n and n-1/n, not by their endpoints", () => {
    const located = line(
      ...repeat(4, 6, 6),
      [2, 6],
      [25, 25],
      ...repeat(2, 11, 11),
      [9, 11],
      [10, 10],
      [11, 11],
      [10, 10],
      [11, 11],
      [10, 11],
    );
    const fewer = line(...repeat(7, 5, 5), ...repeat(2, 7, 7), [6, 7], [25, 25], [10, 11], [11, 11]);
    const flat = line(...repeat(13, 7, 7));
    expect(
      [located, fewer, flat].map(({ signal }) => signal.map(({ passes, n }) => `${passes}/${n}`)),
    ).toEqual([["2/6", "9/11", "10/11"], ["6/7", "10/11"], []]);
    expect(located.horizons).toEqual([
      { rounds: 8, signal: 1 },
      { rounds: 12, signal: 2 },
    ]);
    expect(flat).toMatchObject({ fullPasses: 13, swing: 0, streak: { side: "above", flat: 12 } });
    expect(located.swing).toBeGreaterThan(fewer.swing ?? Number.POSITIVE_INFINITY);
  });

  // The launch film's illustration: a raised requirement drops the rate, a repair lifts it, and over
  // twelve rounds the swings settle into the band. It rises as often as it falls, and it is the shape
  // the goal describes, so it reads as signal on every battery but the full pass and never as flat.
  // A small full pass places over the aim and is still no signal.
  it.concurrent("reads a line that swings through the band as moving, and a full pass as no signal at any size", () => {
    const film = line(
      ...[25, 6, 5, 24, 17, 21, 12, 19, 21, 9, 12, 11].map((passed) => [passed, 25] as const),
    );
    expect(film).toMatchObject({ fullPasses: 1, onAim: 6, streak: null });
    expect(film.signal).toHaveLength(11);
    expect(film.horizons).toEqual([
      { rounds: 8, signal: 7 },
      { rounds: 12, signal: 11 },
    ]);
    expect(film.swing).toBeCloseTo(30.5, 1);
    const small = line([3, 3]);
    expect(small.points[0]?.zone).toBe("over-aim");
    expect(small).toMatchObject({ signal: [], fullPasses: 1, swing: null, horizons: [] });
  });

  // The newest edge needs no measured battery, because both task-side rows come from the authored
  // bytes under `versions/`. Campaign
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
      recorded: null,
      followUp: null,
    });
    const report = (verdict: ReturnType<typeof verdictOf>) =>
      double<ClimbReport>({
        schema: VELOCITY_SCHEMA,
        campaign: "/c",
        model: {},
        batteries: [battery("i03"), battery("i04")],
        unadopted: [],
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
            carried: { unchanged: 0, tasks: 0, afterFullPass: false },
            outcome: "unobservable",
          },
        ],
      });

    expect(render(report("escalated"))).toContain(
      "latest edge: i03 -> i04 escalated — the checks reached a higher tier; the tier says what the checks read, not whether the tasks ask more",
    );
    expect(render(report("widened"))).toContain(
      "widened — the checks held their tier; new tasks or scenarios may still ask more, so read the task rows",
    );
    expect(render(report("eased"))).toContain(
      "eased — the checks fell down the tier order; new tasks or scenarios may still ask more",
    );
    expect(render({ ...report("escalated"), edges: [] })).toContain(
      "latest edge: none, because an edge needs two batteries",
    );
    expect(render(report("widened"))).toContain(
      "velocity: no claimed battery verified a case, so there is no line yet",
    );
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
    expect(() => outcomesOf(dir)).toThrow(/case-record\.jsonl:1: acceptedSubmit must be a boolean/);
  });

  // A battery that fell down the tier order, and one that dropped a check, both read as `adjusted`
  // — the one verdict that names no direction. A retreat reported as neutral is the reading this
  // script exists to prevent.
  it.concurrent("names a retreat instead of reporting it as adjusted", () => {
    const flat = { checks: 0, limits: 0, coupled: 0, tooled: 0, rules: 0, roots: 0, inputs: 0, scenarios: 0 };
    const still = { median: 0, moved: 0, joined: 1, tasks: 1 };
    const tiers = (medium: number, hard: number) => ({ checkTiers: { easy: 0, medium, hard, frontier: 0 } });
    expect(verdictOf(tiers(0, 2), tiers(2, 0), null, flat, still)).toBe("eased");
    expect(verdictOf(tiers(2, 0), tiers(0, 2), null, flat, still)).toBe("escalated");
    expect(verdictOf(tiers(2, 0), tiers(2, 0), null, { ...flat, checks: -1 }, still)).toBe("narrowed");
    expect(verdictOf(tiers(2, 0), tiers(2, 0), null, { ...flat, checks: 1 }, still)).toBe("widened");
    expect(verdictOf(tiers(2, 0), tiers(2, 0), null, flat, still)).toBe("restated");
  });

  // truss-sol-2d7812 added load sites and a forbidden volume, two inputs at the same checks, and read
  // `adjusted`, the label for the same counts with numbers moved. Any structural count names a
  // direction; checks, couplings and scenarios decide first, and only they survive replaced tasks.
  it.concurrent("names growth in any structural count, and keeps a replaced edge replaced", () => {
    const flat = { checks: 0, limits: 0, coupled: 0, tooled: 0, rules: 0, roots: 0, inputs: 0, scenarios: 0 };
    const still = { median: 0, moved: 0, joined: 1, tasks: 1 };
    const swapped = { median: 0, moved: 0, joined: 0, tasks: 2 };
    const tiers = { checkTiers: { easy: 0, medium: 2, hard: 0, frontier: 0 } };
    expect(verdictOf(tiers, tiers, null, { ...flat, inputs: 2 }, still)).toBe("widened");
    expect(verdictOf(tiers, tiers, null, { ...flat, rules: -1 }, still)).toBe("narrowed");
    expect(verdictOf(tiers, tiers, null, { ...flat, checks: -1, inputs: 3 }, still)).toBe("narrowed");
    expect(verdictOf(tiers, tiers, null, { ...flat, inputs: 2 }, swapped)).toBe("replaced");
    expect(verdictOf(tiers, tiers, null, { ...flat, scenarios: 1 }, swapped)).toBe("widened");
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
    expect(render(report)).toContain(
      "correctness-model source, digests only, unread by the two rows above: rules.ts moved, 2 of 3 unchanged",
    );
  });

  // The 2d7812 firmware battery read 4/6 over the aim on two fails of one check that held the sketch
  // to a status label no public rule stated. A placement resting on fails the review settled against
  // their check measured the check, so the reader says which fails were earned and where the battery
  // lands once they leave; with no completed review it says none is known earned.
  it.concurrent("reads a partial battery against the review that settled its fails", async () => {
    const dir = twoVersions("ana-climb-earned-", [brief, brief]);
    const tasks = ["a", "b", "c", "d", "e", "f"];
    writeCaseRecord(
      dir,
      tasks.map((task, index) =>
        caseRecordRow(task, "f", { runId: "run-b", ...(index < 2 && { truthOk: false, pass: false }) }),
      ),
    );
    const unread = render(await readCampaign(dir, { embed: fakeEmbed }));
    expect(unread).toContain("fails 2: no completed review settled any, so none is known earned");
    const settled = (task: string, disposition: CaseDisposition["disposition"]): CaseDisposition => ({
      taskId: task,
      family: "f",
      kind: "disputed-pass",
      checkId: "bench-wiring",
      disposition,
      finding: 0,
    });
    mkdirSync(join(dir, "analysis"), { recursive: true });
    const review = (dispositions: CaseDisposition[]) =>
      writeFileSync(
        join(dir, "analysis", "run-b-epoch-review.json"),
        JSON.stringify({ status: "completed", dispositions }),
        "utf8",
      );
    review([settled("a", "check-stands"), settled("b", "check-stands")]);
    const held = await readCampaign(dir, { embed: fakeEmbed });
    expect(held.batteries[1]?.earned).toBeNull();
    expect(lineOf(held).signal).toMatchObject([{ runId: "run-b", passes: 4, n: 6 }]);
    expect(render(held)).toContain(
      "fails 2: 2 held by the review, 0 settled against the check, 0 unsettled; checks bench-wiring",
    );
    review([settled("a", "against-check"), settled("b", "against-check")]);
    const against = await readCampaign(dir, { embed: fakeEmbed });
    expect(against.batteries[1]?.earned).toMatchObject({ passes: 4, n: 4 });
    expect(render(against)).toContain(
      `earned ${String(against.batteries[1]?.earned?.zone)} at 4/4 over the whole battery`,
    );
    // Fails settled against their check located nothing, so the line reads the battery as a full pass.
    expect(lineOf(against)).toMatchObject({ signal: [], fullPasses: 1, points: [{ passes: 4, n: 4 }] });
  });

  // A forked campaign's seed version carries no claim of its own and so no time, and sorted after the
  // batteries derived from it, every fork edge read backwards (350009 -> seed, 2026-10-01). A version
  // still measuring is also unclaimed, and stays last.
  it.concurrent("reads a fork's edges from the version it was seeded from", async () => {
    const dir = twoVersions("ana-climb-seed-", [brief, wider]);
    rmSync(join(dir, "claims", "run-a.json"));
    const unseeded = await readCampaign(dir, { embed: fakeEmbed });
    expect(unseeded.edges).toMatchObject([{ from: "run-b", to: "run-a" }]);
    writeFileSync(join(dir, "seed.json"), JSON.stringify({ selectedProductId: "run-a" }), "utf8");
    const seeded = await readCampaign(dir, { embed: fakeEmbed });
    expect(seeded.edges).toMatchObject([{ from: "run-a", to: "run-b", verdict: "widened" }]);
  });

  // A round can measure again without adopting a version, and its battery is still a point on the
  // line though no edge can be read into it. A reader keyed on version directories left two of
  // fourteen claimed batteries off one run's line.
  it.concurrent("puts a claimed battery with no version of its own on the line and on no edge", async () => {
    const dir = twoVersions("ana-climb-unadopted-", [brief, brief]);
    const rows = (runId: string, fails: number) =>
      ["a", "b", "c"].map((task, index) =>
        caseRecordRow(task, "f", { runId, ...(index < fails && { truthOk: false, pass: false }) }),
      );
    writeCaseRecord(dir, [
      ...rows("run-a", 0),
      ...rows("run-b", 0),
      ...rows("run-c", 1),
      ...rows("run-d", 0),
    ]);
    write(join(dir, "claims", "run-c.json"), { createdAt: "2026-09-03T00:00:00Z" });
    const report = await readCampaign(dir, { embed: fakeEmbed });
    expect(report.edges).toHaveLength(1);
    expect(report.unadopted.map(({ runId }) => runId)).toEqual(["run-c"]);
    expect(lineOf(report)).toMatchObject({ fullPasses: 2, signal: [{ runId: "run-c", passes: 2, n: 3 }] });
    expect(render(report)).toContain(
      "run-c: 2/3 passed, 0 unaccepted, 0 non-result; claimed with no version of its own, so on the line and on no edge",
    );
  });

  // A task measured again exactly as it was, after a battery that passed every case, re-measures a
  // known pass. The count reads the task and the checks of its family, so a moved input or a changed
  // check on that family takes the task out of it, and a battery that failed a case carries nothing.
  it.concurrent("counts the tasks a battery carried unchanged after a full pass", async () => {
    const stricter = {
      ...brief,
      truthChecks: brief.truthChecks.map((each) =>
        each.id === "loss" ? { ...each, assertion: "every limit holds in each double-loss scenario" } : each,
      ),
    };
    const edgeOf = async (briefs: [Brief, Brief], lighter: boolean, fails: number) => {
      const dir = twoVersions("ana-climb-carried-", briefs, (model, index) => {
        if (index === 1 && lighter) {
          write(join(model, "tasks.json"), [heavy, { ...light, publicInput: { limits: { mass: 90 } } }]);
        }
      });
      writeCaseRecord(
        dir,
        ["a", "b"].map((task, index) =>
          caseRecordRow(task, "f", { runId: "run-a", ...(index < fails && { truthOk: false, pass: false }) }),
        ),
      );
      const report = await readCampaign(dir, { embed: fakeEmbed });
      return { carried: report.edges[0]?.carried, text: render(report) };
    };
    const same = await edgeOf([brief, brief], false, 0);
    expect(same.carried).toEqual({ unchanged: 2, tasks: 2, afterFullPass: true });
    expect(same.text).toContain(
      "carried 2 of 2 tasks unchanged in id, public input and family checks, after a battery that passed every case",
    );
    expect(same.text).toContain(
      "carried: 2 tasks measured again unchanged over the 1 edge after a full pass",
    );
    expect((await edgeOf([brief, brief], true, 0)).carried).toEqual({
      unchanged: 1,
      tasks: 2,
      afterFullPass: true,
    });
    expect((await edgeOf([brief, stricter], false, 0)).carried).toEqual({
      unchanged: 1,
      tasks: 2,
      afterFullPass: true,
    });
    const partial = await edgeOf([brief, brief], false, 1);
    expect(partial.carried).toEqual({ unchanged: 2, tasks: 2, afterFullPass: false });
    expect(partial.text).toContain("carried: no edge follows a full pass");
  });

  // A climb step is an earned fail, a harness change that answers it and the same task passing. The
  // fail is earned through the controller's own settlement and the wall's receipt, and the battery
  // after it says whether it kept the task, how the task came out and whether a changed agent solved
  // it anew or the earlier solve was only graded again.
  it.concurrent("follows each earned fail into the battery measured after it", async () => {
    const solve = (task: Task, startedAt: string, pass: boolean, errors: string[] = []) => ({
      taskId: task.taskId,
      acceptedSubmit: true,
      truthOk: pass,
      pass,
      runtimeNonResult: null,
      solver: { errors, startedAt },
    });
    const first = [solve(heavy, "t1", false), solve(light, "t1", false, [SOLVE_WALL_MESSAGE])];
    const follow = async (
      agents: [string, string],
      later: ReturnType<typeof solve>[],
      tasks = [heavy, light],
    ) => {
      const dir = twoVersions("ana-climb-follow-", [brief, brief], (model, index) => {
        mkdirSync(join(model, "..", "agent"), { recursive: true });
        writeFileSync(join(model, "..", "agent", "BUILT_AGENTS.md"), agents[index] ?? "", "utf8");
        if (index === 1) write(join(model, "tasks.json"), tasks);
      });
      recordDigestBattery(join(dir, "versions", "run-a"), ["run-a"], { "run-a": first });
      recordDigestBattery(join(dir, "versions", "run-b"), ["run-b"], { "run-b": later });
      const report = await readCampaign(dir, { embed: fakeEmbed });
      return { dir, report, text: render(report) };
    };
    const answered = await follow(["a", "b"], [solve(heavy, "t2", true), solve(light, "t2", true)]);
    expect(answered.report.batteries.map(({ followUp }) => followUp)).toEqual([
      {
        next: "run-b",
        agentChanged: true,
        fails: [{ taskId: "heavy-01", task: "carried", outcome: "pass", regraded: false }],
      },
      { next: null, agentChanged: null, fails: [] },
    ]);
    expect(answered.text).toContain(
      "earned fail heavy-01 in run-a: carried unchanged into run-b, passed there on a new solve; agent changed between them",
    );
    expect(answered.text).toContain(
      "follow-up: 1 earned fail, 0 with no battery after it; 1 carried unchanged into the next battery, 1 of them passed there and 1 of those after the agent changed",
    );
    const regraded = await follow(["a", "a"], [solve(heavy, "t1", false), solve(light, "t2", true)]);
    expect(regraded.text).toContain(
      "earned fail heavy-01 in run-a: carried unchanged into run-b, failed there on its earlier solve graded again; agent unchanged between them",
    );
    expect(regraded.text).toContain("earned fail heavy-01 in run-b: no battery measured after it");
    const dropped = await follow(["a", "b"], [solve(light, "t2", true)], [light]);
    expect(dropped.text).toContain(
      "earned fail heavy-01 in run-a: dropped from run-b; agent changed between them",
    );
    // A fail the review settled against the one check that decided it measured the check, and the
    // climb sample already drops it, so there is nothing to follow.
    const settled: CaseDisposition = {
      taskId: "heavy-01",
      family: "heavy",
      kind: "disputed-pass",
      checkId: "loss",
      checkIds: ["loss"],
      disposition: "against-check",
      finding: 0,
    };
    mkdirSync(join(dropped.dir, "analysis"), { recursive: true });
    writeFileSync(
      join(dropped.dir, "analysis", "run-a-epoch-review.json"),
      JSON.stringify({
        schema: EPOCH_REVIEW_SCHEMA,
        status: "completed",
        runId: "run-a",
        findings: [],
        dispositions: [settled],
      }),
      "utf8",
    );
    expect(render(await readCampaign(dropped.dir, { embed: fakeEmbed }))).toContain(
      "follow-up: no adopted battery recorded an earned fail",
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
