/**
 * Where a kept harness's own files name a task: its id, its version's prefix, its family, or a rare
 * identifier from its public input, word by word; or copy a phrase of its public input. Each hit
 * carries the tasks it names and whether each was practice or held out.
 *
 *   bun tools/wri/names.ts <log>
 *   bun tools/wri/names.ts --log <log> [--harness <prefix>]
 *
 * The Builder's one limit is that no part of a harness names a task, copies its text or holds its
 * answer (`src/builder/prompt.ts`), and no production check reads it. Without this a lane 15
 * session scans own programs for it by hand, and such a scan can be refused for walking the
 * checkout or giving an interpreter a campaign's path. The files read are what the
 * harness wrote (`writtenIn`, `tools/wri/trajectory.ts`: the guide and its own programs, nothing it
 * installed). A word matches whole: `x-1-3` is not found inside `x-1-31`.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { QUOTE_WORDS, quotedSpans, spansOf, stringsIn } from "#src/harness/files.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { taskSets } from "#src/kernel/task.ts";
import { lstatSync, readFileSync } from "#src/meta/filesystem.ts";
import { isString } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { logAcross } from "#tools/runs/snapshots.ts";
import { proposedTasks } from "./tasks.ts";
import { keptStates, writtenIn } from "./trajectory.ts";

const USAGE = "usage: bun tools/wri/names.ts (<log> | --log <log>) [--harness <prefix>]";
const OPTIONS = { log: "text", harness: "text" } as const;
const MIN_TOKEN = 6;
const RARE = 2;
const PREFIX_CHARS = 8;
/** A word of a file or an input: letters, digits and inner `-`, `_`, `.` or `:`. */
const WORD = /[\p{L}\p{N}_](?:[\p{L}\p{N}_.:-]*[\p{L}\p{N}_])?/gu;
const IDENTIFIER = /\d|[_.:]|^.+\p{Lu}/u;
const HEX = /^[0-9a-f]{8,64}$/;

type Kind = "id" | "family" | "phrase" | "public" | "version";

interface Token {
  readonly kind: Kind;
  readonly text: string;
  readonly tasks: Set<string>;
}

interface Hit {
  readonly path: string;
  readonly line: number;
  readonly kind: Kind;
  readonly text: string;
  readonly tasks: readonly string[];
}

/** The tokens to look for, by their text, with the tasks each names; and the plain words left out. */
function tokensOf(events: readonly LogEvent[]) {
  const tokens = new Map<string, Token>();
  const add = (kind: Kind, text: string, task: string) => {
    const token = tokens.get(text) ?? { kind, text, tasks: new Set<string>() };
    token.tasks.add(task);
    tokens.set(text, token);
  };
  const publics = new Map<string, Set<string>>();
  const families = new Map<string, Set<string>>();
  const versions = new Map<string, string>();
  const inputs: { name: string; strings: readonly string[] }[] = [];
  for (const { version, taskId, family, input } of proposedTasks(events)) {
    const name = taskId ?? version.slice(0, PREFIX_CHARS);
    versions.set(version, name);
    if (taskId !== null) add("id", taskId, name);
    if (isString(family)) families.set(family, (families.get(family) ?? new Set()).add(name));
    const strings = stringsIn(input?.publicInput);
    inputs.push({ name, strings });
    for (const word of strings.flatMap((text) => text.match(WORD) ?? [])) {
      publics.set(word, (publics.get(word) ?? new Set()).add(name));
    }
  }
  let plain = 0;
  for (const [word, holders] of publics) {
    if (tokens.has(word) || word.length < MIN_TOKEN || holders.size > RARE) continue;
    if (IDENTIFIER.test(word)) for (const task of holders) add("public", word, task);
    else plain += 1;
  }
  const byPrefix = Map.groupBy(versions, ([version]) => version.slice(0, PREFIX_CHARS));
  const escaped = (name: string) => name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const bounded = (body: string) => new RegExp(`(?<![\\p{L}\\p{N}_-])${body}(?![\\p{L}\\p{N}_-])`, "iu");
  const familyRules = [...families].map(([family, holders]) => ({
    family,
    tasks: [...holders],
    rule: bounded(escaped(family)),
  }));
  const familyAny =
    familyRules.length === 0
      ? null
      : bounded(`(?:${familyRules.map(({ family }) => escaped(family)).join("|")})`);
  return { tokens, publics, versions, byPrefix, familyRules, familyAny, plain, phrases: spansOf(inputs) };
}

