#!/usr/bin/env bun
/**
 * Every harness a campaign keeps, with what its log holds of each, and what moved between one and
 * its parent, part by part. It reads: it writes nothing of the campaign's, starts no solve and calls
 * no model.
 *
 *   bun .claude/skills/harness-audit/scripts/harness-versions.ts <log | campaign folder | name> [--blind] [--json]
 *   bun .claude/skills/harness-audit/scripts/harness-versions.ts <log | campaign folder | name> --diff <harness> [--against <harness>]
 *
 * A harness is named as a campaign's commands name one (`keptAs`, `tools/d2/campaign.ts`): `starter`,
 * `promoted`, `latest`, a whole digest or its unambiguous letter. The states sit beside the log,
 * under `states/`.
 *
 * v1's final-harness-audit joined each workspace commit to its iteration, its scored set and its claim
 * through four scripts of 1,246 lines. v2 writes those joins as events, `harness.version`,
 * `harness.imported`, `harness.promoted` and the comparisons' own, and `campaignOf`
 * (`src/campaign/handover.ts`) folds them. This lists the states, opens each as a solve would
 * (`openHarness`), counts its parts, and leaves the joining to the fold. Whole-run-investigation's
 * lane 15 diffs a parent and a child part by part; `--diff` is that count, and quotes a line only under `--lines`.
 *
 * The list reads only the folders of `states/` named by a digest, and the counts leave out the
 * bytecode caches the digest leaves out (`BYTECODE`). On 28 October, in buffer-fresh-gpt-v071, the
 * list showed each shared `tree-*` folder as a harness that does not open, with all 6,158 files of
 * one tree on a single line, and `--diff` counted 405 changed files where the digest saw one: the
 * other 404 were caches.
 *
 * `--blind` takes from each version how it was measured (`blinded`: every comparison, session,
 * promotion and role but the starter's) and prints its diff against a kept parent in their place.
 * Lane 27 grades soundness from it before it reads a result; on 30 October its first session (then
 * lane 34) read the list's comparisons first.
 *
 * `--files` adds a line for each written file that moved (the guide, the spec, `tools.ts` and the
 * programs the harness wrote, `writtenIn` in `tools/wri/trajectory.ts`), and `--lines` prints the
 * moved lines themselves; `--chain` reads every kept version against its kept parent at either depth,
 * blind as `--blind` is. Between 3 and 10 November about 29 of 35 sessions of lanes 12 and 27 rebuilt
 * these by hand, and 13 of their 21 refusals were a diff loop given a campaign's `states/` path,
 * which a lane guard refuses and this command, taking the log, does not need. A digest prefix of eight
 * characters names a version where it names one; lane 16 sessions typed the prefixes the readers print.
 *
 * `--diff` reads a kept state where it sits, as `--chain` does, and says in a line where one opens
 * as another harness. A copy of a campaign from another host leaves out what its harness installed
 * (`installs`, `tools/runs/snapshots.ts`), so there a state opens as another digest: on 12 November
 * every diff of such a copy's four states was refused (`keptAs`, which guards a solve), and a lane
 * read "not as kept" as a lost harness.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { type Handover, campaignOf } from "#src/campaign/handover.ts";
import { short } from "#src/campaign/move.ts";
import { DIGEST, namesOf } from "#src/campaign/names.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import {
  AGENT_DIR,
  BYTECODE,
  GENERATED_TOOLS_FILE,
  GUIDE_FILE,
  TOOLS_SPEC_FILE,
} from "#src/meta/bundle-layout.ts";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { tmpdir } from "#src/meta/os.ts";
import { dirname, join } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { openHarness, pathsUnder, treeContent } from "#src/harness/open.ts";
import { writeStarter } from "#src/harness/starter.ts";
import { keptAs } from "#tools/d2/campaign.ts";
import { logAcross } from "#tools/runs/snapshots.ts";
import { diffOf as lineDiff, madeOf, writtenIn } from "#tools/wri/trajectory.ts";

const USAGE = `usage:
  bun .claude/skills/harness-audit/scripts/harness-versions.ts <log | campaign folder | name> [--blind] [--json]
  bun .claude/skills/harness-audit/scripts/harness-versions.ts <log | campaign folder | name> --diff <harness> [--against <harness>] [--files | --lines]
  bun .claude/skills/harness-audit/scripts/harness-versions.ts <log | campaign folder | name> --chain [--lines]

<harness> is starter, promoted, latest, a whole digest, a prefix of 8 or more of its characters, or its
unambiguous letter. --against defaults to the parent the log records. --files adds a line a written file
that moved; --lines prints the moved lines themselves. --chain reads every kept version against its kept
parent, file by file, and prints no comparison, reading or promotion.`;

const OPTIONS = {
  json: "flag",
  blind: "flag",
  diff: "text",
  against: "text",
  files: "flag",
  lines: "flag",
  chain: "flag",
} as const;
/** The shortest digest prefix taken for a whole one: the eight characters every reader prints. */
const PREFIX = /^[0-9a-f]{8,63}$/;
const TOOL_TREE = ".toolchain";
const GUIDE = `${AGENT_DIR}${GUIDE_FILE}`;
const PARTS: ReadonlySet<string> = new Set([GUIDE, TOOLS_SPEC_FILE, GENERATED_TOOLS_FILE]);

