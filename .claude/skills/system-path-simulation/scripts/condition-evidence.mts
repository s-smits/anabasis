/**
 * Collect a simulation condition's Builder evidence into one directory while the run is live: the
 * Claude CLI transcripts whose working directory lies in the condition's campaign, the campaign's
 * durable prose and execution records, and where the campaign was seeded from.
 *
 * On 2026-09-30 all three stewards copied the Builder's transcript out of
 * `$TMPDIR/ana-claude-cli-*` by hand, and S2 lost its 450 KB copy when a later copy overwrote it
 * with the 6-row stub the CLI leaves at close. So every snapshot here is named by its content
 * (`<session>.<sha12>.jsonl`) and never replaces another, and the summary reads the largest one of
 * each session. Only `projects/**` transcripts are copied: the CLI's config directory also holds
 * its session keys, which this script never reads.
 *
 *   bun .claude/skills/system-path-simulation/scripts/condition-evidence.mts \
 *     --campaign /abs/campaigns/<slug> --out /abs/evidence [--follow <seconds>] [--grep <regex>] \
 *     [--tmp /abs/tmpdir] [--json]
 *
 * `--follow` snapshots again every that many seconds until no transcript of the campaign remains or
 * the script is interrupted; an interrupted write leaves no partial snapshot. `--grep` prints the
 * assistant text lines that match, from the largest snapshot of each session. `--tmp` is where the
 * Builder's process made its temp directories, this process's own by default: a run launched
 * through launchd or systemd may have another.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "#src/meta/filesystem.ts";
import { basename, dirname, join, relative } from "#src/meta/path.ts";
import { tmpdir } from "#src/meta/os.ts";
import { campaignDir } from "#src/meta/campaign-root.ts";
import { sha256 } from "#src/meta/digest.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { readJsonFileOrNull, writeAtomic } from "#src/meta/completed-json.ts";
import { runCommand } from "#skills/main/cli.ts";
import { MCP_TOOL_PREFIX } from "../../../../vendor/pi-claude-bridge/turn-translation.ts";
import { readHead } from "./file-head.mts";
import { SEED_MANIFEST } from "./tool-tree.mts";

const CLI_DIR_PREFIX = "ana-claude-cli-";
/** The Builder's durable records beside each epoch: its prose and its execution record. */
const DURABLE = /^builder-(?:prose(?:-\d+)?\.jsonl|execution(?:-\d+)?\.json)$/;
/** Enough of a transcript's head to reach its first row that carries a `cwd`. */
const HEAD_BYTES = 256 * 1024;
const JSONL = ".jsonl";

/** The fields this script reads from a CLI transcript row, unchecked until read. */
interface TranscriptRow {
  type?: unknown;
  cwd?: unknown;
  timestamp?: unknown;
  message?: unknown;
}

export interface Snapshot {
  source: string;
  session: string;
  file: string;
  bytes: number;
  fresh: boolean;
}

export interface SessionSummary {
  session: string;
  file: string;
  rows: number;
  assistantTurns: number;
  tools: Record<string, number>;
  first: string | null;
  last: string | null;
}

function walk(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const path = join(dir, name);
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true ? walk(path) : [path];
  });
}

function rows(text: string): TranscriptRow[] {
  return text.split("\n").flatMap((line) => {
    if (line.trim() === "") return [];
    try {
      const row = asRecord(parseJsonAs<unknown>(line));
      return row === null ? [] : [row];
    } catch {
      return [];
    }
  });
}

/** Every CLI transcript under `tmp` whose recorded working directory lies in `campaign`. */
export function liveTranscripts(campaign: string, tmp: string): string[] {
  const spellings = [...new Set([campaign, realpathSync(campaign)])];
  let names: string[];
  try {
    names = readdirSync(tmp).filter((name) => name.startsWith(CLI_DIR_PREFIX));
  } catch {
    return [];
  }
  return names
    .flatMap((name) => walk(join(tmp, name, "projects")))
    .filter((path) => {
      if (!path.endsWith(JSONL)) return false;
      // The working directory the transcript's first row records.
      const cwd = rows(readHead(path, HEAD_BYTES).toString("utf8")).find((entry) => isString(entry.cwd))?.cwd;
      return isString(cwd) && spellings.some((parent) => cwd === parent || cwd.startsWith(`${parent}/`));
    })
    .sort();
}

