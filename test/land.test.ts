/**
 * `bun run land` over a real two-pull-request stack in a fixture repository with its own origin, with
 * GitHub and the gate's steps replaced at their command boundaries. The fake `gh` answers from the
 * environment and logs every call, so a case reads which statuses were posted, on what, and in which
 * order against each merge; the fake `bun` (`test/helpers/fake-bun.ts`) logs each gate's steps. The
 * open pull requests are ANA_FAKE_PULLS; `ci.yml` has passed on the top's head unless ANA_FAKE_CI
 * says otherwise, or ANA_FAKE_CI_AFTER names a file only a dispatch creates. ANA_FAKE_CI_STATES
 * names a file whose lines answer successive run reads, the last repeating: `none` lists no run and
 * `down` fails as a 502 would. ANA_FAKE_STACK is the open native stack the top is in, as its number
 * and its members, `down` failing the read; by default stack 7 of #11 and #12. The top's merge is
 * asked for under the id ANA_FAKE_STACK_UUID and ends as ANA_FAKE_STACK_END says, `refused`
 * refusing the asking, with ANA_FAKE_STACK_SHA as its commit, by default the top's.
 * Nothing here reaches GitHub, and nothing is pushed but to the fixture's own bare origin.
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { availableParallelism, tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";

import { afterAll, beforeEach, describe, expect, it } from "bun:test";

import { execTextSync, spawnTextSync } from "./helpers/bun-spawn-sync.ts";
import { fakeBun, gatesRun, logLines } from "./helpers/fake-bun.ts";

const land = join(import.meta.dir, "..", "tools", "runtime", "land.ts");
const fixture = mkdtempSync(join(tmpdir(), "ana-land-"));
const work = join(fixture, "work");
const origin = join(fixture, "origin.git");
const bin = join(fixture, "bin");
const ghLog = join(fixture, "gh.log");
const gateLog = join(fixture, "gates.log");
const fake = (mkdirSync(bin), fakeBun(bin, gateLog));

const GH = String.raw`#!/bin/sh
printf '%s\n' "$*" >> "$ANA_GH_LOG"
case "$*" in
"pr list"*) if [ -n "$ANA_FAKE_PULLS_NEXT" ] && [ -e "$ANA_FAKE_PULLS_NEXT.read" ]; then
  cat "$ANA_FAKE_PULLS_NEXT"
else
  printf '%s\n' "$ANA_FAKE_PULLS"
fi ;;
"repo view"*) echo main ;;
"run list"*) if [ -n "$ANA_FAKE_CI_STATES" ]; then
  row=$(head -n 1 "$ANA_FAKE_CI_STATES")
  [ "$(wc -l < "$ANA_FAKE_CI_STATES")" -le 1 ] || { tail -n +2 "$ANA_FAKE_CI_STATES" > "$ANA_FAKE_CI_STATES.n"; mv "$ANA_FAKE_CI_STATES.n" "$ANA_FAKE_CI_STATES"; }
  case "$row" in down) echo "gh: Bad Gateway (HTTP 502)" >&2; exit 1 ;; none) ;; *) printf '%s\n' "$row" ;; esac
elif [ -z "$ANA_FAKE_CI_AFTER" ] || [ -e "$ANA_FAKE_CI_AFTER" ]; then
  if [ -n "$ANA_FAKE_CI" ]; then printf '%s\n' "$ANA_FAKE_CI"; else printf 'completed\tsuccess\t1\thttps://ci/1\n'; fi
fi ;;
"workflow run"*) [ -z "$ANA_FAKE_CI_AFTER" ] || touch "$ANA_FAKE_CI_AFTER" ;;
"api -X PUT"*"/merge-async"*) [ "$ANA_FAKE_STACK_END" != refused ] || { echo "gh: Stack is not mergeable (HTTP 422)" >&2; exit 1; }
  printf 'pending\t%s\t\t\n' "$ANA_FAKE_STACK_UUID" ;;
"api repos/{owner}/{repo}/pulls/"*"/merge-async/"*) printf '%s\t\t%s\t%s\n' "$ANA_FAKE_STACK_END" "$ANA_FAKE_STACK_SHA" "$ANA_FAKE_STACK_END" ;;
"api repos/{owner}/{repo}/stacks"*) [ "$ANA_FAKE_STACK" != down ] || { echo "gh: Bad Gateway (HTTP 502)" >&2; exit 1; }
  printf '%s\n' "$ANA_FAKE_STACK" ;;
"api -X"*) case "$*" in *"state=success -f context=mergeable"*)
  [ -z "$ANA_FAKE_PULLS_NEXT" ] || touch "$ANA_FAKE_PULLS_NEXT.read" ;; esac ;;
"api repos/"*) echo true ;;
esac
`;

const git = (...args: string[]): string => execTextSync("git", args, { cwd: work }).trim();
function commit(file: string, text: string, message: string): string {
  writeFileSync(join(work, file), text);
  git("add", "-A");
  git("commit", "-qm", message);
  return git("rev-parse", "HEAD");
}
const publish = (): string =>
  execTextSync("git", ["-C", origin, "fetch", "-q", work, "+refs/heads/*:refs/heads/*"]);
const short = (sha: string): string => sha.slice(0, 9);

writeFileSync(join(bin, "gh"), GH);
chmodSync(join(bin, "gh"), 0o755);
mkdirSync(join(work, ".github", "workflows"), { recursive: true });
mkdirSync(join(work, "src"));
mkdirSync(join(work, "test"));
git("init", "-q", "-b", "main");
git("config", "user.email", "fixture@localhost");
git("config", "user.name", "fixture");
const workflow = (dispatch: string): string => `name: ci\non:\n  pull_request:\n${dispatch}jobs: {}\n`;
writeFileSync(join(work, ".github", "workflows", "ci.yml"), workflow("  workflow_dispatch:\n"));
writeFileSync(join(work, "README.md"), "one\n");
writeFileSync(
  join(work, "test", "owner.test.ts"),
  'import { owner } from "../src/owner.ts";\nexport { owner };\n',
);
const trunk = commit("src/owner.ts", "export const owner = 1;\n", "base");
git("checkout", "-q", "-b", "a");
const lower = commit("src/a.ts", "export const a = 1;\n", "a");
const lowerMore = commit("src/owner.ts", "export const owner = 2;\n", "a more");
const lowerDocs = commit("README.md", "two\n", "a docs");
git("checkout", "-q", "-b", "b");
const upper = commit("src/b.ts", "export const b = 1;\n", "b");
git("checkout", "-q", "-b", "beside", "main");
const beside = commit("src/c.ts", "export const c = 1;\n", "beside");
git("checkout", "-q", "-b", "merged");
git("merge", "-qm", "merge a through the second parent", "a");
const merged = git("rev-parse", "HEAD");
git("checkout", "-q", "-b", "tests", "main");
const testOnly = commit("test/c.test.ts", "export {};\n", "a test");
const testsTop = commit("src/d.ts", "export const d = 1;\n", "d");
git("checkout", "-q", "-b", "nodispatch", "main");
const noDispatch = commit(".github/workflows/ci.yml", workflow(""), "no dispatch");
git("checkout", "-q", "b");
execTextSync("git", ["init", "-q", "--bare", origin]);
execTextSync("git", ["-C", origin, "config", "uploadpack.allowAnySHA1InWant", "true"]);
publish();
git("remote", "add", "origin", origin);

afterAll(() => rmSync(fixture, { recursive: true, force: true }));

const pull = (number: number, head: string, base: string, sha: string, isDraft = false) => ({
  number,
  headRefName: head,
  baseRefName: base,
  headRefOid: sha,
  isDraft,
  labels: [{ name: "importance:I2" }],
});
/** A pull request carrying `names` as its labels in place of the one importance label. */
const labelled = (open: ReturnType<typeof pull>, ...names: string[]) => ({
  ...open,
  labels: names.map((name) => ({ name })),
});
const stack = (top = upper, ...more: ReturnType<typeof pull>[]): string =>
  JSON.stringify([
    pull(11, "a", "main", lowerDocs),
    pull(12, "b", "a", top),
    pull(13, "beside", "main", beside),
    ...more,
  ]);

