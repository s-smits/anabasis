// The scripts the operator's skills share: the stack as its edges, the move to its top and the
// republishing of a consolidated stack, the source a campaign's launches ran, the closing of an Oracle
// bundle, and the reading of a live seat.
import { afterAll, describe, expect, it } from "bun:test";
import { CommandFailure } from "#skills/main/cli.ts";
import { gitText } from "#src/meta/git.ts";
import { bundle } from "#skills/oracle-handover/scripts/bundle.ts";
import { follow, type NativeStack, nativeTop } from "#skills/stack-pr/scripts/follow.ts";
import { newsOf, readingOf, told as seatTold } from "#skills/system-path-simulation/scripts/live-seat.ts";
import { pairs, planConsolidation, pushArgs, republish } from "#skills/stack-pr/scripts/republish.ts";
import { chain, told as stackTold } from "#skills/stack-pr/scripts/stack.ts";
import type { Pull } from "#tools/runtime/land.ts";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { decodeOutput, runSync, runTextSyncOrThrow } from "../src/meta/subprocess.ts";
import { capturedJsonStringify } from "../src/meta/json-runtime.ts";
import { read } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { ranWith, receipts, sources } from "../tools/runs/receipt.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-skill-scripts-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const pull = (number: number, head: string, base: string, labels: readonly string[] = []): Pull => ({
  number,
  headRefName: head,
  baseRefName: base,
  headRefOid: String(number).repeat(40).slice(0, 40),
  isDraft: false,
  labels: labels.map((name) => ({ name })),
});

describe("the stack", () => {
  // #9 sits beside the stack with the highest number, off the middle.
  const pulls = [pull(9, "side", "a"), pull(3, "c", "b"), pull(1, "a", "main"), pull(2, "b", "a")];

  it("takes the deepest pull request for the top, not the highest number", () => {
    const { line, sides } = chain(pulls);
    expect(line.map((each) => each.number)).toStrictEqual([1, 2, 3]);
    expect(sides.map((each) => each.number)).toStrictEqual([9]);
    expect(stackTold(pulls, null)).toContain("top: #3 c at 3333333");
  });

  it("says of a branch whether anything is stacked on it", () => {
    expect(stackTold(pulls, "c").at(-1)).toBe("nothing is stacked on it: its commits may still be folded");
    expect(stackTold(pulls, "a").at(-1)).toBe("stacked on it: #9, #2. It takes new commits only");
    expect(stackTold(pulls, "side")[1]).toBe("beside the stack");
    expect(() => stackTold(pulls, "gone")).toThrow(CommandFailure);
  });

  it("ends each line in its importance, and says unranked where land would refuse it", () => {
    const ranked = [
      pull(1, "a", "main", ["importance:I1", "bug"]),
      pull(2, "b", "a"),
      pull(3, "c", "b", ["importance:I0", "importance:I3"]),
    ];
    expect(
      stackTold(ranked, null)
        .slice(0, 3)
        .map((line) => line.split("  ").at(-1)),
    ).toStrictEqual(["I1", "unranked", "unranked"]);
  });

  it("starts a chain on a base that has landed, and says so of an empty list", () => {
    const landed = [pull(5, "b", "a"), pull(4, "a", "landed"), pull(6, "lone", "main")];
    expect(chain(landed).line.map((each) => each.number)).toStrictEqual([4, 5]);
    expect(stackTold([], null)).toStrictEqual(["no pull request is open"]);
  });
});

