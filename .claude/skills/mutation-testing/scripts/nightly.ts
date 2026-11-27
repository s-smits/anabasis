#!/usr/bin/env bun
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { printed } from "#skills/main/print.ts";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { changedLinesInDiff, gitMaybe, mainTree } from "#src/meta/git.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { keyIfNotNull } from "#src/meta/optional-key.ts";
import { availableParallelism } from "#src/meta/os.ts";
import { dirname, join, resolve } from "#src/meta/path.ts";
import { within } from "#tools/runtime/gate.ts";
import { mutantsOf } from "./mutate.ts";

const CAMPAIGN_SUITES = ["test/harness-builder.test.ts", "test/campaign-kill.test.ts", "test/climb.test.ts"];

const OWNERS = new Map<string, readonly string[]>([
  ["src/kernel/compare.ts", []],
  ["src/kernel/reports.ts", []],
  ["src/kernel/size.ts", []],
  ["src/kernel/solve.ts", []],
  ["src/campaign/scheduler.ts", []],
  ["src/campaign/admission.ts", []],
  ["src/campaign/climb.ts", []],
  ["src/builder/past.ts", []],
  ["src/audit/agreement.ts", []],
  ["tools/campaign/campaign-actions.ts", CAMPAIGN_SUITES],
  ["tools/campaign/campaign-terms.ts", CAMPAIGN_SUITES],
  ["tools/campaign/campaign-status.ts", CAMPAIGN_SUITES],
  ["tools/campaign/harness-builder.ts", []],
]);

interface Row {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly label: string;
  readonly killed: Readonly<Record<string, boolean | null>>;
}

interface Done {
  readonly commit: string;
  readonly full: string;
}

const MUTATE = join(import.meta.dir, "mutate.ts");
const DIFF_ROOTS = ["src", "tools"] as const;
const TRANSPILER = new Bun.Transpiler({ loader: "ts" });

const slug = (owner: string) => owner.replaceAll("/", "_").replace(/\.ts$/, "");
const stem = (owner: string, diffBase: string | null) =>
  diffBase === null ? slug(owner) : `${slug(owner)}.diff-${diffBase.slice(0, 9)}`;

function timingsPath(tree: string): string | null {
  const local = join(tree, "test", ".test-timings.json");
  if (existsSync(local)) return local;
  try {
    const shared = join(mainTree(tree), "test", ".test-timings.json");
    return existsSync(shared) ? shared : null;
  } catch {
    return null;
  }
}

function timingsOf(tree: string): ReadonlyMap<string, number> {
  const path = timingsPath(tree);
  if (path === null) return new Map();
  let parsed: unknown;
  try {
    parsed = capturedJsonParse(readFileSync(path, "utf8"));
  } catch {
    return new Map();
  }
  const files = asRecord(asRecord(parsed)?.files);
  if (files === null) return new Map();
  return new Map(Object.entries(files).flatMap(([file, ms]) => (isNumber(ms) ? [[file, ms] as const] : [])));
}

function runtimeText(tree: string, rel: string): string {
  try {
    return TRANSPILER.transformSync(readFileSync(join(tree, rel), "utf8"));
  } catch {
    return "";
  }
}

const joinedPath = (path: string): string =>
  path
    .split("/")
    .map((part) => JSON.stringify(part))
    .join(", ");

const pathMentioned = (code: string, path: string): boolean =>
  code.includes(path) || code.includes(joinedPath(path));