/** Copy `text` to `<dir>/<stem>.<sha12><ext>` unless that content is already there. */
function keep(text: string, dir: string, stem: string, ext: string) {
  const file = join(dir, `${stem}.${sha256(text).slice(0, 12)}${ext}`);
  if (existsSync(file)) return { file, fresh: false };
  mkdirSync(dir, { recursive: true });
  writeAtomic(file, text);
  return { file, fresh: true };
}

/** The Builder's prose and execution records in each epoch of `campaign`, without walking into its
 *  workspaces, whose tool trees run to a hundred thousand files. */
function durableRecords(campaign: string): string[] {
  return readdirSync(campaign)
    .filter((name) => name.startsWith("epoch-"))
    .flatMap((epoch) => {
      const dir = join(campaign, epoch);
      if (statSync(dir, { throwIfNoEntry: false })?.isDirectory() !== true) return [];
      return readdirSync(dir)
        .filter((name) => DURABLE.test(name))
        .map((name) => join(dir, name));
    });
}

/** Snapshot every live transcript of `campaign` and its durable Builder records into `out`. */
export function snapshotEvidence(campaign: string, out: string, tmp: string): Snapshot[] {
  const taken: Snapshot[] = [];
  for (const source of liveTranscripts(campaign, tmp)) {
    const session = basename(source, JSONL);
    const cliDir = relative(tmp, source).split("/")[0] ?? "cli";
    const text = readFileSync(source, "utf8");
    taken.push({
      source,
      session,
      bytes: Buffer.byteLength(text),
      ...keep(text, join(out, "transcripts", cliDir), session, JSONL),
    });
  }
  for (const source of durableRecords(campaign)) {
    const epoch = basename(dirname(source));
    const name = basename(source);
    const ext = name.endsWith(JSONL) ? JSONL : ".json";
    const text = readFileSync(source, "utf8");
    taken.push({
      source,
      session: `${epoch}/${name}`,
      bytes: Buffer.byteLength(text),
      ...keep(text, join(out, "durable", epoch), basename(name, ext), ext),
    });
  }
  return taken;
}

function toolNames(row: TranscriptRow): string[] {
  const content = asRecord(row.message)?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    const entry = asRecord(block);
    if (entry?.type !== "tool_use" || !isString(entry.name)) return [];
    return [entry.name.startsWith(MCP_TOOL_PREFIX) ? entry.name.slice(MCP_TOOL_PREFIX.length) : entry.name];
  });
}

function assistantText(row: TranscriptRow): string[] {
  const content = asRecord(row.message)?.content;
  if (isString(content)) return [content];
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    const entry = asRecord(block);
    return entry?.type === "text" && isString(entry.text) ? [entry.text] : [];
  });
}

/** The largest snapshot kept of each transcript session under `out`. */
export function largestSnapshots(out: string): Map<string, string> {
  const largest = new Map<string, string>();
  for (const file of walk(join(out, "transcripts")).filter((path) => path.endsWith(JSONL))) {
    const session = basename(file).split(".")[0] ?? file;
    const held = largest.get(session);
    if (held === undefined || statSync(file).size > statSync(held).size) largest.set(session, file);
  }
  return largest;
}

export function summarise(session: string, file: string): SessionSummary {
  const all = rows(readFileSync(file, "utf8"));
  const tools: Record<string, number> = {};
  for (const name of all.filter((row) => row.type === "assistant").flatMap(toolNames)) {
    tools[name] = (tools[name] ?? 0) + 1;
  }
  const stamps = all.map((row) => row.timestamp).filter(isString);
  return {
    session,
    file,
    rows: all.length,
    assistantTurns: all.filter((row) => row.type === "assistant").length,
    tools,
    first: stamps[0] ?? null,
    last: stamps.at(-1) ?? null,
  };
}

