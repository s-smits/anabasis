/**
 * The round plan: `EXPERIMENT.json`, which the Builder alone writes before it previews or submits.
 *
 * It pre-registers what the round is for, so the measured result is read against declared intent
 * rather than against a story told afterwards: the gap seen, the change made, the families whose
 * tasks the change moves, and how many verified passes the next blind battery should hold. Its
 * presence switches nothing. Attribution, the condition identity and every gate read the bytes, so
 * a missing or rewritten plan changes no score, refuses nothing and makes no identical bytes new.
 *
 * It is scored against the two things that can prove it wrong, never against rehearsals, which pass
 * almost regardless of what was predicted. The declared families are read against the families
 * whose public tasks changed from the adopted product, inputs or rules, as advice at each check and
 * as a recorded fact once the candidate is accepted, and the pass range against the measured
 * battery's verified count. The next round's climb readout, the Epoch Reviewer and the run end read
 * both.
 *
 * The reader is lenient on purpose. Every field is optional and an unknown field is ignored; a field
 * that does not read is named in one advice line and the rest of the plan still stands.
 */
import { Type, type Static } from "typebox";
import { capturedJsonParse } from "../meta/json-runtime.ts";
import { isRecord, isString, type JsonObject } from "../meta/json-shape.ts";
import { existsSync, readFileSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { EXPERIMENT_FILE } from "./builder-memory.ts";

const PLAN_MAX_BYTES = 16_384;

/** The plan as recorded with an accepted candidate: the fields that read, and their digest. */
export const RecordedPlanSchema = Type.Object({
  gap: Type.Optional(Type.String()),
  change: Type.Optional(Type.String()),
  /** The families whose tasks this round changes; empty when it changes none. */
  families: Type.Optional(Type.Array(Type.String())),
  /** Verified passes the next measured battery should hold, either bound optional. */
  expectedPasses: Type.Optional(
    Type.Object({ atLeast: Type.Optional(Type.Integer()), atMost: Type.Optional(Type.Integer()) }),
  ),
  digest: Type.String(),
});
export type RecordedPlan = Static<typeof RecordedPlanSchema>;
type ExperimentPlan = Omit<RecordedPlan, "digest">;
/** A plan's readable fields, and a name for each field present that did not read. */
type ReadPlan = { plan: ExperimentPlan; unread: string[] };
/** The workspace's plan with its digest, or null, and one advice line per problem with it. */
type CapturedPlan = { plan: RecordedPlan | null; advice: string[] };

/** What a round's plan is scored against the bytes with: the plan recorded beside its accepted
 *  candidate, and the families whose public tasks those bytes changed, inputs or rules, null with
 *  no adopted product to compare them to. */
export type RoundPlan = { plan: RecordedPlan | null; changedFamilies: readonly string[] | null };

export const NO_PLAN: RoundPlan = { plan: null, changedFamilies: null };

const PLAN_TEMPLATE = `${EXPERIMENT_FILE} fields, each optional: {"gap":string,"change":string,"families":[the families whose tasks this round changes],"expectedPasses":{"atLeast":n,"atMost":n}} for the verified passes you expect the next battery to hold.`;

const nonEmpty = (value: unknown) => (isString(value) && value.trim() !== "" ? value.trim() : undefined);
const count = (value: unknown) => (Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined);

function readPlan(value: JsonObject): ReadPlan {
  const plan: ExperimentPlan = {};
  const unread: string[] = [];
  for (const field of ["gap", "change"] as const) {
    const read = nonEmpty(value[field]);
    if (read !== undefined) plan[field] = read;
    else if (value[field] !== undefined) unread.push(`${field} (a non-empty string)`);
  }
  const { families, expectedPasses } = value;
  const listed = Array.isArray(families) ? families.flatMap((row) => nonEmpty(row) ?? []) : [];
  if (Array.isArray(families) && listed.length === families.length) plan.families = [...new Set(listed)];
  else if (families !== undefined) unread.push("families (a list of family names)");
  if (isRecord(expectedPasses)) {
    const [atLeast, atMost] = [count(expectedPasses.atLeast), count(expectedPasses.atMost)];
    if ((atLeast ?? 0) <= (atMost ?? Number.POSITIVE_INFINITY) && (atLeast ?? atMost) !== undefined) {
      plan.expectedPasses = {};
      if (atLeast !== undefined) plan.expectedPasses.atLeast = atLeast;
      if (atMost !== undefined) plan.expectedPasses.atMost = atMost;
    } else unread.push("expectedPasses (whole counts, atLeast no more than atMost)");
  } else if (expectedPasses !== undefined) unread.push("expectedPasses (an object)");
  return { plan, unread };
}

/** Each advice line is followed by the template, and a plan with unread fields still stands on the
 *  fields that read. */
export function capturePlan(workspace: string): CapturedPlan {
  const path = join(workspace, EXPERIMENT_FILE);
  if (!existsSync(path)) return { plan: null, advice: [`Advice: no ${EXPERIMENT_FILE} yet.`, PLAN_TEMPLATE] };
  let parsed: ReadPlan;
  try {
    const bytes = readFileSync(path, "utf8");
    const value = bytes.length > PLAN_MAX_BYTES ? null : capturedJsonParse(bytes);
    if (!isRecord(value)) throw new Error("not a plan object");
    parsed = readPlan(value);
  } catch {
    const limit = PLAN_MAX_BYTES.toLocaleString("en-US");
    return {
      plan: null,
      advice: [
        `Advice: ${EXPERIMENT_FILE} is not a JSON object under ${limit} bytes, so it is not read.`,
        PLAN_TEMPLATE,
      ],
    };
  }
  const advice =
    parsed.unread.length === 0
      ? []
      : [
          `Advice: ${EXPERIMENT_FILE} fields not read: ${parsed.unread.join("; ")}. The rest of the plan stands.`,
          PLAN_TEMPLATE,
        ];
  return { plan: { ...parsed.plan, digest: hashJsonValue(parsed.plan) }, advice };
}

/** A pass range in words: "at least 3", "at most 5" or "3–5". */
export function statedRange({ atLeast, atMost }: NonNullable<ExperimentPlan["expectedPasses"]>): string {
  if (atLeast === undefined) return `at most ${String(atMost)}`;
  return atMost === undefined ? `at least ${atLeast}` : `${atLeast}–${atMost}`;
}

const names = (list: readonly string[]) => (list.length === 0 ? "none" : list.join(", "));

/** The declared families against the families whose public tasks changed, and on a miss each side
 *  of the difference by name. */
function familyScore(plan: ExperimentPlan | null, changed: readonly string[] | null) {
  if (plan?.families === undefined || changed === null) return null;
  const declared = plan.families;
  const unchanged = declared.filter((family) => !changed.includes(family));
  const unnamed = changed.filter((family) => !declared.includes(family));
  const misses = [
    unchanged.length === 0 ? null : `${names(unchanged)} named but unchanged`,
    unnamed.length === 0 ? null : `${names(unnamed)} changed but not named`,
  ].filter((part) => part !== null);
  const verdict = misses.length === 0 ? "met" : `missed, ${misses.join(" and ")}`;
  const text = `the plan names ${names(declared)} as changed and the public tasks changed from the adopted product in ${names(changed)}: ${verdict}`;
  return { met: misses.length === 0, text };
}

/** The declared families against a draft's changed families, as advice only when they disagree. */
export function familyAdvice(plan: ExperimentPlan, changed: readonly string[] | null): string[] {
  const score = familyScore(plan, changed);
  return score === null || score.met ? [] : [`Advice: ${score.text}.`];
}

/** The pass range against the measured battery's verified count. */
function passScore(plan: ExperimentPlan | null, passed: number | null): string | null {
  const range = plan?.expectedPasses;
  if (range === undefined || passed === null) return null;
  const below = range.atLeast !== undefined && passed < range.atLeast;
  const above = range.atMost !== undefined && passed > range.atMost;
  const side = below ? "missed, below" : above ? "missed, above" : "met";
  const noun = (range.atLeast ?? 1) === 1 && (range.atMost ?? 1) === 1 ? "pass" : "passes";
  return `the plan expects ${statedRange(range)} verified ${noun} and the battery holds ${passed}: ${side}`;
}

/** Both scores of a round's plan in one line, the pass range read against `passed` once a battery
 *  has measured it; null when there is no plan or it states neither. */
export function planScoreLine(round: RoundPlan, passed: number | null): string | null {
  const scores = [
    familyScore(round.plan, round.changedFamilies)?.text ?? null,
    passScore(round.plan, passed),
  ];
  const stated = scores.filter((line) => line !== null);
  return stated.length === 0 ? null : stated.join("; ");
}