/** How far a comparison of two versions goes: the counts, a line a written file, or the lines. */
type Depth = "counts" | "files" | "lines";

interface Parts {
  /** Nonblank lines of the guide, null where the state holds none of its own. */
  readonly guide: number | null;
  readonly presets: readonly string[];
  readonly tools: readonly string[];
  /** Nonblank lines of `agent/tools.ts`. */
  readonly module: number;
  readonly toolTree: { readonly files: number; readonly bytes: number; readonly linked: boolean } | null;
  /** Files outside the four parts; `agent/config.yaml` is ignored, others may be module imports. */
  readonly other: readonly string[];
}

export interface Version {
  readonly digest: string;
  readonly kept: boolean;
  /** `as kept`, the digest it opens as instead, or why it does not open; null where not kept, and
   *  where the caller asked for no list (`versionsOf`). */
  readonly opens: string | null;
  readonly made: string;
  readonly parent: string | null;
  /** The Builder turns that made it, as a `slice.ts` selector (`b-1{14-22}`), or null where no
   *  session's turns precede its making. */
  readonly turns: string | null;
  /** The names a campaign's commands give it: `starter`, `reference` (which `promoted` names) and
   *  `latest`, each of which names the starter while nothing else holds it. */
  readonly roles: readonly string[];
  readonly promoted: readonly string[];
  readonly sessions: readonly string[];
  readonly compared: readonly string[];
  /** Null where `opens` is. */
  readonly parts: Parts | null;
}

interface Keeping {
  readonly log: string;
  readonly states: string;
}

const lines = (text: string | null): string[] =>
  text === null ? [] : text.split("\n").filter((line) => line.trim() !== "");

/** A part's text, where the state holds it as a file of its own. */
async function own(dir: string, part: string): Promise<string | null> {
  const file = join(dir, part);
  return existsSync(file) && lstatSync(file).isFile() ? await Bun.file(file).text() : null;
}

