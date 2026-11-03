/**
 * One task of Harness²'s k=1 parallel recursion on JobBench, and one profession's stream of them
 * (`run_parallel` and `_run_stage` of `harness2/core/recursion.py`, `trivial_selection`,
 * `reflect_adoption` and `_distil` of `selection.py`, `run_task`, `_run_one_mode` and
 * `run_domain` of `schedule.py`, and `ledger.py`; Apache-2.0, Google LLC, at 1cfe254 with the fork's
 * Claude Code commits). A task rolls the base harness once (base1), runs an INVARIANT and a DOMAIN
 * editor side by side on that evidence (inv1, dom1) and rolls each, lets one aggregator compose a
 * final from both (agg1) and rolls it, delivers agg1 without a selector, and has one experience
 * session write the lesson the profession's library keeps: R = 4 rollouts and P = 3 sessions.
 *
 * Local changes: each rollout's dollars enter the ledger (Harness² records 0); a task whose summary
 * reads `ok` is skipped on a second sweep instead of Harness²'s per-mode resume, and the summary is
 * written whole instead of merged into an old one; `inputs` and `harness_fingerprint` are sha256
 * digests instead of `runmark`'s sha1, so they never equal a recorded value; no rollout is reused
 * from a completion mark.
 */
import { errorMessage } from "#src/meta/runtime-values.ts";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import { sha256 } from "#src/meta/digest.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { isRecord, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { keysIf } from "#src/meta/optional-key.ts";
import { join } from "#src/meta/path.ts";
import { ProposerError, type Reply } from "./claude.ts";
import {
  build,
  described,
  mission,
  noGraderVerdicts,
  noLeakPaths,
  treeHasNoGraderVerdicts,
  type Candidate,
  type Evidence,
  type RunView,
} from "./context.ts";
import { hasExperience, type Experience, type Library } from "./library.ts";
import { prompt, type Job, type Sections } from "./prompts.ts";
import { pyDumps, pySlice, pyStrip, splitLines, walkFiles } from "./py.ts";
import { autotrigger, changedFrom, readTree, validate, writeTree, type Tree } from "./tree.ts";

/** One improver call as a stage or the experience writer makes it. */
interface Call {
  readonly mission: string;
  readonly contextDir: string;
  readonly label: string;
  readonly harvest: string | null;
}

/** What a task needs from the benchmark: its evidence, base harness, prompts, rollouts and improver. */
export interface Bench {
  readonly evidence: Evidence;
  readonly baseHarness: string;
  readonly sections: Sections;
  /** One rollout of a harness (the base when null): its run directory and dollars, or a throw. */
  execute(task: string, harnessDir: string | null, runId: string): Promise<{ runDir: string; usd: number }>;
  improve(call: Call): Promise<Reply>;
}

export const NAMESPACE = "jb-cc-agg1";
const STAGE_ATTEMPTS = 2;
const TRIVIAL_WHY = "trivial pool: single final at k=1; delivered without a selector session";
const OFF_SURFACE_TAIL =
  ". Component names must be lowercase letters, digits, `_` or `-` (e.g. `.claude/skills/doc_review/SKILL.md`, `scripts/check_totals.py`).";

interface Stage {
  readonly label: string;
  readonly dim: "INV" | "DOM" | "AGG";
  readonly tree: Tree;
  readonly keptBase: boolean;
  readonly fellBack: boolean;
  readonly error: string;
  readonly usd: number;
  readonly attempts: number;
  readonly notes: string;
  readonly executionFailed: boolean;
}

interface Entry {
  readonly kind: "rollout" | "session";
  readonly label: string;
  readonly usd: number;
  readonly attempts: number;
}

/** `Selection`, with what a trivial k=1 pool leaves to vary. */
interface Selection {
  ok: boolean;
  chosenLabel: string;
  chosenRunId: string;
  dropped: string[];
  error: string;
  usd: number;
  experience: Experience;
}

/** What a task's summary gathers as it goes. */
interface Summary {
  readonly modes: Record<string, JsonValue>;
  readonly selections: Record<string, JsonValue>;
  readonly errors: string[];
}

