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
import { addedLines, gitMaybe, mainTree } from "#src/meta/git.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { availableParallelism } from "#src/meta/os.ts";
import { dirname, join, resolve } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { within } from "#tools/runtime/gate.ts";
import { type Job, mutantsOf, resultsOf, runMutants, verdictOf } from "./mutate.ts";

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

const TRANSPILER = new Bun.Transpiler({ loader: "ts" });

const slug = (owner: string) => owner.replaceAll("/", "_").replace(/\.ts$/u, "");
const stem = (owner: string, base: string | null) =>
  base === null ? slug(owner) : `${slug(owner)}.diff-${base.slice(0, 9)}`;

function timingsOf(tree: string): ReadonlyMap<string, number> {
  try {
    const local = join(tree, "test", ".test-timings.json");
    const path = existsSync(local) ? local : join(mainTree(tree), "test", ".test-timings.json");
    const files = asRecord(asRecord(capturedJsonParse(readFileSync(path, "utf8")))?.files) ?? {};
    return new Map(
      Object.entries(files).flatMap(([file, ms]) => (isNumber(ms) ? [[file, ms] as const] : [])),
    );
  } catch {
    return new Map();
  }
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

function testIndex(tree: string, depth: number) {
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
  const reachable = reachAt(depth);
  const direct = depth === 1 ? reachable : reachAt(1);
  let transitive: Map<string, Set<string>> | null = null;
  const code = new Map(tests.map((test) => [test, runtimeText(tree, test)] as const));
  const named = (test: string, path: string) =>
    [path, joinedPath(path)].some((needle) => code.get(test)?.includes(needle) === true);
  const timings = timingsOf(tree);
  const order = (owner: string) => (a: string, b: string) => {
    const nearer = Number(direct.get(a)?.has(owner) !== true) - Number(direct.get(b)?.has(owner) !== true);
    const [ta, tb] = [timings.get(a), timings.get(b)];
    if (nearer !== 0) return nearer;
    if (ta !== undefined && tb !== undefined) return ta - tb;
    if (ta !== undefined || tb !== undefined) return ta === undefined ? 1 : -1;
    return statSync(join(tree, a)).size - statSync(join(tree, b)).size;
  };
  return (owner: string): string[] => {
    let matched = tests.filter((test) => reachable.get(test)?.has(owner) === true || named(test, owner));
    if (matched.length === 0 && depth < Number.POSITIVE_INFINITY) {
      transitive ??= reachAt(Number.POSITIVE_INFINITY);
      matched = tests.filter((test) => transitive?.get(test)?.has(owner) === true);
    }
    const parent = dirname(owner);
    if (matched.length === 0 && parent.includes("/")) {
      matched = tests.filter((test) => code.get(test)?.includes(joinedPath(parent)) === true);
    }
    return [...new Set([...matched.toSorted(order(owner)), ...(OWNERS.get(owner) ?? [])])].filter((path) =>
      existsSync(join(tree, path)),
    );
  };
}

function diffTargets(tree: string, base: string, head: string): Map<string, Set<string>> | null {
  let changed: Map<string, Set<number>>;
  try {
    changed = addedLines(tree, base, head, "--", "src", "tools");
  } catch {
    return null;
  }
  return new Map(
    [...changed].flatMap(([file, lines]) => {
      const source =
        file.endsWith(".ts") &&
        !file.endsWith(".test.ts") &&
        statSync(join(tree, file), { throwIfNoEntry: false })?.isFile() === true;
      if (!source) return [];
      const ids = mutantsOf(tree, file).flatMap(({ id, line }) => (lines.has(line) ? [id] : []));
      return ids.length === 0 ? [] : [[file, new Set(ids)] as const];
    }),
  );
}

export function planOf(tree: string, here: string, head: string, wanted: string | null) {
  const targets = wanted === null ? null : diffTargets(tree, wanted, head);
  if (wanted !== null && targets === null) {
    console.error(`nightly: base ${wanted.slice(0, 9)} is unreachable; running full owner sweep`);
  }
  const base = targets === null ? null : wanted;
  const owners =
    targets === null
      ? [...OWNERS.keys()].filter((owner) => existsSync(join(tree, owner)))
      : [...targets.keys()];
  const suitesFor = testIndex(tree, targets === null ? Number.POSITIVE_INFINITY : 1);
  const jobs: Job[] = [];
  const untested: [string, number][] = [];
  for (const owner of owners) {
    const ids = targets?.get(owner);
    const suites = suitesFor(owner);
    if (suites.length === 0) {
      untested.push([owner, ids?.size ?? mutantsOf(tree, owner).length]);
      continue;
    }
    const prefix = join(here, stem(owner, base));
    const named = Object.fromEntries(
      suites.map((path) => [path.replaceAll(/^test\/|\.test\.ts$/gu, ""), [path]]),
    );
    writeFileSync(`${prefix}.suites.json`, JSON.stringify(named));
    if (ids !== undefined) writeFileSync(`${prefix}.ids.txt`, `${[...ids].join("\n")}\n`);
    jobs.push({ file: owner, out: `${prefix}.jsonl`, suites: named, ...keyIfDefined("ids", ids) });
  }
  return { base, jobs, untested };
}

function deadlineOf(clock: string | null): number {
  if (clock === null) return Number.POSITIVE_INFINITY;
  const [hours = Number.NaN, minutes = Number.NaN] = clock.split(":").map(Number);
  const at = new Date();
  at.setHours(hours, minutes, 0, 0);
  if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
  return at.getTime();
}

type Rows = ReturnType<typeof resultsOf>;

function survivorsOf(tree: string, commit: string, rows: Rows) {
  const sources = new Map<string, string[]>();
  return rows.flatMap((row) => {
    if (verdictOf(row) !== "survived") return [];
    if (!sources.has(row.file)) {
      sources.set(row.file, (gitMaybe(tree, "show", `${commit}:${row.file}`) ?? "").split("\n"));
    }
    const source = sources.get(row.file)?.[row.line - 1]?.trim() ?? "";
    const what = `${row.label}  ${source}`;
    return [{ id: row.id, key: `${row.file}  ${what}`, line: `${row.file}:${String(row.line)}  ${what}` }];
  });
}

interface Pass {
  readonly tree: string;
  readonly state: string;
  readonly here: string;
  readonly head: string;
  readonly base: string | null;
  readonly prevFull: string | null;
  readonly jobs: readonly Job[];
  readonly untested: readonly (readonly [string, number])[];
  readonly unfinished: readonly string[];
}

function writeReport({ tree, state, here, head, base, prevFull, jobs, untested, unfinished }: Pass) {
  const now = jobs.flatMap(({ out }) => resultsOf(out));
  const tally = (rows: Rows, kind: string) => rows.filter((row) => verdictOf(row) === kind).length;
  const table = jobs.map(({ file, out }) => {
    const rows = resultsOf(out);
    return [`\`${file}\``, ...["killed", "survived", "unread"].map((kind) => String(tally(rows, kind)))];
  });
  const left = new Map<string, number>();
  if (base === null && prevFull !== null) {
    const before = jobs.flatMap(({ file }) => resultsOf(join(state, prevFull, `${slug(file)}.jsonl`)));
    for (const { key } of survivorsOf(tree, prevFull, before)) left.set(key, (left.get(key) ?? 0) + 1);
  }
  const added =
    base === null && prevFull === null
      ? []
      : Object.values(Object.groupBy(survivorsOf(tree, head, now), ({ key }) => key)).flatMap((group = []) =>
          group.slice(left.get(group[0]?.key ?? "") ?? 0),
        );
  const recheck = [
    ...added.map(({ id }) => id),
    ...now.filter((row) => verdictOf(row) === "unread").map(({ id }) => id),
  ];
  const idsFile = join(
    here,
    base === null ? "survivors.ids.txt" : `survivors.diff-${base.slice(0, 9)}.ids.txt`,
  );
  if (recheck.length > 0) writeFileSync(idsFile, `${recheck.join("\n")}\n`);
  else rmSync(idsFile, { force: true });
  const since = base ?? prevFull;
  const lines = [
    base === null
      ? `# Nightly mutation at ${head.slice(0, 9)}`
      : `# Nightly diff mutation at ${head.slice(0, 9)} (since ${base.slice(0, 9)})`,
    "",
    printed(["owner", "killed", "survived", "unread"], table),
    "",
    ...untested.map(([owner, count]) => `No nearby test: \`${owner}\` (${String(count)} mutants)`),
    ...unfinished.map(
      (owner) =>
        `Unfinished, resumes next run: \`${owner}\` (deadline, or no place gave a verdict; see the log)`,
    ),
    since === null
      ? "No earlier complete pass to compare."
      : `New survivors since ${since.slice(0, 9)}: ${String(added.length)}`,
    ...(recheck.length > 0 ? [`Recheck IDs (\`mutate.ts run --only\`): \`${idsFile}\``] : []),
    ...added.map(({ line }) => `- \`${line}\``),
  ];
  writeFileSync(join(here, "report.md"), `${lines.join("\n")}\n`);
  return {
    total: now.length,
    survived: tally(now, "survived"),
    added: added.length,
    unread: tally(now, "unread"),
  };
}

function readDone(path: string): { readonly commit: string; readonly full: string } | null {
  try {
    const record = asRecord(capturedJsonParse(readFileSync(path, "utf8")));
    const commit = record?.commit;
    if (!isString(commit)) return null;
    return { commit, full: isString(record?.full) ? record.full : commit };
  } catch {
    return null;
  }
}

async function nightly(args: CommandArgs, rawTree: string): Promise<number> {
  const tree = realpathSync(resolve(rawTree));
  const state = args.required("state");
  const head = gitMaybe(tree, "rev-parse", "HEAD") ?? args.die(`${tree} is not a git tree`);
  const pinned = args.value("diff");
  if (pinned !== null && args.flag("full")) args.die("--diff and --full cannot be combined");
  const resolved =
    pinned === null || pinned.startsWith("-")
      ? null
      : gitMaybe(tree, "rev-parse", "--verify", `${pinned}^{commit}`);
  if (pinned !== null && resolved === null) args.die(`--diff ${pinned}: not a reachable commit in ${tree}`);
  const donePath = join(state, "done.json");
  const done = readDone(donePath);
  const stored = done === null ? null : done.commit;
  const fallback =
    stored === null || gitMaybe(tree, "merge-base", "--is-ancestor", stored, head) !== null
      ? stored
      : (gitMaybe(tree, "merge-base", "origin/main", head) ?? stored);
  const here = join(state, head);
  mkdirSync(here, { recursive: true });
  const reportPath = join(here, "report.md");
  const { base, jobs, untested } = planOf(
    tree,
    here,
    head,
    args.flag("full") ? null : (resolved ?? fallback),
  );
  if (base !== null && jobs.length + untested.length === 0 && pinned === null && stored === head) {
    console.log(`${head.slice(0, 9)}: 0 diff mutants since ${base.slice(0, 9)}; ${reportPath}`);
    return 0;
  }
  const deadline = deadlineOf(args.value("until"));
  let finished = jobs.length === 0;
  if (!finished && Date.now() < deadline) {
    try {
      const { unrun } = await runMutants(tree, jobs, {
        fleet: true,
        jobs: undefined,
        local: Math.max(2, Math.floor(availableParallelism() / 2)),
        stopAtKill: true,
        seconds: args.int("timeout") ?? 900,
        deadline,
        clones: join(state, "clone"),
      });
      finished = unrun === 0;
    } catch (error) {
      console.error(`nightly: ${errorMessage(error)}`);
    }
  }
  const unfinished = finished
    ? []
    : jobs.flatMap(({ file, out, ids }) =>
        resultsOf(out).length < (ids?.size ?? mutantsOf(tree, file).length) ? [file] : [],
      );
  const complete = unfinished.length === 0;
  const prevFull = done?.full ?? null;
  const stats = writeReport({ tree, state, here, head, base, prevFull, jobs, untested, unfinished });
  if (complete && stats.unread === 0 && pinned === null) {
    writeFileSync(
      donePath,
      JSON.stringify({ commit: head, full: base === null ? head : (prevFull ?? base) }),
    );
  }
  console.log(
    `${head.slice(0, 9)}: ${String(stats.total)} mutants, ${String(stats.survived)} survived (${String(stats.added)} new), ${String(stats.unread)} unread; ${complete ? "complete" : "resumes next run"}; ${reportPath}`,
  );
  return complete && stats.added === 0 && stats.unread === 0 && (base === null || untested.length === 0)
    ? 0
    : 3;
}

if (import.meta.main) {
  await runCommand(
    {
      name: "nightly",
      usage: "usage: nightly.ts <tree> --state <dir> [--until HH:MM] [--timeout s] [--diff <base>] [--full]",
      options: { state: "text", until: "text", timeout: "int", diff: "text", full: "flag" },
      positionals: 1,
    },
    async (args: CommandArgs) => nightly(args, args.positionals[0] ?? ""),
  );
}
