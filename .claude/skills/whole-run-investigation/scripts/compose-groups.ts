// Compose one subagent prompt per lane group from the single-lane prompts `build-manifest.ts
// --transport native` writes, for one run or across several. `wri.ts lanes` is the command; this
// module is what it composes with.
//
// `build-manifest.ts --sessions` only groups contiguous catalogue lanes, so thematic groups such as
// 2+34 or 5+33+6 cannot be asked of it. The single-lane prompts under `<lanes>/prompts/lane_NN.md`
// already hold everything a lane needs, and every open one starts with the same shared instructions,
// so a group is one shared prefix plus each lane's own `startsFrom:` line and body.
// `references/lane-groups.json` says which lanes read the same bytes (a binary tree of themes) and
// which lanes always run alone; a plan prunes lanes that have no prompt, gives each alone lane its
// own subagent, and cuts the rest by splitting the largest group into its two children (ties go to
// the left one) until the count is met or every group fits the cap. The Authority paragraph is
// replaced by a report-only one: a native lane's default authority lets it commit repairs in a
// worktree of its own, which a composed prompt withholds so the primary adjudicates first.
//
// Across runs, each group reads its lanes in every named run and writes one report that sorts each
// finding by the runs it recurs in. The cross-run reading hands each lane's per-run reports over as
// leads; the multi-run reading reads the records alone and opens no other reading. The alone lanes
// stay per run, since their evidence boundary or scratch belongs to one run, and a run without a
// snapshot (probe tier) is named with the captures it can answer from.

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isNumber, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { hasText } from "#src/meta/text.ts";
import { openRecordedRun } from "#skills/main/run.ts";
import { ANGLE_COUNT, NATIVE_OUTPUT } from "./catalogue-shape.ts";
import { MULTI_RUN_OUTCOMES, MULTI_RUN_PILES } from "./manifest-reporting.ts";
import { readJsonAs, REVIEW_STATE_FILE, SNAPSHOT_STATUS_FILE } from "./run-overview.ts";

/** A node of the lane-group tree: a lane, or a theme joining two subtrees that read the same bytes. */
type GroupNode = number | { reads: string; split: GroupNode[] };

/** `references/lane-groups.json` as this reader meets it. */
interface LaneGroupsFile {
  schema?: string;
  alone?: Record<string, string>;
  tree?: GroupNode;
}

export interface LaneGroups {
  alone: ReadonlySet<number>;
  tree: GroupNode;
}

/** One planned subagent: its lanes, and what they read in common. */
export interface PlannedGroup {
  lanes: number[];
  reads: string;
}

/** How a plan sizes its groups: a total count of subagents, or a cap on lanes (times runs) each. */
export type GroupSize = { agents: number } | { components: number };

/** The two readings that read one lane group across runs. */
export type AcrossRuns = "cross-run" | "multi-run";

/** One single-lane prompt cut into the parts a group is composed from. */
interface LanePrompt {
  blind: boolean;
  prefix: string[];
  startsFrom: string;
  report: string[];
  body: string[];
}

/** The part of a run's recorded scope a multi-run preamble names. */
interface ScopeReading {
  tier?: string;
  why?: string | null;
  terminal?: { outcome?: string | null; reason?: string | null } | null;
  batteries?: readonly JsonValue[] | null;
  cases?: { verified?: number; unaccepted?: number; nonResult?: number } | null;
}

/** One named run of a multi-run reading. */
export interface RunReading {
  id: string;
  review: string;
  campaign: string;
  commit: string;
  checkout: string;
  scope: ScopeReading;
  lanesDir: string;
  available: Set<number>;
  snapshot: boolean;
  captures: string[];
  reports: Map<number, string[]>;
}

/** One prompt as composed, before it is checked. */
export interface ComposedPrompt {
  name: string;
  text: string;
}

/** One row of `groups.json`: the group's session, its lanes and theme, and the runs it reads. */
interface GroupRow {
  session: string;
  lanes: number[];
  reads: string;
  runs?: readonly string[];
}

/** One composed prompt, ready to write. */
export interface ComposedGroup extends PlannedGroup {
  name: string;
  text: string;
  problems: string[];
}

