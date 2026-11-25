#!/usr/bin/env bun
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { scored, type JudgeWeights, judgedPairs, type Paired, isSignificant } from "#src/kernel/compare.ts";

const USAGE = `usage:
  bun .claude/skills/promotion-tuner/scripts/simulate-scoring.ts
    [--trials <n>] [--tasks <n>] [--solves <n>] [--level <p>] [--bias <b>] [--weights <c:j>] [--seed <n>]

--trials  comparisons drawn per scenario and step, 5000 by default
--tasks   tasks a comparison scores, 24 by default
--solves  solves an arm per task, 2 by default
--level   the one-sided level a step reads at, 0.02 by default
--bias    the judge's slot-1 primacy, in the latent units a vote reads, 0.3 by default
--weights a mixed exam's code to judge weights, 1:1 by default
--seed    the generator's seed, 1 by default

How often a comparison reads a step, per scenario and per judge step, scored by the production
folds in src/kernel/compare.ts (judgedGain, judgedPairs, pointsOf, flipP) on synthetic solves from
a seeded generator. A judge pass votes -1, 0 or +1 with a slot-1 primacy; each pair is judged in
both orientations and the two votes averaged. Model-free: it starts no solve and calls no model.`;
const OPTIONS = {
  trials: "int",
  tasks: "int",
  solves: "int",
  level: "text",
  bias: "text",
  weights: "text",
  seed: "int",
} as const;

interface Effect {
  readonly code: number;
  readonly judge: number;
  readonly holistic: number;
  readonly lifted?: number;
  readonly saturated?: true;
}
interface Scenario {
  readonly name: string;
  readonly weights: Omit<JudgeWeights, "step"> | null;
  readonly effect: Effect;
  readonly wanted: "step" | "none";
}

const NONE: Effect = { code: 0, judge: 0, holistic: 0 };
const MIXED = { code: 1, judge: 1 };
const ONE_CRITERION = { code: 0, judge: 0.6, holistic: 0, lifted: 1 };
const JUDGED_ONLY = { code: 0, judge: 1 };
const SCENARIOS: readonly Scenario[] = [
  { name: "verifiable null A/A", weights: null, effect: NONE, wanted: "none" },
  { name: "verifiable +0.10 code", weights: null, effect: { ...NONE, code: 0.1 }, wanted: "step" },
  { name: "mixed null A/A", weights: MIXED, effect: NONE, wanted: "none" },
  { name: "mixed +0.25 code", weights: MIXED, effect: { ...NONE, code: 0.25 }, wanted: "step" },
  {
    name: "mixed real gain",
    weights: MIXED,
    effect: { code: 0.05, judge: 0.3, holistic: 0.2 },
    wanted: "step",
  },
  { name: "mixed one-criterion win", weights: MIXED, effect: ONE_CRITERION, wanted: "step" },
  {
    name: "mixed one-criterion win, code saturated",
    weights: MIXED,
    effect: { ...ONE_CRITERION, saturated: true },
    wanted: "step",
  },
  {
    name: "mixed null A/A, code saturated",
    weights: MIXED,
    effect: { ...NONE, saturated: true },
    wanted: "none",
  },
  {
    name: "mixed scale attack",
    weights: MIXED,
    effect: { code: -0.1, judge: 0.3, holistic: -0.2 },
    wanted: "none",
  },
  {
    name: "mixed severe bloat",
    weights: MIXED,
    effect: { code: 0, judge: 0.15, holistic: -0.6 },
    wanted: "none",
  },
  {
    name: "mixed mild bloat",
    weights: MIXED,
    effect: { code: 0, judge: 0.1, holistic: -0.15 },
    wanted: "none",
  },
  { name: "judged-only null A/A", weights: JUDGED_ONLY, effect: NONE, wanted: "none" },
  {
    name: "judged-only real gain",
    weights: JUDGED_ONLY,
    effect: { ...NONE, judge: 0.3, holistic: 0.2 },
    wanted: "step",
  },
  {
    name: "judged-only severe bloat",
    weights: JUDGED_ONLY,
    effect: { ...NONE, judge: 0.15, holistic: -0.6 },
    wanted: "none",
  },
  {
    name: "judged-only mild bloat",
    weights: JUDGED_ONLY,
    effect: { ...NONE, judge: 0.1, holistic: -0.15 },
    wanted: "none",
  },
];
const STEPS = [0.25, 0.5, 1] as const;
const CRITERIA = 3;
const SPREAD = { code: 0.08, vote: 0.35, tie: 0.15 };

