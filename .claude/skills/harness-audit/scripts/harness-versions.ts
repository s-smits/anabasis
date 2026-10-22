#!/usr/bin/env bun
/**
 * Every harness a campaign keeps, with what its log holds of each, and what moved between one and
 * its parent, part by part. It reads: it writes nothing of the campaign's, starts no solve and calls
 * no model.
 *
 *   bun .claude/skills/harness-audit/scripts/harness-versions.ts --name <campaign> [--json]
 *   bun .claude/skills/harness-audit/scripts/harness-versions.ts --log <path> [--json]
 *   bun .claude/skills/harness-audit/scripts/harness-versions.ts --name <campaign> --diff <harness> [--against <harness>]
 *
 * A harness is named as a campaign's commands name one (`keptAs`, `tools/d2/campaign.ts`): `starter`,
 * `promoted`, `latest`, a whole digest or its unambiguous letter. The states sit beside the log,
 * under `states/`.
 *
 * v1's final-harness-audit joined each workspace commit to its iteration, its battery and its claim
 * through four scripts of 1,246 lines. v2 writes those joins as events, `harness.version`,
 * `harness.imported`, `harness.promoted` and the comparisons' own, and `campaignOf`
 * (`src/campaign/handover.ts`) folds them. This lists the states, opens each as a solve would
 * (`openHarness`), counts its parts, and leaves the joining to the fold. Whole-run-investigation's
 * lane 13 diffs a parent and a child part by part; `--diff` is that count, and quotes no line.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { type Handover, campaignOf } from "#src/campaign/handover.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { AGENT_DIR, GENERATED_TOOLS_FILE, GUIDE_FILE, TOOLS_SPEC_FILE } from "#src/meta/bundle-layout.ts";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { type JsonValue, asRecord, isString } from "#src/meta/json-shape.ts";
import { tmpdir } from "#src/meta/os.ts";
import { dirname, join } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { openHarness, pathsUnder, treeContent } from "#src/harness/open.ts";
import { writeStarter } from "#src/harness/starter.ts";
import { keptAs } from "#tools/d2/campaign.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

const USAGE = `usage:
  bun .claude/skills/harness-audit/scripts/harness-versions.ts --name <campaign> [--json]
  bun .claude/skills/harness-audit/scripts/harness-versions.ts --log <path> [--json]
  bun .claude/skills/harness-audit/scripts/harness-versions.ts --name <campaign> --diff <harness> [--against <harness>]

<harness> is starter, promoted, latest, a whole digest or its unambiguous letter. --against defaults to
the parent the log records.`;

const OPTIONS = { name: "text", log: "abs", json: "flag", diff: "text", against: "text" } as const;
const TOOL_TREE = ".toolchain";
const GUIDE = `${AGENT_DIR}${GUIDE_FILE}`;
const PARTS: ReadonlySet<string> = new Set([GUIDE, TOOLS_SPEC_FILE, GENERATED_TOOLS_FILE]);
/** Where a campaign event names a harness, by the fields that hold its digest. */
const NAMING = new Map<string, readonly string[]>([
  ["build.started", ["parent"]],
  ["build.finished", ["harness"]],
  ["harness.version", ["parent", "version"]],
  ["harness.imported", ["harness"]],
  ["harness.promoted", ["from", "harness"]],
  ["comparison.started", ["old", "fresh"]],
  ["comparison.reported", ["old", "fresh"]],
]);

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
  /** `as kept`, the digest it opens as instead, or why it does not open; null where not kept. */
  readonly opens: string | null;
  readonly made: string;
  readonly parent: string | null;
  /** The names a campaign's commands give it: `starter`, `reference` (which `promoted` names) and
   *  `latest`, each of which names the starter while nothing else holds it. */
  readonly roles: readonly string[];
  readonly promoted: readonly string[];
  readonly sessions: readonly string[];
  readonly compared: readonly string[];
  readonly parts: Parts | null;
}

interface Keeping {
  readonly log: string;
  readonly states: string;
}

const short = (digest: string): string => digest.slice(0, 8);
const recorded = (value: JsonValue | undefined): string => (isString(value) ? value : "unrecorded");
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
  const files = real === null ? [] : pathsUnder(real).filter((path) => lstatSync(join(real, path)).isFile());
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

/** How the campaign came to hold `digest`, and the parent the log records for it. */
function madeOf(events: readonly LogEvent[], digest: string, starter: string) {
  const version = events.find(
    ({ kind, data }) => kind === "harness.version" && data.version === digest,
  )?.data;
  if (isString(version?.parent)) {
    const note = isString(version.note) ? `${version.note.split(/\s+/).length}-word note` : "no note";
    return {
      made: `session ${recorded(version.session)} from ${short(version.parent)}, ${note}`,
      parent: version.parent,
    };
  }
  const imported = events.find(
    ({ kind, data }) => kind === "harness.imported" && data.harness === digest,
  )?.data;
  if (imported !== undefined) return { made: `imported from ${recorded(imported.from)}`, parent: null };
  if (digest === starter) {
    return { made: "the Starter Built Harness as this checkout writes it", parent: null };
  }
  return {
    made: "no record of its making: a stored sweep's harness, a starter of another checkout, or a programs-of control",
    parent: null,
  };
}