export const LANE_GROUPS_FILE = join(dirname(import.meta.dir), "references", "lane-groups.json");
/** The full shared instructions open with this heading. A launch that also held an isolated lane
 *  writes the blind file first and these instructions inside each open lane's task, after `# Your
 *  assignment`, so a prefix is cut from this heading to `assignedSession:`, never at the first
 *  `# Your assignment`. A prompt without it is an isolated lane's, whose head is the blind file. */
const FULL_HEAD = "# Whole-run investigation";
const ASSIGNMENT = ["", "---", "", "# Your assignment", ""];
/** The sections that split a lane prompt's shared instructions, by heading: shared-instructions.md
 *  opens with the orientation and the moved variable, whose sections hold its other headings, and
 *  build-manifest writes the rest. Only these split a prefix, so an authored heading never does. */
const SECTION_HEADS = [
  "## Orientation",
  "## Controller facts",
  "## Run overview",
  "## The moved variable",
  "## Assignments in this launch",
  "## Progressive admission",
  "## Snapshot directory",
  "## Transport capabilities",
  "## Commands",
  "## Reporting rules",
];
/** A multi-run assignment replaces the launch's own lane ledger. */
const LAUNCH_ONLY = new Set(["## Assignments in this launch", "## Progressive admission"]);
/** The run table the shared instructions carry; when they do, the preamble names the runs no twice. */
const RUN_TABLE_HEADING = "## Runs under review";
/** What each multi-run pile and outcome means; the labels are `manifest-reporting.ts`'s, which
 *  `validate-reports.ts --groups` reads. */
const PILES = {
  every: "the same mechanism at the same owner shows in every run where the lane's question applies",
  absent:
    "it shows in some runs, and you read the others' records and it is not there; say why for each (domain shape, censored by a stop, never reached)",
  unsaid: "it shows in some runs and the others' records cannot say either way; say what is missing",
} satisfies Record<(typeof MULTI_RUN_PILES)[number], string>;
const OUTCOMES = {
  patch:
    "owner `file:line` at the run's source commit, the general mechanism in one sentence, the test that would fail without it, and the corpus count",
  decision: "for the operator: one owner, the missing evidence, and the decision it changes",
  prediction: "a falsifiable row for the next run: moved variable, claim, direction, falsifier",
  drop: "why: an edge case, one run only with a rival explanation, product content, or already fixed",
} satisfies Record<(typeof MULTI_RUN_OUTCOMES)[number], string>;

const pad = (lane: number): string => String(lane).padStart(2, "0");

export function loadLaneGroups(path = LANE_GROUPS_FILE): LaneGroups {
  const doc = readJsonAs<LaneGroupsFile>(path);
  if (doc.schema !== "wri-lane-groups/v2") throw new Error(`${path}: schema is not wri-lane-groups/v2`);
  const alone = new Set(Object.keys(doc.alone ?? {}).map(Number));
  const { tree } = doc;
  if (tree === undefined) throw new Error(`${path}: no \`tree\``);
  const seen: number[] = [];
  const walk = (node: GroupNode): void => {
    if (isNumber(node)) {
      seen.push(node);
      return;
    }
    if (!isString(node.reads) || !Array.isArray(node.split) || node.split.length !== 2) {
      throw new Error(`${path}: a node needs a \`reads\` string and exactly two children`);
    }
    for (const child of node.split) walk(child);
  };
  walk(tree);
  if (new Set(seen).size !== seen.length) throw new Error(`${path}: a lane appears twice in the tree`);
  const both = seen.filter((lane) => alone.has(lane));
  if (both.length > 0) throw new Error(`${path}: lanes ${both.join(", ")} are both alone and in the tree`);
  const missing = Array.from({ length: ANGLE_COUNT }, (_, at) => at + 1).filter(
    (lane) => !seen.includes(lane) && !alone.has(lane),
  );
  if (missing.length > 0) {
    throw new Error(`${path}: lanes ${missing.join(", ")} are in neither the tree nor \`alone\``);
  }
  return { alone, tree };
}