/** The Starter Built Harness's digest as this checkout writes it, written outside the campaign. */
async function starterDigest(): Promise<string> {
  const scratch = mkdtempSync(join(tmpdir(), "ana-harness-audit-"));
  try {
    writeStarter(scratch);
    return (await openHarness(scratch)).digest;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function partsOf(dir: string): Promise<Parts> {
  const spec = asRecord(capturedJsonParse((await own(dir, TOOLS_SPEC_FILE)) ?? "null"));
  const tree = join(dir, TOOL_TREE);
  const real = existsSync(tree) ? realpathSync(tree) : null;
  const files =
    real === null
      ? []
      : pathsUnder(real).filter((path) => !BYTECODE.test(path) && lstatSync(join(real, path)).isFile());
  const guide = await own(dir, GUIDE);
  const rows = Array.isArray(spec?.tools) ? spec.tools : [];
  return {
    guide: guide === null ? null : lines(guide).length,
    presets: Array.isArray(spec?.presets) ? spec.presets.filter(isString) : [],
    tools: rows.flatMap((row) => {
      const name = asRecord(row)?.name;
      return isString(name) ? [name] : [];
    }),
    module: lines(await own(dir, GENERATED_TOOLS_FILE)).length,
    toolTree:
      real === null
        ? null
        : {
            files: files.length,
            bytes: files.reduce((sum, path) => sum + lstatSync(join(real, path)).size, 0),
            linked: lstatSync(tree).isSymbolicLink(),
          },
    other: pathsUnder(dir).filter(
      (path) =>
        !PARTS.has(path) &&
        path !== TOOL_TREE &&
        !path.startsWith(`${TOOL_TREE}/`) &&
        !lstatSync(join(dir, path)).isDirectory(),
    ),
  };
}

/** An open session has handed nothing over yet, so its handover carries its last checkpoint and reads
 *  "so far": until 1 November an open led session that had made three read "left it as it was". */
function measured(steps: readonly Handover[], digest: string) {
  return {
    sessions: steps.flatMap((step) => {
      if (step.step !== "builder" || step.parent !== digest) return [];
      const left =
        step.changed && step.harness !== null
          ? `left ${short(step.harness)}${step.ended === null ? " so far" : ""}`
          : "left it as it was";
      const end = step.ended === null && step.cut ? ", cut" : step.ended === null ? ", open" : "";
      return [
        `${step.id}: ${step.practiceSolves} practice solves, ${step.fails} counted fails, ${left}${end}`,
      ];
    }),
    compared: steps.flatMap((step) => {
      if (step.step !== "comparison" || (step.old !== digest && step.fresh !== digest)) return [];
      const fresh = step.fresh === digest;
      const tally =
        step.tally === null
          ? ""
          : ` (${step.tally.wins} won, ${step.tally.losses} lost, ${step.tally.ties} tied)`;
      return [
        `${step.id} as the ${fresh ? "new harness" : "reference"} against ${short(fresh ? step.old : step.fresh)}: ${
          step.reading ?? (step.cut ? "cut before its report" : "no report yet")
        }${tally}`,
      ];
    }),
  };
}

/** The Builder turns between a version's making and the session's previous making (or its start), as
 *  a `slice.ts` selector: a checkpoint carries no turn, so on 10 November lane 12 sessions found the
 *  Builder's words for one delta by reading the session whole. Null where the log holds no such turn. */
function turnsOf(events: readonly LogEvent[], digest: string): string | null {
  const at = events.findIndex(
    ({ kind, data }) =>
      (kind === "build.checkpoint" && data.harness === digest) ||
      (kind === "harness.version" && data.version === digest),
  );
  const session = events[at]?.data.session;
  if (!isString(session)) return null;
  const from = events
    .slice(0, at)
    .findLastIndex(
      ({ kind, data }) =>
        data.session === session && (kind === "build.checkpoint" || kind === "build.started"),
    );
  const turns = events
    .slice(from + 1, at)
    .flatMap(({ kind, data }) =>
      kind === "build.turn" && data.session === session && isNumber(data.turn) ? [data.turn] : [],
    );
  if (turns.length === 0) return null;
  return `${session}{${String(Math.min(...turns))}-${String(Math.max(...turns))}}`;
}

/** How a kept state opens, as a solve would read it (`openHarness`). */
const opensAs = async (dir: string, digest: string): Promise<string> =>
  await openHarness(dir).then(
    (harness) => (harness.digest === digest ? "as kept" : `as ${short(harness.digest)}, not as kept`),
    (error: unknown) => `refused: ${errorMessage(error)}`,
  );

/** Every harness the log names or the states folder keeps: in the order the log first names them,
 *  the starter first, then any state the log never names. Only the list reads how a state opens and
 *  what its parts hold, and opening one digests its whole tree (25 s of every call on 34 states of
 *  3.4 GB, 10 November), so a diff or a chain asks for the versions `named` and reads neither. */
export async function versionsOf(
  keeping: Keeping,
  detail: "opened" | "named" = "opened",
): Promise<Version[]> {
  const whole = detail === "opened";
  const events = read(keeping.log);
  const { steps, reference, latest } = campaignOf(events);
  const starter = await starterDigest();
  // `states/` also holds the tool trees the states link to (`tree-*`) and a control's scratch.
  const states = existsSync(keeping.states)
    ? readdirSync(keeping.states)
        .filter((each) => DIGEST.test(each))
        .toSorted()
    : [];
  const named = namesOf(events).keys();
  const digests = [...new Set([...(states.includes(starter) ? [starter] : []), ...named, ...states])];
  return await Promise.all(
    digests.map(async (digest): Promise<Version> => {
      const dir = join(keeping.states, digest);
      const kept = states.includes(digest);
      const opens = kept && whole ? await opensAs(dir, digest) : null;
      return {
        digest,
        kept,
        opens,
        ...madeOf(events, digest, starter),
        turns: turnsOf(events, digest),
        roles: [
          ...(digest === starter ? ["starter"] : []),
          ...(digest === (reference ?? starter) ? ["reference"] : []),
          ...(digest === (latest ?? starter) ? ["latest"] : []),
        ],
        promoted: events.flatMap(({ at, kind, data }) =>
          kind === "harness.promoted" && data.harness === digest ? [at] : [],
        ),
        ...measured(steps, digest),
        parts: kept && whole ? await partsOf(dir) : null,
      };
    }),
  );
}

/** Lines a file gained and lost, counted as a multiset of nonblank lines. */
function lineMoves(before: string | null, after: string | null) {
  const counts = new Map<string, number>();
  for (const line of lines(before)) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of lines(after)) {
    const left = counts.get(line) ?? 0;
    if (left > 0) counts.set(line, left - 1);
    else added += 1;
  }
  return { added, removed: [...counts.values()].reduce((sum, left) => sum + left, 0) };
}

function churn(before: string | null, after: string | null): string {
  const { added, removed } = lineMoves(before, after);
  return `${lines(before).length} to ${lines(after).length} nonblank lines, +${added} -${removed}`;
}

/** Entries of a tree by path, each a file's sha256 or a link's target with its mode. */
function entries(dir: string, only: (path: string) => boolean): Map<string, string> {
  if (!existsSync(dir)) return new Map();
  return new Map(
    treeContent(realpathSync(dir)).flatMap(({ path, mode, content }) =>
      content === null || BYTECODE.test(path) || !only(path) ? [] : [[path, `${mode}:${content}`]],
    ),
  );
}

function moved(before: Map<string, string>, after: Map<string, string>) {
  const added = [...after.keys()].filter((path) => !before.has(path));
  const removed = [...before.keys()].filter((path) => !after.has(path));
  const changed = [...after].flatMap(([path, content]) =>
    before.has(path) && before.get(path) !== content ? [path] : [],
  );
  return { added, removed, changed };
}

/** What a harness wrote, by the path a reader names it: the guide, the spec, `tools.ts` and its own
 *  programs (`writtenIn`, which leaves out what it installed), never a bytecode cache. */
function authored(state: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [path, file] of writtenIn(state)) {
    if (path === "guide") found.set(GUIDE, file);
    else if (!BYTECODE.test(path)) found.set(`${TOOL_TREE}/${path}`, file);
  }
  for (const part of [TOOLS_SPEC_FILE, GENERATED_TOOLS_FILE]) {
    const file = join(state, part);
    if (existsSync(file) && lstatSync(file).isFile()) found.set(part, file);
  }
  return new Map([...found].toSorted(([one], [other]) => one.localeCompare(other)));
}

