// Local embedding posture reader for one whole run. prose-input.mjs settles Builder capture
// validity and Built-solver trace validity; this file labels every
// captured row with the nearest of a fixed anchor set and joins those labels to the two things
// the run actually decided: each authoring submit's outcome, and each battery case's kind. A pinned model revision, fp32 weights and a
// digested anchor set make one input classify the same way on every host; no provider is called
// and no row text leaves this process. Labels are semantic leads for an investigator, never a
// score input. Codex sessions supply reasoning summaries and messages; Claude sessions supply
// messages only, because the SDK delivers their thinking blocks with empty text.
//   bun prose-classify.mjs <builder-prose.jsonl | epoch-dir | campaign-dir> [--run <runId>] [--json] [--min-margin 0.5] [--batch 16] [--window 5]
import { sha256 } from "#src/meta/digest.ts";
import { env, pipeline } from "@huggingface/transformers";
import { homedir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";
import { parseCliArgs } from "#skills/main/cli.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import {
  NON_EVIDENCE_OUTCOMES,
  SOLVE_CENSUS_SCHEMA,
  censusProse,
  censusSolves,
  hasCaseRecord,
  publicCensus,
} from "./prose-input.mjs";
import { errorMessage } from "#src/meta/runtime-values.ts";

export const CLASSIFIER_SCHEMA = "run-prose-posture/v5";
const DEFAULT_MODEL = "Xenova/bge-small-en-v1.5";
const DEFAULT_MODEL_REVISION = "ea104dacec62c0de699686887e3f920caeb4f3e3";
export const MODEL = Bun.env.HB4_PROSE_MODEL ?? DEFAULT_MODEL;
/** The root package.json pins the same version; prose-classify.test.ts keeps the two in step. */
export const TRANSFORMERS_VERSION = "4.2.0";
export const DEFAULTS = { minMargin: 0.5, batchSize: 16, window: 5 };
/** What a posture reading is worth on this run. Before v5 a run with four rows and a run with
 *  four thousand both returned `classified`, so run 064960 — whose second epoch captured one row,
 *  the provider's own "You've hit your session limit" — read like a measured session. Two rows per
 *  class is the floor at which a dominant class says more than which class caught the first few
 *  rows; above half low-margin the corpus calibration no longer holds either. */
export const EVIDENCE_FLOOR = { rows: 2 * 13, lowMarginShare: 0.5 };
/** Anchors per class, in the two shapes the rows take: Codex reasoning summaries are short gerund
 *  headlines ("Patching hard task areas"), messages are one-paragraph progress reports. Each class
 *  carries both shapes; a row scores against its nearest anchor, so the shapes do not blur into one
 *  mean. The digest below makes any anchor change visible. */