function testIndex(tree: string) {
  const tests = readdirSync(join(tree, "test"))
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => `test/${name}`);
  const reachAt = (limit: number) =>
    new Map(
      tests.map((test) => {
        const seen = within(tree, test, limit);
        seen.delete(test);
        return [test, seen] as const;
      }),
    );
  const reachable = reachAt(Number.POSITIVE_INFINITY);
  const direct = reachAt(1);
  const transformed = new Map(tests.map((test) => [test, runtimeText(tree, test)] as const));
  const timings = timingsOf(tree);
  const compareSuites =
    (owner: string) =>
    (a: string, b: string): number => {
      const directDiff =
        (direct.get(a)?.has(owner) === true ? 0 : 1) - (direct.get(b)?.has(owner) === true ? 0 : 1);
      if (directDiff !== 0) return directDiff;
      const [ta, tb] = [timings.get(a), timings.get(b)];
      if (ta !== undefined && tb !== undefined) return ta - tb;
      if (ta !== undefined || tb !== undefined) return ta === undefined ? 1 : -1;
      return statSync(join(tree, a)).size - statSync(join(tree, b)).size;
    };
  return (owner: string): string[] => {
    let matched = tests.filter(
      (path) => reachable.get(path)?.has(owner) === true || pathMentioned(transformed.get(path) ?? "", owner),
    );
    if (matched.length === 0) {
      const parent = dirname(owner);
      if (parent !== "." && parent.includes("/")) {
        const needle = joinedPath(parent);
        matched = tests.filter((path) => (transformed.get(path) ?? "").includes(needle));
      }
    }
    return [...new Set([...matched.toSorted(compareSuites(owner)), ...(OWNERS.get(owner) ?? [])])].filter(
      (path) => existsSync(join(tree, path)),
    );
  };
}

const rowsOf = (path: string): Row[] =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map(
          // SAFETY: every line is one mutate.ts appended, a `Row`.
          (line) => JSON.parse(line) as Row,
        )
    : [];

const verdictOf = ({ killed }: Row) => {
  const verdicts = Object.values(killed);
  if (verdicts.includes(true)) return "killed";
  return verdicts.length > 0 && verdicts.every((one) => one === false) ? "survived" : "unread";
};

function deadlineOf(clock: string | null): string | null {
  if (clock === null) return null;
  const [hours = Number.NaN, minutes = Number.NaN] = clock.split(":").map(Number);
  const at = new Date();
  at.setHours(hours, minutes, 0, 0);
  if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
  return at.toISOString();
}

interface Survivor {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly label: string;
  readonly source: string;
  readonly key: string;
}

function survivorEntries(tree: string, commit: string, rows: readonly Row[]): Survivor[] {
  const sources = new Map<string, string[]>();
  return rows.flatMap((row) => {
    if (verdictOf(row) !== "survived") return [];
    if (!sources.has(row.file)) {
      sources.set(row.file, (gitMaybe(tree, "show", `${commit}:${row.file}`) ?? "").split("\n"));
    }
    const source = sources.get(row.file)?.[row.line - 1]?.trim() ?? "";
    const key = `${row.file}  ${row.label}  ${source}`;
    return [{ id: row.id, file: row.file, line: row.line, label: row.label, source, key }];
  });
}

const ANSWERED = ".claude/skills/mutation-testing/answered-survivors.tsv";
const ANSWER_KINDS = new Set(["equivalent", "presentation"]);

function answeredKeys(tree: string): Set<string> {
  const path = join(tree, ANSWERED);
  if (!existsSync(path)) return new Set();
  const rows = readFileSync(path, "utf8").split("\n").slice(1).filter(Boolean);
  return new Set(
    rows.map((row) => {
      const [file = "", label = "", source = "", kind = "", reason = ""] = row.split("\t");
      if (!ANSWER_KINDS.has(kind) || reason.trim().split(/\s+/u).length < 3) {
        throw new Error(
          `${ANSWERED}: "${row}" needs a kind (equivalent or presentation) and a reason a reviewer can check`,
        );
      }
      return `${file}  ${label}  ${source}`;
    }),
  );
}

function freshSurvivors(now: readonly Survivor[], before: readonly Survivor[]): Survivor[] {
  const beforeKeys = before.map(({ key }) => key);
  const count = (keys: readonly string[], key: string) => keys.filter((one) => one === key).length;
  return now.filter(
    (entry, at) =>
      count(
        now.slice(0, at).map(({ key }) => key),
        entry.key,
      ) >= count(beforeKeys, entry.key),
  );
}