/** The tree with lanes that have no prompt removed; a node left with one child becomes it. */
function prune(node: GroupNode, available: ReadonlySet<number>): GroupNode | null {
  if (isNumber(node)) return available.has(node) ? node : null;
  const kids = node.split.flatMap((child) => prune(child, available) ?? []);
  if (kids.length === 0) return null;
  return kids.length === 1 ? (kids[0] ?? null) : { reads: node.reads, split: kids };
}

function lanesOf(node: GroupNode): number[] {
  return isNumber(node) ? [node] : node.split.flatMap(lanesOf);
}

/** Subtrees made by repeatedly splitting the one with the most lanes (the leftmost wins a tie),
 *  until there are `groups` of them or none holds more than `size` lanes, or every lane is alone. */
function cut(tree: GroupNode, limit: { groups: number } | { size: number }): GroupNode[] {
  const parts = [tree];
  for (;;) {
    const sizes = parts.map((part) => lanesOf(part).length);
    const biggest = Math.max(...sizes);
    const at = sizes.indexOf(biggest);
    const node = parts[at];
    const met = "groups" in limit ? parts.length >= limit.groups : biggest <= limit.size;
    if (biggest < 2 || met || node === undefined || isNumber(node)) return parts;
    parts.splice(at, 1, ...node.split);
  }
}

/** Each alone lane in its own subagent, the rest cut into `agents` subagents in all, or into groups
 *  of at most `components` lanes. */
export function planGroups(
  groups: LaneGroups,
  available: ReadonlySet<number>,
  size: GroupSize,
): PlannedGroup[] {
  const own = [...groups.alone].filter((lane) => available.has(lane)).sort((a, b) => a - b);
  const rest = prune(groups.tree, available);
  const out = own.map((lane) => ({ lanes: [lane], reads: "runs alone" }));
  if (rest === null) return out;
  let parts: GroupNode[];
  if ("components" in size) parts = cut(rest, { size: Math.max(1, size.components) });
  else {
    const slots = size.agents - own.length;
    if (slots < 1) {
      throw new Error(
        `--agents ${size.agents} leaves no subagent for the grouped lanes: ${own.length} lanes run alone`,
      );
    }
    parts = cut(rest, { groups: slots });
  }
  return [
    ...out,
    ...parts.map((part) => ({ lanes: lanesOf(part), reads: isNumber(part) ? "one lane" : part.reads })),
  ];
}

function authority(writes: string, remoteHost: string | null, leads = false): string {
  const remote =
    remoteHost === null
      ? "- No remote host is available. Evidence that is not mirrored locally is something you could not read; say so under `### Not established`."
      : `- Evidence that is not mirrored locally may be read on \`${remoteHost}\` with read-only \`ssh ${remoteHost}\` commands (ls, cat, sha256sum, find), as the Orientation says, and only when your question needs it. Never write, install or run anything there, and never redirect output to a file there, not even under /private/tmp: one stray \`> file\` in an ssh command is a write.`;
  const others = leads
    ? "- Do not read another group's prompt or report; the earlier reports your assignment names for your own lanes are leads you may read."
    : "- Do not read any other lane's prompt or report.";
  return [
    "Authority (set by the primary reviewer for this review; it replaces any repair authority in the shared instructions above):",
    "- Report only. Do not create a worktree, branch or commit and do not edit any source file; the primary reviewer decides about repairs after adjudicating the reports.",
    `- The one thing you may write is your report: ${writes} Write nothing else anywhere.`,
    '- Write `owner:` only on a finding\'s own owner line. The report validator takes the first word after any `owner:` on any line as a finding owner, so a sentence like "the projection owner: add a ..." is refused.',
    `${others} Work each assigned lane as its own independent investigation; a conclusion from one lane is not evidence in the other.`,
    remote,
    "- Keep each lane's report to about 1,500 words at most.",
    "- When your report files are written, reply with only: for each lane, its number and one line per finding headline, plus anything you could not read or settle.",
  ].join("\n");
}

function singleWrites(outDir: string): string {
  return (
    `one file per assigned lane at ${outDir}/lane_NN.md (NN = two-digit lane number), in exactly the shape required above ` +
    "(a `## lane_NN` heading, then `### Started from`, `### Evidence read`, `### Findings`, `### Not established`, each once " +
    "and in that order, every finding carrying an `owner:` line, and each finding's observation and its inferred cause as " +
    "separate sentences)."
  );
}