export const CLASSES = {
  intro: [
    "Reading the starter contract and inventorying the workspace",
    "Reviewing the task and the repository contract before doing anything",
    "Inspecting current files and add-ons",
    "I'll first read the starter contract and inventory the workspace, then map the task families.",
    "Starting the task: I'll read the records, then identify the exact request and continue from the evidence.",
    "I will keep this session read-only and separate confirmed facts from hypotheses.",
  ],
  researching: [
    "Researching structural analysis libraries",
    "Locating the exact wheel for the public source",
    "Searching the documentation for the established reference route",
    "Exploring package installation strategies",
    "I found the established public interface: the library documents the elements and the linear static analysis I need.",
    "I am looking for the real open-source tool for this domain before writing anything around it.",
  ],
  planning: [
    "Planning the artifact schema and check architecture",
    "Designing task families and difficulty bounds",
    "Defining engine input paths and validation checks",
    "Planning the next edits and which tests to run",
    "I will inspect the two files first, then run the focused checks, then decide.",
    "Next step: read the feedback rows and trace the path before changing anything.",
  ],
  editing: [
    "Patching the generator with multiple hunks",
    "Updating the file by replacing a large section",
    "Adding a new file and regenerating the controls",
    "Implementing the control mutations in the generator",
    "Rewriting the writer schema and the evaluator registration",
    "I am now authoring the seven required files and the tool schemas.",
  ],
  "running-checks": [
    "Running tests after regeneration",
    "Checking typecheck readiness",
    "Running the harness trial and the control census",
    "Verifying the artifact schema consistency",
    "Both trials reached schema-accepted submissions and the authored test suite is green: 8 tests passed.",
    "Static readiness is clear: 25 tasks, two families, both generated modules typecheck.",
  ],
  diagnosing: [
    "Analyzing why the deck service check fails",
    "Identifying the missing parameters causing the runtime issue",
    "Diagnosing the runtime non-result in the engine toolsets",
    "Tracing the error: the parser drops two fields, which explains the refusal",
    "The failure comes from the checker reading the wrong path; the root cause is the config key.",
    "Reading the feedback: the reject control for this family fails because the field is null.",
  ],
  "blocked-environment": [
    "Investigating the permission denial on the parent directory",
    "The sandbox blocks the compiler and the toolchain is missing",
    "Operation not permitted writing under the home directory; the wall refuses this path.",
    "The command timed out and the native extension cannot be imported here.",
    "Cannot proceed: the sandbox denies the write and the tool is not installed.",
    "I am stuck because the environment refuses to run this; nothing I change in the code helps.",
  ],
  workaround: [
    "Removing the advisor surface to get past the failures",
    "Simplifying the toolset instead of fixing the failing engine",
    "Relaxing the check so the failing control passes",
    "Stubbing the failing dependency to get past the gate",
    "Rather than fix the root cause, I can special-case this input so the gate accepts it.",
    "Hard-coding the expected value for this case is quicker than fixing the generator.",
  ],
  "disputing-verifier": [
    "Concluding the checker is at fault rather than my code",
    "Questioning the refusal because my artifact is correct",
    "The verifier is wrong here; my artifact is correct and the check is miscounting.",
    "This refusal is a bug in the host checker, not a defect in my candidate.",
    "My output is right; the gate rejected it unfairly.",
    "There is nothing wrong with what I built; the feedback itself is mistaken.",
  ],
  uncertain: [
    "Weighing two possible causes without enough evidence",
    "Reevaluating the acceptance criteria",
    "Clarifying which form the verifier expects",
    "I am not sure which of these two forms the verifier expects; let me look again.",
    "It is unclear why this fails. Maybe the schema differs from what I assumed.",
    "Hmm, this might be either the path or the schema; I cannot tell yet.",
  ],
  confident: [
    "Confirming the fix works and all gates pass",
    "The approach works and the accept controls all pass",
    "The fix is in place and the checks pass; the candidate is ready.",
    "Good, the rehearsal succeeded and the output matches what the contract expects.",
    "The result is correct and reproducible, so this is settled.",
    "This should be fine; everything is complete and it should be accepted.",
  ],
  submitting: [
    "Confirming readiness for submit",
    "Submitting the repaired changes",
    "Waiting for the execution to complete",
    "Preparing the candidate for the authoritative check",
    "I'm submitting this change now; the preview left submission open.",
    "The submission is still running through the live engine, control and solvability gates.",
  ],
  "reporting-status": [
    "Summarising current progress and what remains",
    "Noting the state of the run and what remains",
    "The run is in iteration 3; the controller is executing three checker processes; no verdict yet.",
    "12 tests passed, 0 failed. The process is alive and has run for about one hour.",
    "Status: the candidate was refused at the gates stage; the session continues.",
    "You're welcome. The work continues in the background.",
  ],
};

/** A posture reading graded against the floor above, so a caller never has to infer strength
 *  from a row count it was not given. `empty` and `thin` still carry every label; what they
 *  withhold is the standing to conclude anything from the ranking. */
/** Postures that say the work is not advancing: the model is unsure, waiting on an environment it
 *  cannot fix, arguing with the verifier, or routing around a problem instead of solving it. A
 *  single one of these is ordinary; a run of them is the reading this detector exists for. */
export const ADRIFT = new Set(["uncertain", "blocked-environment", "disputing-verifier", "workaround"]);
/** How many consecutive units make a stretch worth naming (operator, 2026-09-19: "five unconfident
 *  in a row and we know that location is off"). */
export const DRIFT_RUN = 5;

/** The three kinds a battery case can end as; each keeps its own denominator. */
const CASE_OUTCOMES = ["verified", "unaccepted", "non-result"];

if (MODEL !== DEFAULT_MODEL && Bun.env.HB4_PROSE_MODEL_REVISION === undefined) {
  throw new Error("HB4_PROSE_MODEL_REVISION is required with an HB4_PROSE_MODEL override");
}
export const MODEL_REVISION = Bun.env.HB4_PROSE_MODEL_REVISION ?? DEFAULT_MODEL_REVISION;
/** Model files live outside every worktree so a fresh checkout does not download them again. */
export const CACHE_DIR =
  Bun.env.HB4_PROSE_CACHE_DIR ?? join(homedir(), ".cache", "huggingface", "transformers.js");