function formatSurvivorClusters(entries: readonly Survivor[]): string[] {
  const groups = [...Map.groupBy(entries, ({ file, line }) => `${file}:${String(line)}`).values()].toSorted(
    (a, b) =>
      b.length - a.length ||
      (a[0]?.file ?? "").localeCompare(b[0]?.file ?? "") ||
      (a[0]?.line ?? 0) - (b[0]?.line ?? 0),
  );
  return groups.flatMap((group) => {
    const first = group[0];
    if (first === undefined) return [];
    const counts = new Map<string, number>();
    for (const { label } of group) counts.set(label, (counts.get(label) ?? 0) + 1);
    const ops = [...counts].map(([label, n]) => (n > 1 ? `${label} x${String(n)}` : label)).join(", ");
    return [`- \`${first.file}:${String(first.line)}  [${String(group.length)}: ${ops}]  ${first.source}\``];
  });
}

function readDone(path: string): Done | null {
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = capturedJsonParse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  const commit = record?.commit;
  if (!isString(commit)) return null;
  return { commit, full: isString(record?.full) ? record.full : commit };
}

function diffTargets(
  tree: string,
  base: string,
  head: string,
): readonly (readonly [string, string[]])[] | null {
  const raw = gitMaybe(
    tree,
    "-c",
    "core.quotePath=false",
    "diff",
    "--unified=0",
    "--no-color",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--no-ext-diff",
    base,
    head,
    "--",
    ...DIFF_ROOTS,
  );
  if (raw === null) return null;
  return [...changedLinesInDiff(raw)].flatMap(([file, lines]) => {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts") || lines.size === 0) return [];
    const full = join(tree, file);
    if (!existsSync(full) || !statSync(full).isFile()) return [];
    const ids = mutantsOf(tree, file)
      .filter((mutant) => lines.has(mutant.line))
      .map((mutant) => mutant.id);
    return ids.length === 0 ? [] : ([[file, ids]] as const);
  });
}

interface OwnerJob {
  readonly owner: string;
  readonly out: string;
  readonly suites: Record<string, readonly string[]>;
  readonly ids: readonly string[] | null;
}

async function runPlan(opts: {
  readonly tree: string;
  readonly state: string;
  readonly here: string;
  readonly jobs: readonly OwnerJob[];
  readonly timeout: number;
  readonly until: string | null;
}): Promise<boolean> {
  const { tree, state, here, jobs, timeout, until } = opts;
  if (jobs.length === 0 || (until !== null && Date.now() >= Date.parse(until))) return jobs.length === 0;
  const planPath = join(here, "plan.json");
  writeFileSync(
    planPath,
    JSON.stringify(
      jobs.map(({ owner, out, suites, ids }) => ({
        file: owner,
        out,
        suites,
        ...keyIfNotNull("ids", ids),
      })),
    ),
  );
  const localSlots = Math.max(2, Math.floor(availableParallelism() / 2));
  const command = [
    MUTATE,
    "run",
    tree,
    "--plan",
    planPath,
    "--fleet",
    "--local",
    String(localSlots),
    "--batch",
    "24",
    "--prune",
    "--cov-cache",
    join(here, "cov"),
    "--stop-at-kill",
    "--timeout",
    String(timeout),
    "--clones",
    join(state, "clone"),
    ...(until === null ? [] : ["--until", until]),
  ];
  const run = Bun.spawn(["bun", ...command], { stdout: "inherit", stderr: "inherit" });
  return (await run.exited) === 0;
}