/** The lanes that have a single-lane prompt under `prompts`. */
export function availableLanes(prompts: string): Set<number> {
  if (!existsSync(prompts)) return new Set();
  const names = [...new Bun.Glob("lane_*.md").scanSync({ cwd: prompts, dot: true })];
  return new Set(names.flatMap((name) => /^lane_(\d+)\.md$/.exec(name)?.[1] ?? []).map(Number));
}

function parsePrompt(lanesDir: string, lane: number): LanePrompt {
  const path = join(lanesDir, "prompts", `lane_${pad(lane)}.md`);
  if (!existsSync(path)) throw new Error(`lane ${lane}: no prompt at ${path}`);
  const lines = readFileSync(path, "utf8").split("\n");
  const find = (test: (line: string) => boolean, start: number, what: string): number => {
    const at = lines.findIndex((line, index) => index >= start && test(line));
    if (at === -1) throw new Error(`lane ${lane}: ${what} not found in ${path}`);
    return at;
  };
  const full = lines.findIndex((line) => line.startsWith(FULL_HEAD));
  const from = Math.max(full, 0);
  const session = find((line) => line.startsWith("assignedSession:"), from, "`assignedSession:` line");
  const prefix = lines.slice(from, session);
  while (prefix.length > 0 && ASSIGNMENT.includes(prefix.at(-1) ?? "")) prefix.pop();
  const starts = find((line) => line.startsWith("startsFrom:"), session, "`startsFrom:` line");
  const report = find((line) => line.startsWith("Report one clearly separated"), session, "report paragraph");
  const body = find((line) => /^\*\*\d+\. /.test(line), session, "`**N. Title.**` lane body");
  const auth = find((line) => line.startsWith("Authority:"), body, "`Authority:` paragraph");
  return {
    blind: full === -1,
    prefix,
    startsFrom: lines[starts] ?? "",
    report: lines.slice(report, body),
    body: lines.slice(body, auth),
  };
}

export function sessionName(lanes: readonly number[]): string {
  const numbers = lanes.map(pad);
  return lanes.length > 1 ? `lanes_${numbers.join("_")}` : `lane_${numbers[0]}`;
}

/** One group of one run's lanes, from the single-lane prompts under `lanesDir`. */
export function composeLanes(
  lanesDir: string,
  lanes: readonly number[],
  remoteHost: string | null,
): ComposedPrompt & { blind: boolean } {
  const parts = lanes.map((lane) => parsePrompt(lanesDir, lane));
  const [first] = parts;
  if (first === undefined) throw new Error("a group needs at least one lane");
  const name = sessionName(lanes);
  const out = [
    ...first.prefix,
    ...ASSIGNMENT,
    `assignedSession: ${name}`,
    `assignedLanes: ${lanes.map(pad).join(", ")}`,
    ...parts.map((part) => part.startsFrom),
    lanes.length > 1 ? "assignmentKind: grouped semantic review" : "assignmentKind: single semantic review",
    "",
    ...first.report,
    ...parts.flatMap((part) => part.body),
    authority(singleWrites(join(lanesDir, NATIVE_OUTPUT)), remoteHost),
    "",
  ];
  return { name, text: out.join("\n"), blind: first.blind };
}

/** What a composed prompt lost or gained that it must not have. `shared` is the shared instructions
 *  every open prompt carries whole; a prompt that lost them, or carries a stale copy, is refused. */