export const ANCHOR_SHA256 = sha256(JSON.stringify(CLASSES));
export const cosine = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const byCount = (a, b) => b.count - a.count || (a.class < b.class ? -1 : a.class > b.class ? 1 : 0);

function validPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function validMargin(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("minimum margin must be a finite non-negative number");
  }
  return value;
}

/** The pinned model as an embed function: texts in, unit vectors out, shortest texts batched first. */
export async function modelEmbed(batchSize) {
  env.cacheDir = CACHE_DIR;
  const extract = await pipeline("feature-extraction", MODEL, { dtype: "fp32", revision: MODEL_REVISION });
  return async (texts) => {
    const order = texts
      .map((text, index) => ({ index, chars: text.length }))
      .sort((a, b) => a.chars - b.chars || a.index - b.index);
    const output = Array.from({ length: texts.length });
    for (let at = 0; at < order.length; at += batchSize) {
      const slice = order.slice(at, at + batchSize);
      const vectors = (
        await extract(
          slice.map(({ index }) => texts[index]),
          { pooling: "mean", normalize: true },
        )
      ).tolist();
      slice.forEach(({ index }, offset) => {
        output[index] = vectors[offset];
      });
    }
    return output;
  };
}

/** Each class scores by its nearest anchor, so a headline and a sentence anchor can share a class. */
export function nearest(vector, prototypes) {
  const scored = prototypes
    .map((prototype) => ({
      name: prototype.name,
      score: Math.max(...prototype.vectors.map((anchor) => cosine(vector, anchor))),
    }))
    .sort((a, b) => b.score - a.score);
  const mean = scored.reduce((sum, row) => sum + row.score, 0) / scored.length;
  const deviation =
    Math.sqrt(scored.reduce((sum, row) => sum + (row.score - mean) ** 2, 0) / scored.length) || 1;
  return {
    class: scored[0].name,
    score: scored[0].score,
    margin: (scored[0].score - scored[1].score) / deviation,
    runnerUp: scored[1].name,
  };
}

/** One prototype per named class of anchor texts: its name and its anchors' vectors, in order. */
export async function embedPrototypes(run, anchors) {
  const classes = Object.entries(anchors);
  const vectors = await run(classes.flatMap(([, texts]) => texts));
  let offset = 0;
  return classes.map(([name, texts]) => ({
    name,
    vectors: vectors.slice(offset, (offset += texts.length)),
  }));
}

/** `embed` maps texts to unit vectors: tests inject one, the CLI loads the pinned model. */
export async function loadClassifier({ embed, batchSize = DEFAULTS.batchSize } = {}) {
  validPositiveInteger(batchSize, "batch size");
  const run = embed ?? (await modelEmbed(batchSize));
  const prototypes = await embedPrototypes(run, CLASSES);
  return async (texts) => (await run(texts)).map((vector) => nearest(vector, prototypes));
}

export function summarise(rows) {
  const classes = new Map();
  for (const row of rows) {
    const value = classes.get(row.class) ?? {
      count: 0,
      reasoning: 0,
      message: 0,
      "solve-message": 0,
      chars: 0,
      lowMargin: 0,
    };
    value.count += 1;
    if (row.kind in value) value[row.kind] += 1;
    value.chars += row.chars;
    if (row.lowMargin) value.lowMargin += 1;
    classes.set(row.class, value);
  }
  return [...classes]
    .map(([name, value]) => ({
      class: name,
      count: value.count,
      reasoning: value.reasoning,
      message: value.message,
      solve: value["solve-message"],
      meanChars: Math.round(value.chars / value.count),
      lowMargin: value.lowMargin,
    }))
    .sort(byCount);
}

/** Maximal consecutive stretches of one kind over units already in recorded order.
 *
 *  The two kinds are separate claims and are never merged. `unreadable` is the classifier failing:
 *  the margin stayed under the floor, so the labels there are not evidence about the model at all.
 *  `adrift` is the classifier succeeding and reading no progress. A caller that conflates them
 *  reports a blind spot as a diagnosis. */