function writeReport(opts: {
  readonly tree: string;
  readonly state: string;
  readonly here: string;
  readonly head: string;
  readonly diffBase: string | null;
  readonly prevFull: string | null;
  readonly owners: readonly string[];
  readonly untested: readonly (readonly [string, number])[];
  readonly unfinished: readonly string[];
}): { readonly total: number; readonly survived: number; readonly added: number; readonly unread: number } {
  const { tree, state, here, head, diffBase, prevFull, owners, untested, unfinished } = opts;
  const diffMode = diffBase !== null;
  const heading = diffMode
    ? `# Nightly diff mutation at ${head.slice(0, 9)} (since ${diffBase.slice(0, 9)})`
    : `# Nightly mutation at ${head.slice(0, 9)}`;
  const now: Row[] = [];
  const before: Row[] = [];
  const tableRows: string[][] = [];
  for (const owner of owners) {
    const rows = rowsOf(join(here, `${stem(owner, diffBase)}.jsonl`));
    now.push(...rows);
    if (!diffMode && prevFull !== null) before.push(...rowsOf(join(state, prevFull, `${slug(owner)}.jsonl`)));
    const count = (kind: string) => String(rows.filter((row) => verdictOf(row) === kind).length);
    tableRows.push([`\`${owner}\``, count("killed"), count("survived"), count("unread")]);
  }
  const lines = [heading, "", printed(["owner", "killed", "survived", "unread"], tableRows)];
  const answered = answeredKeys(tree);
  const current = survivorEntries(tree, head, now);
  const added = (
    diffMode
      ? current
      : prevFull === null
        ? []
        : freshSurvivors(current, survivorEntries(tree, prevFull, before))
  ).filter(({ key }) => !answered.has(key));
  const live = new Set(current.map(({ key }) => key));
  const stale = diffMode
    ? []
    : [...answered].filter((key) => owners.some((owner) => key.startsWith(`${owner}  `)) && !live.has(key));
  const clusters = formatSurvivorClusters(added);
  const recheckIds = [
    ...added.map(({ id }) => id),
    ...now.filter((row) => verdictOf(row) === "unread").map(({ id }) => id),
  ];
  const idsFile = join(
    here,
    diffBase === null ? "survivors.ids.txt" : `survivors.diff-${diffBase.slice(0, 9)}.ids.txt`,
  );
  if (recheckIds.length > 0) writeFileSync(idsFile, `${recheckIds.join("\n")}\n`);
  else rmSync(idsFile, { force: true });
  const summary = diffMode
    ? `Diff survivors since ${diffBase.slice(0, 9)}: ${String(added.length)} across ${String(clusters.length)} line(s)`
    : prevFull === null
      ? "No earlier complete pass to compare."
      : `New survivors since ${prevFull.slice(0, 9)}: ${String(added.length)} across ${String(clusters.length)} line(s)`;
  lines.push(
    "",
    ...untested.map(([owner, count]) => `No nearby test: \`${owner}\` (${String(count)} mutants)`),
    ...unfinished.map(
      (owner) =>
        `Unfinished, resumes next run: \`${owner}\` (deadline, or a suite failed unmutated; see the log)`,
    ),
    summary,
    ...(answered.size > 0 ? [`Answered in \`${ANSWERED}\`: ${String(answered.size)}`] : []),
    ...stale.map((key) => `Stale answer, no such survivor now (delete the row): \`${key}\``),
    ...(recheckIds.length > 0 ? [`Recheck IDs (\`mutate.ts run --only\`): \`${idsFile}\``] : []),
    ...clusters,
  );
  writeFileSync(join(here, "report.md"), `${lines.join("\n")}\n`);
  const tally = (kind: string) => now.filter((row) => verdictOf(row) === kind).length;
  return { total: now.length, survived: tally("survived"), added: added.length, unread: tally("unread") };
}

function defaultDiffBase(tree: string, head: string, stored: string | undefined): string | null {
  if (stored === undefined) return null;
  if (gitMaybe(tree, "merge-base", "--is-ancestor", stored, head) !== null) return stored;
  return gitMaybe(tree, "merge-base", "origin/main", head) ?? stored;
}