function runLand(args: readonly string[], env: Record<string, string> = {}) {
  return spawnTextSync(capturedExecPath, [land, ...args], {
    cwd: work,
    env: {
      ...Bun.env,
      ...fake,
      ANA_GH_LOG: ghLog,
      ANA_FAKE_PULLS: stack(),
      ANA_FAKE_STACK: "7 11,12",
      ANA_FAKE_STACK_END: "merged",
      ANA_FAKE_STACK_UUID: "u1",
      ANA_FAKE_STACK_SHA: upper,
      ...env,
    },
  });
}

const statuses = (context: string): string[] =>
  logLines(ghLog).flatMap((line) => {
    const match = /\/statuses\/(\w+) -f state=(\w+) -f context=(\S+)/u.exec(line);
    return match?.[3] === context ? [`${match[2]} ${match[1]}`] : [];
  });
const described = (context: string): string[] =>
  logLines(ghLog).flatMap((line) => {
    const match = /\/statuses\/(\w+) -f state=\w+ -f context=(\S+) -f description=(.+) --silent$/u.exec(line);
    return match?.[2] === context ? [`${match[1]} ${match[3]}`] : [];
  });
const writes = (): string[] =>
  logLines(ghLog).filter((line) => line.includes("-X") || line.startsWith("workflow"));