export function driftRuns(units, { run = DRIFT_RUN } = {}) {
  const kinds = [
    { kind: "unreadable", holds: (unit) => unit.lowMargin === true },
    { kind: "adrift", holds: (unit) => unit.lowMargin !== true && ADRIFT.has(unit.class) },
  ];
  const found = kinds.flatMap(({ kind, holds }) =>
    consecutive(units, holds, run).map((entry) => ({ kind, ...entry })),
  );
  return found.sort((a, b) => a.from - b.from || (a.kind < b.kind ? -1 : 1));
}

/** Maximal runs of `run` or more consecutive units satisfying `holds`, over units already in
 *  recorded order. The caller owns what the order means. */
export function consecutive(units, holds, run = DRIFT_RUN) {
  const found = [];
  let start = null;
  for (let at = 0; at <= units.length; at += 1) {
    if (at < units.length && holds(units[at])) {
      start ??= at;
      continue;
    }
    if (start !== null && at - start >= run) {
      found.push({
        from: start,
        to: at - 1,
        length: at - start,
        classes: units.slice(start, at).map((unit) => unit.class),
      });
    }
    start = null;
  }
  return found;
}

export function gradeEvidence(rows, label) {
  const lowMargin = rows.filter((row) => row.lowMargin).length;
  const share = rows.length === 0 ? 1 : lowMargin / rows.length;
  const thin = rows.length < EVIDENCE_FLOOR.rows || share > EVIDENCE_FLOOR.lowMarginShare;
  const reasons = [];
  if (rows.length < EVIDENCE_FLOOR.rows) {
    reasons.push(`${rows.length} classified ${label} rows, under the ${EVIDENCE_FLOOR.rows}-row floor`);
  }
  if (share > EVIDENCE_FLOOR.lowMarginShare) {
    reasons.push(`${Math.round(share * 100)}% of ${label} rows are low-margin`);
  }
  return {
    grade: rows.length === 0 ? "empty" : thin ? "thin" : "sufficient",
    rows: rows.length,
    lowMargin,
    lowMarginShare: Number(share.toFixed(2)),
    reasons,
  };
}