/** A rollout that left no deliverable, with what it billed on the way. */
export class DeadRollout extends Error {
  constructor(
    message: string,
    readonly usd: number,
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}

/** `Ledger.to_dict`, once `assert_identity` has held: R = 4 and P = 3 with no label twice. */
function ledgerOf(task: string, entries: readonly Entry[]): JsonObject {
  const of = (kind: Entry["kind"]): Entry[] => entries.filter((entry) => entry.kind === kind);
  const rollouts = of("rollout").map((entry) => entry.label);
  const sessions = of("session").map((entry) => entry.label);
  const twice = [rollouts, sessions].flatMap((labels) =>
    labels.filter((label, index) => labels.indexOf(label) !== index),
  );
  if (twice.length > 0 || rollouts.length !== 4 || sessions.length !== 3) {
    const detail = [
      `agg-1 ${task}: R=${rollouts.length} (want 4), P=${sessions.length} (want 3)`,
      `  rollouts: ${rollouts.join(", ") || "(none)"}`,
      `  sessions: ${sessions.join(", ") || "(none)"}`,
    ];
    if (twice.length > 0) detail.push(`  DUPLICATE labels: ${[...new Set(twice)].toSorted().join(", ")}`);
    throw Object.assign(new Error(detail.join("\n")), { name: "BudgetError" });
  }
  const usd = (kind?: Entry["kind"]): number =>
    Math.round(
      entries
        .filter((entry) => kind === undefined || entry.kind === kind)
        .reduce((sum, entry) => sum + entry.usd, 0) * 1e6,
    ) / 1e6;
  return {
    mode: "agg",
    task_id: task,
    k: 1,
    R: 4,
    expected_R: 4,
    P: 3,
    session_attempts: of("session").reduce((sum, entry) => sum + entry.attempts, 0),
    expected_P: 3,
    usd: usd(),
    rollout_usd: usd("rollout"),
    session_usd: usd("session"),
    rollouts,
    sessions,
  };
}

/** `_accept_tree`: repair then validate a proposed tree; whether it kept the base, and the refusal. */
function accept(tree: Tree, fallback: Tree): [boolean, string] {
  autotrigger(tree);
  const kept = !changedFrom(fallback, tree);
  try {
    validate(tree);
    treeHasNoGraderVerdicts(tree);
  } catch (error) {
    return [kept, errorMessage(error)];
  }
  return [kept, ""];
}

/** Why a returned workspace cannot stand as the stage's tree, writing it back for the retry. */
function refusalOf(
  workspace: string | null,
  root: string,
  fallback: Tree,
): { tree: Tree; keptBase: boolean; error: string } {
  if (workspace === null) {
    return {
      tree: new Map(),
      keptBase: false,
      error:
        "the harness directory did not come back from the session; edit the files in `context/harness/` in place",
    };
  }
  const rejected: string[] = [];
  const tree = readTree(workspace, rejected);
  if (tree.size === 0) {
    return {
      tree,
      keptBase: false,
      error: "`context/harness/` came back empty -- edit the files, do not delete them all",
    };
  }
  const [keptBase, error] =
    rejected.length > 0
      ? [
          false,
          `these files are off the editable surface and were not applied: ${rejected.toSorted().slice(0, 6).join(", ")}${OFF_SURFACE_TAIL}`,
        ]
      : accept(tree, fallback);
  if (error !== "") writeTree(tree, join(root, "harness"));
  return { tree, keptBase, error };
}

/** `_run_stage`: build the evidence, ask for an edit, and retry a refused one once. */
async function runStage(
  bench: Bench,
  stage: { label: string; dim: Stage["dim"]; job: Job; fallback: Tree; contextDir: string; task: string },
  inputs: Parameters<typeof build>[3],
): Promise<Stage> {
  const base = {
    label: stage.label,
    dim: stage.dim,
    tree: stage.fallback,
    keptBase: false,
    fellBack: true,
    notes: "",
  };
  let made: { root: string; text: string };
  try {
    const built = build(join(stage.contextDir, stage.label), bench.evidence, stage.task, inputs);
    made = { root: built.root, text: mission(built, prompt(stage.job, bench.sections)) };
  } catch (error) {
    return {
      ...base,
      error: pySlice(`could not build evidence: ${described(error)}`, 0, 400),
      usd: 0,
      attempts: 0,
      executionFailed: false,
    };
  }
  let error = "";
  let usd = 0;
  let attempts = 0;
  for (let attempt = 1; attempt <= STAGE_ATTEMPTS; attempt += 1) {
    const retry =
      error === ""
        ? ""
        : `\n\n# YOUR PREVIOUS ATTEMPT WAS REJECTED\n\n${error}\n\nFix it in \`context/harness/\` and reply again.`;
    let reply: Reply;
    try {
      reply = await bench.improve({
        mission: made.text + retry,
        contextDir: made.root,
        label: `${stage.label}.a${attempt}`,
        harvest: "context/harness",
      });
    } catch (failure) {
      if (!(failure instanceof ProposerError)) throw failure;
      attempts += failure.attempts || STAGE_ATTEMPTS;
      usd += failure.costUsd;
      return { ...base, error: pySlice(failure.message, 0, 400), usd, attempts, executionFailed: true };
    }
    usd += reply.costUsd;
    attempts += Math.max(1, reply.attempts);
    const got = refusalOf(reply.workspace, made.root, stage.fallback);
    error = got.error;
    if (error === "") {
      const notes = /<notes>([\s\S]*?)<\/notes>/u.exec(reply.text)?.[1] ?? reply.text;
      return {
        ...base,
        tree: got.tree,
        keptBase: got.keptBase,
        fellBack: false,
        error: "",
        usd,
        attempts,
        notes: pyStrip(notes),
        executionFailed: false,
      };
    }
  }
  return { ...base, error: pySlice(error, 0, 400), usd, attempts, executionFailed: false };
}

/** `_roll`: write a harness and roll it once; a dead rollout is recorded, never thrown. */
async function roll(
  bench: Bench,
  task: string,
  label: string,
  tree: Tree | null,
  workDir: string,
): Promise<[RunView, number]> {
  const harnessDir = tree === null ? null : writeTree(tree, join(workDir, "harnesses", label));
  const runId = `${NAMESPACE}/${task}/${label}`;
  try {
    const { runDir, usd } = await bench.execute(task, harnessDir, runId);
    const exists = existsSync(runDir);
    return [
      { label, runId, runDir, ok: exists, delivered: exists && walkFiles(runDir).length > 0, error: "" },
      usd,
    ];
  } catch (error) {
    const usd = error instanceof DeadRollout ? error.usd : 0;
    return [
      {
        label,
        runId,
        runDir: join(workDir, "missing"),
        ok: false,
        delivered: false,
        error: described(error),
      },
      usd,
    ];
  }
}

function stageRecord(stage: Stage): JsonObject {
  return {
    label: stage.label,
    dim: stage.dim,
    fell_back: stage.fellBack,
    kept_base: stage.keptBase,
    execution_failed: stage.executionFailed,
    attempts: stage.attempts,
    usd: stage.usd,
    cached: false,
    notes: stage.notes,
    error: pySlice(stage.error, 0, 400),
  };
}

const decisionsOf = (stages: readonly Stage[]): Map<string, string> =>
  new Map(stages.map((stage) => [stage.label, stage.notes || stage.error]));

/** `run_parallel` at k=1, from a base rollout that produced something. */
async function runParallel(
  bench: Bench,
  task: string,
  base: [RunView, number],
  workDir: string,
  libraryDir: string | null,
) {
  const entries: Entry[] = [{ kind: "rollout", label: base[0].label, usd: base[1], attempts: 1 }];
  const baseTree = readTree(bench.baseHarness);
  const baseDir = writeTree(baseTree, join(workDir, "harnesses", "base"));
  const common = { fallback: baseTree, contextDir: join(workDir, "context"), task };
  const evidence = { rollouts: [base[0]], harnessDir: baseDir, libraryDir };
  const editors = await Promise.all([
    runStage(bench, { ...common, label: "inv1", dim: "INV", job: "propose INV" }, evidence),
    runStage(bench, { ...common, label: "dom1", dim: "DOM", job: "propose DOM" }, evidence),
  ]);
  for (const stage of editors) {
    entries.push({ kind: "session", label: stage.label, usd: stage.usd, attempts: stage.attempts });
  }
  const rolled = await Promise.all(
    editors.map((stage) => roll(bench, task, stage.label, stage.tree, workDir)),
  );
  for (const [run, usd] of rolled) entries.push({ kind: "rollout", label: run.label, usd, attempts: 1 });
  const pool: Candidate[] = rolled.map(([run]) => [run.label, join(workDir, "harnesses", run.label), run]);
  const aggInputs = { ...evidence, pool, decisions: decisionsOf(editors) };
  const agg = await runStage(bench, { ...common, label: "agg1", dim: "AGG", job: "aggregate" }, aggInputs);
  entries.push({ kind: "session", label: agg.label, usd: agg.usd, attempts: agg.attempts });
  const [final, finalUsd] = await roll(bench, task, "agg1", agg.tree, workDir);
  entries.push({ kind: "rollout", label: "agg1", usd: finalUsd, attempts: 1 });
  const stages = [...editors, agg];
  const record: JsonObject = {
    mode: "agg",
    task_id: task,
    k: 1,
    finals: ["agg1"],
    ok: !stages.some((stage) => stage.executionFailed),
    fell_back: stages.filter((stage) => stage.fellBack).map((stage) => stage.label),
    kept_base: stages.filter((stage) => stage.keptBase).map((stage) => stage.label),
    stages: stages.map((stage) => stageRecord(stage)),
    similarity: { n: 1, n_distinct: 1, mean_line_jaccard: 1 },
    ledger: ledgerOf(task, entries),
    errors: [],
  };
  return { record, stages, agg, final, rollouts: [base[0], ...rolled.map(([run]) => run), final], baseTree };
}

/** `Selection.to_dict`, in its field order. */
function selectionRecord(task: string, selection: Selection): JsonObject {
  const label = selection.chosenLabel;
  return {
    task_id: task,
    mode: "agg",
    k: 1,
    chosen_id: label === "" ? "" : "A",
    chosen_label: label,
    chosen_run_id: selection.chosenRunId,
    chosen_is_base: label.startsWith("base"),
    why: label === "" ? "" : TRIVIAL_WHY,
    id_map: label === "" ? {} : { A: label },
    dropped: selection.dropped,
    n_candidates: label === "" ? 0 : 1,
    ok: selection.ok,
    fallback: false,
    error: selection.error,
    usd: selection.usd,
    experience: { ...selection.experience },
    trivial: true,
    evidence: "deliverable",
  };
}

const failedSelection = (error: string): Selection => ({
  ok: false,
  chosenLabel: "",
  chosenRunId: "",
  dropped: [],
  error,
  usd: 0,
  experience: {},
});

function persist(task: string, selection: Selection, workDir: string, runDir: string): void {
  const record = { ...selectionRecord(task, selection), chosen_run_dir: runDir };
  writeFileSync(join(workDir, "selection", "agg1", "selection.json"), pyDumps(record, { indent: 2 }));
}

/** `trivial_selection` over `_render_pool`: deliver the one final unless it left nothing readable. */
function trivialSelection(bench: Bench, task: string, final: RunView, workDir: string): Selection {
  const selection = failedSelection(
    "no candidate produced an artifact (finals-only pool has no base fallback)",
  );
  try {
    if (final.ok && final.delivered && pyStrip(bench.evidence.text(final.runDir)) !== "") {
      Object.assign(selection, { ok: true, chosenLabel: final.label, chosenRunId: final.runId, error: "" });
    } else selection.dropped.push(final.label);
  } catch (error) {
    selection.dropped.push(pySlice(`${final.label} (render failed: ${described(error)})`, 0, 200));
  }
  if (!selection.ok) return selection;
  rmSync(join(workDir, "selection", "agg1"), { recursive: true, force: true });
  mkdirSync(join(workDir, "selection", "agg1"), { recursive: true });
  persist(task, selection, workDir, final.runDir);
  return selection;
}

/** `_distil`'s reading of the reply: the edit rows, and the lesson only when its three fields hold. */
function lessonOf(reply: string, root: string): Experience {
  const edits = /<edits>([\s\S]*?)<\/edits>/u.exec(reply)?.[1];
  if (edits !== undefined) writeFileSync(join(root, "edits.md"), `${pyStrip(edits)}\n`);
  const block = /<experience>([\s\S]*?)<\/experience>/u.exec(reply)?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const line of splitLines(pyStrip(block)).filter((row) => row.includes(":"))) {
    const cut = line.indexOf(":");
    const key = pyStrip(line.slice(0, cut)).toLowerCase();
    if (["cue", "lesson", "evidence", "confidence"].includes(key)) out[key] = pyStrip(line.slice(cut + 1));
  }
  if (!["cue", "lesson", "evidence"].every((key) => (out[key] ?? "") !== "")) return {};
  if (edits !== undefined) out.edits = pyStrip(edits);
  treeHasNoGraderVerdicts(new Map([["EXPERIENCE.md", pyDumps(out)]]));
  return out;
}

