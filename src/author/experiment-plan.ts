/**
 * The round plan and the controller's evidence about it: two files, one owner.
 *
 * `EXPERIMENT.json` is the plan, and the Builder alone writes it: the gap, the change, the expected
 * result, a pass-count target, each family's ladder level and the move that puts it there, and a
 * predicted pass probability per task. The controller writes the other file, `experiment-evidence.json`
 * under the campaign directory, which the Builder can neither read nor write directly: every
 * rehearsal's aggregate verdict, what the solve spent, the bytes it solved, the prediction the plan
 * stated for it before its verdict arrived and how those predictions scored. It sits outside the
 * workspace, so it is in no candidate diff, no fingerprint and no `scoringHash`.
 *
 * The plan used to be read in four places with three shapes of its own — a capture, a submission
 * parse, a recorded-authoring check and a readout. Here the schema, the one strict reader, the
 * capture, the evidence file, the scoring, the advice and the compact view live together, so the
 * context tool, every continuation, `correctness_check` and `submit` all show the same reading.
 *
 * Intent never changes a score or a gate outcome by itself. The reader is strict for a different
 * reason: a plan edited with a shell tool can lose a field without noticing, and a plan read
 * leniently would then be scored against predictions it no longer states.
 */
import { Type, type Static } from "typebox";
import { Check as validateSchema } from "typebox/value";
import { fingerprintSlug } from "../claim/fingerprint.ts";
import { writeCompleted } from "../meta/completed-json.ts";
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
import { isRecord } from "../meta/json-shape.ts";
import { join } from "../meta/path.ts";
import { containsPath } from "../meta/path-containment.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { effortPhrase, type SolveEffort } from "../builder/solver-trace-text.ts";
import { type ContractFinding, controllerValidatedFinding, requiredToolsOf } from "../truth/brief.ts";
import { readValidatedBrief } from "../truth/public-resources.ts";
import { bundleSnapshotToolTree } from "../claim/bundle-snapshot.ts";
import { resolveToolInventory } from "../verify/tool-inventory.ts";
import type { BuildTask } from "../truth/tasks.ts";
import { loadRecordedTasks } from "../run/run-driver.ts";
import { aimCounts } from "../claim/battery-difficulty.ts";
import { POLICY } from "../critic/policy.ts";
import { EXPERIMENT_FILE, MEMORY_FILE } from "./builder-memory.ts";

const PLAN_SCHEMA = "experiment-plan/v2";
export const EVIDENCE_SCHEMA = "experiment-evidence/v3";
export const EVIDENCE_STEM = "experiment-evidence";
const TEXT_MAX_BYTES = 2_000;
const MOVE_MAX_BYTES = 300;
const PLAN_MAX_BYTES = 16_384;
/** Bytes kept of each free-text line the compact view quotes. */
const VIEW_MAX_BYTES = 320;
/** Rehearsal passes this far from the passes their predictions expected are stated as advice. */
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

/** One rehearsal as the evidence file records it: the aggregate verdict rule 4 lets a rehearsal
 *  return, and what the solve spent. No check, no verifier output and no failure location. */
export type RehearsalRow = SolveEffort & {
  taskId: string;
  family: string | null;
  verdict: "pass" | "fail" | "not-run";
  wallMinutes: number;
};

/** A rehearsal with the `rehearsalBytes` digest its task held when it was recorded, and the pass
 *  probability the plan then stated for it, which the Builder wrote before it saw the verdict. */
type RecordedRehearsal = RehearsalRow & { bytes: string | null; predicted: number | null };

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

// Gate audit 2026-09-25 (docs/gate-audit.md, experiment-plan-schema): kept: the plan is read only in its one
// schema, so its target and predictions are scored against what the Builder actually declared.
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

// Gate audit 2026-09-25 (docs/gate-audit.md, experiment-plan-schema): kept: the plan is captured once from a
// bounded regular file, so it is fixed before the round that tests it.
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

/** The digest each workspace task would be rehearsed at now: the whole task row with its hidden
 *  operands, the scoring program, the agent and the tools the brief requires as they resolve, so a
 *  verdict stops counting once any of them moves. Null when the bundle does not fingerprint or its
 *  tasks do not load, because an identity that cannot be read is unknown rather than changed. */
function rehearsalBytes(workspace: string): ReadonlyMap<string, string> | null {
  const fingerprint = fingerprintSlug(workspace);
  if (!fingerprint.ok) return null;
  let tasks: BuildTask[];
  try {
    tasks = loadRecordedTasks(workspace);
  } catch {
    return null;
  }
  const checks = readValidatedBrief(workspace)?.truthChecks ?? [];
  const toolIds = checks.flatMap((check) => requiredToolsOf(check.execution));
  const { inventory } = resolveToolInventory({ toolIds, toolTree: bundleSnapshotToolTree(workspace) });
  // Identity and bytes, not location: a workspace carried to a new pass keeps its rehearsals.
  const tools = Object.values(inventory).map(({ id, digest }) => [id, digest]);
  const { scoringHash, agentHash } = fingerprint;
  return new Map(tasks.map((task) => [task.taskId, hashJsonValue([task, scoringHash, agentHash, tools])]));
}

