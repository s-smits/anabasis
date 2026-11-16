// The complexity instrument (reduce-complexity): a revision's measures and a diff's budget count
// shell beside TypeScript, so code moved between the two reads as moved and not as written or cut.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runTextSyncOrThrow } from "../src/meta/subprocess.ts";

// One function, ten nonblank lines and three decisions in each language.
const SHELL = `#!/bin/sh
pick() {
  if [ -z "$1" ]; then
    return 1
  fi
  for host in "$@"; do
    [ -n "$host" ] && echo "$host"
  done
}
pick "$@"
`;
const TYPED = `export function pick(hosts: readonly string[]): string[] {
  if (hosts.length === 0) {
    return [];
  }
  const named: string[] = [];
  for (const host of hosts) {
    if (host !== "") named.push(host);
  }
  return named;
}
`;
// The same function in Python: its prose says "and" and "or", which are no decisions there.
const PYTHON = `def count(hosts):
    """Names that are set, or none where there are no hosts and nothing to do."""
    if not hosts:
        return []
    named = []
    for host in hosts:
        # a host and its name, or neither
        if host:
            named.append(host)
    return named
`;

const scripts = join(import.meta.dir, "..", ".claude/skills/reduce-complexity/scripts");
const repo = realpathSync(mkdtempSync(join(tmpdir(), "ana-complexity-")));
afterAll(() => rmSync(repo, { recursive: true, force: true }));
const git = (...args: string[]) =>
  runTextSyncOrThrow(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t.dev", ...args]);

describe("the complexity instrument", () => {
  git("init", "-q", "-b", "main");
  for (const folder of ["tools", "docs"]) mkdirSync(join(repo, folder));
  writeFileSync(join(repo, "tools/pick.sh"), SHELL);
  // Hostile: shell outside the source roots is no source, as TypeScript there is none.
  writeFileSync(join(repo, "docs/example.sh"), SHELL);
  git("add", ".");
  git("commit", "-q", "-m", "in shell");
  writeFileSync(join(repo, "tools/pick.ts"), TYPED);
  git("rm", "-q", "tools/pick.sh");
  git("add", ".");
  git("commit", "-q", "-m", "in TypeScript");
  git("tag", "typed");
  // A second move: the function in Python, and the shell again in a file named without a suffix.
  writeFileSync(join(repo, "tools/count.py"), PYTHON);
  writeFileSync(join(repo, "tools/shim"), SHELL);
  // Hostile: a file without a suffix whose first line names no shell is no source.
  writeFileSync(join(repo, "tools/NOTES"), SHELL.replace("#!/bin/sh", "pick, in words"));
  git("add", ".");
  git("commit", "-q", "-m", "in Python and a shim");
  writeFileSync(join(repo, "tools/count.ts"), TYPED.replace("pick", "count"));
  writeFileSync(join(repo, "tools/shim.ts"), TYPED.replace("pick", "shim"));
  git("rm", "-q", "tools/count.py", "tools/shim");
  git("add", ".");
  git("commit", "-q", "-m", "both in TypeScript");

  /** The table's first two columns for `label`, between two revisions. */
  const rowsOf = (from: string, to: string): ((label: string) => string[] | undefined) => {
    const table = runTextSyncOrThrow([
      "python3",
      join(scripts, "stack-complexity.py"),
      "--repo",
      repo,
      from,
      to,
    ]);
    return (label) =>
      table
        .split("\n")
        .find((line) => line.startsWith(label))
        ?.slice(label.length)
        .trim()
        .split(/\s+/)
        .slice(0, 2);
  };

  it("reads a function moved from shell to TypeScript as no net lines, files or decisions", () => {
    const row = rowsOf("typed~1", "typed");
    expect(row("source files")).toEqual(["1", "1"]);
    expect(row("nonblank source lines")).toEqual(["10", "10"]);
    expect(row("decision points (proxy)")).toEqual(["3", "3"]);
  });

  it("reads Python's decisions and a shim named by its first line, so both moves read as moves", () => {
    const row = rowsOf("HEAD~1", "HEAD");
    expect(row("source files")).toEqual(["3", "3"]);
    expect(row("nonblank source lines")).toEqual(["30", "30"]);
    expect(row("decision points (proxy)")).toEqual(["9", "9"]);
  });

  it("budgets the same move as lines out and in, and names the function as moved", () => {
    const diff = join(repo, "scope.diff");
    writeFileSync(diff, git("diff", "typed~1", "typed"));
    const said = runTextSyncOrThrow(["python3", join(scripts, "measure.py"), "--diff", diff, "-C", repo]);
    expect(said).toContain("prod nonblank: +10 -10, net +0");
    expect(said).toContain("new production functions: 0; moved or re-declared: pick");
  });

  it("budgets a function moved from Python as lines out and in, as the table counts it", () => {
    const diff = join(repo, "python.diff");
    writeFileSync(diff, git("diff", "HEAD~1", "HEAD", "--", "tools/count.py", "tools/count.ts"));
    const said = runTextSyncOrThrow(["python3", join(scripts, "measure.py"), "--diff", diff, "-C", repo]);
    expect(said).toContain("prod nonblank: +10 -10, net +0");
    expect(said).toContain("new production functions: 0; moved or re-declared: count");
  });
});