/** `reflect_adoption` then `_distil`: the record of the round, and the lesson one session draws from it. */
async function reflect(
  bench: Bench,
  task: string,
  selection: Selection,
  run: Awaited<ReturnType<typeof runParallel>>,
  workDir: string,
): Promise<void> {
  const root = join(workDir, "reflection", "agg1");
  const harnesses = join(workDir, "harnesses");
  const built = build(root, bench.evidence, task, {
    rollouts: run.rollouts,
    harnessDir: join(harnesses, selection.chosenLabel),
    pool: run.rollouts
      .filter((rollout) => !rollout.label.startsWith("base"))
      .map((rollout) => [rollout.label, join(harnesses, rollout.label), rollout]),
    decisions: decisionsOf(run.stages),
  });
  cpSync(bench.baseHarness, join(root, "base_harness"), { recursive: true });
  const adoption = {
    chosen_label: selection.chosenLabel,
    candidate_ids: { A: selection.chosenLabel },
    reason: TRIVIAL_WHY,
  };
  writeFileSync(join(root, "adoption.json"), `${pyDumps(adoption, { indent: 2 })}\n`);
  noLeakPaths(root);
  noGraderVerdicts(root);
  const copy = `${root}.experience`;
  rmSync(copy, { recursive: true, force: true });
  cpSync(root, copy, { recursive: true, filter: (path) => !path.endsWith("/selection.json") });
  noGraderVerdicts(copy);
  const happened = `# WHAT HAPPENED\n\nHarness ${selection.chosenLabel} was adopted. The selection reasoning was:\n\n${TRIVIAL_WHY}\n\ncontext/adoption.json maps any anonymous IDs in that reasoning to rollout labels. Compare context/harness/ with context/base_harness/ and the candidates in context/pool/. Read the decisions and execution contrasts before writing.\n\n`;
  const text = [prompt("experience", bench.sections), happened + built.layout].join("\n\n");
  try {
    const reply = await bench.improve({
      mission: text,
      contextDir: copy,
      label: "experience.agg1",
      harvest: null,
    });
    selection.usd += reply.costUsd;
    selection.experience = lessonOf(reply.text, root);
  } catch (failure) {
    if (!(failure instanceof ProposerError)) throw failure;
    selection.usd += failure.costUsd;
    return;
  }
  persist(task, selection, workDir, run.final.runDir);
}