/** A line for each written file that moved from `parent` to `child`: added, removed or changed, with
 *  the nonblank lines it gained and lost. A file of the same bytes is left out. */
async function filesMoved(parent: string, child: string): Promise<string[]> {
  const [old, fresh] = [authored(parent), authored(child)];
  const rows = await Promise.all(
    [...new Set([...old.keys(), ...fresh.keys()])].toSorted().map(async (path) => {
      const [before, after] = await Promise.all(
        [old.get(path), fresh.get(path)].map(async (file) =>
          file === undefined ? null : await Bun.file(file).text(),
        ),
      );
      if (before === after) return [];
      const { added, removed } = lineMoves(before ?? null, after ?? null);
      const how = before === null ? "added" : after === null ? "removed" : "changed";
      return [`${path}  ${how}  +${added} -${removed}`];
    }),
  );
  const shown = rows.flat();
  return shown.length === 0 ? ["no written file moved"] : shown;
}

/** What moved from `parent` to `child`, part by part, by kind and size. */
async function diffOf(parent: string, child: string): Promise<string[]> {
  const [old, fresh] = await Promise.all([partsOf(parent), partsOf(child)]);
  const tree = moved(
    entries(join(parent, TOOL_TREE), () => true),
    entries(join(child, TOOL_TREE), () => true),
  );
  const roots = [
    ...new Set([...tree.added, ...tree.removed, ...tree.changed].map((path) => path.split("/")[0])),
  ];
  const outside = (path: string) =>
    !PARTS.has(path) && path !== TOOL_TREE && !path.startsWith(`${TOOL_TREE}/`);
  const other = moved(entries(parent, outside), entries(child, outside));
  const named = (list: readonly string[]) => (list.length === 0 ? "none" : list.join(", "));
  const gone = (list: readonly string[], from: readonly string[]) =>
    list.filter((each) => !from.includes(each));
  return [
    `guide: ${churn(await own(parent, GUIDE), await own(child, GUIDE))}`,
    `spec: presets ${named(old.presets)} to ${named(fresh.presets)}; tools added ${named(gone(fresh.tools, old.tools))}, removed ${named(gone(old.tools, fresh.tools))}`,
    `tools.ts: ${churn(await own(parent, GENERATED_TOOLS_FILE), await own(child, GENERATED_TOOLS_FILE))}`,
    `${TOOL_TREE}: ${old.toolTree?.files ?? 0} to ${fresh.toolTree?.files ?? 0} files, +${tree.added.length} -${tree.removed.length} changed ${tree.changed.length}${roots.length === 0 ? "" : `, under ${roots.join(", ")}`}`,
    `other files: added ${named(other.added)}; removed ${named(other.removed)}; changed ${named(other.changed)}`,
  ];
}