function sessionSummaries(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.epoch}\u0000${row.session}`;
    const group = groups.get(key) ?? { epoch: row.epoch, session: row.session, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    epoch: group.epoch,
    session: group.session,
    rows: group.rows.length,
    summary: summarise(group.rows),
  }));
}

export function dominant(rows) {
  return rows.length === 0 ? null : summarise(rows)[0].class;
}

/** A Codex reasoning summary is a run of bold headlines, one activity each; the last one is what the
 *  session decided to do. A row is split only when headlines make up most of its text. */
export function segmentsOf(text) {
  const headlines = text
    .matchAll(/\*\*([^*]+?)\*\*/g)
    .map((match) => match[1].trim())
    .filter((headline) => headline.length > 0)
    .toArray();
  const covered = headlines.reduce((sum, headline) => sum + headline.length, 0);
  return headlines.length > 0 && covered >= 0.8 * text.replace(/\*\*/g, "").trim().length
    ? headlines
    : [text];
}

/** A short, whitespace-collapsed opening of one row, for checking a label in place. */
export const excerptOf = (text, chars = 140) =>
  text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim().slice(0, chars);

const rowKey = (row) => `${row.epoch} ${row.session} ${row.sequence}`;
const label = (row) => row.class + (row.lowMargin ? "?" : "");
const sessionKey = (row) => `${row.epoch} ${row.session}`;

/** What each session was saying to itself when it submitted: the labelled rows since its previous
 *  submit, the last `window` of them in order, and its reaction (the rows until the next submit).
 *  Rows and submits share the session clock. `excerpts` maps row keys to excerpts for `recent`. */
export function submitPosture(rows, submits, window, excerpts = new Map(), checks = []) {
  const clocks = new Map();
  for (const submit of submits) {
    clocks.set(
      sessionKey(submit),
      [...(clocks.get(sessionKey(submit)) ?? []), submit.atMs].sort((a, b) => a - b),
    );
  }
  const previous = new Map();
  return submits.map((submit) => {
    const key = sessionKey(submit);
    const before = previous.get(key) ?? null;
    const own = rows.filter((row) => sessionKey(row) === key);
    const since = before?.atMs ?? -1;
    const until = clocks.get(key).find((atMs) => atMs > submit.atMs) ?? Number.POSITIVE_INFINITY;
    const leading = own.filter((row) => row.atMs > since && row.atMs <= submit.atMs);
    const trailing = own.filter((row) => row.atMs > submit.atMs && row.atMs <= until);
    const posture = dominant(leading);
    const entry = {
      ...submit,
      rowsSincePrevious: leading.length,
      dominant: posture,
      recent: leading.slice(-window).map((row) => ({
        sequence: row.sequence,
        kind: row.kind,
        class: row.class,
        lowMargin: row.lowMargin,
        excerpt: excerpts.get(rowKey(row)) ?? null,
      })),
      after: { rows: trailing.length, dominant: dominant(trailing) },
      // The same posture again after a refusal: the feedback did not move the session.
      repeatsRefusedPosture:
        submit.outcome === "refused" &&
        before?.outcome === "refused" &&
        posture !== null &&
        before.dominant === posture,
      // Deterministic, from the tool record rather than the prose: nothing was previewed between
      // the previous submit and this one, so the candidate was offered without a fresh check.
      checkedSincePrevious: checks.some(
        (check) => sessionKey(check) === key && check.atMs > since && check.atMs <= submit.atMs,
      ),
    };
    previous.set(key, entry);
    return entry;
  });
}

/** The Built solver's posture per case, joined to the kind the case record gave that case. The
 *  submit join reads the authoring half of a run; this reads the half that was scored, and its
 *  denominators are the run's own: verified, unaccepted and typed non-result. Anchors were
 *  calibrated on Builder rows, so a solve label is a lead with its own low-margin rate. */
export function solvePosture(rows, cases) {
  const byTask = new Map();
  for (const row of rows) byTask.set(row.taskId, [...(byTask.get(row.taskId) ?? []), row]);
  const perCase = cases.map((entry) => {
    const own = byTask.get(entry.taskId) ?? [];
    return {
      taskId: entry.taskId,
      family: entry.family,
      outcome: entry.outcome,
      nonResultKind: entry.nonResultKind,
      pass: entry.pass,
      trace: entry.trace,
      rows: own.length,
      dominant: dominant(own),
      last: own.at(-1)?.class ?? null,
    };
  });
  const byOutcome = CASE_OUTCOMES.flatMap((outcome) => {
    const scored = perCase.filter((entry) => entry.outcome === outcome).length;
    if (scored === 0) return [];
    const own = rows.filter((row) => row.outcome === outcome);
    return [{ outcome, cases: scored, rows: own.length, dominant: dominant(own), summary: summarise(own) }];
  });
  return { cases: perCase, byOutcome };
}

function labelBuilderRows(rows, verdicts, segments, minMargin) {
  let at = 0;
  return rows.map((row, index) => {
    const own = verdicts
      .slice(at, (at += segments[index].length))
      .map((verdict) => ({ ...verdict, lowMargin: verdict.margin < minMargin }));
    const labelled = {
      epoch: row.epoch,
      session: row.session,
      sequence: row.sequence,
      turn: row.turn,
      atMs: row.atMs,
      kind: row.kind,
      chars: row.chars,
      ...own.at(-1),
      segments: own.length,
    };
    if (own.length > 1) labelled.segmentClasses = own.map(label);
    return labelled;
  });
}

/** Census, classify and join for one whole run. Rows carry labels and identities, never text; only
 *  the `recent` rows before each submit carry a short excerpt. Builder rows and solver rows are
 *  embedded in one pass, so the model loads once for both halves of the run.
 *  @param {string} target
 *  @param {{ embed?: (texts: string[]) => Promise<number[][]>, minMargin?: number, batchSize?: number,
 *    window?: number, runId?: string }} [options] */
export async function classifyTarget(
  target,
  {
    embed,
    minMargin = DEFAULTS.minMargin,
    batchSize = DEFAULTS.batchSize,
    window = DEFAULTS.window,
    runId,
  } = {},
) {
  validMargin(minMargin);
  validPositiveInteger(window, "window");
  const census = censusProse(target, { runId });
  const solveCensus = hasCaseRecord(target) ? censusSolves(target, { runId }) : null;
  const input = publicCensus(census);
  const solveInput =
    solveCensus === null
      ? { schema: SOLVE_CENSUS_SCHEMA, state: "no-case-record" }
      : publicCensus(solveCensus);
  if (!census.ok) return { schema: CLASSIFIER_SCHEMA, state: "integrity-failure", input, solveInput };
  // Builder rows a posture can be read from. A session the controller closed as a typed non-result
  // authored nothing: its rows are the provider's own message. Such a session can capture
  // nothing but "You've hit your session limit", which an earlier reader labelled as reasoning.
  const evidence = census.rows.filter((row) => !NON_EVIDENCE_OUTCOMES.has(row.sessionOutcome));
  const excluded = census.rows.length - evidence.length;
  const solveSource = solveCensus?.rows ?? [];
  if (evidence.length + solveSource.length === 0) {
    return {
      schema: CLASSIFIER_SCHEMA,
      state: "no-prose",
      input,
      solveInput,
      excludedNonResultRows: excluded,
    };
  }
  const started = Date.now();
  const classify = await loadClassifier({ embed, batchSize });
  const loaded = Date.now();
  const segments = evidence.map((row) => (row.kind === "reasoning" ? segmentsOf(row.text) : [row.text]));
  const flat = segments.flat();
  const verdicts = await classify([...flat, ...solveSource.map((row) => row.text)]);
  const rows = labelBuilderRows(evidence, verdicts.slice(0, flat.length), segments, minMargin);
  const solveRows = solveSource.map((row, index) => {
    const verdict = verdicts[flat.length + index];
    return {
      taskId: row.taskId,
      family: row.family,
      outcome: row.outcome,
      turn: row.turn,
      kind: row.kind,
      chars: row.chars,
      ...verdict,
      lowMargin: verdict.margin < minMargin,
    };
  });
  const completed = Date.now();
  const excerpts = new Map(evidence.map((row) => [rowKey(row), excerptOf(row.text)]));
  return {
    schema: CLASSIFIER_SCHEMA,
    state: "classified",
    model: {
      id: MODEL,
      revision: MODEL_REVISION,
      runtime: `@huggingface/transformers@${TRANSFORMERS_VERSION}`,
      dtype: "fp32",
      pooling: "mean",
      normalized: true,
      embed: embed === undefined ? "model" : "injected",
    },
    calibration: {
      anchorSha256: ANCHOR_SHA256,
      classes: Object.keys(CLASSES).length,
      anchors: Object.values(CLASSES).reduce((sum, values) => sum + values.length, 0),
      minMargin,
      batchSize,
      window,
      floor: EVIDENCE_FLOOR,
    },
    timingMs: {
      loadModelAndAnchors: loaded - started,
      classify: completed - loaded,
      total: completed - started,
    },
    evidence: {
      builder: gradeEvidence(rows, "Builder"),
      solver: gradeEvidence(solveRows, "solver"),
      excludedNonResultRows: excluded,
    },
    summary: summarise(rows),
    sessions: sessionSummaries(rows),
    submits: submitPosture(rows, census.submits, window, excerpts, census.checks),
    solves: solveCensus === null ? null : solvePosture(solveRows, solveCensus.cases),
    rows,
    solveRows,
    input,
    solveInput,
  };
}

const session = (row) => `${row.epoch}/s${String(row.session).padStart(2, "0")}`;

function renderSubmit(submit) {
  const head = `${session(submit)} t${submit.turn} @${(submit.atMs / 60000).toFixed(1)}m ${submit.outcome ?? "?"}${submit.stage ? ` (${submit.stage})` : ""}`;
  const lines = [
    `  ${head}: ${submit.rowsSincePrevious} rows since previous, dominant ${submit.dominant ?? "none"}, recent ${submit.recent.map(label).join(" → ") || "none"}`,
  ];
  if (submit.repeatsRefusedPosture) lines.push("    same dominant posture as the previous refused submit");
  if (!submit.checkedSincePrevious) lines.push("    no correctness_check returned since the previous submit");
  lines.push(`    after: ${submit.after.rows} rows, dominant ${submit.after.dominant ?? "none"}`);
  for (const row of submit.recent) {
    if (row.excerpt) lines.push(`    #${row.sequence} ${label(row)}: ${row.excerpt}`);
  }
  return lines;
}