/** Each task's latest graded verdict, among the rehearsals whose recorded bytes are known and equal
 *  the bytes it holds now; none counts while the current bytes are unknown. */
const rehearsalVerdicts = (rows: readonly RecordedRehearsal[], now: ReadonlyMap<string, string> | null) =>
  new Map(
    rows.flatMap(
      (row): Array<[string, boolean]> =>
        row.verdict === "not-run" || row.bytes === null || row.bytes !== now?.get(row.taskId)
          ? []
          : [[row.taskId, row.verdict === "pass"]],
    ),
  );

/** Each graded rehearsal against the prediction recorded with it, so a task rehearsed twice counts
 *  twice and a prediction revised after its verdict leaves the score as it was. */
function scoredBeforeVerdicts(rows: readonly RecordedRehearsal[]): PredictionScore | null {
  const graded = rows.flatMap((row, index) =>
    row.verdict === "not-run" || row.predicted === null
      ? []
      : [{ taskId: String(index), pass: row.predicted, verdict: row.verdict === "pass" }],
  );
  return predictionScore(graded, new Map(graded.map((row) => [row.taskId, row.verdict])));
}

/** Where the plan and the rehearsals disagree, as advice only: a target above the aim, which the
 *  readout would otherwise say only after a battery measured it, rehearsal passes past an at-most
 *  target, predictions made before their verdicts that expected another pass count, which revising
 *  them afterwards does not unsay, and tasks rehearsed only at bytes since changed.
 *  None refuses anything, because a rehearsal is one blind solve and the measured battery is the
 *  evidence. */
function planAdvice(
  plan: ExperimentPlan,
  rows: readonly RecordedRehearsal[],
  now: ReadonlyMap<string, string> | null,
): string[] {
  const verdicts = rehearsalVerdicts(rows, now);
  const passed = [...verdicts].flatMap(([taskId, pass]) => (pass ? [taskId] : []));
  const advice: string[] = [];
  const { comparator, verifiedPasses } = plan.target;
  const slots = now?.size ?? 0;
  const [lo, hi] = aimCounts(slots, POLICY.climb.band);
  if (slots > 0 && hi >= lo && verifiedPasses > hi) {
    advice.push(
      `Advice: the target, ${comparator} ${verifiedPasses} verified passes, lies above the aim of ${lo} to ${hi} of ${slots}, so a battery meeting it would find no limit.`,
    );
  }
  if (comparator === "at-most" && passed.length > verifiedPasses) {
    advice.push(
      `Advice: rehearsals already passed ${passed.length} distinct task(s) (${passed.join(", ")}) against a target of at most ${verifiedPasses} verified passes.`,
    );
  }
  const score = scoredBeforeVerdicts(rows);
  if (score !== null && Math.abs(score.observed - score.expected) >= CONTRADICTED_BY) {
    advice.push(
      `Advice: before their verdicts, your predictions for this round's ${score.scored} graded rehearsal(s) expected ${score.expected} passes and ${score.observed} passed.`,
    );
  }
  const stale = new Set(
    rows.flatMap((row) => (verdicts.has(row.taskId) || row.verdict === "not-run" ? [] : [row.taskId])),
  );
  if (now === null && rows.some((row) => row.verdict !== "not-run")) {
    advice.push(
      "Advice: the current bundle or its tasks do not load, so no rehearsal counts towards the target until they do.",
    );
  } else if (stale.size > 0) {
    advice.push(
      `Advice: rehearsed only at bytes that have since changed, so not counted towards the target: ${[...stale].join(", ")}.`,
    );
  }
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
 *  its own `experiment-evidence*.json` in `dir` at each read of the plan, submit included, so the file
 *  names the plan that stood last. One object per round; a null `dir` keeps the rows in memory only. */
export class PlanEvidence {
  private readonly rows: RecordedRehearsal[] = [];
  private path: string | undefined;

  constructor(
    private readonly workspace: string,
    private readonly dir: string | null,
  ) {}

  /** Records one rehearsal and returns the plan's advice after it. */
  record(row: RehearsalRow): string[] {
    const predicted = currentPlan(this.workspace)?.predictions.find(({ taskId }) => taskId === row.taskId);
    const bytes = rehearsalBytes(this.workspace)?.get(row.taskId) ?? null;
    this.rows.push({ ...row, bytes, predicted: predicted?.pass ?? null });
    return this.advice();
  }

  /** The advice the current plan earns against this round's rehearsals. */
  advice(): string[] {
    const plan = currentPlan(this.workspace);
    if (this.dir !== null && this.rows.length > 0) {
      mkdirSync(this.dir, { recursive: true });
      this.path ??= claimEvidenceFile(this.dir);
      writeCompleted(this.path, {
        schema: EVIDENCE_SCHEMA,
        planDigest: plan?.digest ?? null,
        rehearsals: this.rows,
        predictionScore: scoredBeforeVerdicts(this.rows),
      });
    }
    return plan === null ? [] : planAdvice(plan, this.rows, rehearsalBytes(this.workspace));
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

function planLines(workspace: string, rows: readonly RecordedRehearsal[]): string[] {
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
    ...planAdvice(plan, rows, rehearsalBytes(workspace)),
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
function renderPlanView(workspace: string, rows: readonly RecordedRehearsal[]): string {
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