function measured(steps: readonly Handover[], digest: string) {
  return {
    sessions: steps.flatMap((step) => {
      if (step.step !== "builder" || step.parent !== digest) return [];
      const left =
        step.changed && step.harness !== null ? `left ${short(step.harness)}` : "left it as it was";
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

/** Every harness the log names or the states folder keeps: in the order the log first names them,
 *  the starter first, then any state the log never names. */
export async function versionsOf(keeping: Keeping): Promise<Version[]> {
  const events = read(keeping.log);
  const { steps, reference, latest } = campaignOf(events);
  const starter = await starterDigest();
  const states = existsSync(keeping.states) ? readdirSync(keeping.states).sort() : [];
  const named = events.flatMap(({ kind, data }) =>
    (NAMING.get(kind) ?? []).map((field) => data[field]).filter(isString),
  );
  const digests = [...new Set([...(states.includes(starter) ? [starter] : []), ...named, ...states])];
  return await Promise.all(
    digests.map(async (digest): Promise<Version> => {
      const dir = join(keeping.states, digest);
      const kept = states.includes(digest);
      const opens = kept
        ? await openHarness(dir).then(
            (harness) => (harness.digest === digest ? "as kept" : `as ${short(harness.digest)}, not as kept`),
            (error: unknown) => `refused: ${errorMessage(error)}`,
          )
        : null;
      return {
        digest,
        kept,
        opens,
        ...madeOf(events, digest, starter),
        roles: [
          ...(digest === starter ? ["starter"] : []),
          ...(digest === (reference ?? starter) ? ["reference"] : []),
          ...(digest === (latest ?? starter) ? ["latest"] : []),
        ],
        promoted: events.flatMap(({ at, kind, data }) =>
          kind === "harness.promoted" && data.harness === digest ? [at] : [],
        ),
        ...measured(steps, digest),
        parts: kept ? await partsOf(dir) : null,
      };
    }),
  );
}

function churn(before: string | null, after: string | null): string {
  const counts = new Map<string, number>();
  for (const line of lines(before)) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of lines(after)) {
    const left = counts.get(line) ?? 0;
    if (left > 0) counts.set(line, left - 1);
    else added += 1;
  }
  const removed = [...counts.values()].reduce((sum, left) => sum + left, 0);
  return `${lines(before).length} to ${lines(after).length} nonblank lines, +${added} -${removed}`;
}

/** Entries of a tree by path, each a file's sha256 or a link's target with its mode. */
function entries(dir: string, only: (path: string) => boolean): Map<string, string> {
  if (!existsSync(dir)) return new Map();
  return new Map(
    treeContent(realpathSync(dir)).flatMap(({ path, mode, content }) =>
      content === null || !only(path) ? [] : [[path, `${mode}:${content}`]],
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

/** What moved from `parent` to `child`, part by part, by kind and size. */
export async function diffOf(parent: string, child: string): Promise<string[]> {
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

function printed(version: Version): string[] {
  const parts = version.parts;
  const tree = parts?.toolTree;
  return [
    `${version.digest}  ${version.kept ? `kept, opens ${String(version.opens)}` : "not kept under states/"}${version.roles.map((role) => `  [${role}]`).join("")}`,
    `  made: ${version.made}`,
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

async function main(args: CommandArgs): Promise<number> {
  const name = args.value("name");
  const given = args.value("log");
  if (name !== null && given !== null) args.die("name the campaign or its log, not both");
  const log = await logAcross(given ?? name ?? args.die("--name or --log is required"));
  const keeping = { log, states: join(dirname(log), "states") };
  if (!existsSync(log)) args.die(`${log} does not exist`);
  const versions = await versionsOf(keeping);
  const asked = args.value("diff");
  if (asked === null) {
    if (args.value("against") !== null) args.die("--against is read with --diff");
    const list = args.flag("json")
      ? capturedJsonStringify({ ...keeping, versions }, null, 2)
      : versions.flatMap(printed).join("\n");
    console.log(list);
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
    return await keptAs(keeping, flag, digest ?? harness);
  };
  const child = await named("--diff", asked);
  const parent = args.value("against") ?? versions.find((version) => version.digest === child.digest)?.parent;
  if (parent === null || parent === undefined) {
    return args.die(
      `${short(child.digest)} has no parent on record; name the harness to read it against with --against`,
    );
  }
  const against = await named("--against", parent);
  const moves = await diffOf(against.dir, child.dir);
  console.log([`${child.digest} against ${against.digest}`, ...moves.map((line) => `  ${line}`)].join("\n"));
  return 0;
}

if (import.meta.main) await runCommand({ name: "harness-versions", usage: USAGE, options: OPTIONS }, main);