/** What moved at the depth asked: the counts, then a line a written file or the moved lines. */
async function movesAt(parent: string, child: string, depth: Depth): Promise<string[]> {
  if (depth === "lines") return lineDiff(parent, child, authored);
  const counts = await diffOf(parent, child);
  return depth === "files"
    ? [...counts, "written files that moved:", ...(await filesMoved(parent, child))]
    : counts;
}

function printed(version: Version): string[] {
  const parts = version.parts;
  const tree = parts?.toolTree;
  return [
    `${version.digest}  ${version.kept ? `kept, opens ${String(version.opens)}` : "not kept under states/"}${version.roles.map((role) => `  [${role}]`).join("")}`,
    `  made: ${version.made}`,
    ...(version.turns === null
      ? []
      : [`  made in Builder turns ${version.turns} (slice.ts Builder:${version.turns})`]),
    ...(parts === null
      ? []
      : [
          `  parts: guide ${parts.guide === null ? "none" : `${parts.guide} lines`}; presets ${parts.presets.join(", ") || "none"}; ${parts.tools.length} tools of its own; tools.ts ${parts.module} lines; ${TOOL_TREE} ${tree ? `${tree.files} files, ${Math.round(tree.bytes / 1024)} KiB${tree.linked ? ", a link" : ""}` : "none"}${parts.other.length === 0 ? "" : `; other ${parts.other.join(", ")}`}`,
        ]),
    ...version.sessions.map((line) => `  session ${line}`),
    ...version.compared.map((line) => `  comparison ${line}`),
    ...version.promoted.map((at) => `  promoted at ${at}`),
  ];
}

/** A version less how it was measured. */
const blinded = (version: Version): Version => ({
  ...version,
  roles: version.roles.filter((role) => role === "starter"),
  sessions: [],
  compared: [],
  promoted: [],
});

/** What moved into a kept version from its kept parent; nothing where either state is missing. */
async function againstParent(
  { digest, kept, parent }: Version,
  states: string,
  depth: Depth,
): Promise<string[]> {
  if (!kept || parent === null || !existsSync(join(states, parent))) return [];
  const moves = await movesAt(join(states, parent), join(states, digest), depth);
  return [`  against ${short(parent)}:`, ...moves.map((line) => `    ${line}`)];
}

/** Every kept version against its kept parent, in the order the log names them, with how it was made
 *  and nothing of how it was measured: no role but the starter's, no comparison, reading or promotion. */
async function chainOf(versions: readonly Version[], states: string, depth: Depth): Promise<string[]> {
  const blocks = await Promise.all(
    versions.map(async (version) => {
      const moves = await againstParent(version, states, depth);
      if (moves.length === 0) return [];
      const turns = version.turns === null ? "" : `, Builder turns ${version.turns}`;
      return [`${short(version.digest)}  made: ${version.made}${turns}`, ...moves];
    }),
  );
  const shown = blocks.flat();
  return shown.length === 0 ? ["no kept version has a kept parent on record"] : shown;
}