function generator(seed: number) {
  let state = seed >>> 0;
  const uniform = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
  const normal = (sd: number) =>
    sd * Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
  return { uniform, normal };
}
type Draw = ReturnType<typeof generator>;

function mirrored(draw: Draw, latent: number, bias: number): number {
  const pass = (slot: number) => {
    const seen = latent + slot * bias + draw.normal(SPREAD.vote);
    return seen > SPREAD.tie ? 1 : seen < -SPREAD.tie ? -1 : 0;
  };
  return (pass(1) + pass(-1)) / 2;
}

interface Setting {
  readonly scenario: Scenario;
  readonly step: number;
  readonly solves: number;
  readonly bias: number;
  readonly mixed: { readonly code: number; readonly judge: number };
}

function taskPair(draw: Draw, { scenario, step, solves, bias, mixed }: Setting, at: number): Paired {
  const base = 0.3 + 0.4 * draw.uniform();
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const scores = (lift: number) =>
    Array.from({ length: solves }, () =>
      scenario.effect.saturated ? 1 : clamp(base + lift + draw.normal(SPREAD.code)),
    );
  const objective = {
    direction: "higher" as const,
    scale: "unit" as const,
    old: scores(0),
    fresh: scores(scenario.effect.code),
  };
  const valid = Array.from({ length: solves }, () => true);
  const pair: Paired = { task: `t${String(at)}`, old: valid, fresh: valid, objective };
  if (scenario.weights === null) return pair;
  const ids = (side: string) =>
    Array.from({ length: solves }, (_, index) => `${side}${String(at)}-${String(index)}`);
  const votes = judgedPairs(
    `c:${String(at)}`,
    { old: ids("o"), fresh: ids("f") },
    { old: valid, fresh: valid },
  ).map(([fresh, old]) => ({
    fresh,
    old,
    judge:
      Array.from({ length: CRITERIA }, (_, criterion) =>
        mirrored(draw, criterion < (scenario.effect.lifted ?? CRITERIA) ? scenario.effect.judge : 0, bias),
      ).reduce((sum, one) => sum + one, 0) / CRITERIA,
    holistic: mirrored(draw, scenario.effect.holistic, bias),
  }));
  const weights = scenario.weights === MIXED ? mixed : scenario.weights;
  return { ...pair, judged: { weights: { ...weights, step }, votes } };
}

function main(args: CommandArgs): number {
  const trials = args.int("trials") ?? 5000;
  const tasks = args.int("tasks") ?? 24;
  const solves = args.int("solves") ?? 2;
  const level = Number(args.value("level") ?? 0.02);
  const bias = Number(args.value("bias") ?? 0.3);
  const draw = generator(args.int("seed") ?? 1);
  const [code = 1, judge = 1] = (args.value("weights") ?? "1:1").split(":").map(Number);
  const mixed = { code, judge };
  console.log(
    `${String(trials)} comparisons of ${String(tasks)} tasks at ${String(solves)} solves an arm, step at p <= ${String(level)}, primacy ${String(bias)}, mixed weights ${String(code)}:${String(judge)}\n`,
  );
  console.log(["scenario", "wanted", ...STEPS.map((step) => `step ${String(step)}`)].join("\t"));
  for (const scenario of SCENARIOS) {
    const steps = scenario.weights === null || scenario.weights.code === 0 ? [STEPS[0]] : STEPS;
    const rates = steps.map((step) => {
      let stepped = 0;
      for (let trial = 0; trial < trials; trial += 1) {
        const pairs = Array.from({ length: tasks }, (_, at) =>
          taskPair(draw, { scenario, step, solves, bias, mixed }, at),
        );
        if (isSignificant(scored(pairs).differences, level)) stepped += 1;
      }
      return `${((100 * stepped) / trials).toFixed(2)}%`;
    });
    console.log([scenario.name, scenario.wanted, ...rates].join("\t"));
  }
  console.log(
    "\nA judged-only exam has no code term, so its step is 1 whatever is asked; verifiable exams call no judge.",
  );
  return 0;
}

if (import.meta.main) await runCommand({ name: "simulate-scoring", usage: USAGE, options: OPTIONS }, main);
