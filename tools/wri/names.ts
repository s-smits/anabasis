/**
 * Where a kept harness's own files name a task: its id, its version's prefix, its family, or a rare
 * identifier from its public input, word by word; or copy a phrase of its public input. Each hit
 * carries the tasks it names and whether each was practice or held out.
 *
 *   bun tools/wri/names.ts <log>
 *   bun tools/wri/names.ts --log <log> [--harness <prefix>]
 *
 * The Builder's one limit is that no part of a harness names a task, copies its text or holds its
 * answer (`src/builder/prompt.ts`), and no production check reads it. Between 3 and 10 November 9 of
 * 18 lane 12 sessions scanned own programs for it by hand, and two such scans were refused for
 * walking the checkout or giving an interpreter a campaign's path. The files read are what the
 * harness wrote (`writtenIn`, `tools/wri/trajectory.ts`: the guide and its own programs, nothing it
 * installed). A word matches whole: `x-1-3` is not found inside `x-1-31`.
 *
 * A short id or a common word matches by chance, so each hit carries the token's length and how many
 * kept versions and public inputs hold it, and the lane judges. A public token is kept only where it
 * looks like an identifier (a digit, an inner `_`, `.` or `:`, or a capital past its first letter), has
 * at least `MIN_TOKEN` characters and stands in at most `RARE` tasks' public inputs; a plain word is
 * left out, a compound of plain words joined by hyphens with it, and the header says how many were.
 * A task's id is looked for whatever its form. A public token's own text is not printed, its place is.
 *
 * A phrase is a span of at least `PHRASE` consecutive words, lower-cased and split on everything but
 * letters and digits, that a written file shares with a public input, across its lines. Overlapping
 * windows in one place are one hit, the longest span, at its first word's line, with its length in
 * words and every task holding six words of it. A span every task's public input holds is the
 * contract's fixed wording, not a copy of one task, so it is left out and the header counts such
 * six-word spans; with one task nothing is left out so. A phrase's text is not printed either.
 * A practice task's name in a harness is one the Builder was shown; a held-out task's is not, and
 * neither is called a breach here.
 *
 * It names which tasks were held out, so lane 27 reads it only after it has graded.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { DIGEST } from "#src/campaign/names.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { taskSets } from "#src/kernel/task.ts";
import { existsSync, lstatSync, readdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { asRecord, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { logAcross } from "#tools/runs/snapshots.ts";
import { proposedTasks } from "./tasks.ts";
import { writtenIn } from "./trajectory.ts";

const USAGE = "usage: bun tools/wri/names.ts (<log> | --log <log>) [--harness <prefix>]";
const OPTIONS = { log: "text", harness: "text" } as const;
const MIN_TOKEN = 6;
const RARE = 2;
const PREFIX_CHARS = 8;
/** A word of a file or an input: letters, digits and inner `-`, `_`, `.` or `:`. */
const WORD = /[\p{L}\p{N}_](?:[\p{L}\p{N}_.:-]*[\p{L}\p{N}_])?/gu;
const IDENTIFIER = /\d|[_.:]|^.+\p{Lu}/u;
const HEX = /^[0-9a-f]{8,64}$/;
const PHRASE = 6;
const PLAIN = /[\p{L}\p{N}]+/gu;

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

