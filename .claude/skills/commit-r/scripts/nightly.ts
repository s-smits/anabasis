#!/usr/bin/env bun
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { gitMaybe } from "#src/meta/git.ts";
import { join } from "#src/meta/path.ts";

const BOUNDED = [
  "test/compare-exhaustive.test.ts",
  "test/decide-explore.test.ts",
  "test/pairs-property.test.ts",
  "test/wall-practice.test.ts",
  "test/wall-held-out.test.ts",
];

const OWNERS = new Map<string, readonly string[]>([
  ["src/kernel/compare.ts", []],
  ["src/kernel/reports.ts", []],
  ["src/kernel/size.ts", []],
  ["src/kernel/solve.ts", []],
  ["src/campaign/decide.ts", []],
  ["src/campaign/admission.ts", []],
  ["src/campaign/climb.ts", []],
  ["src/builder/past.ts", []],
  ["src/audit/agreement.ts", []],
  [
    "tools/d2/campaign-actions.ts",
    ["test/harness-builder.test.ts", "test/campaign-kill.test.ts", "test/climb.test.ts"],
  ],
  ["tools/d2/harness-builder.ts", []],
]);

interface Row {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly label: string;
  readonly killed: Readonly<Record<string, boolean | null>>;
}

const MUTATE = join(import.meta.dir, "mutate.ts");

const slug = (owner: string) => owner.replaceAll("/", "_").replace(/\.ts$/, "");

function suitesOf(tree: string, owner: string): string[] {
  const tests = readdirSync(join(tree, "test"))
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => `test/${name}`);
  const importers = tests
    .filter((path) => !BOUNDED.includes(path) && readFileSync(join(tree, path), "utf8").includes(owner))
    .toSorted((a, b) => statSync(join(tree, a)).size - statSync(join(tree, b)).size);
  return [...new Set([...BOUNDED, ...importers, ...(OWNERS.get(owner) ?? [])])].filter((path) =>
    existsSync(join(tree, path)),
  );
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
  return verdicts.includes(false) ? "survived" : "unread";
};

function deadlineOf(clock: string | null): string | null {
  if (clock === null) return null;
  const [hours = Number.NaN, minutes = Number.NaN] = clock.split(":").map(Number);
  const at = new Date();
  at.setHours(hours, minutes, 0, 0);
  if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
  return at.toISOString();
}

function survivorKeys(tree: string, commit: string, rows: readonly Row[]): string[] {
  const sources = new Map<string, string[]>();
  return rows.flatMap((row) => {
    if (verdictOf(row) !== "survived") return [];
    if (!sources.has(row.file)) {
      sources.set(row.file, (gitMaybe(tree, "show", `${commit}:${row.file}`) ?? "").split("\n"));
    }
    return [`${row.file}  ${row.label}  ${sources.get(row.file)?.[row.line - 1]?.trim() ?? ""}`];
  });
}

function fresh(now: readonly string[], before: readonly string[]): string[] {
  const count = (keys: readonly string[], key: string) => keys.filter((one) => one === key).length;
  return now.filter((key, at) => count(now.slice(0, at), key) >= count(before, key));
}

