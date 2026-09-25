/**
 * The round plan and the controller's evidence about it: two files, one owner.
 *
 * `EXPERIMENT.json` is the plan, and the Builder alone writes it: the gap, the change, the expected
 * result, a pass-count target, each family's ladder level and the move that puts it there, and a
 * predicted pass probability per task. The controller writes the other file, `experiment-evidence.json`
 * under the campaign directory, which the Builder can neither read nor write directly: every
 * rehearsal's aggregate verdict, what the solve spent, the bytes it solved and how the plan's
 * predictions scored against the verdicts that still describe the tasks as they stand. It sits
 * outside the workspace, so it is in no candidate diff, no fingerprint and no `scoringHash`.
 *
 * The plan used to be read in four places with three shapes of its own — a capture, a submission
 * parse, a recorded-authoring check and a readout — and its change prose was read against the
 * fingerprint in a module of its own. Here the schema, the one strict reader, the capture, the
 * evidence file, the scoring, the advice and the compact view live together, so the context tool,
 * every continuation, `correctness_check` and `submit` all show the same reading. Admission keeps its
 * refusal policy and asks this module the three questions that read a plan: did the named files
 * move, is the target reachable, and does a climb after a battery that found no limit declare a new
 * move.
 *
 * Intent never changes a score or a gate outcome by itself. The reader is strict for a different
 * reason: a plan edited with a shell tool can lose a field without noticing, and a plan read
 * leniently would then be scored against predictions it no longer states.
 */
import { Type, type Static } from "typebox";
import { Check as validateSchema } from "typebox/value";
import { BATTERY_FILES, type FingerprintEvidence, fingerprintSlug } from "../claim/fingerprint.ts";
import { writeCompleted } from "../meta/completed-json.ts";
import { AGENT_DIR, CORRECTNESS_MODEL_DIR, TASKS_FILE } from "../meta/bundle-layout.ts";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
} from "../meta/filesystem.ts";
import { boundText } from "../meta/bounded-text.ts";
import { capturedJsonParse, capturedJsonStringify } from "../meta/json-runtime.ts";
import { isRecord, isString } from "../meta/json-shape.ts";
import { join } from "../meta/path.ts";
import { containsPath } from "../meta/path-containment.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { effortPhrase, type SolveEffort } from "../builder/solver-trace-text.ts";
import { type ContractFinding, controllerValidatedFinding } from "../truth/brief.ts";
import { commitPublicTask } from "../truth/task-split.ts";
import { EXPERIMENT_FILE, MEMORY_FILE } from "./builder-memory.ts";

const PLAN_SCHEMA = "experiment-plan/v2";
export const EVIDENCE_SCHEMA = "experiment-evidence/v2";
export const EVIDENCE_STEM = "experiment-evidence";
const TEXT_MAX_BYTES = 2_000;
const MOVE_MAX_BYTES = 300;
const PLAN_MAX_BYTES = 16_384;
/** Bytes kept of each free-text line the compact view quotes. */
const VIEW_MAX_BYTES = 320;
/** A prediction this far from a verdict is stated as contradicted by it. */
const CONTRADICTED_BY = 0.8;
const LADDER_FILE = "starter-pack/difficulty-ladder.md";
const RISK_HEADING = "## Risk";

const Level = Type.Union([
  Type.Literal("easy"),
  Type.Literal("medium"),
  Type.Literal("hard"),
  Type.Literal("frontier"),
]);

/** Author claims about the next experiment, never host-certified difficulty and never a verdict.
 *  What the bytes actually moved is derived by the host from the captured measurement. */
