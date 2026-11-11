/**
 * Where a kept harness's own files name a task: its id, its version's prefix, its family, or a rare
 * identifier from its public input, word by word, each hit with the tasks it names and whether each
 * was practice or held out.
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
 * looks like an identifier (a digit, an inner `-`, `_` or `.`, or a capital past its first letter), has
 * at least `MIN_TOKEN` characters and stands in at most `RARE` tasks' public inputs; a plain word is
 * left out and the header says how many were. A public token's own text is not printed, its place is.
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
const IDENTIFIER = /\d|[-_.:]|^.+\p{Lu}/u;
const HEX = /^[0-9a-f]{8,64}$/;

type Kind = "id" | "family" | "public" | "version";

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
  return { tokens, families, publics, versions, plain };
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
    for (const [at, text] of readFileSync(file, "utf8").split("\n").entries()) {
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
    `names: where the files each kept harness wrote name a task, word by word; looked for ${count("id")} task ids, ${String(known.versions.size)} version prefixes, ${String(known.families.size)} families and ${count("public")} identifiers of public inputs (${String(known.plain)} plain words left out)`,
    "harness  path:line  kind  length  kept versions holding it  public inputs holding it  tasks",
    ...(kept.length === 0 ? [`no kept harness under ${states}`] : []),
    ...scanned.flatMap(({ digest, files, hits }) => [
      `${digest.slice(0, 8)}  ${String(files)} written files, ${String(hits.length)} hits`,
      ...hits.map(
        (hit) =>
          `  ${hit.path}:${String(hit.line)}  ${hit.kind}${hit.kind === "public" ? "" : ` ${hit.text}`}  ${String(hit.text.length)}  ${String(versionsHolding(hit.text))}  ${String(known.publics.get(hit.text)?.size ?? 0)}  ${hit.tasks.map(marked).join(", ")}`,
      ),
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
