/**
 * The evidence tree an improver session reads, and the only way evidence reaches it
 * (`harness2/core/context.py`, Apache-2.0, Google LLC, at 1cfe254). Evidence is served as files
 * and the mission is a short pointer to them, so nothing is cut to fit a prompt; two tripwires
 * refuse a tree that holds an answer-key path or a grader's verdict before any session sees it.
 *
 * Only what JobBench on Claude Code reaches is here: deliverables are served as contents (never the
 * names-only mode), JobBench declares no raw assets, and the leak globs are JobBench's own.
 */
import { errorMessage } from "#src/meta/runtime-values.ts";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { fnmatch, pyLen, pyRepr, pySlice, pyStrip, splitLines, unifiedDiff, walkFiles } from "./py.ts";
import { readTree, type Tree } from "./tree.ts";

/** One rollout as the recursion sees it (`RunView`). */
export interface RunView {
  readonly label: string;
  readonly runId: string;
  readonly runDir: string;
  readonly ok: boolean;
  readonly delivered: boolean;
  readonly error: string;
}

/** What the benchmark supplies to an evidence tree: JobBench's adapter methods. */
export interface Evidence {
  taskPrompt(task: string): string;
  taskFiles(task: string): string | null;
  trajectory(runDir: string): string;
  files(runDir: string): ReadonlyMap<string, string>;
  images(runDir: string): readonly string[];
  text(runDir: string): string;
}

/** A pool candidate: its label, its harness directory and its rollout. */
export type Candidate = readonly [label: string, harnessDir: string, rollout: RunView | null];

/** What landed in a built tree, so the mission names only that (`ContextTree`). */
export interface Built {
  readonly root: string;
  readonly layout: string;
}

const LEAK_GLOBS = ["RUBRICS.json", "eval_result/**", "expected/**", "reference/**"];
const VERDICT_MARKERS = [
  "deterministic_eval_summary",
  "deterministic_eval_result",
  "judge_scope_and_deterministic_status",
  "Judge findings on the rendered result",
  '"passed_count"',
  '"pass_rate"',
  '"test_pass_rate"',
];
const SCANNED = new Set(
  ".md .txt .json .csv .tsv .yaml .yml .html .htm .log .py .js .sh .xml .ini .toml .patch .diff"
    .split(" ")
    .concat(""),
);
const NO_EVENTS_RENDERED =
  "no trajectory could be rendered for ANY rollout -- the proposer would be adapting on nothing: ";

const INDEX_TAIL =
  "\n\nEach `.txt` is the artifact converted to text by the SAME reader the work\nis assessed through, so reason about correctness from these -- an artifact\nthat does not survive that conversion is treated as unreadable however good\nit looks. `images/` holds any images from the same set, which are also part\nof how the work is read.\n";

const READ_FIRST = [
  "Every trajectory EVENT is present: the trajectory was not clipped to fit this mission. An individual observation may contain an explicit renderer-truncation marker; that marker is ours, not behavior by the solver. Do not diagnose it as a solver failure.",
  "",
  "Read `task.md` and the current harness first. Inventory every available rollout or candidate and inspect each at least once before deciding. For a candidate, compare what changed from its editing baseline, what behavior changed in its rollout, what improved, and what regressed or remained unresolved. Then deep-read the evidence relevant to any edit. Cite the specific trajectory moment behind every change; one you cannot trace to a moment is speculation.",
];

/** `type(exc).__name__: exc`, with an error's own name standing in for Python's class name. */
export function described(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : `Error: ${String(error)}`;
}

/** `PurePath.suffix`: the last dot of the last component, unless it leads or ends the name. */
function suffix(rel: string): string {
  const name = basename(rel);
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot) : "";
}

function leaks(rel: string): boolean {
  return LEAK_GLOBS.some((glob) => {
    const pattern = glob.replace(/^[./]+/u, "");
    return fnmatch(rel, pattern) || fnmatch(rel, `*/${pattern}`);
  });
}

/** `assert_no_leak_paths`: refuse a tree holding a benchmark-declared answer-key path. */
export function noLeakPaths(root: string): void {
  const hits = walkFiles(root).filter((rel) => leaks(rel));
  if (hits.length > 0) {
    throw new Error(
      `answer-key path(s) would enter model context: ${hits.toSorted().slice(0, 8).join(", ")}`,
    );
  }
}

/** The marker's offset and Python's repr of the 180 code points around it. */
function around(body: string, marker: string): [number, string] {
  const where = pyLen(body.slice(0, body.indexOf(marker)));
  return [where, pyRepr(pySlice(body, Math.max(0, where - 60), where + 120))];
}