/** The list, blind or not, as text or JSON. */
async function listed(args: CommandArgs, keeping: Keeping, versions: readonly Version[], depth: Depth) {
  if (args.value("against") !== null) args.die("--against is read with --diff");
  const blind = args.flag("blind");
  const shown = blind ? versions.map(blinded) : versions;
  if (args.flag("json")) return capturedJsonStringify({ ...keeping, versions: shown }, null, 2);
  const blocks = await Promise.all(
    shown.map(async (version) => [
      ...printed(version),
      ...(blind ? await againstParent(version, keeping.states, depth) : []),
    ]),
  );
  return blocks.flat().join("\n");
}

/** A harness as the commands name one, or a digest prefix of eight characters or more that names one
 *  version this campaign knows; a prefix that names two is refused with both. */
function wholeOf(args: CommandArgs, versions: readonly Version[], flag: string, harness: string): string {
  if (!PREFIX.test(harness)) return harness;
  const begun = versions.filter(({ digest }) => digest.startsWith(harness)).map(({ digest }) => digest);
  if (begun.length > 1) {
    args.die(`${flag} ${harness} begins ${String(begun.length)} digests: ${begun.join(", ")}`);
  }
  return begun[0] ?? harness;
}

async function main(args: CommandArgs): Promise<number> {
  const log = await logAcross(args.positionals[0] ?? args.die(USAGE));
  if (!existsSync(log)) args.die(`${log} does not exist`);
  const keeping = { log, states: join(dirname(log), "states") };
  const listing = !args.flag("chain") && args.value("diff") === null;
  const versions = await versionsOf(keeping, listing ? "opened" : "named");
  if (args.flag("files") && args.flag("lines")) args.die("--files and --lines are two depths; name one");
  const depth: Depth = args.flag("lines") ? "lines" : args.flag("files") ? "files" : "counts";
  if (args.flag("chain")) {
    if (args.value("diff") !== null || args.flag("json")) {
      args.die("--chain reads every version; it takes no --diff or --json");
    }
    console.log((await chainOf(versions, keeping.states, depth === "lines" ? "lines" : "files")).join("\n"));
    return 0;
  }
  const asked = args.value("diff");
  if (asked === null) {
    console.log(await listed(args, keeping, versions, depth));
    return 0;
  }
  if (args.flag("json")) args.die("--json is for the list; --diff prints its lines");
  // A role is resolved here, so that `keptAs` is handed a digest and never writes the starter into
  // a campaign that does not keep it.
  const named = async (flag: string, harness: string) => {
    if (harness.startsWith("programs-of:")) {
      args.die(`${flag} takes no control: the command that compares one makes it (tools/d2/checkpoint.ts)`);
    }
    const role = harness === "promoted" ? "reference" : harness;
    const digest = versions.find((version) => version.roles.includes(role))?.digest;
    if (digest === undefined && ["starter", "reference", "latest"].includes(role)) {
      args.die(`${flag} ${harness} names the starter, which this campaign keeps no state of`);
    }
    const whole = digest ?? wholeOf(args, versions, flag, harness);
    // A letter, or a name this campaign does not keep, is `keptAs`'s to resolve or refuse.
    if (!versions.some((version) => version.kept && version.digest === whole)) {
      return { ...(await keptAs(keeping, flag, whole)), notes: [] };
    }
    const dir = join(keeping.states, whole);
    const opens = await opensAs(dir, whole);
    const note = `${short(whole)} opens ${opens}; read as its files stand here (a copy of a campaign leaves out what its harness installed)`;
    return { dir, digest: whole, notes: opens === "as kept" ? [] : [note] };
  };
  const child = await named("--diff", asked);
  const parent = args.value("against") ?? versions.find((version) => version.digest === child.digest)?.parent;
  if (parent === null || parent === undefined) {
    return args.die(
      `${short(child.digest)} has no parent on record; name the harness to read it against with --against`,
    );
  }
  const against = await named("--against", parent);
  const moves = await movesAt(against.dir, child.dir, depth);
  const shown = [...child.notes, ...against.notes, ...moves];
  console.log([`${child.digest} against ${against.digest}`, ...shown.map((line) => `  ${line}`)].join("\n"));
  return 0;
}

if (import.meta.main) {
  await runCommand({ name: "harness-versions", usage: USAGE, options: OPTIONS, positionals: 1 }, main);
}