export function checkComposed(
  text: string,
  lanes: readonly number[],
  { blind = false, shared = null }: { blind?: boolean; shared?: string | null } = {},
): string[] {
  const bad: string[] = [];
  const assignments = text.split("# Your assignment").length - 1;
  if (assignments !== 1) bad.push(`${assignments} assignment headings`);
  if (blind && text.includes("## Run overview")) {
    bad.push("an isolated lane's prompt carries the `## Run overview` it must be blind to");
  }
  if (!blind && !text.includes("## Run overview")) {
    bad.push("no `## Run overview`: the shared instructions did not reach the composed prompt");
  }
  if (!blind && shared !== null && !text.includes(shared)) {
    bad.push("the prompt does not carry shared-instructions.md as it now reads; rebuild the per-run prompts");
  }
  if (!blind && text.includes("# Independent blind review")) {
    bad.push("an open lane's prompt carries the isolated lanes' blind file");
  }
  const authorities = text.match(/^Authority[ (:]/gm)?.length ?? 0;
  if (authorities !== 1) bad.push(`${authorities} Authority paragraphs; a lane body kept its own`);
  for (const lane of lanes) {
    if (!new RegExp(`^\\*\\*${lane}\\. `, "m").test(text)) bad.push(`lane ${lane} body missing`);
  }
  if (text.includes("trace-challenge-packet") && lanes.join() !== "23") {
    bad.push("private trace-challenge packet named outside lane 23");
  }
  return bad;
}

// ---- several runs ---------------------------------------------------------------------------

/** Paths ordered by their components, as a path sort orders them: `lanes/` before `lanes-23/`. */
function byComponents(a: string, b: string): number {
  const left = a.split("/");
  const right = b.split("/");
  for (let at = 0; at < Math.min(left.length, right.length); at += 1) {
    const [x = "", y = ""] = [left[at], right[at]];
    if (x !== y) return x < y ? -1 : 1;
  }
  return left.length - right.length;
}

/** One named run: its identity, its single-lane prompts if it has a snapshot, and the earlier lane
 *  reports under its review, by the lane headings they carry. */
export function readRun(reviewDir: string): RunReading {
  const review = realpathSync(reviewDir);
  const statePath = join(review, REVIEW_STATE_FILE);
  if (!existsSync(statePath)) {
    throw new Error(`${review}: no ${REVIEW_STATE_FILE}; read the run with \`wri.ts start\` first`);
  }
  const state = readJsonAs<{ campaign: string; runId: string; repo: string; scope?: ScopeReading | null }>(
    statePath,
  );
  const lanesDir = join(review, "lanes");
  const reports = new Map<number, string[]>();
  const found = [...new Bun.Glob("lanes*/*-output/*.md").scanSync({ cwd: review, dot: true })];
  for (const path of found.map((rel) => join(review, rel)).sort(byComponents)) {
    for (const match of readFileSync(path, "utf8").matchAll(/^## lane_(\d{2})\s*$/gm)) {
      const lane = Number(match[1]);
      reports.set(lane, [...(reports.get(lane) ?? []), path]);
    }
  }
  return {
    id: state.runId,
    review,
    campaign: state.campaign,
    commit: openRecordedRun(state.campaign, state.runId).source.commit,
    checkout: state.repo,
    scope: state.scope ?? {},
    lanesDir,
    available: availableLanes(join(lanesDir, "prompts")),
    snapshot: existsSync(join(review, "snapshot", SNAPSHOT_STATUS_FILE)),
    captures: [...new Bun.Glob("*.txt").scanSync({ cwd: review, dot: true })].sort(),
    reports,
  };
}

/** The run's shared instructions, from the first of its prompts that is not an isolated lane's. */
function sharedPrefix(run: RunReading): string[] {
  for (const lane of [...run.available].sort((a, b) => a - b)) {
    const parsed = parsePrompt(run.lanesDir, lane);
    if (!parsed.blind) return parsed.prefix;
  }
  throw new Error(
    `${run.review}: no open lane's prompt under ${join(run.lanesDir, "prompts")} carries the shared instructions`,
  );
}

function runLine(run: RunReading): string {
  const { scope } = run;
  const terminal = scope.terminal ?? {};
  const cases = scope.cases ?? {};
  const head = `- \`${run.id}\` (${scope.tier ?? "unknown"} tier, ${run.snapshot ? "snapshot" : "no snapshot"}): campaign \`${run.campaign}\`; review \`${run.review}\`;`;
  const source = ` source \`${run.commit}\`, read in \`${run.checkout}\`;`;
  const outcome = ` terminal \`${terminal.outcome ?? "unknown"}\` (${hasText(terminal.reason) ? terminal.reason : "no reason recorded"});`;
  const counts =
    ` ${scope.batteries?.length ?? 0} batteries; cases ${cases.verified ?? "?"} verified,` +
    ` ${cases.unaccepted ?? "?"} unaccepted, ${cases.nonResult ?? "?"} non-results.`;
  return head + source + outcome + counts;
}

function probeLines(run: RunReading): string[] {
  const captures = run.captures.map((name) => `\`${name}\``).join(", ") || "none";
  return [
    `## Run ${run.id} (no snapshot)`,
    "",
    `This run was read at the ${run.scope.tier ?? "unknown"} tier: ${hasText(run.scope.why) ? run.scope.why : "no reason recorded"}.`,
    `It can answer only from its deterministic captures under \`${run.review}\` (${captures}) and from its own`,
    "campaign records. It cannot answer a question that needs the snapshot's cases, traces, digest or",
    "views, and it has no lane prompt or lane trigger: where a lane's question needs those, put the",
    "finding in `unsaid` for this run and name what is missing.",
  ];
}

/** A run's shared instructions as (heading, lines) in order; the first is its title and identity. */
function sections(prefix: readonly string[]): [string, string[]][] {
  const out: [string, string[]][] = [[prefix[0] ?? "", []]];
  for (const line of prefix.slice(1)) {
    if (SECTION_HEADS.some((head) => line.startsWith(head))) out.push([line, []]);
    else out.at(-1)?.[1].push(line);
  }
  return out;
}

function headingKey(heading: string): string {
  return SECTION_HEADS.find((head) => heading.startsWith(head)) ?? heading;
}

/** The section keys every snapshot run carries byte for byte, such as the shared instructions
 *  written once for the investigation, which the preamble renders once. */
function sharedKeys(split: readonly [string, string[]][][]): Set<string> {
  const byRun = split.map(
    (parts) => new Map(parts.map(([heading, body]) => [headingKey(heading), [heading, ...body].join("\n")])),
  );
  const [first, ...rest] = byRun;
  if (first === undefined || rest.length === 0) return new Set();
  return new Set(
    [...first.keys()].filter(
      (key) => !LAUNCH_ONLY.has(key) && rest.every((other) => other.get(key) === first.get(key)),
    ),
  );
}

export function runsPreamble(
  runs: readonly RunReading[],
  prior: readonly string[],
  reading: AcrossRuns,
): string[] {
  const snapshotRuns = runs.filter((run) => run.snapshot);
  const split = snapshotRuns.map((run) => sections(sharedPrefix(run)));
  const commits = new Set(runs.map((run) => run.commit));
  const tabled = split.some((parts) => parts.some(([, body]) => body.includes(RUN_TABLE_HEADING)));
  const out = [
    `# Multi-run investigation — ${runs.length} runs`,
    "",
    "You are one independent leaf session, with no delegation, coordination or launcher authority.",
    "You read the same lanes in every run named below, and sort what you find by the runs it shows in:",
    "a mechanism that recurs across campaigns is stronger evidence than one run's finding, and a",
    "mechanism absent from a run whose records you read is evidence too. Evidence outranks prose; a",
    "started run is not a completed run; generated output under `campaigns/` or `domains/` is immutable.",
    "",
    ...(tabled ? [] : [RUN_TABLE_HEADING, "", ...runs.map(runLine), ""]),
    commits.size === 1
      ? `Every run was measured at source \`${[...commits][0]}\`: read source in the checkout named for it.`
      : "The runs were measured at different source commits. Read each run's source at its own commit, in the" +
        " checkout named for it; a mechanism at one commit is evidence about another only once you have read the" +
        " same lines there (`git diff <one> <other> -- <owner file>` in a checkout that holds both).",
    "",
  ];
  const shared = sharedKeys(split);
  for (const [heading, body] of split[0] ?? []) {
    if (shared.has(headingKey(heading))) out.push(heading, ...body);
  }
  snapshotRuns.forEach((run, index) => {
    out.push("", `## Run ${run.id}`, "");
    (split[index] ?? []).forEach(([heading, body], at) => {
      const key = headingKey(heading);
      if (shared.has(key) || LAUNCH_ONLY.has(key)) return;
      if (at > 0) {
        out.push(`#${heading}`, ...body);
        return;
      }
      // The title's identity lines, less the session sentence the preamble already says.
      const identity = body.filter((line) => !line.startsWith("You are one independent leaf session"));
      while (identity[0] === "") identity.shift();
      out.push(...identity);
    });
  });
  for (const run of runs) if (!run.snapshot) out.push("", ...probeLines(run));
  out.push("", ...methodLines(runs, prior, reading));
  while (out.at(-1) === "") out.pop();
  return out;
}

/** The first two method steps: how a lane is read across the runs, with or without the per-run
 *  reports as leads. */
function readingSteps(reading: AcrossRuns): string[] {
  const sort = [
    "2. Sort every finding into exactly one pile, after checking the other runs' bytes yourself:",
    ...Object.entries(PILES).map(([name, text]) => `   - \`${name}\`: ${text};`),
  ];
  if (reading === "multi-run") {
    return [
      "1. For each assigned lane, read its question against every named run, straight from its records. The",
      "   assignment says, per run, the trigger it started from there, or why it has none. You are an",
      "   independent reading: do not open the per-run or cross-run lane reports of these runs, or any",
      "   synthesis of them; agreement with them counts only because you reached it alone.",
      ...sort,
      "   a finding you see in one run is examined now in every other run's records, never left unsorted.",
      "   A difference in wording is not a difference in mechanism; a shared file name is not a shared",
      "   mechanism. Name the runs, by id and campaign, the finding shows in and those it was checked absent from.",
    ];
  }
  return [
    "1. For each assigned lane, read its question against every named run. The assignment says, per run,",
    "   the trigger it started from there, or why it has none, and any earlier report of that lane. An",
    "   earlier report is a lead, not a receipt: re-check each consequential claim against the run's",
    "   source and records before carrying it.",
    ...sort,
    "   a finding one run's earlier report made and another run's did not examine is examined now in",
    "   that run's records, never left unsorted. A difference in wording is not a difference in",
    "   mechanism; a shared file name is not a shared mechanism. Name the runs, by id and campaign, the",
    "   finding shows in and those it was checked absent from.",
  ];
}

function methodLines(runs: readonly RunReading[], prior: readonly string[], reading: AcrossRuns): string[] {
  const corpus = [...new Set(runs.map((run) => dirname(run.campaign)))].sort();
  const lines = [
    "## Multi-run method",
    "",
    "These steps extend the reporting rules above; where the two differ for a multi-run report, these win.",
    "",
    ...readingSteps(reading),
    "3. For each `every` finding whose owner is controller source (`src/`, `tools/`, `.claude/skills/`),",
    `   count over the recorded corpus (${corpus.map((root) => `\`${root}\``).join(", ")}) the distinct campaigns and`,
    "   distinct domains where the same mechanism shows, naming the reader you used and one join it did not",
    "   make. Prefer an exported function over a hand regex. If a count would take more than about fifteen",
    "   minutes, give the cheapest bounded count and say what it misses. Builder product content",
    "   (`correctness-model/`, `agent/`, `reference/`) is counted the same way but never patched: its",
    "   owner is the Builder, and a recurring one points at the controller surface that let it through.",
    "4. End every finding with exactly one typed outcome:",
    ...Object.entries(OUTCOMES).map(([name, text]) => `   - \`${name}\`: ${text};`),
    "   only a fix whose shape recurs across campaigns is a `patch`; name a domain-specific one as such.",
    "   Prefer deleting a competing owner, then reusing an existing one, then adding the minimum. A",
    "   prompt sentence is a mitigation, never a guard.",
  ];
  if (prior.length > 0) {
    lines.push(
      `5. Only after your own sort is done, reconcile with the earlier reading in ${prior.map((path) => `\`${path}\``).join(", ")}. For each of`,
      "   its rows your lanes touch, say `confirmed` (your lanes reach the same owner from the bytes),",
      "   `amended` (same link, different owner or scope: say which), `not supported` or `not touched`.",
    );
  }
  lines.push(
    "",
    "Hard rules: resolve every path to its real location before counting, so a symlinked tree is not",
    "counted twice; run no git command inside a campaign workspace (even `git status` writes a lock);",
    "never quote task content, request text, briefs, review or advice prose, trace text, or any domain",
    "text from a campaign record: report counts, ids, digests, paths and line numbers, and describe",
    "mechanisms in your own abstract words.",
    "",
    "## Multi-run report",
    "",
    "Write one report for your whole assignment, headed `# Multi-run: <assignedSession>`, with one",
    "`## lane_NN` section per assigned lane. Under each, write `### Started from` (per run, the trigger",
    "or why there is none), `### Evidence read` (per run, every path), `### Findings` and",
    "`### Not established`, each exactly once and in that order. `### Findings` holds the single word",
    "`none` or one entry per finding, each carrying three lines of its own: `owner: <owner>` from the",
    `owners the reporting rules list, \`pile: <${MULTI_RUN_PILES.join(" | ")}>\` and \`outcome: <${MULTI_RUN_OUTCOMES.join(" | ")}>\`.`,
  );
  if (prior.length > 0) {
    lines.push(
      "After the lane sections, write `## Prior reconciliation` with one verdict per row your lanes touch.",
    );
  }
  return lines;
}

