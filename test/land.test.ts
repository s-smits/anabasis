/**
 * `bun run land` over a real two-pull-request stack in a fixture repository with its own origin, with
 * GitHub and the gate's steps replaced at their command boundaries. The fake `gh` answers from the
 * environment and logs every call, so a case reads which statuses were posted, on what, and in which
 * order against each merge; the fake `bun` (`test/helpers/fake-bun.ts`) logs each gate's steps. The
 * open pull requests are ANA_FAKE_PULLS; `ci.yml` has passed on the top's head unless ANA_FAKE_CI
 * says otherwise, or ANA_FAKE_CI_AFTER names a file only a dispatch creates. ANA_FAKE_CI_STATES
 * names a file whose lines answer successive run reads, the last repeating: `none` lists no run and
 * `down` fails as a 502 would. ANA_FAKE_REFUSED lists the pull requests GitHub will not merge.
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
import { tmpdir } from "../src/meta/os.ts";
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
number=$(printf '%s' "$*" | sed -nE 's#.*/pulls/([0-9]+).*#\1#p')
case "$*" in
"pr list"*) printf '%s\n' "$ANA_FAKE_PULLS" ;;
"repo view"*) echo main ;;
"run list"*) if [ -n "$ANA_FAKE_CI_STATES" ]; then
  row=$(head -n 1 "$ANA_FAKE_CI_STATES")
  [ "$(wc -l < "$ANA_FAKE_CI_STATES")" -le 1 ] || { tail -n +2 "$ANA_FAKE_CI_STATES" > "$ANA_FAKE_CI_STATES.n"; mv "$ANA_FAKE_CI_STATES.n" "$ANA_FAKE_CI_STATES"; }
  case "$row" in down) echo "gh: Bad Gateway (HTTP 502)" >&2; exit 1 ;; none) ;; *) printf '%s\n' "$row" ;; esac
elif [ -z "$ANA_FAKE_CI_AFTER" ] || [ -e "$ANA_FAKE_CI_AFTER" ]; then
  if [ -n "$ANA_FAKE_CI" ]; then printf '%s\n' "$ANA_FAKE_CI"; else printf 'completed\tsuccess\t1\thttps://ci/1\n'; fi
fi ;;
"workflow run"*) [ -z "$ANA_FAKE_CI_AFTER" ] || touch "$ANA_FAKE_CI_AFTER" ;;
"api -X PUT"*) case " $ANA_FAKE_REFUSED " in *" $number "*) echo "gh: Pull Request is not mergeable (HTTP 405)" >&2; exit 1 ;; esac
  echo "merge$number" ;;
"api -X"*) ;;
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
    env: { ...Bun.env, ...fake, ANA_GH_LOG: ghLog, ANA_FAKE_PULLS: stack(), ...env },
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
    expect(writes().filter((line) => !line.includes("context=ana/commit"))).toEqual([]);
    expect(logLines(ghLog).some((line) => line.startsWith("run list"))).toBe(false);
  });

  it("gives a commit that changes a test alone its static steps, with that test", () => {
    const result = runLand(["14"], { ANA_FAKE_PULLS: JSON.stringify([pull(14, "tests", "main", testsTop)]) });
    expect(result.status).toBe(0);
    expect(gatesRun(gateLog)).toEqual([`${testOnly} test/c.test.ts`, `${testsTop} suite`]);
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
    expect(statuses("ana/stack-gate")).toEqual([]);
  });

  it("gates commits side by side with --jobs, and the top alone once every one beneath it passed", () => {
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
  });

  it("names the lowest commit that failed side by side, and starts nothing after it", () => {
    const result = runLand(["12", "--jobs", "2"], {
      ANA_FAKE_TOGETHER: "2",
      ANA_FAKE_FAIL: `${lowerMore} typecheck`,
    });
    expect(result.status).toBe(1);
    expect(gatesRun(gateLog).toSorted()).toEqual([`${lower} -`, `${lowerMore} -`].toSorted());
    expect(result.stderr).toContain(`git commit --fixup=${short(lowerMore)}`);
    expect(readFileSync(join(work, ".git", "ana-gate-passed"), "utf8")).toBe(`${lower} static\n`);
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

  it("posts the required status on every head, then merges bottom-up, each on main and at its gated head", () => {
    const result = runLand(["12", "--merge"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`#11 merged into main at ${short(lowerDocs)}: merge11.`);
    expect(result.stdout).toContain(`#12 merged into main at ${short(upper)}: merge12.`);
    expect(statuses("ana/stack-gate")).toEqual([`success ${lowerDocs}`, `success ${upper}`]);
    const calls = logLines(ghLog);
    const first = calls.findIndex((line) => line.includes("pulls/11/merge"));
    expect(calls.findLastIndex((line) => line.includes("context=ana/stack-gate"))).toBeLessThan(first);
    expect(calls.slice(first).filter((line) => line.startsWith("api"))).toEqual([
      `api -X PUT repos/{owner}/{repo}/pulls/11/merge -f merge_method=merge -f sha=${lowerDocs} --jq .sha`,
      "api -X PATCH repos/{owner}/{repo}/pulls/12 -f base=main --silent",
      "api repos/{owner}/{repo}/pulls/12 --jq .mergeable",
      `api -X PUT repos/{owner}/{repo}/pulls/12/merge -f merge_method=merge -f sha=${upper} --jq .sha`,
    ]);
  });

  it("takes the required status back from every head GitHub left open", () => {
    const result = runLand(["12", "--merge"], { ANA_FAKE_REFUSED: "12" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("GitHub did not merge #12: gh: Pull Request is not mergeable (HTTP 405)");
    expect(result.stderr).toContain("land: #11 merged; #12 is open.");
    expect(statuses("ana/stack-gate")).toEqual([
      `success ${lowerDocs}`,
      `success ${upper}`,
      `pending ${upper}`,
    ]);
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
