/**
 * The `ci.yml` runs a landing reads, and the `ci-fixes` run it dispatches after a failed one.
 *
 * A full run of `ci.yml` takes about 17 runner-minutes over its three jobs and ten to fifteen
 * minutes of a landing's wall clock. When one failed in its tests and the fix is pushed, the next
 * landing used to dispatch the whole run again although most of its files had just passed on a tree
 * that differs from the new one only by the fix. Of 60 runs from 20 October to 7 November, 7
 * failed, and each fix paid the whole run again (the operator, 7 November: "we only need to rerun
 * 'ci-fixes' which is only the maxdepth1 of all the fixed tests").
 *
 * So where the newest full run on the top's branch failed and only in its test steps, the run on the
 * new head is `ci-fixes`: the same workflow, dispatched with the test files to run in place of the
 * suite. Those are the files that failed there, and the tests near what changed between the failed
 * run's tree and the new head's, by the rule the gate's static pass uses (`testsNear`, one import
 * for the root's tests, and `uiTestsNear`, three for the UI's). The diff is of trees, not of commits, since a fix here
 * goes into the commit that broke and the pull requests above are replayed, so the failed head is
 * seldom an ancestor of the new one. A test neither near the change nor failed there passed on the
 * failed run's tree. The landing's own whole gate still runs the full suite on the new head, on a
 * runner host, before anything merges.
 *
 * A full run is dispatched instead wherever that argument does not hold: a failed step other than
 * the suite (the typecheck, the lint, the format, the secret scan, the UI's build, the climb
 * simulation), a job cancelled or never taken, a failed log that names no test file, or a change
 * to what installs or runs the suite or to the OS walls, which `ci.yml` exists to prove on clean
 * machines (`FULL`).
 */
import { mkdtempSync, realpathSync, rmSync } from "../../src/meta/filesystem.ts";
import { tmpdir } from "../../src/meta/os.ts";
import { join } from "../../src/meta/path.ts";
import { git, gitSays, lines, reachingWall, short, testsNear, UI_ROOT, uiTestsNear } from "./gate.ts";
import { gh, type Pull } from "./pulls.ts";

export const CI_WORKFLOW = "ci.yml";
/** `ci.yml`'s `run-name` for a run that names its test files; a full run keeps the workflow's name. */
export const FIXES = "ci-fixes";
/** The suite's steps in `ci.yml`, the only failed steps a `ci-fixes` run can stand in for. */
const TEST_STEP = /^Run bun run test(?: -- \$?\S+)?$/u;
/** What a non-test failure or an untaken job reads as; empty where only the suite failed. A step
 *  cut short (cancelled at a timeout) is named with its conclusion, so it reads as beyond the tests. */
const NOT_TESTS = String.raw`[.jobs[] | select(.conclusion != "success") | if .conclusion == "failure" then (.steps[] | select(.conclusion != "success" and .conclusion != "skipped") | if .conclusion == "failure" then .name else "\(.name) \(.conclusion)" end) else "\(.name) \(.conclusion)" end] | join(", ")`;
/** A change to any of these proves nothing narrower than the whole run. */
const FULL = [
  ".github/",
  "package.json",
  "bun.lock",
  "bunfig.toml",
  "tsconfig.json",
  `${UI_ROOT}/package.json`,
  `${UI_ROOT}/bun.lock`,
  `${UI_ROOT}/bunfig.toml`,
  `${UI_ROOT}/tsconfig.json`,
  "tools/runtime/test-suite.ts",
  "src/wall/",
];
/** A test file's header in Bun's output, as `gh run view --log-failed` prints it after the job, the
 *  step and the timestamp; each `(fail)` belongs to the header before it in the same job. */
const HEADER = /^((?:test|packages\/ui\/test)\/[^\s:]+\.test\.tsx?):$/u;
const STAMP = /^\d{4}-\d\d-\d\dT[\d:.]+Z ?/u;
/** Bun's closing list of every failure, which repeats them under no header of their own: in run
 *  40754653803 it followed `test/walled-env.test.ts`, whose tests had all passed. */
const SUMMARY = /^\d+ tests? failed:$/u;

/** What a `ci-fixes` run dispatches: the root's test files and the UI's, each as one input. */
interface Fixes {
  readonly since: string;
  readonly tests: string;
  readonly uiTests: string;
  readonly count: number;
}

/** The newest `ci.yml` run on `sha` that a later one did not cancel, as its status, conclusion, id,
 *  link, start and title; null when there is none; undefined when GitHub did not answer, which is
 *  never read as none. */
export function ciRun(root: string, sha: string): string[] | null | undefined {
  const read = gh(root, [
    "run",
    "list",
    "--workflow",
    CI_WORKFLOW,
    "--commit",
    sha,
    "--json",
    "status,conclusion,databaseId,url,createdAt,displayTitle",
    "--jq",
    String.raw`[.[] | select(.conclusion != "cancelled")] | first // empty | [.status, .conclusion, .databaseId, .url, .createdAt, .displayTitle] | map(tostring) | join("\t")`,
  ]);
  if (!read.ok) return undefined;
  return read.out === "" ? null : read.out.split("\t");
}