/** `assert_no_grader_verdicts`: refuse a tree holding the grader's output, by name or content. */
export function noGraderVerdicts(root: string): void {
  const tail =
    "The tripwire in core.context fired -- this is a leak, not a false positive to widen around. Find the read path that produced it.";
  for (const rel of walkFiles(root)) {
    const named = VERDICT_MARKERS.find((marker) => rel.includes(marker));
    if (named !== undefined) {
      throw new Error(
        `grader verdict would enter model context: ${pyRepr(rel)} matched marker ${pyRepr(named)} in its NAME. ${tail}`,
      );
    }
    if (!SCANNED.has(suffix(rel).toLowerCase())) continue;
    const body = readFileSync(join(root, rel), "utf8");
    const found = VERDICT_MARKERS.find((marker) => body.includes(marker));
    if (found === undefined) continue;
    const [where, shown] = around(body, found);
    throw new Error(
      `grader verdict would enter model context: ${pyRepr(rel)} contains marker ${pyRepr(found)} at offset ${where} (${shown}). ${tail}`,
    );
  }
}

/** `assert_tree_has_no_grader_verdicts`: the same tripwire on a harness before it is rolled or kept. */
export function treeHasNoGraderVerdicts(tree: ReadonlyMap<string, string>): void {
  const tail = "files carrying these strings cannot be served as evidence to later tasks";
  for (const rel of [...tree.keys()].toSorted()) {
    const named = VERDICT_MARKERS.find((marker) => rel.includes(marker));
    if (named !== undefined) {
      throw new Error(
        `harness file ${pyRepr(rel)} has grader-verdict marker ${pyRepr(named)} in its NAME; rename it -- ${tail}`,
      );
    }
    const body = tree.get(rel) ?? "";
    const found = SCANNED.has(suffix(rel).toLowerCase())
      ? VERDICT_MARKERS.find((marker) => body.includes(marker))
      : undefined;
    if (found === undefined) continue;
    const [where, shown] = around(body, found);
    throw new Error(
      `harness file ${pyRepr(rel)} contains grader-verdict marker ${pyRepr(found)} at offset ${where} (${shown}); remove or rename that string -- ${tail.replace("these strings", "it")}`,
    );
  }
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function copyFiles(src: string, dst: string, files: readonly string[]): number {
  for (const rel of files) {
    mkdirSync(dirname(join(dst, rel)), { recursive: true });
    copyFileSync(join(src, rel), join(dst, rel));
  }
  return files.length;
}

/** `_copy_tree`: a component tree without byte-compiled files; the count copied. */
function copyTree(src: string, dst: string): number {
  return copyFiles(
    src,
    dst,
    walkFiles(src, ["__pycache__"]).filter((rel) => suffix(rel) !== ".pyc"),
  );
}

/** `copy_source`: the task's source material under `source/`, answer-key paths left out. */
function copySource(src: string | null, root: string): number {
  if (src === null || !existsSync(src)) return 0;
  const copied = copyFiles(
    src,
    join(root, "source"),
    walkFiles(src, ["__pycache__"]).filter((rel) => !leaks(rel)),
  );
  if (copied > 0) noLeakPaths(join(root, "source"));
  return copied;
}

/** `_write_rollout`: one rollout's trajectory and deliverables; "" or the failure. */
function writeRollout(dest: string, run: RunView, evidence: Evidence): string {
  let failure = "";
  try {
    write(join(dest, "rollouts", `${run.label}.md`), evidence.trajectory(run.runDir));
  } catch (error) {
    write(join(dest, "rollouts", `${run.label}.md`), `(trajectory unavailable: ${described(error)})`);
    failure = `${run.label}: ${described(error)}`;
  }
  const perFile = evidence.files(run.runDir);
  if (perFile.size === 0) {
    let text: string;
    try {
      text = evidence.text(run.runDir) || "(no deliverable produced)";
    } catch (error) {
      text = `(deliverable unavailable: ${described(error)})`;
    }
    write(join(dest, "deliverables", `${run.label}.md`), text);
    return failure;
  }
  const dir = join(dest, "deliverables", run.label);
  for (const image of evidence.images(run.runDir).slice(0, 8)) {
    try {
      mkdirSync(join(dir, "images"), { recursive: true });
      copyFileSync(image, join(dir, "images", basename(image)));
    } catch {
      // `shutil.copy2` raising OSError is skipped in Python too: an image is optional evidence.
    }
  }
  for (const [name, body] of perFile) {
    const safe = name.replaceAll("/", "__") || "unnamed";
    write(join(dir, `${safe}${safe.endsWith(".txt") ? "" : ".txt"}`), body);
  }
  const lines = [...perFile].map(
    ([name, body]) =>
      `- \`${name}\`  (${String(pyLen(body)).replaceAll(/\B(?=(\d{3})+(?!\d))/gu, ",")} chars extracted)`,
  );
  write(
    join(dir, "INDEX.md"),
    `# ${run.label} produced ${perFile.size} file(s)\n\n${lines.join("\n")}${INDEX_TAIL}`,
  );
  return failure;
}

/** `_write_pool`: each candidate's harness, its diff from the tree being edited, and its rollout. */
function writePool(dest: string, pool: readonly Candidate[], evidence: Evidence): void {
  for (const [label, harnessDir, roll] of pool) {
    const dir = join(dest, "pool", label);
    mkdirSync(dir, { recursive: true });
    if (existsSync(harnessDir)) {
      noLeakPaths(harnessDir);
      copyTree(harnessDir, join(dir, "harness"));
      const reference: Tree = readTree(join(dest, "harness"));
      const candidate: Tree = readTree(harnessDir);
      const names = [...new Set([...reference.keys(), ...candidate.keys()])].toSorted();
      const diff = names
        .map((name) =>
          unifiedDiff(
            splitLines(reference.get(name) ?? "", "keep"),
            splitLines(candidate.get(name) ?? "", "keep"),
            {
              from: `current/${name}`,
              to: `${label}/${name}`,
            },
          ),
        )
        .join("");
      writeFileSync(join(dir, "harness.diff"), diff);
    }
    if (roll === null) continue;
    try {
      writeFileSync(join(dir, "rollout.md"), evidence.trajectory(roll.runDir));
      writeFileSync(join(dir, "produced.md"), evidence.text(roll.runDir) || "(nothing produced)");
    } catch (error) {
      writeFileSync(join(dir, "rollout.md"), `(unavailable: ${errorMessage(error)})`);
    }
  }
}

/** `ContextTree.layout`: the evidence listing in the mission, naming only what exists. */
function layoutOf(facts: {
  sources: number;
  decisions: number;
  rollouts: readonly string[];
  deliverables: number;
  harness: number;
  pool: number;
  library: boolean;
}): string {
  const lines = ["context/task.md                  the task as the agent received it"];
  if (facts.sources > 0) lines.push("context/source/                 task source materials");
  if (facts.decisions > 0) {
    lines.push("context/decisions/              earlier edits and composition decisions");
  }
  if (facts.rollouts.length > 0) {
    const names = facts.rollouts
      .slice(0, 6)
      .map((label) => `${label}.md`)
      .join(", ");
    const more = facts.rollouts.length > 6 ? ` (+${facts.rollouts.length - 6} more)` : "";
    lines.push(`context/rollouts/               FULL trajectories: ${names}${more}`);
  }
  if (facts.deliverables > 0) {
    lines.push(
      "context/deliverables/<label>/    the files each rollout produced, one per artifact (browse INDEX.md for the set)",
    );
  }
  if (facts.harness > 0) {
    lines.push(`context/harness/                the harness you are editing (${facts.harness} files)`);
  }
  if (facts.pool > 0) {
    lines.push(
      `context/pool/                   ${facts.pool} candidates, each with its harness and its rollout`,
    );
  }
  if (facts.library) {
    lines.push(
      "context/library/                earlier tasks in this area -- browse INDEX.md first, then open what looks relevant",
    );
  }
  return lines.join("\n");
}

/** `build`: write the evidence tree and return what landed in it. */
export function build(
  dest: string,
  evidence: Evidence,
  task: string,
  inputs: {
    rollouts: readonly RunView[];
    harnessDir: string | null;
    libraryDir?: string | null;
    pool?: readonly Candidate[];
    decisions?: ReadonlyMap<string, string>;
  },
): Built {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "task.md"), evidence.taskPrompt(task));
  const sources = copySource(evidence.taskFiles(task), dest);
  const decisions = inputs.decisions ?? new Map<string, string>();
  for (const [label, notes] of decisions) {
    write(join(dest, "decisions", `${label}.md`), notes || "No decision notes returned.");
  }
  const rendered: string[] = [];
  const failed: string[] = [];
  for (const run of inputs.rollouts) {
    const failure = writeRollout(dest, run, evidence);
    if (failure === "") rendered.push(run.label);
    else failed.push(failure);
  }
  let harness = 0;
  if (inputs.harnessDir !== null && existsSync(inputs.harnessDir)) {
    noLeakPaths(inputs.harnessDir);
    harness = copyTree(inputs.harnessDir, join(dest, "harness"));
  }
  const pool = inputs.pool ?? [];
  writePool(dest, pool, evidence);
  const libraryDir = inputs.libraryDir ?? null;
  const library = libraryDir !== null && existsSync(libraryDir) && readdirSync(libraryDir).length > 0;
  if (library) {
    noLeakPaths(libraryDir);
    cpSync(libraryDir, join(dest, "library"), { recursive: true });
  }
  noLeakPaths(dest);
  noGraderVerdicts(dest);
  if (inputs.rollouts.length > 0 && rendered.length === 0) {
    throw new Error(NO_EVENTS_RENDERED + failed.slice(0, 4).join("; "));
  }
  return {
    root: dest,
    layout: layoutOf({
      sources,
      decisions: decisions.size,
      rollouts: rendered,
      deliverables: inputs.rollouts.length,
      harness,
      pool: pool.length,
      library,
    }),
  };
}

/** `mission`: the job, where the evidence is, and the instruction to open it. */
export function mission(built: Built, job: string): string {
  return [
    pyStrip(job),
    "",
    "# YOUR EVIDENCE",
    "",
    "It is on disk, in `context/`. Read it -- do not answer from this message alone.",
    "",
    built.layout,
    "",
    ...READ_FIRST,
  ].join("\n");
}