/** What one word of a file names: a task id or public identifier, and the versions it begins. */
function wordHits(word: string, known: ReturnType<typeof tokensOf>): Omit<Hit, "path" | "line">[] {
  const token = known.tokens.get(word);
  // HEX takes no word shorter than a printed prefix, so a short hex word names no version.
  const named = HEX.test(word)
    ? (known.byPrefix.get(word.slice(0, PREFIX_CHARS)) ?? []).filter(([version]) => version.startsWith(word))
    : [];
  return [
    ...(token === undefined ? [] : [{ kind: token.kind, text: word, tasks: [...token.tasks] }]),
    ...(named.length === 0
      ? []
      : [{ kind: "version" as const, text: word, tasks: named.map(([, task]) => task) }]),
  ];
}

/** The hits in one kept state's own files. */
function hitsIn(state: string, known: ReturnType<typeof tokensOf>): { files: number; hits: Hit[] } {
  const files = writtenIn(state);
  const hits: Hit[] = [];
  // A link names another file of the tree, whose words are read under that file's own path.
  for (const [path, file] of files) {
    if (lstatSync(file).isSymbolicLink()) continue;
    const whole = readFileSync(file, "utf8");
    for (const [at, text] of whole.split("\n").entries()) {
      const line = at + 1;
      hits.push(
        ...[...new Set(text.match(WORD))].flatMap((word) =>
          wordHits(word, known).map((hit) => ({ path, line, ...hit })),
        ),
        ...(known.familyAny?.test(text) === true
          ? known.familyRules
              .filter(({ rule }) => rule.test(text))
              .map(({ family, tasks }) => ({ path, line, kind: "family" as const, text: family, tasks }))
          : []),
      );
    }
    hits.push(
      ...quotedSpans(path, whole, known.phrases.spans).map((hit) => ({ kind: "phrase" as const, ...hit })),
    );
  }
  return { files: files.size, hits };
}

/** The rows: a header, then a block a kept state with a line a hit. */
export function nameRows(events: readonly LogEvent[], states: string, only: string | null = null): string[] {
  const known = tokensOf(events);
  const { held, released } = taskSets(events);
  const heldNames = new Set(held.map((version) => known.versions.get(version)));
  const practised = new Set(released.map((version) => known.versions.get(version)));
  const marked = (task: string) =>
    `${task} (${practised.has(task) ? "practice" : heldNames.has(task) ? "held out" : "neither set"})`;
  const kept = keptStates(states).filter((each) => only === null || each.startsWith(only));
  const scanned = kept.map((digest) => ({ digest, ...hitsIn(join(states, digest), known) }));
  const holders = new Map<string, number>();
  for (const { hits } of scanned) {
    for (const text of new Set(hits.map((hit) => hit.text))) holders.set(text, (holders.get(text) ?? 0) + 1);
  }
  const kinds = [...known.tokens.values()];
  const count = (kind: Kind) => String(kinds.filter((token) => token.kind === kind).length);
  return [
    `names: where the files each kept harness wrote name a task, word by word, or copy its public input; looked for ${count("id")} task ids, ${String(known.versions.size)} version prefixes, ${String(known.familyRules.length)} families, ${count("public")} identifiers of public inputs (${String(known.plain)} plain words left out) and ${String(known.phrases.spans.size)} spans of ${String(QUOTE_WORDS)} words of public inputs (${String(known.phrases.common)} spans every task shares left out)`,
    "harness  path:line  kind  length  kept versions holding it  public inputs holding it  tasks",
    ...(kept.length === 0 ? [`no kept harness under ${states}`] : []),
    ...scanned.flatMap(({ digest, files, hits }) => [
      `${digest.slice(0, 8)}  ${String(files)} written files, ${String(hits.length)} hits`,
      ...hits.map((hit) => {
        const phrase = hit.kind === "phrase";
        const length = phrase ? hit.text.split(" ").length : hit.text.length;
        const inputs = phrase ? hit.tasks.length : (known.publics.get(hit.text)?.size ?? 0);
        return `  ${hit.path}:${String(hit.line)}  ${hit.kind}${phrase || hit.kind === "public" ? "" : ` ${hit.text}`}  ${String(length)}  ${String(holders.get(hit.text) ?? 0)}  ${String(inputs)}  ${hit.tasks.map(marked).join(", ")}`;
      }),
    ]),
  ];
}

async function main(args: CommandArgs): Promise<number> {
  const log = await logAcross(args.value("log") ?? args.positionals[0] ?? args.die(USAGE));
  console.log(nameRows(read(log), join(dirname(log), "states"), args.value("harness")).join("\n"));
  return 0;
}

if (import.meta.main) {
  await runCommand({ name: "names", usage: USAGE, options: OPTIONS, positionals: [0, 1] }, main);
}