/** Assistant text lines matching `pattern`, each prefixed with its row's timestamp. */
export function grepProse(file: string, pattern: RegExp): string[] {
  return rows(readFileSync(file, "utf8"))
    .filter((row) => row.type === "assistant")
    .flatMap((row) =>
      assistantText(row)
        .flatMap((text) => text.split("\n"))
        .filter((line) => pattern.test(line))
        .map((line) => `${isString(row.timestamp) ? row.timestamp : "?"}  ${line.slice(0, 240)}`),
    );
}

/** Where the campaign was seeded from, as its `seed.json` records it. */
function seedLine(campaign: string): string | null {
  const seed = asRecord(readJsonFileOrNull(join(campaign, SEED_MANIFEST)));
  if (seed === null) return null;
  const from = isString(seed.fromRoot) && isString(seed.slug) ? campaignDir(seed.fromRoot, seed.slug) : "?";
  return `seeded     ${isString(seed.mode) ? seed.mode : "?"} from ${from}, product ${isString(seed.selectedProductId) ? seed.selectedProductId : "none"}`;
}

/** The seed source, then each session's summary from its largest snapshot, with `pattern`'s lines. */
function report(campaign: string, out: string, pattern: RegExp | null): string[] {
  const lines: string[] = [];
  const seed = seedLine(campaign);
  if (seed !== null) lines.push(seed);
  for (const [session, file] of largestSnapshots(out)) {
    const summary = summarise(session, file);
    const tools = Object.entries(summary.tools)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name} ${count}`)
      .join(", ");
    lines.push(
      `session    ${session}: ${summary.rows} rows, ${summary.assistantTurns} assistant turns, ${summary.first ?? "?"} .. ${summary.last ?? "?"}`,
    );
    lines.push(`  tools    ${tools === "" ? "none" : tools}`);
    if (pattern !== null) lines.push(...grepProse(file, pattern).map((line) => `  grep     ${line}`));
  }
  return lines;
}

if (import.meta.main) {
  await runCommand(
    {
      name: "condition-evidence",
      usage:
        "usage: condition-evidence.mts --campaign /abs/campaigns/<slug> --out /abs/evidence [--follow <seconds>] [--grep <regex>] [--tmp /abs/tmpdir] [--json]",
      options: { campaign: "abs", out: "abs", follow: "int", grep: "text", tmp: "abs", json: "flag" },
    },
    async (args) => {
      const campaign = args.required("campaign");
      if (!existsSync(campaign)) args.die(`--campaign ${campaign} does not exist`);
      const out = args.required("out");
      const tmp = args.value("tmp") ?? tmpdir();
      const follow = args.int("follow");
      if (follow !== null && follow < 1) args.die("--follow takes a whole number of seconds, at least 1");
      const grep = args.value("grep");
      const pattern = grep === null ? null : new RegExp(grep, "i");
      const taken = snapshotEvidence(campaign, out, tmp);
      const say = (snaps: readonly Snapshot[]) => {
        for (const snap of snaps) {
          if (snap.fresh && !args.flag("json")) {
            console.log(`kept       ${snap.file} (${snap.bytes} B from ${snap.source})`);
          }
        }
      };
      say(taken);
      if (follow !== null) {
        while (liveTranscripts(campaign, tmp).length > 0) {
          await Bun.sleep(follow * 1000);
          const more = snapshotEvidence(campaign, out, tmp).filter((snap) => snap.fresh);
          taken.push(...more);
          say(more);
        }
      }
      if (args.flag("json")) {
        const sessions = [...largestSnapshots(out)].map(([session, file]) => summarise(session, file));
        console.log(JSON.stringify({ campaign, out, snapshots: taken, sessions }, null, 2));
        return;
      }
      console.log(report(campaign, out, pattern).join("\n"));
    },
  );
}
