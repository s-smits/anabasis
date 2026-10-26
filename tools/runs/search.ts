/**
 * Find an old analysis without fetching campaigns or asking machines one by one.
 * `runs search <pattern> [--regex] [--ignore-case] [--host <name>]... [--here]
 * [--in logs|notes|all] [--max <chars>]` searches campaign folders and the main tree's
 * notes and docs. ANA_SEARCH_ROOTS adds private note roots. Each peer runs this script
 * in its configured tree through the runs transport, within its 30-second deadline.
 * Whole matches spill locally when either the line window or the output cap cuts text.
 * Every host searches with rg (`--regex` takes rg's syntax); one installed in ~/.local/bin is found
 * although a plain ssh command leaves that folder off the PATH.
 */
import { existsSync, lstatSync, mkdtempSync, realpathSync } from "#src/meta/filesystem.ts";
import { mainTree } from "#src/meta/git.ts";
import { capturedJsonParse, parseJsonAs } from "#src/meta/json-runtime.ts";
import { isString } from "#src/meta/json-shape.ts";
import { homedir, tmpdir } from "#src/meta/os.ts";
import { dirname, join, resolve } from "#src/meta/path.ts";
import { capturedSpawn, parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { type Host, hostsOf } from "./host-config.ts";
import { askedScript } from "./hosts.ts";
import { everyRun, isCampaign } from "./registry.ts";

interface Match {
  readonly path: string;
  readonly line: number;
  readonly text: string;
  readonly at: number;
}
interface SearchResult {
  readonly matches: readonly Match[];
}
interface Query {
  readonly pattern: string;
  readonly regex: boolean;
  readonly ignoreCase: boolean;
}
interface Dependencies {
  readonly hosts?: readonly Host[];
  readonly local?: (query: Query, scope: string) => Promise<SearchResult>;
  readonly transport?: typeof askedScript;
  readonly print?: (text: string) => void;
}

const SCRIPT = "tools/runs/search.ts";
const DEADLINE = 30_000;
const EXCLUDED = [
  "node_modules",
  ".git",
  ".env*",
  ".accounts",
  ".ssh",
  ".aws",
  ".gnupg",
  ".kube",
  "*credential*",
  "*secret*",
  "*token*",
  "*password*",
  "*passwd*",
  "*oauth*",
  "auth.json",
  "id_*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.keystore",
  "*.kdbx",
  ".netrc",
  ".npmrc",
  ".bunfig.toml",
];
const EXCLUSION_GLOBS = EXCLUDED.map((pattern) => new Bun.Glob(pattern));
const OPTIONS = {
  regex: { type: "boolean", default: false },
  "ignore-case": { type: "boolean", default: false },
  host: { type: "string", multiple: true },
  here: { type: "boolean", default: false },
  in: { type: "string", default: "all" },
  max: { type: "string", default: "20000" },
} as const;

function permitted(path: string): boolean {
  return !path.split(/[\\/]/).some((part) => EXCLUSION_GLOBS.some((glob) => glob.match(part.toLowerCase())));
}

function checked(query: Query): void {
  if (query.pattern.includes("\n")) throw new Error("search takes a single-line pattern");
}

/** Registry discovery reads names only; rg reads every file. */
function rootsOf(scope: string): string[] {
  const repo = runtimeProcess.cwd();
  const main = mainTree(repo);
  const extra = capturedJsonParse(runtimeProcess.env.ANA_SEARCH_ROOTS ?? "[]");
  if (!Array.isArray(extra) || !extra.every(isString)) {
    throw new Error("ANA_SEARCH_ROOTS takes a JSON list of paths");
  }
  const logs =
    scope === "notes"
      ? []
      : everyRun(repo)
          .filter(isCampaign)
          .map((run) => dirname(run.path));
  const notes = scope === "logs" ? [] : [join(main, "notes"), join(main, "docs"), ...extra];
  return [
    ...new Set(
      [...logs, ...notes].map((path) =>
        resolve(path === "~" ? homedir() : path.replace(/^~\//, `${homedir()}/`)),
      ),
    ),
  ].filter(existsSync);
}

/** rg on the PATH, or a user install in ~/.local/bin, which a plain ssh command leaves off it. */
function rgPath(): string {
  const found = Bun.which("rg") ?? Bun.which("rg", { PATH: join(homedir(), ".local", "bin") });
  if (found === null) throw new Error("rg is not installed on this host");
  return found;
}

/** Whole matching lines, so the controller can keep one complete spill file. */
export async function searchLocal(query: Query, roots: readonly string[]): Promise<SearchResult> {
  checked(query);
  const safePaths = roots.filter(
    (path) => permitted(path) && permitted(realpathSync(path)) && !lstatSync(path).isSymbolicLink(),
  );
  const safeRoots = safePaths.filter(
    (path) => !safePaths.some((parent) => parent !== path && path.startsWith(`${parent}/`)),
  );
  if (safeRoots.length === 0) return { matches: [] };
  const child = capturedSpawn(
    [
      rgPath(),
      "--json",
      "--hidden",
      "--no-ignore",
      "--no-config",
      "--color=never",
      "--crlf",
      ...EXCLUDED.flatMap((glob) => ["--iglob", `!${glob}`]),
      ...(query.regex ? [] : ["--fixed-strings"]),
      ...(query.ignoreCase ? ["--ignore-case"] : []),
      "--",
      query.pattern,
      ...safeRoots,
    ],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: DEADLINE },
  );
  const [output, errors, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0 && code !== 1) throw new Error(errors.trim() || "rg search failed or timed out");
  const matches: Match[] = [];
  for (const row of output.split("\n").filter((line) => line !== "")) {
    const event = parseJsonAs<{
      type: string;
      data: {
        path: { text?: string };
        lines: { text?: string };
        line_number: number;
        submatches: readonly { start: number }[];
      };
    }>(row);
    if (event.type !== "match") continue;
    const { path, lines, line_number: line, submatches } = event.data;
    if (path.text === undefined || lines.text === undefined) throw new Error("rg returned non-UTF-8 text");
    // rg gives the match's offset in bytes; the window is cut in characters.
    const at = Buffer.from(lines.text)
      .subarray(0, submatches[0]?.start ?? 0)
      .toString().length;
    matches.push({ path: path.text, line, text: lines.text.replace(/\r?\n$/, ""), at });
  }
  return { matches };
}

async function display(
  results: readonly { host: string; result?: SearchResult; error?: string }[],
  max: number,
  print: (text: string) => void,
): Promise<void> {
  const whole: string[] = [];
  const shown: string[] = [];
  let characters = 0;
  let shownMatches = 0;
  let cut = false;
  for (const { host, result, error } of results) {
    print(
      `${host}: ${result === undefined ? `search failed (${error ?? "unavailable or timed out"})` : `${String(result.matches.length)} found`}`,
    );
    for (const match of result?.matches ?? []) {
      const prefix = `${host} ${match.path}:${match.line}: `;
      whole.push(`${prefix}${match.text}\n`);
      const start = Math.max(0, match.at - 100);
      const from = match.text.length <= 300 ? 0 : start;
      const window = match.text.length <= 300 ? match.text : match.text.slice(from, from + 298);
      const text = `${from > 0 ? "…" : ""}${window}${from + window.length < match.text.length ? "…" : ""}`;
      const row = `${prefix}${text}\n`;
      cut ||= text !== match.text;
      if (characters + row.length <= max) {
        shown.push(row);
        characters += row.length;
        shownMatches += 1;
      } else cut = true;
    }
  }
  if (shown.length > 0) print(shown.join("").slice(0, -1));
  if (!cut) return;
  const file = join(mkdtempSync(join(tmpdir(), "ana-search-")), "matches.log");
  const full = whole.join("");
  await Bun.write(file, full);
  print(
    `shown ${shownMatches}/${whole.length} matches, ${characters}/${full.length} characters; full output: ${file}`,
  );
}

/** The public verb keeps local and remote searches independent, including failures. */
export async function search(args: readonly string[], dependencies: Dependencies = {}): Promise<void> {
  const { values, positionals } = parseArgs({ args: [...args], options: OPTIONS, allowPositionals: true });
  const [pattern, extra] = positionals;
  const scope = values.in;
  const max = Number(values.max);
  if (pattern === undefined || extra !== undefined || !["logs", "notes", "all"].includes(scope)) {
    throw new Error(
      "usage: runs search <pattern> [--regex] [--ignore-case] [--host <name>]... [--here] [--in logs|notes|all] [--max <chars>]",
    );
  }
  if (!Number.isSafeInteger(max) || max < 1) throw new Error("--max takes a positive integer");
  if (values.here && (values.host?.length ?? 0) > 0) throw new Error("--here cannot be combined with --host");
  const query = { pattern, regex: values.regex, ignoreCase: values["ignore-case"] };
  checked(query);
  const known = dependencies.hosts ?? hostsOf();
  const targets = values.here
    ? []
    : known.filter((host) => values.host === undefined || values.host.includes(host.name));
  for (const name of values.host ?? []) {
    if (!known.some((host) => host.name === name)) throw new Error(`unknown search host: ${name}`);
  }
  const local = dependencies.local ?? ((asked: Query, within: string) => searchLocal(asked, rootsOf(within)));
  const here =
    values.host === undefined
      ? Promise.resolve()
          .then(() => local(query, scope))
          .then(
            (result) => ({ host: "here", result }),
            (error: unknown) => ({ host: "here", error: errorMessage(error) }),
          )
      : Promise.resolve(null);
  const remoteArgs = [
    "--in",
    scope,
    ...(query.regex ? ["--regex"] : []),
    ...(query.ignoreCase ? ["--ignore-case"] : []),
    "--",
    pattern,
  ];
  const away = Promise.all(
    targets.map(async (host) => {
      try {
        const [reply] = await (dependencies.transport ?? askedScript)(
          SCRIPT,
          remoteArgs,
          [host],
          "configured",
        );
        if (reply?.lines === null || reply?.lines === undefined) return { host: host.name };
        return { host: host.name, result: parseJsonAs<SearchResult>(reply.lines.join("\n")) };
      } catch (error) {
        return { host: host.name, error: errorMessage(error) };
      }
    }),
  );
  const [own, peers] = await Promise.all([here, away]);
  await display([...(own === null ? [] : [own]), ...peers], max, dependencies.print ?? console.log);
}

// The transport runs this entrypoint once in the host's own tree, with no recursive fan-out.
if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: OPTIONS,
    allowPositionals: true,
  });
  const pattern = positionals[0];
  if (pattern === undefined) throw new Error("search needs a pattern");
  console.log(
    JSON.stringify(
      await searchLocal(
        { pattern, regex: values.regex, ignoreCase: values["ignore-case"] },
        rootsOf(values.in),
      ),
    ),
  );
}