/** `runmark`'s digest walk (a name, then its content), with sha256 in place of sha1. */
function digestOf(parts: readonly (readonly [name: string, content: string | Uint8Array])[]): string {
  return sha256(parts.map(([name, content]) => `${name}\0${sha256(content)}\0`).join("")).slice(0, 16);
}

/** The files `runmark` digests: a tree's own, without bytecode or Finder litter. */
function treeParts(dir: string): [string, Uint8Array][] {
  return walkFiles(dir, ["__pycache__"])
    .filter((rel) => !rel.endsWith(".pyc") && !rel.endsWith(".DS_Store") && rel !== ".adapt_complete")
    .map((rel) => [rel, readFileSync(join(dir, rel))]);
}

/** `_run_one_mode`: the recursion, the trivial selection, the reflection and the library entry. */
async function runMode(
  bench: Bench,
  { task, workDir }: { task: string; workDir: string },
  base: [RunView, number],
  library: Library,
  summary: Summary,
): Promise<void> {
  const run = await runParallel(bench, task, base, workDir, library.contextDir());
  summary.modes.agg = run.record;
  for (const stage of run.stages.filter((each) => each.executionFailed)) {
    summary.errors.push(`agg: ${stage.label}: proposer execution failed: ${stage.error}`);
  }
  const selection = trivialSelection(bench, task, run.final, workDir);
  summary.selections.agg = selectionRecord(task, selection);
  if (selection.ok) await reflect(bench, task, selection, run, workDir);
  const chosenTree = selection.ok ? run.agg.tree : run.baseTree;
  const record: JsonObject = {
    ...selectionRecord(task, selection),
    selected_at: new Date().toISOString(),
    chosen_run_dir: selection.ok ? run.final.runDir : "",
    chosen_tree_is_base: !changedFrom(run.baseTree, chosenTree),
  };
  if (selection.ok) {
    record.harness_fingerprint = digestOf(treeParts(join(workDir, "harnesses", selection.chosenLabel)));
  }
  summary.selections.agg = record;
  if (!selection.ok) summary.errors.push(`agg: selection failed: ${selection.error}`);
  if (selection.ok && !run.final.delivered) {
    summary.errors.push(`agg: selected run ${run.final.runId} produced no deliverable`);
  }
  if (selection.ok && hasExperience(selection.experience)) {
    library.add(task, chosenTree, {
      why: TRIVIAL_WHY,
      label: selection.chosenLabel,
      runId: selection.chosenRunId,
      experience: selection.experience,
    });
  }
}