const forgetPasses = (): void => rmSync(join(work, ".git", "ana-gate-passed"), { force: true });
const ciStates = (...rows: string[]): string => {
  const file = join(fixture, "ci-states");
  writeFileSync(file, `${rows.join("\n")}\n`);
  return file;
};

beforeEach(() => {
  rmSync(ghLog, { force: true });
  rmSync(gateLog, { force: true });
  forgetPasses();
});

describe("bun run land", () => {
  it("gates every commit where it sits and the top's head whole, and writes nothing to GitHub unasked", () => {
    const result = runLand(["12"]);
    expect(result.status).toBe(0);
    expect(gatesRun(gateLog)).toEqual([`${lower} -`, `${lowerMore} test/owner.test.ts`, `${upper} suite`]);
    expect(result.stdout).toContain(`3 of 4, ${short(lowerDocs)}: documentation only.`);
    expect(result.stdout).toContain("--sanitize shows it on GitHub");
    expect(writes()).toEqual([]);
  });

  it("runs nothing again that passed on these exact bytes, and --sanitize posts each verdict and stops", () => {
    runLand(["12"]);
    rmSync(gateLog, { force: true });
    const result = runLand(["12", "--sanitize"]);
    expect(result.status).toBe(0);
    expect(gatesRun(gateLog)).toEqual([]);
    expect(result.stdout).toContain("passed earlier on these exact bytes");
    expect(result.stdout).toContain("every commit passed; each shows ana/commit on GitHub.");
    expect(described("ana/commit")).toEqual([
      `${lower} its static steps and nearby tests passed on its own checkout`,
      `${lowerMore} its static steps and nearby tests passed on its own checkout`,
      `${lowerDocs} documentation only`,
      `${upper} passed the whole gate on its own checkout`,
    ]);
    expect(statuses("mergeable")).toEqual([
      `pending ${lowerDocs}`,
      `pending ${upper}`,
      `success ${lowerDocs}`,
      `success ${upper}`,
    ]);
    expect(writes().filter((line) => !/context=(ana\/commit|mergeable) /u.test(line))).toEqual([]);
    expect(logLines(ghLog).some((line) => line.startsWith("run list"))).toBe(false);
  });

  it("gives a commit that changes a test alone its static steps, with that test", () => {
    const result = runLand(["14"], { ANA_FAKE_PULLS: JSON.stringify([pull(14, "tests", "main", testsTop)]) });
    expect(result.status).toBe(0);
    expect(gatesRun(gateLog)).toEqual([`${testOnly} test/c.test.ts`, `${testsTop} suite`]);
  });

  it("proves every landing head and turns the stack green when a lower head is a merge's second parent", () => {
    const result = runLand(["12", "--sanitize"], {
      ANA_FAKE_PULLS: JSON.stringify([pull(11, "a", "main", lowerDocs), pull(12, "merged", "a", merged)]),
    });
    expect(result.status).toBe(0);
    expect(statuses("mergeable")).toEqual([
      `pending ${lowerDocs}`,
      `pending ${merged}`,
      `success ${lowerDocs}`,
      `success ${merged}`,
    ]);
    expect(statuses("ana/commit")).toContain(`success ${lowerDocs}`);
    expect(gatesRun(gateLog)).toContain(`${lowerMore} test/owner.test.ts`);
    expect(gatesRun(gateLog).at(-1)).toBe(`${merged} suite`);
  });

  it("refuses to restore green when a parent moves while its unchanged child is being proved", () => {
    const next = join(fixture, "moved-pulls");
    for (const [head, reason] of [
      [beside, "does not contain #11's head"],
      [lowerMore, "a pull request's head moved"],
    ] as const) {
      rmSync(ghLog, { force: true });
      rmSync(`${next}.read`, { force: true });
      writeFileSync(next, JSON.stringify([pull(11, "a", "main", head), pull(12, "b", "a", upper)]));
      const result = runLand(["12", "--sanitize"], { ANA_FAKE_PULLS_NEXT: next });
      expect(statuses("mergeable")).toEqual([
        `pending ${lowerDocs}`,
        `pending ${upper}`,
        `success ${lowerDocs}`,
      ]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(reason);
    }
  });

  it("stops at the first commit that fails and names its pull request and where the fix goes", () => {
    const result = runLand(["12", "--sanitize"], { ANA_FAKE_FAIL: `${lower} lint` });
    expect(result.status).toBe(1);
    expect(gatesRun(gateLog)).toEqual([`${lower} -`]);
    expect(result.stderr).toContain(
      `the fix belongs in ${short(lower)}, on #11 (a), not in a commit on top.`,
    );
    expect(result.stderr).toContain(`git commit --fixup=${short(lower)}`);
    expect(result.stderr).toContain("then replay #12 on it, bottom-up, and push them together");
    const last = result.stderr.trimEnd().split("\n").at(-1) ?? "";
    expect(last).toStartWith(`land: ${short(lower)} FAILS lint ON ITS OWN. Nothing was merged. Log: `);
    expect(statuses("ana/commit")).toEqual([`failure ${lower}`]);
    expect(statuses("mergeable")).toEqual([
      `pending ${lowerDocs}`,
      `pending ${upper}`,
      `failure ${lowerDocs}`,
      `failure ${upper}`,
    ]);
    expect(statuses("ana/stack-gate")).toEqual([]);
  });

  it("turns each pull request below a failed commit green, and the one that holds it red", () => {
    const result = runLand(["12", "--sanitize"], { ANA_FAKE_FAIL: `${upper} lint` });
    expect(result.status).toBe(1);
    expect(statuses("mergeable")).toEqual([
      `pending ${lowerDocs}`,
      `pending ${upper}`,
      `success ${lowerDocs}`,
      `failure ${upper}`,
    ]);
  });

  it("gates commits side by side with --jobs, each on its share of the cores, and the top alone once every one beneath it passed", () => {
    const result = runLand(["12", "--jobs", "2"], { ANA_FAKE_TOGETHER: "2", ANA_FAKE_LATE: lower });
    expect(result.status).toBe(0);
    // Two gates side by side reach the log in whichever order the host runs them. The lower one ends
    // last, so a top started as soon as the other ended would begin before that end.
    const order = logLines(gateLog).flatMap((row) => {
      const [first = "", second = ""] = row.split("\t");
      if (first === "end") return [`end ${second}`];
      return second.startsWith("install") ? [`start ${first}`] : [];
    });
    expect(order.slice(0, 2).toSorted()).toEqual([`start ${lower}`, `start ${lowerMore}`].toSorted());
    expect(order.slice(2, 4).toSorted()).toEqual([`end ${lower}`, `end ${lowerMore}`].toSorted());
    expect(order.slice(4)).toEqual([`start ${upper}`, `end ${upper}`]);
    const share = String(Math.max(2, Math.floor((availableParallelism() - 2) / 2)));
    expect(logLines(gateLog).filter((row) => row.startsWith("workers\t"))).toEqual([
      `workers\t${lowerMore}\t${Bun.env.ANA_TEST_WORKERS ?? share}\t1`,
      `workers\t${upper}\t${Bun.env.ANA_TEST_WORKERS ?? ""}\t1`,
    ]);
  });

  it("names the lowest commit that failed side by side, and starts nothing after it", () => {
    const result = runLand(["12", "--jobs", "2"], {
      ANA_FAKE_TOGETHER: "2",
      ANA_FAKE_FAIL: `${lowerMore} typecheck`,
    });
    expect(result.status).toBe(1);
    expect(gatesRun(gateLog).toSorted()).toEqual([`${lower} -`, `${lowerMore} -`].toSorted());
    expect(result.stderr).toContain(`git commit --fixup=${short(lowerMore)}`);
    const tree = (at: string): string => git("rev-parse", `${at}^{tree}`);
    const [recorded, ...more] = readFileSync(join(work, ".git", "ana-gate-passed"), "utf8").split("\n");
    expect(more).toEqual([""]);
    expect(recorded?.split(" ").toSpliced(3, 1)).toEqual([
      "tree",
      `${tree(`${lower}^`)}..${tree(lower)}`,
      "static",
      `bun-${Bun.version}`,
    ]);
  });

  it("refuses a head that does not contain the pull request beneath it", () => {
    const result = runLand(["12"], { ANA_FAKE_PULLS: stack(beside) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`#12 (b) does not contain #11's head ${short(lowerDocs)}`);
    expect(gatesRun(gateLog)).toEqual([]);
  });

  // The last merge leaves main at the top's tree only while the bottom contains main's head.
  it("refuses a stack whose bottom does not contain main's head", () => {
    git("checkout", "-q", "main");
    const moved = commit("src/owner.ts", "export const owner = 3;\n", "hotfix");
    publish();
    try {
      const result = runLand(["12"]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`#11 (a) does not contain main's head ${short(moved)}`);
      expect(gatesRun(gateLog)).toEqual([]);
    } finally {
      git("reset", "-q", "--hard", trunk);
      git("checkout", "-q", "b");
      publish();
    }
  });

  it("refuses a stack whose bottom is based on a branch that is neither main nor an open pull request", () => {
    const result = runLand(["12"], { ANA_FAKE_PULLS: JSON.stringify([pull(12, "b", "a", upper)]) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "#12 (b) is based on a, which is neither main nor an open pull request's head.",
    );
  });

  it("refuses a landing in which a pull request carries no importance label or two, naming each, before gating anything", () => {
    const unranked = JSON.stringify([
      labelled(pull(11, "a", "main", lowerDocs)),
      labelled(pull(12, "b", "a", upper), "importance:I1", "importance:I3", "bug"),
      labelled(pull(13, "beside", "main", beside)),
    ]);
    for (const flags of [[], ["--sanitize"], ["--merge"]]) {
      rmSync(ghLog, { force: true });
      const result = runLand(["12", ...flags], { ANA_FAKE_PULLS: unranked });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "#11 carries no importance label; #12 carries importance:I1 and importance:I3. Give each pull request exactly one",
      );
      expect(result.stderr).not.toContain("#13");
      expect(gatesRun(gateLog)).toEqual([]);
      expect(logLines(ghLog).filter((call) => call.startsWith("api -X POST"))).toEqual([]);
    }
    // One importance label among others lands.
    const ranked = JSON.stringify([
      labelled(pull(11, "a", "main", lowerDocs), "importance:I0", "docs"),
      pull(12, "b", "a", upper),
    ]);
    expect(runLand(["12"], { ANA_FAKE_PULLS: ranked }).status).toBe(0);
  });

  it("refuses to merge a landing that holds a draft, before gating anything", () => {
    const result = runLand(["12", "--merge"], {
      ANA_FAKE_PULLS: JSON.stringify([pull(11, "a", "main", lowerDocs, true), pull(12, "b", "a", upper)]),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "#11 is a draft, and it would merge in this landing. Nothing was merged.",
    );
    expect(gatesRun(gateLog)).toEqual([]);
  });

  it("refuses to merge a pull request beside another open chain on main, before gating anything", () => {
    const result = runLand(["13", "--merge"], { ANA_FAKE_STACK: "", ANA_FAKE_STACK_SHA: beside });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "land: #11 (a) starts another chain on main, which this merge would leave short of main's new head",
    );
    expect(gatesRun(gateLog)).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it("merges a lone pull request in no stack through its own merge, pinned to its gated head", () => {
    const result = runLand(["13", "--merge"], {
      ANA_FAKE_PULLS: JSON.stringify([pull(11, "a", "main", lowerDocs), pull(13, "beside", "main", beside)]),
      ANA_FAKE_STACK: "",
      ANA_FAKE_STACK_SHA: beside,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `land: #13 merged into main as #13, at ${short(beside)}: ${short(beside)}.`,
    );
    expect(logLines(ghLog)).toContain(
      `api -X PUT repos/{owner}/{repo}/pulls/13/merge-async -f merge_method=merge -f merge_action=direct_merge -f sha=${beside} --jq [.status, .details.uuid // "", .details.sha // "", .details.message // ""] | join("\\t")`,
    );
  });

  it("refuses a landing of several pull requests in no stack, or whose stack GitHub did not say, before gating", () => {
    for (const [listed, why] of [
      [
        "",
        "#11, #12 are in no stack on GitHub. Make them one, bottom to top, with gh stack link 11 12, and land again.",
      ],
      ["down", "GitHub did not say which stack #12 is in: gh: Bad Gateway (HTTP 502) Land again."],
    ] as const) {
      writeFileSync(ghLog, "");
      const result = runLand(["12", "--merge"], { ANA_FAKE_STACK: listed });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`land: ${why} Nothing was merged.`);
      expect(gatesRun(gateLog)).toEqual([]);
      expect(writes()).toEqual([]);
    }
  });

  const stackMerge = (end: string, more: Record<string, string> = {}) =>
    runLand(["12", "--merge"], {
      ANA_FAKE_STACK: "7 11,12,14",
      ANA_FAKE_STACK_END: end,
      ANA_FAKE_STACK_UUID: "u1",
      ...more,
    });
  const askedStack = `api -X PUT repos/{owner}/{repo}/pulls/12/merge-async -f merge_method=merge -f merge_action=direct_merge -f sha=${upper}`;

  it("merges a landing GitHub holds as a stack whole, through the stack's merge, after the statuses", () => {
    const result = stackMerge("merged", { ANA_FAKE_STACK_SHA: upper });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `land: #11, #12 merged into main as stack 7, at ${short(upper)}: ${short(upper)}.`,
    );
    expect(statuses("ana/stack-gate")).toEqual([`success ${lowerDocs}`, `success ${upper}`]);
    const calls = logLines(ghLog);
    const asked = calls.findIndex((line) => line.startsWith(askedStack));
    expect(calls.findLastIndex((line) => line.includes("context=ana/stack-gate"))).toBeLessThan(asked);
    expect(calls.slice(asked + 1).map((line) => line.split(" --jq")[0])).toEqual([
      "api repos/{owner}/{repo}/pulls/12/merge-async/u1",
    ]);
    expect(calls.some((line) => /pulls\/\d+\/merge -f/u.test(line) || line.includes("-X PATCH"))).toBe(false);
  });

  it("takes the status back from every head when GitHub refuses or fails a stack's merge, and says nothing merged", () => {
    for (const [end, why] of [
      ["failed", "its merge ended failed: failed"],
      ["refused", "gh: Stack is not mergeable (HTTP 422)"],
    ] as const) {
      writeFileSync(ghLog, "");
      const result = stackMerge(end);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`land: GitHub did not merge stack 7: ${why}`);
      expect(result.stderr).toContain("land: nothing merged; #11, #12 are open.");
      expect(statuses("ana/stack-gate")).toEqual([
        `success ${lowerDocs}`,
        `success ${upper}`,
        `pending ${lowerDocs}`,
        `pending ${upper}`,
      ]);
    }
  });

  it("leaves the statuses and says nothing merged nowhere when it cannot tell whether a stack merged", () => {
    const unread = stackMerge("merged", { ANA_FAKE_STACK_UUID: "" });
    expect(unread.status).toBe(1);
    expect(unread.stderr).toContain(
      "land: GitHub's merge of stack 7 named no merge to read back; the statuses stand.",
    );
    writeFileSync(ghLog, "");
    const other = stackMerge("merged", { ANA_FAKE_STACK_SHA: lowerDocs });
    expect(other.status).toBe(1);
    expect(other.stderr).toContain(
      `land: stack 7 merged into main as ${short(lowerDocs)}, whose tree is not the tree of ${short(upper)} that the gate read.`,
    );
    writeFileSync(ghLog, "");
    const queued = stackMerge("enqueued");
    expect(queued.status).toBe(1);
    expect(queued.stderr).toContain(
      "land: GitHub's merge of stack 7 went into the merge queue; the statuses stand.",
    );
    for (const result of [unread, other, queued]) expect(result.stderr).not.toContain("nothing merged");
    expect(statuses("ana/stack-gate")).toEqual([`success ${lowerDocs}`, `success ${upper}`]);
  });

  it("refuses a stack whose members are not the chain of bases, before any status is posted", () => {
    const result = runLand(["12", "--merge"], { ANA_FAKE_STACK: "7 13,12" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "land: GitHub's stack 7 holds #13, #12, and the chain of bases up to #12 holds #11, #12. " +
        "Make them agree, and land again. Nothing was merged.",
    );
    expect(statuses("ana/stack-gate")).toEqual([]);
  });

  it("dispatches ci.yml on the top's head before gating when it has no run, and waits for it", () => {
    const dispatched = join(fixture, "ci-dispatched");
    rmSync(dispatched, { force: true });
    const result = runLand(["12", "--merge"], { ANA_FAKE_CI_AFTER: dispatched });
    expect(result.status).toBe(0);
    const calls = logLines(ghLog);
    const dispatch = calls.indexOf("workflow run ci.yml --ref b");
    expect(dispatch).toBeGreaterThan(-1);
    expect(dispatch).toBeLessThan(calls.findIndex((line) => line.includes("context=ana/commit")));
    expect(
      calls.filter((line) => line.startsWith("run list")).every((line) => line.includes(`--commit ${upper}`)),
    ).toBe(true);
    expect(result.stdout).toContain(`ci.yml passed on #12's head ${short(upper)}: https://ci/1`);
  });

  it("waits through a queued, a running and an unreadable read of ci.yml, with one dispatch, until it passes", () => {
    const result = runLand(["12", "--merge"], {
      ANA_FAKE_CI_STATES: ciStates(
        "none",
        "queued\t\t17\thttps://ci/17",
        "in_progress\t\t17\thttps://ci/17",
        "down",
        "completed\tsuccess\t17\thttps://ci/17",
      ),
      ANA_CI_POLL_MS: "1",
    });
    expect(result.status).toBe(0);
    const calls = logLines(ghLog);
    expect(calls.filter((line) => line.startsWith("workflow run"))).toEqual(["workflow run ci.yml --ref b"]);
    expect(calls.filter((line) => line.startsWith("run list"))).toHaveLength(5);
    expect(result.stdout).toContain(`ci.yml passed on #12's head ${short(upper)}: https://ci/17`);
  });

  it("refuses to merge when ci.yml failed on the top's head, and does not dispatch it again", () => {
    const result = runLand(["12", "--merge"], { ANA_FAKE_CI: "completed\tfailure\t9\thttps://ci/9" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `ci.yml ended failure on #12's head ${short(upper)}: https://ci/9. Fix the commit it names, ` +
        "or run gh run rerun 9 if the runner was at fault, and land again. Nothing was merged.",
    );
    expect(logLines(ghLog).some((line) => line.startsWith("workflow run") || line.includes("/merge"))).toBe(
      false,
    );
    expect(statuses("ana/stack-gate")).toEqual([]);
  });

  it("refuses before gating when no run exists and ci.yml takes no dispatch", () => {
    const result = runLand(["15", "--merge"], {
      ANA_FAKE_PULLS: JSON.stringify([pull(15, "nodispatch", "main", noDispatch)]),
      ANA_FAKE_STACK: "",
      ANA_FAKE_CI_STATES: ciStates("none"),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `no ci.yml run exists on #15's head ${short(noDispatch)}, and ci.yml there takes no workflow_dispatch to start one.`,
    );
    expect(logLines(ghLog).some((line) => line.startsWith("workflow run"))).toBe(false);
    expect(gatesRun(gateLog)).toEqual([]);
  });

  it("refuses before gating when GitHub does not list ci.yml's runs, and dispatches none", () => {
    // A run follows, so code that read the failed list as "none" dispatches, passes and fails here.
    const result = runLand(["12", "--merge"], {
      ANA_FAKE_CI_STATES: ciStates("down", "completed\tsuccess\t19\thttps://ci/19"),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `GitHub did not list ci.yml's runs on #12's head ${short(upper)}. Land again.`,
    );
    expect(logLines(ghLog).some((line) => line.startsWith("workflow run"))).toBe(false);
    expect(gatesRun(gateLog)).toEqual([]);
  });
});
