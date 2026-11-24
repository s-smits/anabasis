/**
 * Where a kept harness's own files name a task: its id, its version's prefix, its family, or a rare
 * identifier from its public input, word by word; or copy a phrase of its public input. Each hit
 * carries the tasks it names and whether each was practice or held out.
 *
 *   bun tools/wri/names.ts <log>
 *   bun tools/wri/names.ts --log <log> [--harness <prefix>]
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
const WORD = /[\p{L}\p{N}_](?:[\p{L}\p{N}_.:-]*[\p{L}\p{N}_])?/gu;
const SPAN_WORD = /[a-z0-9]+/gu;
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

/** Read kept states once and collect candidate identifiers and quote spans present in their files. */
function loadKept(states: string, only: string | null) {
  const wantedWords = new Set<string>();
  const wantedSpans = new Set<string>();
  const unique = new Set<string>();
  const loaded = keptStates(states)
    .filter((each) => only === null || each.startsWith(only))
    .map((digest) => {
      const files = writtenIn(join(states, digest));
      const entries = [...files].flatMap(([path, file]): [string, string][] => {
        if (lstatSync(file).isSymbolicLink()) return [];
        const whole = readFileSync(file, "utf8");
        if (!unique.has(whole)) {
          unique.add(whole);
          for (const word of whole.match(WORD) ?? []) {
            if ((word.length >= MIN_TOKEN && IDENTIFIER.test(word)) || HEX.test(word)) wantedWords.add(word);
          }
          const words = whole.toLowerCase().match(SPAN_WORD) ?? [];
          for (let from = 0; from + QUOTE_WORDS <= words.length; from += 1) {
            wantedSpans.add(words.slice(from, from + QUOTE_WORDS).join(" "));
          }
        }
        return [[path, whole]];
      });
      return { digest, files: files.size, entries };
    });
  return { loaded, wantedWords, wantedSpans };
}

/** The tokens and quote spans of public inputs, restricted to candidates present in kept states. */
function tokensOf(
  events: readonly LogEvent[],
  wantedWords: ReadonlySet<string>,
  wantedSpans: ReadonlySet<string>,
) {
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
  const tasks = proposedTasks(events);
  const scanWords = new Set(wantedWords);
  for (const { taskId, family } of tasks) {
    if (taskId !== null) scanWords.add(taskId);
    if (isString(family)) scanWords.add(family);
  }
  const hasKept = wantedWords.size > 0 || wantedSpans.size > 0;
  for (const { version, taskId, family, input } of tasks) {
    const name = taskId ?? version.slice(0, PREFIX_CHARS);
    versions.set(version, name);
    if (taskId !== null) add("id", taskId, name);
    if (isString(family)) families.set(family, (families.get(family) ?? new Set()).add(name));
    if (!hasKept) continue;
    const strings = stringsIn(input?.publicInput);
    inputs.push({ name, strings });
    for (const word of strings.flatMap((text) => text.match(WORD) ?? []).filter((w) => scanWords.has(w))) {
      publics.set(word, (publics.get(word) ?? new Set()).add(name));
    }
  }
  for (const [word, holders] of publics) {
    if (!tokens.has(word) && word.length >= MIN_TOKEN && holders.size <= RARE && IDENTIFIER.test(word)) {
      for (const task of holders) add("public", word, task);
    }
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
  return {
    tokens,
    publics,
    versions,
    byPrefix,
    familyRules,
    familyAny,
    phrases: spansOf(inputs, QUOTE_WORDS, wantedSpans),
  };
}

/** Scan one file's text, caching hits across kept states that share identical file bytes. */
function scanText(whole: string, known: ReturnType<typeof tokensOf>): Omit<Hit, "path">[] {
  const hits = whole.split("\n").flatMap((text, at): Omit<Hit, "path">[] => {
    const line = at + 1;
    const words = [...new Set(text.match(WORD))].flatMap((word): Omit<Hit, "path">[] => {
      const token = known.tokens.get(word);
      const named = HEX.test(word)
        ? (known.byPrefix.get(word.slice(0, PREFIX_CHARS)) ?? []).filter(([v]) => v.startsWith(word))
        : [];
      return [
        ...(token === undefined ? [] : [{ line, kind: token.kind, text: word, tasks: [...token.tasks] }]),
        ...(named.length === 0
          ? []
          : [{ line, kind: "version" as const, text: word, tasks: named.map(([, task]) => task) }]),
      ];
    });
    const families =
      known.familyAny?.test(text) === true
        ? known.familyRules
            .filter(({ rule }) => rule.test(text))
            .map(({ family, tasks }) => ({ line, kind: "family" as const, text: family, tasks }))
        : [];
    return [...words, ...families];
  });
  return [
    ...hits,
    ...quotedSpans("", whole, known.phrases.spans).map(({ line, text, tasks }) => ({
      line,
      kind: "phrase" as const,
      text,
      tasks,
    })),
  ];
}

/** The rows: a header, then a block a kept state with a line a hit. */
export function nameRows(events: readonly LogEvent[], states: string, only: string | null = null): string[] {
  const { loaded, wantedWords, wantedSpans } = loadKept(states, only);
  const known = tokensOf(events, wantedWords, wantedSpans);
  const { held, released } = taskSets(events);
  const heldNames = new Set(held.map((version) => known.versions.get(version)));
  const practised = new Set(released.map((version) => known.versions.get(version)));
  const marked = (task: string) =>
    `${task} (${practised.has(task) ? "practice" : heldNames.has(task) ? "held out" : "neither set"})`;
  const byContent = new Map<string, Omit<Hit, "path">[]>();
  const scanned = loaded.map(({ digest, files, entries }) => ({
    digest,
    files,
    hits: entries.flatMap(([path, whole]) => {
      const cached = byContent.get(whole) ?? scanText(whole, known);
      byContent.set(whole, cached);
      return cached.map((hit) => ({ path, ...hit }));
    }),
  }));
  const holders = new Map<string, number>();
  for (const { hits } of scanned) {
    for (const text of new Set(hits.map((hit) => hit.text))) holders.set(text, (holders.get(text) ?? 0) + 1);
  }
  const ids = [...known.tokens.values()].filter((token) => token.kind === "id").length;
  return [
    `names: where the files each kept harness wrote name a task, word by word, or copy its public input; looked for ${String(ids)} task ids, ${String(known.versions.size)} version prefixes, ${String(known.familyRules.length)} families, plus rare public-input identifiers and ${String(QUOTE_WORDS)}-word spans across ${String(loaded.length)} kept harnesses`,
    "harness  path:line  kind  length  kept versions holding it  public inputs holding it  tasks",
    ...(loaded.length === 0 ? [`no kept harness under ${states}`] : []),
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