/** `_merged_status`: ok only when the mode and its selection both are, and nothing erred. */
function mergedStatus(summary: Summary): string {
  const holds = (value: JsonValue | undefined, key: string): boolean => {
    const field = isRecord(value) ? value[key] : undefined;
    return field !== undefined && field !== false && field !== "";
  };
  const [mode, selection] = [summary.modes.agg, summary.selections.agg];
  return summary.errors.length === 0 &&
    holds(mode, "ok") &&
    holds(selection, "ok") &&
    holds(selection, "chosen_label")
    ? "ok"
    : "partial";
}

const workDirOf = (runsRoot: string, task: string): string =>
  join(runsRoot, NAMESPACE, task.replaceAll("/", "__"));

/** `run_task`: base1, the recursion, the selection and the summary; the summary's status and errors. */
async function runTask(
  bench: Bench,
  task: string,
  runsRoot: string,
  library: Library,
): Promise<{ status: string; errors: string[] }> {
  const workDir = workDirOf(runsRoot, task);
  mkdirSync(workDir, { recursive: true });
  const base = await roll(bench, task, "base1", null, workDir);
  const summary: Summary = { modes: {}, selections: {}, errors: [] };
  let status = "base-failed";
  if (base[0].ok) {
    try {
      await runMode(bench, { task, workDir }, base, library, summary);
    } catch (error) {
      summary.modes.agg = {
        ok: false,
        error: described(error),
        traceback: error instanceof Error ? (error.stack ?? "") : "",
      };
      summary.selections.agg = selectionRecord(task, failedSelection(described(error)));
      summary.errors.push(`agg: ${described(error)}`);
    }
    status = mergedStatus(summary);
  } else {
    const error = "no base rollout produced anything";
    summary.modes.agg = { ok: false, error };
    summary.selections.agg = selectionRecord(task, failedSelection(error));
    summary.errors.push(error);
  }
  const files = bench.evidence.taskFiles(task);
  const record = {
    task_id: task,
    domain: task.split("/")[0] ?? "",
    k: 1,
    seed: null,
    status,
    inputs: digestOf([
      ["prompt", bench.evidence.taskPrompt(task)],
      ...(files === null ? [] : treeParts(files)),
    ]),
    base: [{ label: base[0].label, run_id: base[0].runId, run_dir: base[0].runDir }],
    ...summary,
  };
  writeFileSync(join(workDir, "summary.json"), pyDumps(record, { indent: 2 }));
  return { status, errors: summary.errors };
}

