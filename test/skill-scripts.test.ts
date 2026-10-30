// The scripts the operator's skills share: the stack as its edges, the move to its top and the
// republishing of a consolidated stack, the source a campaign's launches ran, the closing of an Oracle
// bundle, and the reading of a live seat.
import { afterAll, describe, expect, it } from "bun:test";
import { gitText } from "#src/meta/git.ts";
import { bundle } from "#skills/oracle-handover/scripts/bundle.ts";
import { follow, type NativeStack, nativeTop } from "#skills/stack-pr/scripts/follow.ts";
import { pairLines } from "#skills/compare-systems/scripts/systems.ts";
import { censusOf, newsOf } from "#skills/system-path-simulation/scripts/live-seat.ts";
import { pairs, planConsolidation, pushArgs, republish } from "#skills/stack-pr/scripts/republish.ts";
import { chains, told as stackTold } from "#skills/stack-pr/scripts/stack.ts";
import type { Pull } from "#tools/runtime/pulls.ts";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { decodeOutput, runSync, runTextSyncOrThrow } from "../src/meta/subprocess.ts";
import { capturedJsonStringify, parseJsonAs } from "../src/meta/json-runtime.ts";
import { LOG_FILE, read } from "../src/kernel/log.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { capturedExecPath, capturedSpawn } from "../src/meta/process.ts";
import { sources } from "../tools/runs/receipt.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-skill-scripts-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const script = join(import.meta.dir, "..", ".claude/skills/system-path-simulation/scripts/live-seat.ts");
const git = (repo: string, ...args: string[]) =>
  runTextSyncOrThrow(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t.dev", ...args]);

const pull = (number: number, head: string, base: string, labels: readonly string[] = []): Pull => ({
  number,
  headRefName: head,
  baseRefName: base,
  headRefOid: String(number).repeat(40).slice(0, 40),
  isDraft: false,
  labels: labels.map((name) => ({ name })),
});

describe("the stack", () => {
  it("lists each stack on main with its own top, longest first, and a fork off the middle apart", () => {
    const several = [pull(7, "lone", "main"), pull(1, "a", "main"), pull(2, "b", "a"), pull(9, "side", "a")];
    const { stacks, sides } = chains(several);
    expect(stacks.map((line) => line.map((each) => each.number))).toStrictEqual([[1, 2], [7]]);
    expect(sides.map((each) => each.number)).toStrictEqual([9]);
    expect(stackTold(several, null).filter((line) => line.startsWith("top:"))).toStrictEqual([
      "top: #2 b at 2222222",
      "top: #7 lone at 7777777",
    ]);
    expect(stackTold(several, "lone")[1]).toBe("on the stack whose top: #7 lone at 7777777");
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
  const commit = (repo: string, file: string, text: string) => {
    writeFileSync(join(repo, file), text);
    git(repo, "add", file);
    git(repo, "commit", "-q", "-m", `write ${file}`);
  };

  it("takes the last open pull request of the open native stack that holds the oldest one", () => {
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
      native(205, true, [
        [190, "first", "open"],
        [196, "second", "open"],
      ]),
      native(208, true, [[180, "gone", "closed"]]),
    ];
    expect(nativeTop(stacks)).toStrictEqual({ number: 196, branch: "second", pulls: [190, 196] });
    expect(nativeTop(stacks.filter((stack) => stack.number !== 205))).toStrictEqual({
      number: 199,
      branch: "c",
      pulls: [193, 194, 199],
    });
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
    git(up, "clone", "-q", up, co);
    git(co, "config", "user.name", "t");
    git(co, "config", "user.email", "t@t.dev");
    git(co, "switch", "-q", "--track", "-c", "stack-pr1", "origin/claude/one");
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
});

describe("republishing a consolidated stack", () => {
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

  it("prints every publication operation in order in a dry run without changing a head or GitHub", () => {
    const plan = planConsolidation(co, pulls, heads, absorbed);
    const asked: string[] = [];
    const said = republish(
      co,
      plan,
      "no-verify",
      (args) => {
        asked.push(args.join(" "));
        return capturedJsonStringify([
          { number: 7, open: true, pull_requests: [{ number: 1, state: "open", head: { ref: "a" } }] },
        ]);
      },
      "dry-run",
    );
    expect([sha(up, "a"), sha(up, "b")], "a dry run must leave the heads unchanged").toStrictEqual([a0, b0]);
    expect(asked).toStrictEqual(["api repos/{owner}/{repo}/stacks"]);
    expect(said).toStrictEqual([
      "gh 'stack' 'unstack' '7'",
      "gh 'pr' 'edit' '1' '--base' 'main'",
      "gh 'pr' 'edit' '2' '--base' 'main'",
      `git ${pushArgs(plan, "no-verify")
        .map((arg) => `'${arg}'`)
        .join(" ")}`,
      "gh 'pr' 'edit' '1' '--base' 'main'",
      "gh 'pr' 'edit' '2' '--base' 'a'",
      `gh 'pr' 'close' '3' '--comment' 'Closed when the stack was consolidated: this change is now part of #2 at ${b1.slice(0, 9)}.'`,
      "gh 'stack' 'link' '1' '2'",
    ]);
  });

  it("unstacks and retargets every survivor before pushing leased heads, then sets bases, closes and relinks", () => {
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
      if (sha(up, "a") === a1 && !asked.includes("git push")) asked.push("git push");
      asked.push(args.join(" "));
      return args[0] === "api" ? capturedJsonStringify(stacks) : "";
    });
    expect(said).toContain(
      `git ${pushArgs(plan, "no-verify")
        .map((arg) => `'${arg}'`)
        .join(" ")}`,
    );
    expect([sha(up, "a"), sha(up, "b"), sha(up, "c")]).toStrictEqual([a1, b1, c0]);
    expect(asked, "heads must be pushed only after unstacking and retargeting every survivor").toStrictEqual([
      "api repos/{owner}/{repo}/stacks",
      "stack unstack 7",
      "pr edit 1 --base main",
      "pr edit 2 --base main",
      "git push",
      "pr edit 1 --base main",
      "pr edit 2 --base a",
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
  git(repo, "init", "-q");
  git(repo, "commit", "-q", "--allow-empty", "-m", "first");
  const first = gitText(repo, "rev-parse", "HEAD");
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "score.ts"), "export const WEIGHTS = 1;\n");
  writeFileSync(join(repo, "plan.md"), "export const ROOM\n");
  git(repo, "add", "src", "plan.md");
  git(repo, "commit", "-q", "-m", "second");
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
    const first = runSync([capturedExecPath, script, "due", seat, "--hook"]);
    expect(first.exitCode).toBe(2);
    expect(decodeOutput(first.stderr)).toContain("due-seat: x-2 ended finished");
    const again = runSync([capturedExecPath, script, "due", seat, "--hook"]);
    expect(again.exitCode).toBe(0);
    expect(decodeOutput(again.stderr)).toBe("");
  });

  it("compares two arms at the same count of gates, stops only a seat running here, and closes one not seated", () => {
    const folder = join(root, "arms", ".ana", "d2", "sim-arms");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "log.jsonl"), readFileSync(log, "utf8"));
    const arm = (name: string, from: number) => {
      const seat = join(root, name);
      writeFileSync(
        `${seat}.json`,
        JSON.stringify({ tree: join(root, "arms"), name: "sim-arms", from, pid: null }),
      );
      return seat;
    };
    const [late, early] = [arm("arm-late", 3), arm("arm-early", 0)];
    const whole = decodeOutput(runSync([capturedExecPath, script, "compare", late, early]).stdout);
    expect(whole).toMatch(/^gated\s+5\s+6\s*$/mu);
    expect(whole).toMatch(/^held\s+2\s+2\s*$/mu);
    const cut = decodeOutput(
      runSync([capturedExecPath, script, "compare", late, early, "--gates", "2"]).stdout,
    );
    expect(cut).toMatch(/^gated\s+2\s+2\s*$/mu);
    expect(cut).toMatch(/^held\s+0\s+0\s*$/mu);
    const pending = join(root, "arm-pending");
    const stopped = runSync([capturedExecPath, script, "stop", late, pending]);
    expect(stopped.exitCode).not.toBe(0);
    expect(decodeOutput(stopped.stderr)).toContain("no process group running on this host");
    expect(existsSync(`${late}.stopped`)).toBe(false);
    // The pending seat is closed, so a seating script that comes to it later seats nothing.
    const seated = runSync([
      capturedExecPath,
      script,
      "start",
      "--tree",
      join(root, "arms"),
      "--name",
      "sim-arms",
      "--out",
      pending,
      "--cap",
      "1",
      "--minutes",
      "1",
      "--",
      "x.ts",
    ]);
    expect(seated.exitCode).not.toBe(0);
    expect(decodeOutput(seated.stderr)).toContain("was stopped");
    expect(existsSync(`${pending}.json`)).toBe(false);
  });

  it("ends a stopped seat's start as soon as its group is gone, with the reading", async () => {
    const tree = join(root, "running");
    const folder = join(tree, ".ana", "d2", "sim-running");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, LOG_FILE), readFileSync(log, "utf8"));
    writeFileSync(join(folder, "seed.json"), JSON.stringify({ from: "/runs/job", events: 3 }));
    const ready = join(tree, "ready");
    writeFileSync(
      join(tree, "idle.ts"),
      `await Bun.write(${JSON.stringify(ready)}, "ready"); await Bun.sleep(120_000);\n`,
    );
    runTextSyncOrThrow(["git", "init", "-q", tree]);
    runTextSyncOrThrow([
      "git",
      "-C",
      tree,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "seed",
    ]);
    const seat = join(root, "running-seat");
    const flags = ["--tree", tree, "--name", "sim-running", "--out", seat, "--cap", "5", "--minutes", "5"];
    const started = capturedSpawn([capturedExecPath, script, "start", ...flags, "--", "idle.ts"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const deadline = Date.now() + 5000;
    while (
      (!existsSync(ready) || !existsSync(`${seat}.json`)) &&
      started.exitCode === null &&
      Date.now() < deadline
    ) {
      await Bun.sleep(10);
    }
    const stoppedAt = Date.now();
    // Spawned rather than run in step, so this process reaps the start as soon as it ends.
    const stopped = capturedSpawn([capturedExecPath, script, "stop", seat], { stdout: "pipe" });
    expect(await started.exited).toBe(1);
    // The start wakes on its group's end, well inside its 30-second tick.
    expect(Date.now() - stoppedAt).toBeLessThan(10_000);
    expect(await stopped.exited).toBe(0);
    expect(existsSync(ready)).toBe(true);
    expect(await new Response(started.stdout).text()).toContain("stopped at live-seat stop");
  });

  it("reads pairs at the shorter arm's gates, signs each measure past thin pairs, and refuses a pair of two seats or two cuts", () => {
    const head = readFileSync(log, "utf8").split("\n").slice(0, 3);
    const seed = (name: string, lines: readonly string[], events = 3) => {
      const folder = join(root, "pairs", ".ana", "d2", name);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, LOG_FILE), `${lines.join("\n")}\n`);
      writeFileSync(join(folder, "seed.json"), JSON.stringify({ from: "/runs/job", events }));
    };
    const seat = (prefix: string, name: string, examiner: string) => {
      const command = ["tools/d1b/examine.ts", "--examiner", examiner, "--examiner-effort", "high"];
      writeFileSync(
        join(root, `${prefix}.json`),
        JSON.stringify({ tree: join(root, "pairs"), name, commit: prefix, command, from: 3, pid: null }),
      );
      return join(root, prefix);
    };
    // Four gates the reference closes take the arm to six, past THIN.
    const closed = Array.from({ length: 4 }, () => gate("refused", { valid: 3, solves: 3 }));
    seed("sim-control", [...readFileSync(log, "utf8").trimEnd().split("\n"), ...closed]);
    seed("sim-arm", [
      ...head,
      gate("passed", { valid: 1, solves: 3, gap: 0.05 }),
      gate("passed", { valid: 0, solves: 3 }, { proved: true }),
      ...closed,
    ]);
    seed("sim-other-cut", head, 2);
    const control = seat("p-control", "sim-control", "openai-codex/gpt-6.1-sol");
    const arm = seat("p-arm", "sim-arm", "openai-codex/gpt-6.1-sol");
    const result = runSync([capturedExecPath, script, "pairs", `${control},${arm}`]);
    expect(result.exitCode).toBe(0);
    const out = decodeOutput(result.stdout);
    // At the arm's six gates the control has held two of its own; only the arm's author beat the room floor.
    expect(out).toMatch(
      /^p-control,p-arm\s+openai-codex\/gpt-6\.1-sol high\s+6\s+2 \/ 2\s+3 \/ 2\s+0 \/ 1\s/mu,
    );
    expect(out).toMatch(/^\s+held\s+more in 0, fewer in 0, the same in 1$/mu);
    expect(out).toMatch(/^\s+gap >= 1%\s+more in 1, fewer in 0, the same in 0$/mu);
    expect(out).toMatch(/^\s+median turns\s+more in 0, fewer in 0, the same in 0$/mu);
    const thin = decodeOutput(
      runSync([capturedExecPath, script, "pairs", `${control},${arm}`, "--gates", "2"]).stdout,
    );
    // At two gates the control refused an every and a some, the arm held a some and a proved none.
    expect(thin).toMatch(/^p-control,p-arm\s+\S+ high\s+2 thin\s+0 \/ 2\s+1 \/ 2\s+0 \/ 1\s/mu);
    expect(thin).toMatch(/^\s+held\s+more in 0, fewer in 0, the same in 0$/mu);
    expect(thin).toContain("thin, not counted: p-control,p-arm");
    const opus = seat("p-opus", "sim-arm", "claude/claude-opus-5-5");
    const models = runSync([capturedExecPath, script, "pairs", `${control},${opus}`]);
    expect(models.exitCode).not.toBe(0);
    expect(decodeOutput(models.stderr)).toContain("claude/claude-opus-5-5");
    const cuts = runSync([
      capturedExecPath,
      script,
      "pairs",
      `${control},${seat("p-cut", "sim-other-cut", "openai-codex/gpt-6.1-sol")}`,
    ]);
    expect(cuts.exitCode).not.toBe(0);
    expect(decodeOutput(cuts.stderr)).toContain("at event 2");
  });

  it("reads a seed's log from its cut, and refuses to seat a seed whose links point at nothing", () => {
    const folder = join(root, "cut", ".ana", "d2", "sim-cut");
    mkdirSync(join(folder, "states", "h"), { recursive: true });
    writeFileSync(join(folder, LOG_FILE), readFileSync(log, "utf8"));
    writeFileSync(join(folder, "seed.json"), JSON.stringify({ from: "/runs/job", events: 3 }));
    const reading = runSync([capturedExecPath, script, "read", "--log", join(folder, LOG_FILE), "--json"]);
    expect(reading.exitCode).toBe(0);
    expect(parseJsonAs<{ sessions: string[] }>(decodeOutput(reading.stdout)).sessions).toStrictEqual(["x-2"]);
    expect(runSync([capturedExecPath, script, "read", "--log", log]).exitCode).not.toBe(0);
    symlinkSync("../nowhere", join(folder, "states", "h", ".toolchain"));
    const started = runSync([
      capturedExecPath,
      script,
      "start",
      "--tree",
      join(root, "cut"),
      "--name",
      "sim-cut",
      "--out",
      join(root, "cut-seat"),
      "--cap",
      "1",
      "--minutes",
      "1",
      "--",
      "x.ts",
    ]);
    expect(started.exitCode).not.toBe(0);
    expect(decodeOutput(started.stderr)).toContain(join(folder, "states", "h", ".toolchain"));
    expect(existsSync(join(root, "cut-seat.json"))).toBe(false);
  });

  it("counts each Examiner call once across copies of a log, its failures by the line that names them", () => {
    const call = (tool: string, extra: JsonObject = {}) =>
      line(1, "exam.call", { session: "x-1", tool, args: {}, isError: false, text: "", ...extra });
    const events = [
      line(0, "exam.started", { session: "x-1" }),
      call("bash", {
        isError: true,
        text: "out\nModuleNotFoundError: No module named 'scipy'\n\nTurn 3 of 200; 1 of 240 minutes used.\nCommand exited with code 1",
      }),
      call("finish"),
      call("read_example", {
        isError: true,
        text: "x-1-006 is not one of the tasks: ex-001\n\nTurn 9 of 200",
      }),
      call("finish"),
    ].map((each, index) => ({ ...parseJsonAs<LogEvent>(each), at: at(index) }));
    const census = censusOf([events, events.slice(0, 4)]);
    expect(census.logs).toBe(2);
    expect(census.sessions).toBe(1);
    expect(census.calls).toStrictEqual({ bash: 1, finish: 2, read_example: 1 });
    expect(census.failed).toStrictEqual({ bash: 1, read_example: 1 });
    expect(Object.keys(census.kinds).toSorted()).toStrictEqual([
      "bash: ModuleNotFoundError: No module named 'scipy'",
      "read_example: x-N-N is not one of the tasks: ex-N",
    ]);
    expect(census.finishes).toStrictEqual([2, 1]);
    // On a seed only the calls after its cut are the seat's: the two before it are its source's.
    const folder = join(root, "census", ".ana", "d2", "sim-census");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, LOG_FILE), `${events.map((each) => JSON.stringify(each)).join("\n")}\n`);
    writeFileSync(join(folder, "seed.json"), JSON.stringify({ from: "/runs/job", events: 3 }));
    const counted = decodeOutput(runSync([capturedExecPath, script, "calls", folder]).stdout);
    expect(counted).toMatch(/^2 Examiner calls in /mu);
    expect(counted).toMatch(/^ {2}read_example 1, failed 1$/mu);
    expect(counted).not.toMatch(/^ {2}bash /mu);
  });
});