describe("following the stack's top", () => {
  const native = (
    number: number,
    open: boolean,
    pulls: readonly [number, string, string][],
  ): NativeStack => ({
    number,
    open,
    pull_requests: pulls.map(([n, ref, state]) => ({ number: n, state, head: { ref } })),
  });
  const git = (repo: string, ...args: string[]) =>
    runTextSyncOrThrow(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t.dev", ...args]);
  const commit = (repo: string, file: string, text: string) => {
    writeFileSync(join(repo, file), text);
    git(repo, "add", file);
    git(repo, "commit", "-q", "-m", `write ${file}`);
  };
  const clone = (up: string, co: string) => {
    git(up, "clone", "-q", up, co);
    git(co, "config", "user.name", "t");
    git(co, "config", "user.email", "t@t.dev");
    git(co, "switch", "-q", "--track", "-c", "stack-pr1", "origin/claude/one");
  };

  it("takes the last open pull request of the longest open native stack", () => {
    const stacks = [
      native(150, false, [
        [140, "old", "closed"],
        [141, "older", "closed"],
        [142, "oldest", "closed"],
      ]),
      native(201, true, [
        [193, "a", "open"],
        [194, "b", "open"],
        [199, "c", "open"],
      ]),
      native(205, true, [[198, "side", "open"]]),
    ];
    expect(nativeTop(stacks)).toStrictEqual({ number: 199, branch: "c", pulls: [193, 194, 199] });
    expect(nativeTop(stacks.filter((stack) => !stack.open))).toBeUndefined();
  });

  it("moves a restacked checkout to the new top, keeps its uncommitted change and drops the old branch", () => {
    const up = join(root, "follow-up");
    const co = join(root, "follow-co");
    mkdirSync(up);
    git(up, "init", "-q", "-b", "main");
    commit(up, "mine.txt", "base\n");
    git(up, "switch", "-q", "-c", "claude/one");
    commit(up, "one.txt", "first\n");
    clone(up, co);
    // The stack is restacked: #1 is rewritten and #2 lands on it.
    git(up, "switch", "-q", "main");
    git(up, "branch", "-D", "claude/one");
    git(up, "switch", "-q", "-c", "claude/one");
    commit(up, "one.txt", "rewritten\n");
    git(up, "switch", "-q", "-c", "claude/two");
    commit(up, "two.txt", "second\n");
    git(co, "fetch", "-q", "--prune", "origin");
    writeFileSync(join(co, "mine.txt"), "changed here\n");
    writeFileSync(join(co, "untracked.txt"), "kept\n");

    const top = { number: 2, branch: "claude/two", pulls: [1, 2] };
    const said = follow(co, top);
    expect(said[0]).toStartWith("stack-pr2 at #2 claude/two");
    expect(said).toContain("deleted stack-pr1");
    expect(said).toContain("your uncommitted changes are back");
    expect(gitText(co, "rev-parse", "HEAD")).toBe(gitText(up, "rev-parse", "claude/two"));
    expect(gitText(co, "rev-parse", "--abbrev-ref", "@{upstream}")).toBe("origin/claude/two");
    expect(gitText(co, "branch", "--list", "stack-pr*")).toBe("* stack-pr2");
    expect(readFileSync(join(co, "mine.txt"), "utf8")).toBe("changed here\n");
    expect(readFileSync(join(co, "one.txt"), "utf8")).toBe("rewritten\n");
    expect(existsSync(join(co, "untracked.txt"))).toBe(true);
    expect(gitText(co, "stash", "list")).toBe("");
    expect(follow(co, top)[0]).toStartWith("stack-pr2 is already at #2");
  });

  it("moves a checkout to main once no pull request is open, and keeps its change where git refuses", () => {
    const up = join(root, "landed-up");
    const co = join(root, "landed-co");
    const held = join(root, "landed-held");
    mkdirSync(up);
    git(up, "init", "-q", "-b", "main");
    commit(up, "mine.txt", "base\n");
    git(up, "switch", "-q", "-c", "claude/one");
    commit(up, "one.txt", "first\n");
    clone(up, co);
    // #1 lands, main takes another change after it, and #1's branch goes.
    git(up, "switch", "-q", "main");
    git(up, "merge", "-q", "--no-ff", "-m", "land #1", "claude/one");
    commit(up, "after.txt", "newer\n");
    git(up, "branch", "-D", "claude/one");
    git(co, "fetch", "-q", "--prune", "origin");
    writeFileSync(join(co, "mine.txt"), "changed here\n");

    // Another worktree has main checked out, so git refuses the switch.
    git(co, "worktree", "add", "-q", "-b", "main", held, "origin/main");
    const before = gitText(co, "rev-parse", "HEAD");
    expect(() => follow(co, undefined)).toThrow();
    expect(gitText(co, "symbolic-ref", "--short", "HEAD")).toBe("stack-pr1");
    expect(gitText(co, "rev-parse", "HEAD")).toBe(before);
    expect(readFileSync(join(co, "mine.txt"), "utf8")).toBe("changed here\n");
    expect(gitText(co, "stash", "list")).toBe("");

    git(co, "worktree", "remove", held);
    const said = follow(co, undefined);
    expect(said[0]).toStartWith(`main at origin/main (${gitText(up, "rev-parse", "main").slice(0, 7)})`);
    expect(said).toContain("no pull request is open");
    expect(said).toContain("deleted stack-pr1");
    expect(said).toContain("your uncommitted changes are back");
    expect(gitText(co, "rev-parse", "HEAD")).toBe(gitText(up, "rev-parse", "main"));
    expect(gitText(co, "rev-parse", "--abbrev-ref", "@{upstream}")).toBe("origin/main");
    expect(gitText(co, "branch", "--list", "stack-pr*")).toBe("");
    expect(readFileSync(join(co, "mine.txt"), "utf8")).toBe("changed here\n");
    expect(existsSync(join(co, "after.txt"))).toBe(true);
    expect(gitText(co, "stash", "list")).toBe("");
    expect(follow(co, undefined)[0]).toStartWith("main is already at origin/main");
  });
});

describe("republishing a consolidated stack", () => {
  const git = (repo: string, ...args: string[]) =>
    runTextSyncOrThrow(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t.dev", ...args]);
  const up = join(root, "over-up");
  const co = join(root, "over-co");
  const sha = (repo: string, ref: string) => gitText(repo, "rev-parse", ref);
  const step = (file: string, text: string) => {
    writeFileSync(join(co, file), text);
    git(co, "add", file);
    git(co, "commit", "-q", "-m", `write ${file}`);
    return sha(co, "HEAD");
  };
  git(root, "init", "-q", "--bare", "-b", "main", up);
  git(root, "clone", "-q", up, co);
  step("base.txt", "base\n");
  git(co, "push", "-q", "origin", "HEAD:refs/heads/main");
  // The stack before: #1 a on main, #2 b on a, #3 c on b.
  const a0 = step("a.txt", "a\n");
  const b0 = step("b.txt", "b\n");
  const c0 = step("c.txt", "c\n");
  git(co, "push", "-q", "origin", `${a0}:refs/heads/a`, `${b0}:refs/heads/b`, `${c0}:refs/heads/c`);
  const pulls: Pull[] = [
    { ...pull(1, "a", "main"), headRefOid: a0 },
    { ...pull(2, "b", "a"), headRefOid: b0 },
    { ...pull(3, "c", "b"), headRefOid: c0 },
  ];
  // The consolidation: #1 rewritten, and #3 folded into #2.
  git(co, "fetch", "-q", "origin");
  git(co, "switch", "-q", "--detach", "origin/main");
  const a1 = step("a.txt", "a, reviewed\n");
  const b1 = step("bc.txt", "b and c\n");
  const heads = pairs("head", [`1=${a1}`, `#2=${b1}`]);
  const absorbed = new Map([[3, 2]]);

  it("pushes every moved head with a lease on the head GitHub showed, closes what was absorbed and relinks", () => {
    const plan = planConsolidation(co, pulls, heads, absorbed);
    expect(plan.moves.map((move) => [move.pull.number, move.to, move.base])).toStrictEqual([
      [1, a1, "main"],
      [2, b1, "a"],
    ]);
    expect(pushArgs(plan, "no-verify")).toStrictEqual([
      "push",
      "--atomic",
      "--no-verify",
      `--force-with-lease=refs/heads/a:${a0}`,
      `--force-with-lease=refs/heads/b:${b0}`,
      "origin",
      `${a1}:refs/heads/a`,
      `${b1}:refs/heads/b`,
    ]);
    expect(pushArgs(plan, "verify")).not.toContain("--no-verify");
    const asked: string[] = [];
    const stacks = [
      { number: 7, open: true, pull_requests: [{ number: 3, state: "open", head: { ref: "c" } }] },
    ];
    const said = republish(co, plan, "no-verify", (args) => {
      asked.push(args.join(" "));
      return args[0] === "api" ? capturedJsonStringify(stacks) : "";
    });
    expect(said).toContain("pushed 2 heads");
    expect([sha(up, "a"), sha(up, "b"), sha(up, "c")]).toStrictEqual([a1, b1, c0]);
    expect(asked).toStrictEqual([
      "api repos/{owner}/{repo}/stacks",
      "stack unstack 7",
      `pr close 3 --comment Closed when the stack was consolidated: this change is now part of #2 at ${b1.slice(0, 9)}.`,
      "stack link 1 2",
    ]);
  });

  it("pushes nothing where a lease fails, and refuses a stack off main or out of order", () => {
    // GitHub still shows the old heads, but the push above moved the remote, so no branch may move.
    const plan = planConsolidation(co, pulls, pairs("head", [`1=${b0}`, `2=${c0}`]), new Map());
    expect(() => republish(co, plan, "no-verify", () => "[]")).toThrow();
    expect([sha(up, "a"), sha(up, "b")]).toStrictEqual([a1, b1]);

    expect(() => planConsolidation(co, pulls, pairs("head", [`1=${b1}`, `2=${a1}`]), new Map())).toThrow(
      "does not hold #1's",
    );
    expect(() => planConsolidation(co, pulls, pairs("head", ["9=HEAD"]), new Map())).toThrow(
      "not on the open stack",
    );
    expect(() => planConsolidation(co, pulls, pairs("head", [`1=${a1}`]), absorbed)).toThrow(
      "absorbed into #2, which is given no new head",
    );
    expect(() => pairs("head", ["1=x", "1=y"])).toThrow("names #1 twice");

    // main is rewritten on the remote, as on 25 October: the same tree under a new commit.
    git(co, "switch", "-q", "--detach", "origin/main");
    git(co, "commit", "-q", "--amend", "--allow-empty", "--author", "u <u@u.dev>", "-C", "HEAD");
    git(co, "push", "-q", "--force", "origin", "HEAD:refs/heads/main");
    git(co, "fetch", "-q", "origin");
    expect(() => planConsolidation(co, pulls, heads, absorbed)).toThrow("does not hold origin/main");
  });
});

describe("the source a campaign's launches ran", () => {
  const repo = join(root, "repo");
  const folder = join(repo, ".ana", "d2", "buffer");
  mkdirSync(folder, { recursive: true });
  const git = (...args: string[]) =>
    runTextSyncOrThrow(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t.dev", ...args]);
  git("init", "-q");
  git("commit", "-q", "--allow-empty", "-m", "first");
  const first = gitText(repo, "rev-parse", "HEAD");
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "score.ts"), "export const WEIGHTS = 1;\n");
  writeFileSync(join(repo, "plan.md"), "export const ROOM\n");
  git("add", "src", "plan.md");
  git("commit", "-q", "-m", "second");
  const second = gitText(repo, "rev-parse", "HEAD");
  const receipt = (session: string, at: string, commit: string, dirty: boolean, bun?: string) =>
    writeFileSync(
      join(folder, `launch-${session}.json`),
      JSON.stringify({
        at,
        pid: 1,
        flags: ["--cap", "5"],
        envFile: "/private/x.env",
        commit,
        dirty,
        load: 3.2,
        cores: 8,
        bun,
      }),
    );

  it("says nothing was recorded for a campaign started by hand", () => {
    expect(receipts(join(folder, "log.jsonl"))).toStrictEqual([]);
    expect(sources(join(folder, "log.jsonl"), repo, [])[0]).toStartWith("no launch receipt");
  });

  it("says each launch's commit and what it holds, and nothing a receipt keeps private", () => {
    receipt("g1", "2026-10-09T14:00:00.000Z", second, true, "1.4.3");
    receipt("b-1", "2026-10-09T13:00:00.000Z", first, false);
    writeFileSync(join(folder, "launch-b-1.out"), "");
    const lines = sources(join(folder, "log.jsonl"), repo, [second]);
    expect(lines).toStrictEqual([
      `b-1  2026-10-09T13:00:00.000Z  ${first.slice(0, 9)}  clean  load 3.2 on 8 cores  bun unknown`,
      "  published on no remote branch",
      `  does not hold ${second.slice(0, 9)}`,
      `g1  2026-10-09T14:00:00.000Z  ${second.slice(0, 9)}  with uncommitted changes  load 3.2 on 8 cores  bun 1.4.3`,
      "  published on no remote branch",
      `  holds ${second.slice(0, 9)}`,
    ]);
    expect(lines.join("\n")).not.toContain("x.env");
  });

  it("says a campaign ran with a fix only where every launch holds it, by commit or by text", () => {
    const log = join(folder, "log.jsonl");
    expect(ranWith(log, repo, { holds: [first], has: [] })).toBe(true);
    expect(ranWith(log, repo, { holds: [second], has: [] })).toBe(false);
    expect(ranWith(log, repo, { holds: [], has: ["export const WEIGHTS"] })).toBe(false);
    receipt("b-1", "2026-10-09T13:00:00.000Z", second, false);
    expect(ranWith(log, repo, { holds: [second], has: ["export const WEIGHTS"] })).toBe(true);
    expect(ranWith(log, repo, { holds: [], has: ["export const ROOM"] })).toBe(false);
    expect(ranWith(join(root, "none", "log.jsonl"), repo, { holds: [], has: [] })).toBe(false);
  });
});

describe("an Oracle bundle", () => {
  const made = (name: string, files: Readonly<Record<string, string>>) => {
    const dir = join(root, name);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return dir;
  };

  it("zips a folder that holds the task document, and counts its files", () => {
    const dir = made("oracle-a", { "REVIEW.md": "# Review\n", "notes/predictions.md": "held\n" });
    const { out, bytes, files } = bundle(dir, 1024 * 1024);
    expect(out).toBe(`${dir}.zip`);
    expect(files).toBe(2);
    expect(bytes).toBeGreaterThan(0);
    expect(runTextSyncOrThrow(["unzip", "-Z1", out]).split("\n")).toContain("oracle-a/REVIEW.md");
  });

  it("refuses a folder with no task document, a credential-shaped line and a zip over its size", () => {
    expect(() => bundle(made("oracle-b", { "notes/a.md": "x\n" }), 1024)).toThrow("holds no REVIEW.md");
    const key = ["sk-ant-api03-", "Xy7Qm2Lp9RtVw4Zc8Nb1Hj6Kd3Gs0Ge5"].join("");
    const leaky = made("oracle-c", {
      "REVIEW.md": "# Review\n",
      "notes/a.md": `Authorization: Bearer ${key}\n`,
    });
    expect(() => bundle(leaky, 1024 * 1024)).toThrow("notes/a.md:1");
    expect(existsSync(`${leaky}.zip`)).toBe(false);
    const big = made("oracle-d", { "REVIEW.md": "# Review\n" });
    expect(() => bundle(big, 10)).toThrow("over its");
    expect(existsSync(`${big}.zip`)).toBe(false);
  });
});

describe("a live seat's reading", () => {
  const log = join(root, "seat", "log.jsonl");
  const at = (minute: number) => `2026-10-19T00:${String(minute).padStart(2, "0")}:00.000Z`;
  const line = (minute: number, kind: string, data: JsonObject) =>
    JSON.stringify({ at: at(minute), kind, data });
  const gate = (outcome: string, reference: JsonObject | null, extra: JsonObject = {}) =>
    line(5, "task.gate", {
      version: "v",
      gate: 1,
      outcome,
      reason: "r",
      ...(reference && { reference }),
      ...extra,
    });
  mkdirSync(join(root, "seat"), { recursive: true });
  writeFileSync(
    log,
    `${[
      line(0, "exam.started", { session: "x-1" }),
      line(1, "task.gate", {
        version: "v0",
        gate: 1,
        outcome: "refused",
        reason: "r",
        reference: { valid: 3, solves: 3 },
      }),
      line(2, "exam.finished", { session: "x-1", ended: "finished", billed: 5 }),
      line(3, "exam.started", { session: "x-2" }),
      line(4, "task.proposed", { session: "x-2" }),
      line(4, "task.proposed", { session: "x-2" }),
      gate("refused", { valid: 3, solves: 3 }),
      gate("refused", { valid: 1, solves: 3 }),
      gate("passed", { valid: 2, solves: 3 }),
      gate("passed", { valid: 0, solves: 3 }, { proved: true }),
      gate("refused", null),
      gate("refused", { valid: 0, solves: 1 }),
      line(6, "exam.call", {
        session: "x-2",
        tool: "bash",
        args: { command: "cat reference-harness/agent/BUILT_AGENTS.md" },
      }),
      line(6, "exam.call", { session: "x-2", tool: "try_task", args: { task: {} } }),
      line(9, "exam.finished", { session: "x-2", ended: "finished", billed: 2.5 }),
    ].join("\n")}\n`,
  );

  it("reads only the stretch from where the seat began, each gate by what the reference's solves did", () => {
    const reading = readingOf(read(log), 3, ["reference-harness"]);
    expect(reading.billed).toBeCloseTo(2.5, 6);
    expect(reading.minutes).toBe(6);
    expect(reading.sessions).toStrictEqual(["x-2"]);
    expect(reading.ended).toStrictEqual(["finished"]);
    expect(reading.proposed).toBe(2);
    expect(reading.gates).toStrictEqual({ every: 1, some: 2, "none, proved": 1, package: 1, unread: 1 });
    expect(reading.held).toBe(2);
    expect(reading.ran).toStrictEqual([3, 3, 3, 3, 1]);
    expect(reading.calls).toStrictEqual({ bash: 1, try_task: 1 });
    expect(reading.mentions).toStrictEqual({ "reference-harness": 1 });
    expect(reading.turns).toBeNull();
    expect(seatTold(reading)[2]).toContain("held 2");
  });

  it("starts no seat on a campaign that is no seed", () => {
    const folder = join(root, "tree", ".ana", "d2", "sim-plain");
    mkdirSync(folder, { recursive: true });
    const script = join(import.meta.dir, "..", ".claude/skills/system-path-simulation/scripts/live-seat.ts");
    const flags = [
      "--tree",
      join(root, "tree"),
      "--out",
      join(root, "seat-out"),
      "--cap",
      "1",
      "--minutes",
      "1",
    ];
    for (const name of ["sim-plain", "buffer"]) {
      const result = runSync([capturedExecPath, script, "start", ...flags, "--name", name, "--", "x.ts"]);
      expect(result.exitCode).not.toBe(0);
      expect(decodeOutput(result.stderr)).toContain("is no seed");
    }
    expect(existsSync(join(root, "seat-out.json"))).toBe(false);
  });

  it("tells each gate, ruling and session end once, and a hook only while something is unread", () => {
    expect(newsOf(read(log), 3)).toStrictEqual([
      "gate refused, every",
      "gate refused, some",
      "gate passed, some",
      "gate passed, none, proved",
      "gate refused, package",
      "gate refused, unread",
      "x-2 ended finished",
    ]);
    const folder = join(root, "due", ".ana", "d2", "sim-due");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "log.jsonl"), readFileSync(log, "utf8"));
    const seat = join(root, "due-seat");
    writeFileSync(
      `${seat}.json`,
      JSON.stringify({ tree: join(root, "due"), name: "sim-due", from: 3, pid: null }),
    );
    const script = join(import.meta.dir, "..", ".claude/skills/system-path-simulation/scripts/live-seat.ts");
    const first = runSync([capturedExecPath, script, "due", seat, "--hook"]);
    expect(first.exitCode).toBe(2);
    expect(decodeOutput(first.stderr)).toContain("due-seat: x-2 ended finished");
    const again = runSync([capturedExecPath, script, "due", seat, "--hook"]);
    expect(again.exitCode).toBe(0);
    expect(decodeOutput(again.stderr)).toBe("");
  });

  it("seats the Referee only on a seed, before it opens any campaign", () => {
    const script = join(
      import.meta.dir,
      "..",
      ".claude/skills/system-path-simulation/scripts/referee-seat.ts",
    );
    const flags = ["--solve", "s-1", "--reviewer", "claude/claude-opus-5-5"];
    mkdirSync(join(root, "tree"), { recursive: true });
    const result = runSync([capturedExecPath, script, "--name", "buffer", ...flags], {
      cwd: join(root, "tree"),
    });
    expect(result.exitCode).not.toBe(0);
    expect(decodeOutput(result.stderr)).toContain("is no seed");
    expect(existsSync(join(root, "tree", ".ana", "d2", "buffer"))).toBe(false);
  });
});