async function nightly(args: CommandArgs, rawTree: string): Promise<number> {
  const tree = realpathSync(resolve(rawTree));
  const state = args.required("state");
  const head = gitMaybe(tree, "rev-parse", "HEAD") ?? args.die(`${tree} is not a git tree`);
  const diffFlag = args.value("diff");
  if (diffFlag !== null && args.flag("full")) args.die("--diff and --full cannot be combined");
  const resolvedFlag =
    diffFlag === null || diffFlag.startsWith("-")
      ? null
      : gitMaybe(tree, "rev-parse", "--verify", `${diffFlag}^{commit}`);
  if (diffFlag !== null && resolvedFlag === null) {
    args.die(`--diff ${diffFlag}: not a reachable commit in ${tree}`);
  }
  const donePath = join(state, "done.json");
  const done = readDone(donePath);
  const requestedBase = args.flag("full")
    ? null
    : (resolvedFlag ?? defaultDiffBase(tree, head, done?.commit));
  const targets = requestedBase === null ? null : diffTargets(tree, requestedBase, head);
  if (diffFlag !== null && targets === null) {
    args.die(`--diff ${diffFlag}: not a reachable commit in ${tree}`);
  }
  if (requestedBase !== null && targets === null) {
    console.error(
      `nightly: stored base ${requestedBase.slice(0, 9)} is unreachable; running full owner sweep`,
    );
  }
  const diffBase = targets === null ? null : requestedBase;
  const diffMode = diffBase !== null && targets !== null;
  const here = join(state, head);
  mkdirSync(here, { recursive: true });
  const reportPath = join(here, "report.md");
  if (diffBase !== null && targets?.length === 0 && diffFlag === null && done?.commit === head) {
    console.log(`${head.slice(0, 9)}: 0 diff mutants since ${diffBase.slice(0, 9)}; ${reportPath}`);
    return 0;
  }
  const until = deadlineOf(args.value("until"));
  const timeout = args.int("timeout") ?? 900;
  const suitesFor = testIndex(tree);
  const unfinished: string[] = [];
  const untested: [string, number][] = [];
  const owners =
    diffBase !== null && targets !== null
      ? targets.map(([owner]) => owner)
      : [...OWNERS.keys()].filter((owner) => existsSync(join(tree, owner)));
  const prevFull = done?.full ?? null;
  const diffIds = targets === null ? new Map<string, string[]>() : new Map(targets);
  const jobs: OwnerJob[] = [];
  for (const owner of owners) {
    const suites = suitesFor(owner);
    if (suites.length === 0) {
      untested.push([owner, diffMode ? (diffIds.get(owner)?.length ?? 0) : mutantsOf(tree, owner).length]);
      continue;
    }
    const prefix = stem(owner, diffBase);
    const suiteMap = Object.fromEntries(
      suites.map((path) => [path.replace(/^test\//u, "").replace(/\.test\.ts$/u, ""), [path]] as const),
    );
    writeFileSync(join(here, `${prefix}.suites.json`), JSON.stringify(suiteMap));
    const ids = diffMode ? (diffIds.get(owner) ?? []) : null;
    if (ids !== null) writeFileSync(join(here, `${prefix}.ids.txt`), `${ids.join("\n")}\n`);
    jobs.push({ owner, out: join(here, `${prefix}.jsonl`), suites: suiteMap, ids });
  }
  const ok = await runPlan({ tree, state, here, jobs, timeout, until });
  if (!ok) {
    for (const job of jobs) {
      const expected = job.ids?.length ?? mutantsOf(tree, job.owner).length;
      if (rowsOf(job.out).length < expected) unfinished.push(job.owner);
    }
  }
  const complete = unfinished.length === 0;
  const stats = writeReport({
    tree,
    state,
    here,
    head,
    diffBase,
    prevFull,
    owners,
    untested,
    unfinished,
  });
  if (complete && stats.unread === 0 && diffFlag === null) {
    writeFileSync(
      donePath,
      JSON.stringify({ commit: head, full: diffMode ? (done?.full ?? diffBase) : head }),
    );
  }
  console.log(
    `${head.slice(0, 9)}: ${String(stats.total)} mutants, ${String(stats.survived)} survived (${String(stats.added)} new), ${String(stats.unread)} unread; ${complete ? "complete" : "resumes next run"}; ${reportPath}`,
  );
  return complete && stats.added === 0 && stats.unread === 0 && (!diffMode || untested.length === 0) ? 0 : 3;
}

if (import.meta.main) {
  await runCommand(
    {
      name: "nightly",
      usage: [
        "usage: nightly.ts <tree> --state <dir> [--until HH:MM] [--timeout s] [--diff <base>] [--full]",
        "After a complete baseline in <dir>, mutates only changed lines under src/ and tools/",
        "since the previous complete pass (or --diff <base>); --full (and the first pass) sweeps all",
        "high-importance owners. Exits 3 when survivors remain or the pass must resume.",
      ].join("\n"),
      options: { state: "text", until: "text", timeout: "int", diff: "text", full: "flag" },
      positionals: 1,
    },
    async (args: CommandArgs) => nightly(args, args.positionals[0] ?? ""),
  );
}