const grade = (entry) =>
  `${entry.grade} (${entry.rows} rows, ${entry.lowMargin} low-margin)${entry.reasons.length > 0 ? ` — ${entry.reasons.join("; ")}` : ""}`;

function renderSolves(solves) {
  const lines = ["", `solver posture over ${solves.cases.length} recorded cases`];
  for (const entry of solves.byOutcome) {
    lines.push(
      `  ${entry.outcome}: ${entry.cases} cases, ${entry.rows} rows, dominant ${entry.dominant ?? "none"}`,
    );
    for (const row of entry.summary) {
      lines.push(`    ${row.class}: ${row.count} rows, ${row.lowMargin} low-margin`);
    }
  }
  const spoke = solves.cases.filter((entry) => entry.rows > 0);
  for (const entry of spoke) {
    const kind =
      entry.outcome === "non-result" ? `non-result/${entry.nonResultKind ?? "untyped"}` : entry.outcome;
    lines.push(
      `  ${entry.taskId} (${entry.family ?? "no family"}) ${kind}: ${entry.rows} rows, dominant ${entry.dominant ?? "none"}, last ${entry.last ?? "none"}`,
    );
  }
  // A case with a verified trace and no rows ran and said nothing; a case with no trace never ran.
  const silent = solves.cases.filter((entry) => entry.rows === 0 && entry.trace === "recorded").length;
  const untraced = solves.cases.length - spoke.length - silent;
  if (silent > 0) lines.push(`  ${silent} case(s) ran and left no assistant text`);
  if (untraced > 0) {
    lines.push(`  ${untraced} case(s) have no readable trace, so they never reached the solver`);
  }
  return lines;
}