async function nightly(args: CommandArgs, tree: string): Promise<number> {
  const state = args.required("state");
  const head = gitMaybe(tree, "rev-parse", "HEAD") ?? args.die(`${tree} is not a git tree`);
  const donePath = join(state, "done.json");
  // SAFETY: done.json is the one this script writes, `{ commit }`.
  const prev = existsSync(donePath)
    ? (JSON.parse(readFileSync(donePath, "utf8")) as { commit: string }).commit
    : null;
  const diff = prev === null || args.flag("full") ? null : gitMaybe(tree, "diff", "--name-only", prev, head);
  const changed = diff === null ? null : new Set(diff.split("\n"));
  const here = join(state, head);
  mkdirSync(here, { recursive: true });
  const until = deadlineOf(args.value("until"));
  const unfinished: string[] = [];
  const owners = [...OWNERS.keys()].filter((owner) => existsSync(join(tree, owner)));
  for (const owner of owners) {
    const suites = suitesOf(tree, owner);
    const out = join(here, `${slug(owner)}.jsonl`);
    const carried = prev === null ? null : join(state, prev, `${slug(owner)}.jsonl`);
    const stale = changed === null || [owner, ...suites].some((path) => changed.has(path));
    if (!stale && carried !== null && existsSync(carried) && !existsSync(out)) copyFileSync(carried, out);
    if (!stale && existsSync(out)) continue;
    if (until !== null && Date.now() >= Date.parse(until)) {
      unfinished.push(owner);
      continue;
    }
    const map = join(here, `${slug(owner)}.suites.json`);
    writeFileSync(map, JSON.stringify(Object.fromEntries(suites.map((path) => [path.slice(5, -8), [path]]))));
    const timeout = args.int("timeout") ?? 900;
    const command = [MUTATE, "run", tree, owner, "--out", out, "--suites", map, "--stop-at-kill"];
    const extra = ["--timeout", String(timeout), "--clones", join(state, "clone")];
    const run = Bun.spawn(["bun", ...command, ...extra, ...(until === null ? [] : ["--until", until])], {
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await run.exited) !== 0) unfinished.push(owner);
  }
  const complete = unfinished.length === 0;
  const lines = [
    `# Nightly mutation at ${head.slice(0, 9)}`,
    "",
    "| owner | killed | survived | unread |",
    "| --- | --- | --- | --- |",
  ];
  const now: Row[] = [];
  const before: Row[] = [];
  for (const owner of owners) {
    const rows = rowsOf(join(here, `${slug(owner)}.jsonl`));
    now.push(...rows);
    if (prev !== null) before.push(...rowsOf(join(state, prev, `${slug(owner)}.jsonl`)));
    const count = (kind: string) => String(rows.filter((row) => verdictOf(row) === kind).length);
    lines.push(`| \`${owner}\` | ${count("killed")} | ${count("survived")} | ${count("unread")} |`);
  }
  const added = prev === null ? [] : fresh(survivorKeys(tree, head, now), survivorKeys(tree, prev, before));
  lines.push(
    "",
    ...unfinished.map(
      (owner) =>
        `Unfinished, resumes next run: \`${owner}\` (deadline, or a suite failed unmutated; see the log)`,
    ),
    prev === null
      ? "No earlier complete pass to compare."
      : `New survivors since ${prev.slice(0, 9)}: ${String(added.length)}`,
    ...added.map((key) => `- \`${key}\``),
  );
  writeFileSync(join(here, "report.md"), `${lines.join("\n")}\n`);
  if (complete) writeFileSync(donePath, JSON.stringify({ commit: head }));
  const tally = (kind: string) => now.filter((row) => verdictOf(row) === kind).length;
  console.log(
    `${head.slice(0, 9)}: ${String(now.length)} mutants, ${String(tally("survived"))} survived (${String(added.length)} new), ${String(tally("unread"))} unread; ${complete ? "complete" : "resumes next run"}; ${join(here, "report.md")}`,
  );
  return complete && added.length === 0 ? 0 : 3;
}

if (import.meta.main) {
  await runCommand(
    {
      name: "nightly",
      usage: [
        "usage: nightly.ts <tree> --state <dir> [--until HH:MM] [--timeout s] [--full]",
        "Mutates the high-importance owners at <tree>'s HEAD against bounded suites and their importers,",
        "rerunning only owners whose file or suites changed since the last complete pass in <dir>.",
        "Exits 3 when survivors are new or the pass must resume; report.md lists them.",
      ].join("\n"),
      options: { state: "text", until: "text", timeout: "int", full: "flag" },
      positionals: 1,
    },
    async (args: CommandArgs) => nightly(args, args.positionals[0] ?? ""),
  );
}