/** `run_domain`: one profession's tasks in order, each reading only the library of those before it. */
export async function runDomain(
  bench: Bench,
  domain: string,
  tasks: readonly string[],
  runsRoot: string,
  library: Library,
): Promise<JsonObject> {
  const rows: { task: string; status: string; error?: string; library_entries_before?: JsonObject }[] = [];
  for (const [index, task] of tasks.entries()) {
    let row: { task: string; status: string; error?: string; library_entries_before?: JsonObject };
    try {
      library.retain(tasks.slice(0, index));
      const before = { agg: library.entries().length };
      const summaryPath = join(workDirOf(runsRoot, task), "summary.json");
      const recorded = existsSync(summaryPath) ? capturedJsonParse(readFileSync(summaryPath, "utf8")) : null;
      const done = isRecord(recorded) && recorded.status === "ok";
      const { status, errors } = done
        ? { status: "skipped", errors: [] }
        : await runTask(bench, task, runsRoot, library);
      const settled = status === "ok" || status === "skipped";
      row = {
        task,
        status,
        ...keysIf(!settled, () => ({ error: errors.join("; ") || status })),
        library_entries_before: before,
      };
    } catch (error) {
      row = { task, status: "exception", error: described(error) };
    }
    rows.push(row);
    const tail = row.error === undefined ? "" : `  :: ${row.error}`;
    console.log(`  [${domain}] ${index + 1}/${tasks.length} ${row.status.padEnd(12)} ${task}${tail}`);
  }
  const done = rows.filter((row) => row.status === "ok" || row.status === "skipped").length;
  return { domain, n_tasks: tasks.length, seed: null, done, failed: rows.length - done, tasks: rows };
}