/** The test files a failed run's log reports a failed test or an error between tests in, each
 *  once, in order: a file that fails as it loads prints no `(fail)` line. */
export function failedFiles(log: string): string[] {
  const at = new Map<string, string>();
  const found = new Set<string>();
  for (const line of lines(log)) {
    const [job = "", , text = ""] = line.split("\t");
    const said = text.replace(STAMP, "");
    const header = HEADER.exec(said)?.[1];
    if (header !== undefined) at.set(job, header);
    if (SUMMARY.test(said)) at.delete(job);
    const file = at.get(job);
    const failed = said.startsWith("(fail) ") || said.startsWith("# Unhandled error");
    if (failed && file !== undefined) found.add(file);
  }
  return [...found];
}

/** The `ci-fixes` run for `top`'s head, or null where a full run is due; `say` names why not. */
export function fixesFor(root: string, top: Pull, say: (line: string) => void): Fixes | null {
  const read = gh(root, [
    "run",
    "list",
    "--workflow",
    CI_WORKFLOW,
    "--branch",
    top.headRefName,
    "--json",
    "headSha,conclusion,databaseId,displayTitle",
    "--jq",
    String.raw`[.[] | select(.conclusion != "cancelled" and .displayTitle != "${FIXES}")] | first // empty | [.headSha, .conclusion, .databaseId] | map(tostring) | join("\t")`,
  ]);
  const [sha = "", conclusion = "", id = ""] = read.ok ? read.out.split("\t") : [];
  if (conclusion !== "failure" || sha === top.headRefOid) return null;
  const full = (why: string): null => {
    say(`${CI_WORKFLOW} runs in full: ${why}.`);
    return null;
  };
  const other = gh(root, ["run", "view", id, "--json", "jobs", "--jq", NOT_TESTS]);
  const outside = other.ok
    ? other.out.split(", ").filter((step) => step !== "" && !TEST_STEP.test(step))
    : [];
  if (!other.ok || outside.length > 0) {
    return full(`run ${id} on ${short(sha)} failed beyond its tests (${outside.join(", ") || other.err})`);
  }
  const log = gh(root, ["run", "view", id, "--log-failed"]);
  const failed = log.ok ? failedFiles(log.out) : [];
  if (failed.length === 0) return full(`run ${id}'s failed log names no test file`);
  if (
    !gitSays(root, ["cat-file", "-e", `${sha}^{commit}`]) &&
    !gitSays(root, ["fetch", "-q", "origin", sha])
  ) {
    return full(`${short(sha)}, where run ${id} failed, is not on origin`);
  }
  const changed = new Set(lines(git(root, ["diff", "--name-only", sha, top.headRefOid])));
  const wide = [...changed].find((file) => FULL.some((path) => file === path || file.startsWith(path)));
  if (wide !== undefined) return full(`${wide} changed since run ${id}`);
  const { near, wall } = nearOn(root, top.headRefOid, changed);
  if (wall !== undefined) return full(`${wall}, which the wall imports, changed since run ${id}`);
  const present = new Set(lines(git(root, ["ls-tree", "-r", "--name-only", top.headRefOid])));
  const tests = [...new Set([...failed, ...near])].filter((file) => present.has(file)).toSorted();
  if (tests.length === 0) return full(`no test file run ${id} failed is still there`);
  const ui = (file: string): boolean => file.startsWith(`${UI_ROOT}/`);
  // A run of UI tests alone skips the linux job, and with it the climb simulation.
  const beyond = tests.every(ui) ? [...changed].find((file) => !ui(file)) : undefined;
  if (beyond !== undefined) return full(`${beyond} changed since run ${id}, and only UI tests are near it`);
  return {
    since: `run ${id} on ${short(sha)}`,
    tests: tests.filter((file) => !ui(file)).join(" "),
    uiTests: tests.filter(ui).join(" "),
    count: tests.length,
  };
}

/** The test files near `changed` in `sha`'s tree, and a changed file the wall reaches, read from a
 *  scratch checkout of it. Its real path, since imports resolve to real paths and macOS's temporary
 *  folder is a link: from the link every import read as outside the tree. */
function nearOn(
  root: string,
  sha: string,
  changed: ReadonlySet<string>,
): { near: string[]; wall: string | undefined } {
  const tree = realpathSync(mkdtempSync(join(tmpdir(), "ana-ci-fixes-")));
  rmSync(tree, { recursive: true, force: true });
  git(root, ["worktree", "add", "-q", "--detach", tree, sha]);
  try {
    return {
      near: [...testsNear(tree, changed), ...uiTestsNear(tree, changed, true)],
      wall: reachingWall(tree, changed),
    };
  } finally {
    git(root, ["worktree", "remove", "--force", tree]);
  }
}