/** Where one lane starts in one run, for a group read across runs. */
function laneInRun(run: RunReading, lane: number, reading: AcrossRuns): string {
  let where: string;
  if (run.available.has(lane)) {
    const startsFrom = parsePrompt(run.lanesDir, lane).startsFrom.split(":");
    where = (startsFrom.length >= 3 ? startsFrom.slice(2).join(":") : (startsFrom.at(-1) ?? ""))
      .trim()
      .replace(/\.+$/, "");
  } else if (run.snapshot) {
    where =
      "no prompt in this run (its trigger did not fire or it was not selected); read the question against its records anyway, and say if it does not apply";
  } else where = "no snapshot; answer from its captures where they can, else `unsaid`";
  const leads = reading === "cross-run" ? (run.reports.get(lane) ?? []) : [];
  const lead = leads.length > 0 ? ` Earlier report: ${leads.map((path) => `\`${path}\``).join(", ")}.` : "";
  return `- \`${run.id}\`: ${where}.${lead}`;
}

export function composeRuns(
  runs: readonly RunReading[],
  lanes: readonly number[],
  {
    outDir,
    preamble,
    remoteHost,
    reading,
  }: { outDir: string; preamble: readonly string[]; remoteHost: string | null; reading: AcrossRuns },
): ComposedPrompt {
  const name = sessionName(lanes);
  const out = [
    ...preamble,
    ...ASSIGNMENT,
    `assignedSession: ${name}`,
    `assignedLanes: ${lanes.map(pad).join(", ")}`,
    `assignedRuns: ${runs.map((run) => run.id).join(", ")}`,
    "assignmentKind: multi-run semantic review",
    "",
  ];
  for (const lane of lanes) {
    const first = runs.find((run) => run.available.has(lane));
    if (first === undefined) throw new Error(`lane ${lane}: no run holds its prompt`);
    out.push(
      ...parsePrompt(first.lanesDir, lane).body,
      `Lane ${pad(lane)} in each run:`,
      ...runs.map((run) => laneInRun(run, lane, reading)),
      "",
    );
  }
  const writes = `one file at ${join(outDir, NATIVE_OUTPUT, `${name}.md`)}, in exactly the shape the multi-run report section asks.`;
  out.push(authority(writes, remoteHost, reading === "cross-run"), "");
  return { name, text: out.join("\n") };
}

/** Write the plan as `groups.json` beside the composed prompts, one `<name>.md` each. */
export function writeGroups(
  outDir: string,
  composed: readonly ComposedGroup[],
  runs: readonly string[] = [],
): void {
  mkdirSync(outDir, { recursive: true });
  const rows = composed.map(({ name, lanes, reads }) => {
    const row: GroupRow = { session: name, lanes, reads };
    if (runs.length > 0) row.runs = runs;
    return row;
  });
  writeFileSync(join(outDir, "groups.json"), `${capturedJsonStringify(rows, null, 1)}\n`);
  for (const group of composed) writeFileSync(join(outDir, `${group.name}.md`), group.text);
}