describe("compare-systems reads a candidate against the baseline as a comparison does", () => {
  const system = (name: string) => ({ name, model: "m", effort: "high", harness: "starter" });
  const solvedAs = (valid: boolean, aside: boolean) =>
    new Map(
      ["t1", "t2", "t3", "t4", "t5", "t6"].map((task) => [
        task,
        {
          valid: [valid, valid],
          measure: [null, null],
          billed: [1, 1],
          seconds: [60, 60],
          turns: [4, 4],
          aside: [aside, aside],
        },
      ]),
    );
  const at = { solves: 2, level: 0.02, direction: undefined };

  it("reports the winner in either direction, excludes unsettled tasks and leaves ties undecided", () => {
    const fails = solvedAs(false, false);
    const passes = solvedAs(true, false);
    const aside = solvedAs(false, true);
    for (const [baseline, old, candidate, fresh, facts] of [
      ["cheap", fails, "dear", passes, ["dear won 6, lost 0, tied 0", "dear is better", "0 more tasks"]],
      ["dear", passes, "cheap", fails, ["cheap won 0, lost 6, tied 0", "dear is better"]],
      ["cheap", aside, "dear", passes, ["on the 0 tasks", "6 more tasks", "no step either way"]],
      ["a", passes, "b", passes, ["b won 0, lost 0, tied 6", "no step either way"]],
    ] as const) {
      const lines = pairLines([system(baseline), old], [system(candidate), fresh], at).join("\n");
      for (const fact of facts) expect(lines).toContain(fact);
    }
  });
});