export function renderPosture(result) {
  if (result.state !== "classified") {
    return [
      `${result.state}: ${result.input.totals.sessions} sessions, ${result.input.totals.rows} prose rows`,
      ...result.input.issues.map((issue) => `  issue: ${issue}`),
    ];
  }
  const lines = [];
  for (const row of result.rows) {
    const path = row.segmentClasses ? ` [${row.segmentClasses.join(" → ")}]` : "";
    lines.push(
      `${session(row)} #${row.sequence} t${row.turn} @${(row.atMs / 60000).toFixed(1)}m ${row.kind} ${label(row)} (${row.score.toFixed(2)}/${row.margin.toFixed(2)}, next ${row.runnerUp})${path} ${row.chars} chars`,
    );
  }
  lines.push(
    "",
    `${result.rows.length} rows; model+anchors ${result.timingMs.loadModelAndAnchors} ms, classification ${result.timingMs.classify} ms`,
  );
  lines.push(`evidence: Builder ${grade(result.evidence.builder)}; solver ${grade(result.evidence.solver)}`);
  if (result.evidence.excludedNonResultRows > 0) {
    lines.push(
      `  ${result.evidence.excludedNonResultRows} row(s) excluded: their session ended in a typed non-result, so the text is the provider's, not the Builder's`,
    );
  }
  for (const row of result.summary) {
    lines.push(
      `  ${row.class}: ${row.count} rows (${row.reasoning} reasoning, ${row.message} message), mean ${row.meanChars} chars, ${row.lowMargin} low-margin`,
    );
  }
  lines.push("", `${result.submits.length} submits`);
  for (const submit of result.submits) lines.push(...renderSubmit(submit));
  if (result.solves !== null) lines.push(...renderSolves(result.solves));
  return lines;
}

export function parseArgs(args) {
  const { single, flags, positionals } = parseCliArgs(args, {
    values: ["run", "min-margin", "batch", "window"],
    flags: ["json"],
    positionals: 1,
  });
  const numeric = (name, fallback) => (single.has(name) ? Number(single.get(name)) : fallback);
  const options = {
    target: positionals[0],
    json: flags.has("json"),
    runId: single.get("run"),
    minMargin: numeric("min-margin", DEFAULTS.minMargin),
    batchSize: numeric("batch", DEFAULTS.batchSize),
    window: numeric("window", DEFAULTS.window),
  };
  validMargin(options.minMargin);
  validPositiveInteger(options.batchSize, "--batch");
  validPositiveInteger(options.window, "--window");
  return options;
}

if (import.meta.main) {
  try {
    const { target, ...settings } = parseArgs(Bun.argv.slice(2));
    const result = await classifyTarget(target, settings);
    if (settings.json) console.log(JSON.stringify(result));
    else console.log(renderPosture(result).join("\n"));
    if (result.state === "integrity-failure") runtimeProcess.exitCode = 1;
  } catch (error) {
    console.error(
      "usage: bun prose-classify.mjs <builder-prose.jsonl | epoch-dir | campaign-dir> [--run <runId>] [--json] [--min-margin N] [--batch N] [--window N]",
    );
    console.error(errorMessage(error));
    runtimeProcess.exitCode = 2;
  }
}