const ExperimentPlanSchema = Type.Object(
  {
    schema: Type.Literal(PLAN_SCHEMA),
    scope: Type.Union([Type.Literal("tasks"), Type.Literal("product")]),
    gap: Type.String(),
    change: Type.String(),
    expectedResult: Type.String(),
    target: Type.Object(
      {
        comparator: Type.Union([Type.Literal("at-least"), Type.Literal("at-most")]),
        verifiedPasses: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    families: Type.Array(
      Type.Object(
        { family: Type.String(), level: Level, move: Type.String() },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
    predictions: Type.Array(
      Type.Object(
        { taskId: Type.String(), pass: Type.Number({ minimum: 0, maximum: 1 }) },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type ExperimentPlan = Static<typeof ExperimentPlanSchema>;

export const ExperimentSubmissionSchema = Type.Object(
  { ...ExperimentPlanSchema.properties, digest: Type.String() },
  { additionalProperties: false },
);
export type ExperimentSubmission = Static<typeof ExperimentSubmissionSchema>;

/** A bundle-relative path with a source or data suffix, as the prose spells it. Deliberately
 *  narrow: a sentence about "the evaluator" names no file and is read as naming nothing. */
const PATH_TOKEN = /[A-Za-z0-9._\-/]*[A-Za-z0-9._-]\.(?:ts|tsx|json|md|ya?ml)\b/g;

type NamedFile = { path: string; state: "moved" | "unmoved" | "unresolved" };

/** The newest measured battery as the plan admission reads it. */
export type LastBattery = {
  /** Above the aim, or every verified case passed: the battery found no limit. */
  noLimit: boolean;
  passed: number;
  verified: number;
  plan: ExperimentSubmission | null;
};

/** What one rehearsal solved, in digests the controller already takes: the task's public projection
 *  as `commitPublicTask` commits it, and the scoring program and agent bundle as `fingerprintSlug`
 *  hashes them. A verdict calibrates a task only while all three still read the same. */
export type RehearsedBytes = { publicTaskDigest: string; scoringHash: string; agentHash: string };

/** One rehearsal as the evidence file records it: the aggregate verdict rule 4 lets a rehearsal
 *  return, what the solve spent and the bytes it solved. No check, no verifier output and no
 *  failure location. */
export type RehearsalRow = SolveEffort & {
  taskId: string;
  family: string | null;
  verdict: "pass" | "fail" | "not-run";
  wallMinutes: number;
  bytes: RehearsedBytes;
};

/** The rehearsals that still calibrate the tasks as they would be submitted, and what to say about
 *  the rest. A rehearsal of a task at other bytes, or of a task no longer in the battery, measured a
 *  different question, so it counts towards neither the target nor the predictions. */
type Standing = { counted: readonly RehearsalRow[]; advice: string | null };

export type PredictionScore = { scored: number; brier: number; expected: number; observed: number };

export const PLAN_TEMPLATE = `Write ${EXPERIMENT_FILE} as {"schema":"${PLAN_SCHEMA}","scope":"tasks"|"product","gap":string,"change":string,"expectedResult":string,"target":{"comparator":"at-least"|"at-most","verifiedPasses":integer},"families":[{"family":string,"level":"easy"|"medium"|"hard"|"frontier","move":string}],"predictions":[{"taskId":string,"pass":number from 0 to 1}]}.`;

type Parsed = { ok: true; plan: ExperimentPlan } | { ok: false; findings: ContractFinding[] };

const refusal = (code: string, detail: string) => ({
  ok: false as const,
  findings: [controllerValidatedFinding({ code, path: EXPERIMENT_FILE, detail })],
});

const blankOrOver = (text: string, max: number) =>
  text.trim() === "" || new TextEncoder().encode(text).byteLength > max;

/** Whatever `readPlan` refuses beyond the schema: blank or oversized text and a family or task
 *  named twice, which would give one name two moves or two predictions. */
function planTextRefusal(plan: ExperimentPlan): string | null {
  if ([plan.gap, plan.change, plan.expectedResult].some((field) => blankOrOver(field, TEXT_MAX_BYTES))) {
    return `gap, change and expectedResult each hold 1 to ${TEXT_MAX_BYTES.toLocaleString("en-US")} UTF-8 bytes.`;
  }
  if (plan.families.some((row) => row.family.trim() === "" || blankOrOver(row.move, MOVE_MAX_BYTES))) {
    return `Each family names itself and states its move in 1 to ${MOVE_MAX_BYTES} UTF-8 bytes.`;
  }
  const families = plan.families.map((row) => row.family.trim());
  const tasks = plan.predictions.map((row) => row.taskId);
  if (new Set(families).size !== families.length || new Set(tasks).size !== tasks.length) {
    return "Name each family and each predicted task once.";
  }
  return null;
}

/** The one reading of a plan. A plan without this schema is refused by name rather than read as
 *  whatever fields it still has: the shape before it carried no families and no predictions, and
 *  reading it would score a battery against a plan that declared neither. */
function readPlan(value: unknown): Parsed {
  const declared = isRecord(value) ? value.schema : undefined;
  if (declared !== PLAN_SCHEMA) {
    const named =
      declared === undefined
        ? `${EXPERIMENT_FILE} names no schema`
        : `${EXPERIMENT_FILE} declares schema ${capturedJsonStringify(declared)}`;
    return refusal(
      "experiment-plan-schema",
      `${named}, and this controller reads ${PLAN_SCHEMA} alone; the shape without schema, families and predictions is superseded. ${PLAN_TEMPLATE}`,
    );
  }
  if (!validateSchema(ExperimentPlanSchema, value)) {
    return refusal(
      "experiment-proposal-shape",
      `${PLAN_TEMPLATE} Name every field exactly and add no other.`,
    );
  }
  const text = planTextRefusal(value);
  if (text !== null) return refusal("experiment-proposal-shape", `${text} ${PLAN_TEMPLATE}`);
  const plan: ExperimentPlan = {
    ...value,
    gap: value.gap.trim(),
    change: value.change.trim(),
    expectedResult: value.expectedResult.trim(),
    families: value.families.map((row) => ({
      family: row.family.trim(),
      level: row.level,
      move: row.move.trim(),
    })),
  };
  return { ok: true, plan };
}

/** Only a captured, digest-bound plan crosses into history: a submission whose digest does not
 *  match the plan it carries is read as no declaration at all rather than as a corrected one. */
export function parseExperimentSubmission(value: unknown): ExperimentSubmission | null {
  if (!isRecord(value)) return null;
  const { digest, ...plan } = value;
  const parsed = readPlan(plan);
  return parsed.ok && digest === hashJsonValue(parsed.plan) ? { ...parsed.plan, digest } : null;
}

/** Refuse indirect paths before reading; hold a regular-file descriptor for the captured bytes. */
function capturedPlanBytes(workspace: string): string {
  const root = realpathSync(workspace);
  const absolute = join(root, EXPERIMENT_FILE);
  if (realpathSync(absolute) !== absolute || !containsPath(absolute, root)) {
    throw new Error("indirect plan path");
  }
  const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > PLAN_MAX_BYTES) {
      throw new Error("the plan must be a bounded regular file");
    }
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

/** Capture the plan once, independently of candidate identity, so it is fixed before the round
 *  that tests it and cannot be tuned to the result. Rewording it produces a new digest and nothing
 *  else: it establishes membership in a new experiment, not a harder one. */
export function captureExperimentSubmission(
  workspace: string,
): { ok: true; experiment: ExperimentSubmission } | { ok: false; findings: ContractFinding[] } {
  let parsed: Parsed;
  try {
    parsed = readPlan(capturedJsonParse(capturedPlanBytes(workspace)));
  } catch {
    return refusal(
      "experiment-proposal-read",
      `Write ${EXPERIMENT_FILE} as a regular JSON file before preview or submit; links and files over ${PLAN_MAX_BYTES.toLocaleString("en-US")} bytes are refused.`,
    );
  }
  if (!parsed.ok) return parsed;
  return { ok: true, experiment: { ...parsed.plan, digest: hashJsonValue(parsed.plan) } };
}

// ---------------------------------------------------------------------------------------------
// Admission questions. Each returns the refusal detail or null; the refusal policy is the caller's.

/** Resolve one named path against both trees. A path neither bundle carries under either spelling
 *  is `unresolved`: the prose may be naming a workspace note, and an absent file proves nothing. */
function resolveNamed(path: string, adopted: FingerprintEvidence, candidate: FingerprintEvidence): NamedFile {
  const leaf = path.split("/").pop() ?? path;
  // tasks.json and controls.json sit outside correctnessModelFiles; one hash covers the pair.
  if (BATTERY_FILES.some((name) => name === leaf)) {
    return { path, state: adopted.taskSetHash === candidate.taskSetHash ? "unmoved" : "moved" };
  }
  for (const [prefix, before, after] of [
    [AGENT_DIR, adopted.agentFiles, candidate.agentFiles],
    [CORRECTNESS_MODEL_DIR, adopted.correctnessModelFiles, candidate.correctnessModelFiles],
  ] as const) {
    const inner = path.startsWith(prefix) ? path.slice(prefix.length) : path;
    const was = before.find((file) => file.path === inner)?.sha256 ?? null;
    const is = after.find((file) => file.path === inner)?.sha256 ?? null;
    if (was === null && is === null) continue;
    return { path, state: was === is ? "unmoved" : "moved" };
  }
  return { path, state: "unresolved" };
}

/** When the plan's change names bundle files and none of them moved. A single moved file settles
 *  it: prose that names an unchanged file for context is not a false declaration. The change can
 *  declare a repair across three rounds while the file keeps one hash throughout, and nothing else
 *  reads the prose against the snapshot. */
export function unmovedChangeDetail(
  change: string,
  adopted: FingerprintEvidence,
  candidate: FingerprintEvidence,
): string | null {
  const paths = new Set(
    [...change.matchAll(PATH_TOKEN)].flatMap((match) => {
      const path = match[0].replace(/^\.\//, "").replace(/^\/+/, "");
      return path.length > 0 ? [path] : [];
    }),
  );
  const named = [...paths].map((path) => resolveNamed(path, adopted, candidate));
  const unmoved = named.flatMap((file) => (file.state === "unmoved" ? [file.path] : []));
  if (unmoved.length === 0 || named.some((file) => file.state === "moved")) return null;
  return `The change names ${unmoved.join(", ")}, and every one of them is byte-identical to the adopted product. Make the change in the bytes, or rewrite the change to name what this candidate actually moved; submit again in this session.`;
}

/** When the target counts more verified passes than the battery has slots. */
export function unreachableTargetDetail(plan: ExperimentPlan, slots: number): string | null {
  const count = plan.target.verifiedPasses;
  return count > slots
    ? `The target counts ${count} verified passes, but the submitted battery has ${slots} task slots. Bind a count within the battery before measuring.`
    : null;
}

/** The newest battery whose claim stands, read off the recorded readout rows; undefined when none
 *  stands. A battery above the aim or passing every verified case found no limit. */
export function lastBatteryOf(
  rows: ReadonlyArray<{
    claimRefusal: string | null;
    zone: string | null;
    passed: number | null;
    verified: number;
    experiment: { proposal: unknown } | null;
  }>,
): LastBattery | undefined {
  const row = rows.find(
    (item): item is typeof item & { passed: number } => item.claimRefusal === null && item.passed !== null,
  );
  if (row === undefined) return undefined;
  const above = row.zone === "over-aim" || row.zone === "too-easy";
  return {
    noLimit: above || (row.verified > 0 && row.passed === row.verified),
    passed: row.passed,
    verified: row.verified,
    plan: row.experiment === null ? null : parseExperimentSubmission(row.experiment.proposal),
  };
}

const sameWords = (text: string) => text.trim().replaceAll(/\s+/g, " ").toLocaleLowerCase();

/** When a plan declares a climb — a target below the last battery's passes — after a battery that
 *  found no limit, and every family it names declares the move the last plan declared. A family
 *  the last plan did not name is a new move. This compares declarations, never semantic difficulty,
 *  and without a last plan there is nothing to compare, so it never fires. */
export function repeatedMoveDetail(last: LastBattery | undefined, plan: ExperimentPlan): string | null {
  if (last?.noLimit !== true || last.plan === null || plan.target.verifiedPasses >= last.passed) return null;
  const before = new Map(last.plan.families.map((row) => [row.family, sameWords(row.move)]));
  if (plan.families.some((row) => before.get(row.family) !== sameWords(row.move))) return null;
  return `The last battery passed ${last.passed} of ${last.verified} verified cases and found no limit, and this plan declares a climb to ${plan.target.comparator} ${plan.target.verifiedPasses}, but every family declares the move the last battery's plan declared. This compares the declared moves, not semantic difficulty: name for at least one family the new reasoning step its tasks now demand of the solver, and make the tasks demand it.`;
}

// ---------------------------------------------------------------------------------------------
// Evidence, scoring and advice.

/** The mean squared distance between each predicted pass probability and its verdict (1 passed,
 *  0 did not), over the tasks that have both; null when none has. A Brier score of 0 is perfect,
 *  and 0.25 is what predicting one half for every task earns. Calibration is scored against
 *  verdicts and nothing else: what a solve spent is not a verdict. */
export function predictionScore(
  predictions: ExperimentPlan["predictions"],
  verdicts: ReadonlyMap<string, boolean>,
): PredictionScore | null {
  const pairs = predictions.flatMap((row) => {
    const verdict = verdicts.get(row.taskId);
    return verdict === undefined ? [] : [{ p: row.pass, y: verdict ? 1 : 0 }];
  });
  if (pairs.length === 0) return null;
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  return {
    scored: pairs.length,
    brier: Math.round((sum(pairs.map(({ p, y }) => (p - y) ** 2)) / pairs.length) * 1000) / 1000,
    expected: Math.round(sum(pairs.map(({ p }) => p)) * 10) / 10,
    observed: sum(pairs.map(({ y }) => y)),
  };
}

const rehearsalVerdicts = (rows: readonly RehearsalRow[]) =>
  new Map(
    rows.flatMap(
      (row): Array<[string, boolean]> =>
        row.verdict === "not-run" ? [] : [[row.taskId, row.verdict === "pass"]],
    ),
  );

/** Each task of the workspace's tasks.json as it would be submitted now, or null when the bundle
 *  does not fingerprint or the file is not a task array. Then no rehearsal can be told stale, and
 *  every one counts as it is. */
function currentBytes(workspace: string): ReadonlyMap<string, RehearsedBytes> | null {
  const fingerprint = fingerprintSlug(workspace);
  if (!fingerprint.ok) return null;
  let tasks: unknown;
  try {
    tasks = capturedJsonParse(readFileSync(join(workspace, TASKS_FILE), "utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(tasks)) return null;
  const { scoringHash, agentHash } = fingerprint;
  return new Map(
    tasks.flatMap((row): Array<[string, RehearsedBytes]> => {
      if (!isRecord(row) || !isString(row.taskId) || !isString(row.family)) return [];
      const { taskId, family, publicInput } = row;
      const { publicTaskDigest } = commitPublicTask({ taskId, family, publicInput, hidden: null });
      return [[taskId, { publicTaskDigest, scoringHash, agentHash }]];
    }),
  );
}

const BYTE_PARTS = [
  ["publicTaskDigest", "public input"],
  ["scoringHash", "scoring program"],
  ["agentHash", "agent"],
] as const;

const movedParts = (was: RehearsedBytes, now: RehearsedBytes) =>
  BYTE_PARTS.flatMap(([key, name]) => (was[key] === now[key] ? [] : [name]));

function rehearsalStanding(workspace: string, rows: readonly RehearsalRow[]): Standing {
  const graded = rows.filter((row) => row.verdict !== "not-run");
  const now = graded.length === 0 ? null : currentBytes(workspace);
  if (now === null) return { counted: rows, advice: null };
  const isCurrent = (row: RehearsalRow) => {
    const at = now.get(row.taskId);
    return at !== undefined && movedParts(row.bytes, at).length === 0;
  };
  const counted = rows.filter(isCurrent);
  const covered = [...new Set(graded.flatMap((row) => (isCurrent(row) ? [row.taskId] : [])))];
  const stale = [...now].flatMap(([taskId, at]) => {
    const last = covered.includes(taskId) ? undefined : graded.findLast((row) => row.taskId === taskId);
    return last === undefined ? [] : [`${taskId} (${movedParts(last.bytes, at).join(" and ")} moved)`];
  });
  if (stale.length === 0 && covered.length > 0) return { counted, advice: null };
  const listed = covered.length === 0 ? "" : ` (${covered.join(", ")})`;
  const earlier =
    stale.length === 0
      ? ""
      : ` Rehearsed only at earlier bytes: ${stale.join(", ")}; those verdicts say nothing about the tasks as they now stand, and count towards neither the target nor the predictions.`;
  return {
    counted,
    advice: `Advice: ${covered.length} of the ${now.size} task(s) you would submit now have a graded rehearsal at their current bytes${listed}.${earlier}`,
  };
}

/** Where the plan and the rehearsals disagree, as advice only: rehearsal passes past an at-most
 *  target, a prediction the verdict contradicts, and tasks whose rehearsals solved other bytes.
 *  None refuses anything, because a rehearsal is one blind solve and the measured battery is the
 *  evidence. */
function planAdvice(plan: ExperimentPlan, standing: Standing): string[] {
  const verdicts = rehearsalVerdicts(standing.counted);
  const passed = [...verdicts].flatMap(([taskId, pass]) => (pass ? [taskId] : []));
  const advice: string[] = [];
  const { comparator, verifiedPasses } = plan.target;
  if (comparator === "at-most" && passed.length > verifiedPasses) {
    advice.push(
      `Advice: rehearsals already passed ${passed.length} distinct task(s) (${passed.join(", ")}) against a target of at most ${verifiedPasses} verified passes.`,
    );
  }
  const contradicted = plan.predictions.flatMap((row) => {
    const verdict = verdicts.get(row.taskId);
    if (verdict === undefined || Math.abs(row.pass - (verdict ? 1 : 0)) < CONTRADICTED_BY) return [];
    return [`${row.taskId} predicted ${row.pass} and ${verdict ? "passed" : "failed"}`];
  });
  if (contradicted.length > 0) {
    advice.push(
      `Advice: rehearsal verdicts contradict ${contradicted.length} prediction(s): ${contradicted.join("; ")}.`,
    );
  }
  if (standing.advice !== null) advice.push(standing.advice);
  return advice;
}

/** The first free evidence name in `dir`, so a later round never writes over an earlier one's. */
function claimEvidenceFile(dir: string): string {
  let path = join(dir, `${EVIDENCE_STEM}.json`);
  for (let next = 2; existsSync(path); next += 1) path = join(dir, `${EVIDENCE_STEM}-${String(next)}.json`);
  return path;
}

/** The workspace's plan as it reads now, or null when it is absent or refused. */
export function currentPlan(workspace: string): ExperimentSubmission | null {
  if (!existsSync(join(workspace, EXPERIMENT_FILE))) return null;
  const captured = captureExperimentSubmission(workspace);
  return captured.ok ? captured.experiment : null;
}

/** The controller's evidence about the round plan: every rehearsal of the round, written through to
 *  its own `experiment-evidence*.json` in `dir` after each one, beside the prediction score the
 *  current plan earns against those still at their task's current bytes. One object per round,
 *  held by the controller and read by the plan view; a null `dir` keeps the rows in memory only. */
export class PlanEvidence {
  private readonly rows: RehearsalRow[] = [];
  private path: string | undefined;

  constructor(
    private readonly workspace: string,
    private readonly dir: string | null,
  ) {}

  /** Records one rehearsal and returns the plan's advice after it. */
  record(row: RehearsalRow): string[] {
    this.rows.push(row);
    const plan = currentPlan(this.workspace);
    const standing = rehearsalStanding(this.workspace, this.rows);
    if (this.dir !== null) {
      mkdirSync(this.dir, { recursive: true });
      this.path ??= claimEvidenceFile(this.dir);
      writeCompleted(this.path, {
        schema: EVIDENCE_SCHEMA,
        planDigest: plan?.digest ?? null,
        rehearsals: this.rows,
        predictionScore:
          plan === null ? null : predictionScore(plan.predictions, rehearsalVerdicts(standing.counted)),
      });
    }
    return plan === null ? [] : planAdvice(plan, standing);
  }

  list(): readonly RehearsalRow[] {
    return this.rows;
  }

  /** The advice the current plan earns against this round's rehearsals. */
  advice(): string[] {
    const plan = currentPlan(this.workspace);
    return plan === null ? [] : planAdvice(plan, rehearsalStanding(this.workspace, this.rows));
  }

  view(): string {
    return renderPlanView(this.workspace, this.rows);
  }
}

// ---------------------------------------------------------------------------------------------
// The compact view.

/** One line of the view: the text on a single line, bounded to `VIEW_MAX_BYTES`. */
const clip = (text: string) => boundText(text.replaceAll(/\s+/g, " "), VIEW_MAX_BYTES).shown;

function readOr(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** The ladder's frontier row with its continuation lines. */
function frontierRow(workspace: string): string | null {
  const lines = readOr(join(workspace, LADDER_FILE))?.split("\n") ?? [];
  const start = lines.findIndex((line) => /^- \**frontier\**/.test(line));
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && !/^ {2,}\S/.test(line));
  return clip(lines.slice(start, end < 0 ? undefined : end).join(" "));
}

/** The first line written under MEMORY.md's risk heading. */
function riskLine(workspace: string): string | null {
  const lines = readOr(join(workspace, MEMORY_FILE))?.split("\n") ?? [];
  const start = lines.findIndex((line) => line.trim() === RISK_HEADING);
  if (start < 0) return null;
  const line = lines.slice(start + 1).find((row) => row.trim() !== "" && !row.trim().startsWith("<!--"));
  return line === undefined || line.startsWith("## ") ? null : clip(line);
}

function planLines(workspace: string, rows: readonly RehearsalRow[]): string[] {
  if (!existsSync(join(workspace, EXPERIMENT_FILE))) {
    return [`Round plan: ${EXPERIMENT_FILE} is not written yet. ${PLAN_TEMPLATE}`];
  }
  const captured = captureExperimentSubmission(workspace);
  if (!captured.ok) {
    return [
      `Round plan: ${EXPERIMENT_FILE} is refused — ${captured.findings.map((row) => row.detail).join(" ")}`,
    ];
  }
  const plan = captured.experiment;
  const expected = plan.predictions.reduce((sum, row) => sum + row.pass, 0);
  return [
    `Round plan (${PLAN_SCHEMA}, ${plan.scope} scope): target ${plan.target.comparator} ${plan.target.verifiedPasses} verified passes; ${plan.predictions.length} task prediction(s) summing to ${Math.round(expected * 10) / 10} expected passes.`,
    `Families: ${plan.families.map((row) => `${row.family} at ${row.level} — ${clip(row.move)}`).join("; ")}.`,
    ...planAdvice(plan, rehearsalStanding(workspace, rows)),
  ];
}

function rehearsalLines(rows: readonly RehearsalRow[]): string[] {
  if (rows.length === 0) return [];
  const listed = rows.map(
    (row) =>
      `${row.taskId}${row.family === null ? "" : ` (${row.family})`} ${row.verdict} in ${effortPhrase(row, row.wallMinutes)}`,
  );
  return [`Rehearsals this round: ${listed.join("; ")}.`];
}

/** One compact view of the plan and its evidence, for every continuation and the context tool:
 *  the target, each family's level and move, the prediction total, this round's rehearsals with
 *  their effort as plain facts, any advice, the ladder's frontier row, the MEMORY.md risk line and
 *  where the full files are. */
function renderPlanView(workspace: string, rows: readonly RehearsalRow[]): string {
  const frontier = frontierRow(workspace);
  const risk = riskLine(workspace);
  return [
    ...planLines(workspace, rows),
    ...rehearsalLines(rows),
    ...(frontier === null ? [] : [`Ladder frontier row: ${frontier}`]),
    ...(risk === null ? [] : [`${MEMORY_FILE} risk: ${risk}`]),
    `Full files: ${EXPERIMENT_FILE}, ${MEMORY_FILE} and ${LADDER_FILE}; the context tool searches them with the round's history and traces.`,
  ].join("\n");
}