/** Every string of a public input, keys and values, at any depth. */
function stringsIn(value: JsonValue | undefined): string[] {
  if (isString(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  const record = asRecord(value);
  return record === null ? [] : Object.entries(record).flatMap(([key, each]) => [key, ...stringsIn(each)]);
}

/** The words of a text as a phrase is matched: lower-cased runs of letters and digits, each with its offset. */
function plainWords(text: string): { word: string; at: number }[] {
  return [...text.matchAll(PLAIN)].map((match) => ({ word: match[0].toLowerCase(), at: match.index }));
}

/** The six-word spans of public inputs with the tasks holding each, and how many every task holds. */
function spansOf(tasks: readonly { name: string; strings: readonly string[] }[]) {
  const spans = new Map<string, Set<string>>();
  for (const { name, strings } of tasks) {
    for (const words of strings.map((text) => plainWords(text).map(({ word }) => word))) {
      for (let from = 0; from + PHRASE <= words.length; from += 1) {
        const span = words.slice(from, from + PHRASE).join(" ");
        spans.set(span, (spans.get(span) ?? new Set()).add(name));
      }
    }
  }
  const everyone = new Set(tasks.map(({ name }) => name)).size;
  const common = everyone < 2 ? [] : [...spans].filter(([, holders]) => holders.size === everyone);
  for (const [span] of common) spans.delete(span);
  return { spans, common: common.length };
}

/** The phrases of one written file: each run of overlapping shared windows, once, as its longest span. */
function phrasesIn(path: string, text: string, spans: ReadonlyMap<string, ReadonlySet<string>>): Hit[] {
  const words = plainWords(text);
  const hits: Hit[] = [];
  let run: { from: number; to: number; tasks: Set<string> } | null = null;
  for (let from = 0; from <= words.length; from += 1) {
    const holders = spans.get(
      words
        .slice(from, from + PHRASE)
        .map(({ word }) => word)
        .join(" "),
    );
    if (holders !== undefined) {
      run ??= { from, to: from, tasks: new Set() };
      run.to = from;
      for (const task of holders) run.tasks.add(task);
    } else if (run !== null) {
      const span = words.slice(run.from, run.to + PHRASE).map(({ word }) => word);
      const line = text.slice(0, words[run.from]?.at ?? 0).split("\n").length;
      hits.push({ path, line, kind: "phrase", text: span.join(" "), tasks: [...run.tasks] });
      run = null;
    }
  }
  return hits;
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
  const tasks = proposedTasks(events);
  for (const { version, taskId, family, input } of tasks) {
    const name = taskId ?? version.slice(0, PREFIX_CHARS);
    if (taskId !== null) add("id", taskId, name);
    if (isString(family)) families.set(family, (families.get(family) ?? new Set()).add(name));
    for (const word of stringsIn(input?.publicInput).flatMap((text) => text.match(WORD) ?? [])) {
      publics.set(word, (publics.get(word) ?? new Set()).add(name));
    }
  }
  let plain = 0;
  for (const [word, holders] of publics) {
    if (tokens.has(word) || word.length < MIN_TOKEN || holders.size > RARE) continue;
    if (IDENTIFIER.test(word)) for (const task of holders) add("public", word, task);
    else plain += 1;
  }
  const versions = new Map(
    tasks.map(({ version, taskId }) => [version, taskId ?? version.slice(0, PREFIX_CHARS)]),
  );
  const phrases = spansOf(
    tasks.map(({ version, input }) => ({
      name: versions.get(version) ?? version,
      strings: stringsIn(input?.publicInput),
    })),
  );
  return { tokens, families, publics, versions, plain, phrases };
}

/** What one word of a file names: a task id or public identifier, and the versions it begins. */
function wordHits(word: string, known: ReturnType<typeof tokensOf>): Omit<Hit, "path" | "line">[] {
  const token = known.tokens.get(word);
  // HEX takes no word shorter than a printed prefix, so a short hex word names no version.
  const named = HEX.test(word) ? [...known.versions].filter(([version]) => version.startsWith(word)) : [];
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
  const familyRules = [...known.families].map(([family, tasks]) => ({
    family,
    tasks: [...tasks],
    rule: new RegExp(
      `(?<![\\p{L}\\p{N}_-])${family.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}(?![\\p{L}\\p{N}_-])`,
      "iu",
    ),
  }));
  // A link names another file of the tree, whose words are read under that file's own path.
  for (const [path, file] of [...files].filter(([, each]) => !lstatSync(each).isSymbolicLink())) {
    const whole = readFileSync(file, "utf8");
    for (const [at, text] of whole.split("\n").entries()) {
      const line = at + 1;
      hits.push(
        ...[...new Set(text.match(WORD))].flatMap((word) =>
          wordHits(word, known).map((hit) => ({ path, line, ...hit })),
        ),
        ...familyRules
          .filter(({ rule }) => rule.test(text))
          .map(({ family, tasks }) => ({ path, line, kind: "family" as const, text: family, tasks })),
      );
    }
    hits.push(...phrasesIn(path, whole, known.phrases.spans));
  }
  return { files: files.size, hits };
}

/** The rows: a header, then a block a kept state with a line a hit. */
export function nameRows(events: readonly LogEvent[], states: string, only: string | null = null): string[] {
  const known = tokensOf(events);
  const { held, released } = taskSets(events);
  const names = new Map(
    proposedTasks(events).map(({ version, taskId }) => [version, taskId ?? version.slice(0, PREFIX_CHARS)]),
  );
  const heldNames = new Set(held.map((version) => names.get(version)));
  const practised = new Set(released.map((version) => names.get(version)));
  const marked = (task: string) =>
    `${task} (${practised.has(task) ? "practice" : heldNames.has(task) ? "held out" : "neither set"})`;
  const kept = existsSync(states)
    ? readdirSync(states)
        .filter((each) => DIGEST.test(each) && (only === null || each.startsWith(only)))
        .toSorted()
    : [];
  const scanned = kept.map((digest) => ({ digest, ...hitsIn(join(states, digest), known) }));
  const versionsHolding = (text: string) =>
    scanned.filter(({ hits }) => hits.some((hit) => hit.text === text)).length;
  const kinds = [...known.tokens.values()];
  const count = (kind: Kind) => String(kinds.filter((token) => token.kind === kind).length);
  return [
    `names: where the files each kept harness wrote name a task, word by word, or copy its public input; looked for ${count("id")} task ids, ${String(known.versions.size)} version prefixes, ${String(known.families.size)} families, ${count("public")} identifiers of public inputs (${String(known.plain)} plain words left out) and ${String(known.phrases.spans.size)} spans of ${String(PHRASE)} words of public inputs (${String(known.phrases.common)} spans every task shares left out)`,
    "harness  path:line  kind  length  kept versions holding it  public inputs holding it  tasks",
    ...(kept.length === 0 ? [`no kept harness under ${states}`] : []),
    ...scanned.flatMap(({ digest, files, hits }) => [
      `${digest.slice(0, 8)}  ${String(files)} written files, ${String(hits.length)} hits`,
      ...hits.map((hit) => {
        const phrase = hit.kind === "phrase";
        const length = phrase ? hit.text.split(" ").length : hit.text.length;
        const inputs = phrase ? hit.tasks.length : (known.publics.get(hit.text)?.size ?? 0);
        return `  ${hit.path}:${String(hit.line)}  ${hit.kind}${phrase || hit.kind === "public" ? "" : ` ${hit.text}`}  ${String(length)}  ${String(versionsHolding(hit.text))}  ${String(inputs)}  ${hit.tasks.map(marked).join(", ")}`;
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
