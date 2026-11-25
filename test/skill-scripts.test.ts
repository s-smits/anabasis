// The scripts the operator's skills share: the stack as its edges, the move to its top and the
// republishing of a consolidated stack, the source a campaign's launches ran, the closing of an Oracle
// bundle and its folder of open pull requests, and the reading of a live seat.
import { afterAll, describe, expect, it } from "bun:test";
import { gitText } from "#src/meta/git.ts";
import { analyzeStack, formatAnalysis, parseNumstat } from "#skills/consolidate-stack/scripts/analyze.ts";
import { bundle } from "#skills/oracle-handover/scripts/bundle.ts";
import { sanitised, seenParts, untested } from "#skills/oracle-handover/scripts/document.ts";
import { pasted, pullsInto } from "#skills/oracle-handover/scripts/open-pulls.ts";
import {
  keptRepublish,
  pairs,
  planConsolidation,
  pushArgs,
  replayedHeads,
  republish,
} from "#skills/stack-pr/scripts/republish.ts";
import { follow, hazards, targetOf } from "#tools/runtime/follow.ts";
import { firstStack, offMain, type Pull, stackHolding } from "#tools/runtime/pulls.ts";
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
import { capturedExecPath } from "../src/meta/process.ts";
import { sources } from "../tools/runs/receipt.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-skill-scripts-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const git = (repo: string, ...args: string[]) =>
  runTextSyncOrThrow(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t.dev", ...args]);

const commitFile = (repo: string, file: string, text: string) => {
  writeFileSync(join(repo, file), text);
  git(repo, "add", file);
  git(repo, "commit", "-q", "-m", `write ${file}`);
};

const pull = (number: number, head: string, base: string, labels: readonly string[] = []): Pull => ({
  number,
  headRefName: head,
  baseRefName: base,
  headRefOid: String(number).repeat(40).slice(0, 40),
  isDraft: false,
  labels: labels.map((name) => ({ name })),
});

describe("following the stack's top", () => {
  it("follows the end of the stack land lands first, named stack-pr<top>, or the trunk where none is open", () => {
    const open = [pull(193, "a", "main"), pull(194, "b", "a"), pull(199, "c", "b"), pull(4, "lone", "main")];
    expect(targetOf(firstStack([...open, pull(202, "e", "c")]), "main")).toStrictEqual({
      trunk: "main",
      name: "stack-pr202",
      upstream: "origin/e",
      said: "#202 e",
      pulls: [193, 194, 199, 202],
    });
    expect(targetOf(firstStack([]), "main")).toStrictEqual({
      trunk: "main",
      name: "main",
      upstream: "origin/main",
      said: "origin/main",
      pulls: [],
    });
  });

  it("moves a restacked checkout to the new top, keeps its uncommitted change and drops the old branch", () => {
    const up = join(root, "follow-up");
    const co = join(root, "follow-co");
    mkdirSync(up);
    git(up, "init", "-q", "-b", "main");
    commitFile(up, "mine.txt", "base\n");
    git(up, "switch", "-q", "-c", "claude/one");
    commitFile(up, "one.txt", "first\n");
    git(up, "clone", "-q", up, co);
    git(co, "config", "user.name", "t");
    git(co, "config", "user.email", "t@t.dev");
    git(co, "switch", "-q", "--track", "-c", "stack-pr1", "origin/claude/one");
    git(up, "switch", "-q", "main");
    git(up, "branch", "-D", "claude/one");
    git(up, "switch", "-q", "-c", "claude/one");
    commitFile(up, "one.txt", "rewritten\n");
    git(up, "switch", "-q", "-c", "claude/two");
    commitFile(up, "two.txt", "second\n");
    git(co, "fetch", "-q", "--prune", "origin");
    writeFileSync(join(co, "mine.txt"), "changed here\n");
    writeFileSync(join(co, "untracked.txt"), "kept\n");

    const top = targetOf([pull(1, "claude/one", "main"), pull(2, "claude/two", "claude/one")], "main");
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

describe("the hourly follow's reasons not to move", () => {
  const up = join(root, "safe-up");
  const co = join(root, "safe-co");
  mkdirSync(up);
  git(up, "init", "-q", "-b", "main");
  commitFile(up, "shared.txt", "base\n");
  commitFile(up, "other.txt", "base\n");
  git(up, "switch", "-q", "-c", "claude/top");
  commitFile(up, "shared.txt", "top\n");
  commitFile(up, "new.txt", "top\n");
  git(up, "switch", "-q", "main");
  git(up, "clone", "-q", up, co);
  git(co, "config", "user.name", "t");
  git(co, "config", "user.email", "t@t.dev");
  const later = () => Date.now() + 3_600_000;
  const target = targetOf([pull(1, "claude/top", "main")], "main");
  const why = (now = later()) => hazards(co, target, now);

  it("finds none on a clean checkout, and carries an edit the top does not touch", () => {
    expect(why()).toStrictEqual([]);
    writeFileSync(join(co, "other.txt"), "mine\n");
    expect(why(), "an edit that merges onto the top is carried, not a reason").toStrictEqual([]);
    expect(why(Date.now()).join("\n"), "an edit made just now is").toContain(
      "edited in the last 10 minutes: other.txt",
    );
    expect(gitText(co, "stash", "list"), "the checks stash nothing").toBe("");
  });

  it("names a conflicting edit, a file in the way, a branch it does not own and a git operation under way", () => {
    writeFileSync(join(co, "shared.txt"), "mine\n");
    writeFileSync(join(co, "new.txt"), "mine, untracked\n");
    git(co, "switch", "-q", "-c", "feature");
    const said = why().join("\n");
    expect(said).toContain("would conflict with the top: shared.txt");
    expect(said).toContain("files the top adds are here already: new.txt");
    expect(said).toContain("on feature, which follow does not own");
    writeFileSync(join(co, ".git", "index.lock"), "");
    expect(why()).toStrictEqual(["a git operation is under way here (index.lock)"]);
    rmSync(join(co, ".git", "index.lock"));
    writeFileSync(join(co, ".git", "info", "exclude"), "new.txt\n");
    expect(why().join("\n"), "an ignored file the top adds is in the way too").toContain(
      "files the top adds are here already: new.txt",
    );
    expect(readFileSync(join(co, "shared.txt"), "utf8"), "nothing moved").toBe("mine\n");
  });

  it("does not count the follow that asks as work running in the checkout", () => {
    // The verb runs from tools/runtime/, a path the hazards read as work, with the checkout as its
    // working folder; a probe of the same shape stands in for it.
    const clean = join(root, "safe-own");
    git(root, "clone", "-q", up, clean);
    const probe = join(root, "tools", "runtime", "probe.ts");
    mkdirSync(join(root, "tools", "runtime"), { recursive: true });
    writeFileSync(
      probe,
      [
        `import { hazards, targetOf } from ${capturedJsonStringify(join(import.meta.dir, "..", "tools", "runtime", "follow.ts"))};`,
        `const target = targetOf([{ number: 1, headRefName: "claude/top", baseRefName: "main" }], "main");`,
        `console.log(JSON.stringify(hazards(${capturedJsonStringify(clean)}, target, Date.now() + 3_600_000)));`,
      ].join("\n"),
    );
    const asked = runSync([capturedExecPath, probe], { cwd: clean });
    expect(decodeOutput(asked.stdout).trim(), decodeOutput(asked.stderr)).toBe("[]");
  });

  it("refuses to switch over an ignored file the top adds, and keeps it", () => {
    const kept = join(root, "safe-ignored");
    git(root, "clone", "-q", up, kept);
    writeFileSync(join(kept, ".git", "info", "exclude"), "new.txt\n");
    writeFileSync(join(kept, "new.txt"), "mine, ignored\n");
    expect(() => follow(kept, target)).toThrow("would be overwritten");
    expect(readFileSync(join(kept, "new.txt"), "utf8")).toBe("mine, ignored\n");
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
  const a0 = step("a.txt", "a\n");
  const b0 = step("b.txt", "b\n");
  const c0 = step("c.txt", "c\n");
  git(co, "push", "-q", "origin", `${a0}:refs/heads/a`, `${b0}:refs/heads/b`, `${c0}:refs/heads/c`);
  const pulls: Pull[] = [
    { ...pull(1, "a", "main"), headRefOid: a0 },
    { ...pull(2, "b", "a"), headRefOid: b0 },
    { ...pull(3, "c", "b"), headRefOid: c0 },
  ];
  git(co, "fetch", "-q", "origin");
  git(co, "switch", "-q", "--detach", "origin/main");
  const a1 = step("a.txt", "a, reviewed\n");
  const b1 = step("bc.txt", "b and c\n");
  const heads = pairs("head", [`1=${a1}`, `#2=${b1}`]);
  const absorbed = new Map([[3, 2]]);

  it("prints every publication operation in order in a dry run without changing a head or GitHub", () => {
    const plan = planConsolidation(co, pulls, heads, absorbed, "main");
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
      "gh 'pr' 'edit' '3' '--base' 'main'",
      `git ${pushArgs(plan, "no-verify")
        .map((arg) => `'${arg}'`)
        .join(" ")}`,
      "gh 'pr' 'edit' '1' '--base' 'main'",
      "gh 'pr' 'edit' '2' '--base' 'a'",
      `gh 'pr' 'close' '3' '--comment' 'Closed when the stack was consolidated: this change is now part of #2 at ${b1.slice(0, 9)}.'`,
      "gh 'stack' 'link' '1' '2'",
    ]);
  });

  it("unstacks and retargets every survivor and absorbed pull request before pushing leased heads, then sets bases, closes and relinks", () => {
    const plan = planConsolidation(co, pulls, heads, absorbed, "main");
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
    expect(
      asked,
      "heads must be pushed only after unstacking and retargeting every pull request",
    ).toStrictEqual([
      "api repos/{owner}/{repo}/stacks",
      "stack unstack 7",
      "pr edit 1 --base main",
      "pr edit 2 --base main",
      "pr edit 3 --base main",
      "git push",
      "pr edit 1 --base main",
      "pr edit 2 --base a",
      `pr close 3 --comment Closed when the stack was consolidated: this change is now part of #2 at ${b1.slice(0, 9)}.`,
      "stack link 1 2",
    ]);
  });

  it("finishes a republish cut short after its push from its record, detaching and pushing nothing again", () => {
    const plan = planConsolidation(co, pulls, heads, absorbed, "main");
    const asked: string[] = [];
    const answer = (args: readonly string[]): string => {
      asked.push(args.join(" "));
      return args[0] === "api" ? "[]" : "";
    };
    expect(() =>
      republish(co, plan, "no-verify", (args) => {
        if (args.join(" ") === "pr edit 2 --base a") throw new Error("cut short");
        return answer(args);
      }),
    ).toThrow("cut short");
    expect(asked).toStrictEqual(["api repos/{owner}/{repo}/stacks", "pr edit 1 --base main"]);
    const kept = keptRepublish(co);
    expect(kept?.plan).toStrictEqual(plan);
    asked.length = 0;
    republish(co, kept?.plan ?? plan, kept?.verify ?? "verify", answer);
    expect(asked).toStrictEqual([
      "api repos/{owner}/{repo}/stacks",
      "pr edit 1 --base main",
      "pr edit 2 --base a",
      `pr close 3 --comment Closed when the stack was consolidated: this change is now part of #2 at ${b1.slice(0, 9)}.`,
      "stack link 1 2",
    ]);
    expect(keptRepublish(co), "the record goes once the last step is done").toBeNull();
  });

  it("pushes nothing where a lease fails, and refuses a stack off main or out of order", () => {
    const plan = planConsolidation(co, pulls, pairs("head", [`1=${b0}`, `2=${c0}`]), new Map(), "main");
    expect(() => republish(co, plan, "no-verify", () => "[]")).toThrow();
    expect(keptRepublish(co)?.plan).toStrictEqual(plan);
    rmSync(join(co, ".git", "ana-republish.json"));
    expect([sha(up, "a"), sha(up, "b")]).toStrictEqual([a1, b1]);

    expect(() =>
      planConsolidation(co, pulls, pairs("head", [`1=${b1}`, `2=${a1}`]), new Map(), "main"),
    ).toThrow("does not hold #1's");
    expect(() => planConsolidation(co, pulls, pairs("head", ["9=HEAD"]), new Map(), "main")).toThrow(
      "not on the open stack",
    );
    expect(() => planConsolidation(co, pulls, pairs("head", [`1=${a1}`]), absorbed, "main")).toThrow(
      "absorbed into #2, which is given no new head",
    );
    expect(() => pairs("head", ["1=x", "1=y"])).toThrow("names #1 twice");

    // main is rewritten on the remote: the same tree under a new commit.
    git(co, "switch", "-q", "--detach", "origin/main");
    git(co, "commit", "-q", "--amend", "--allow-empty", "--author", "u <u@u.dev>", "-C", "HEAD");
    git(co, "push", "-q", "--force", "origin", "HEAD:refs/heads/main");
    git(co, "fetch", "-q", "origin");
    expect(() => planConsolidation(co, pulls, heads, absorbed, "main")).toThrow("does not hold origin/main");
  });
});

describe("replaying a stack onto main once what it stood on landed", () => {
  const up = join(root, "replay-up");
  const co = join(root, "replay-co");
  const sha = (ref: string) => gitText(co, "rev-parse", ref);
  const step = (file: string, text: string) => {
    writeFileSync(join(co, file), text);
    git(co, "add", file);
    git(co, "commit", "-q", "-m", `write ${file}`);
    return sha("HEAD");
  };
  git(root, "init", "-q", "--bare", "-b", "main", up);
  git(root, "clone", "-q", up, co);
  git(co, "config", "user.name", "t");
  git(co, "config", "user.email", "t@t.dev");
  step("base.txt", "base\n");
  git(co, "push", "-q", "origin", "HEAD:refs/heads/main");
  // #1 stands on `lower`, which then merges into main, and #2 stands on #1.
  git(co, "switch", "-q", "-c", "lower");
  const lower = step("lower.txt", "lower\n");
  const a = step("a.txt", "a\n");
  const b = step("b.txt", "b\n");
  git(co, "switch", "-q", "main");
  git(co, "merge", "-q", "--no-ff", "-m", "Merge lower", lower);
  git(co, "push", "-q", "origin", "main", `${a}:refs/heads/a`, `${b}:refs/heads/b`);
  git(co, "fetch", "-q", "origin");
  const line = [
    { ...pull(1, "a", "lower"), headRefOid: a },
    { ...pull(2, "b", "a"), headRefOid: b },
  ];

  it("names a head for every pull request, each on main and in its old order, with its commits' trees", () => {
    expect(offMain(co, line, "main").join("\n")).toContain("off main: #1 stands on lower");
    expect(offMain(co, line, "main").join("\n")).toContain("republish.ts --onto-main 2 --yes");
    const heads = replayedHeads(co, line, "main");
    const [a1, b1] = [heads.get(1) ?? "", heads.get(2) ?? ""];
    expect(gitText(co, "rev-parse", `${a1}^`)).toBe(sha("origin/main"));
    expect(gitText(co, "rev-parse", `${b1}^`)).toBe(a1);
    expect([sha(`${a1}^{tree}`), sha(`${b1}^{tree}`)]).toStrictEqual([
      sha(`${a}^{tree}`),
      sha(`${b}^{tree}`),
    ]);
    expect(sha("origin/a"), "a replay moves no ref").toBe(a);
    const plan = planConsolidation(co, line, heads, new Map(), "main");
    expect(plan.moves.map((move) => [move.pull.number, move.base])).toStrictEqual([
      [1, "main"],
      [2, "a"],
    ]);
  });

  it("keeps a chain that already holds main, and refuses one that conflicts with it", () => {
    const heads = replayedHeads(co, line, "main");
    const settled = line.map((each, index) => ({
      ...each,
      baseRefName: index === 0 ? "main" : each.baseRefName,
      headRefOid: heads.get(each.number) ?? "",
    }));
    expect(replayedHeads(co, settled, "main")).toStrictEqual(heads);
    expect(offMain(co, settled, "main"), "a stack on main that holds it is not said").toStrictEqual([]);
    step("a.txt", "a, written on main\n");
    git(co, "push", "-q", "origin", "HEAD:refs/heads/main");
    git(co, "fetch", "-q", "origin");
    expect(() => replayedHeads(co, line, "main")).toThrow("does not replay cleanly");
  });

  it("finds the open stack holding a pull request, and refuses one on none", () => {
    expect(stackHolding(line, 2)?.map((each) => each.number)).toStrictEqual([1, 2]);
    expect(stackHolding(line, 9)).toBeUndefined();
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
      "  flags --cap",
      `  does not hold ${second.slice(0, 9)}`,
      `g1  2026-10-09T14:00:00.000Z  ${second.slice(0, 9)}  with uncommitted changes  load 3.2 on 8 cores  bun 1.4.3`,
      "  published on no remote branch",
      "  same login; flags as before",
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

describe("an Oracle folder of the open pull requests", () => {
  const up = join(root, "pulls-up");
  const co = join(root, "pulls-co");
  const write = (file: string, text: string) => {
    mkdirSync(join(co, file, ".."), { recursive: true });
    writeFileSync(join(co, file), text);
  };
  const commit = (message: string) => {
    git(co, "add", "-A");
    git(co, "commit", "-q", "-m", message);
    return gitText(co, "rev-parse", "HEAD");
  };
  git(root, "init", "-q", "--bare", "-b", "main", up);
  git(root, "clone", "-q", up, co);
  // main: a.ts imports b.ts, a test imports a.ts, another names only the fixture, one only the README
  // (read as documentation), and one is far.
  write("README.md", "# r\n");
  write("test/doc.test.ts", 'export const t = "README.md";\n');
  write("src/a.ts", 'import { b } from "./b.ts";\nexport const a = b;\n');
  write("src/b.ts", "export const b = 1;\n");
  write("src/far.ts", "export const far = 2;\n");
  write("src/gone.ts", "export const gone = 3;\n");
  write("fixtures/data.json", "{}\n");
  write("test/a.test.ts", 'import { a } from "../src/a.ts";\nexport const t = a;\n');
  write("test/data.test.ts", 'export const t = "fixtures/data.json";\n');
  write("test/far.test.ts", 'import { far } from "../src/far.ts";\nexport const t = far;\n');
  commit("base");
  git(co, "push", "-q", "origin", "HEAD:refs/heads/main");
  // #1 changes a.ts, the fixture and the README; #2 on it removes gone.ts.
  write("README.md", "# r, read\n");
  write("src/a.ts", 'import { b } from "./b.ts";\nexport const a = b + 1;\n');
  write("fixtures/data.json", '{"x":1}\n');
  const one = commit("one");
  rmSync(join(co, "src/gone.ts"));
  const two = commit("two");
  git(co, "push", "-q", "origin", `${one}:refs/heads/one`, `${two}:refs/heads/two`);
  git(co, "fetch", "-q", "origin");
  const open: Pull[] = [
    { ...pull(2, "claude/two", "one"), headRefOid: two },
    { ...pull(1, "one", "main", ["importance:I2"]), headRefOid: one },
  ];
  const how = {
    web: "https://github.example/o/r",
    at: "now",
    told: (n: string) => `Title ${n}\n\nbody\n`,
    code: true,
  };

  it("writes each pull request's text and its diff against the one beneath, and the code one import away", () => {
    const into = join(root, "pulls-out", "pulls");
    const written = pullsInto(co, into, open, how);
    expect(written.slice(0, 5)).toStrictEqual([
      "README.md",
      "1-one.md",
      "1-one.diff",
      "2-two.md",
      "2-two.diff",
    ]);
    const text = pasted(into, written);
    const headings = text.split("\n").filter((line) => /^#+ /u.test(line));
    expect(headings.slice(0, 11)).toStrictEqual([
      "# The open pull requests of https://github.example/o/r",
      "## On `main`: #1 to #2",
      "## Pull request 1: Title 1",
      "### The diff of pull request 1",
      "#### `README.md`",
      "#### `fixtures/data.json`",
      "#### `src/a.ts`",
      "## Pull request 2: Title 2",
      "### The diff of pull request 2",
      "#### `src/gone.ts`",
      "# The code at #2's head",
    ]);
    expect(headings).toContain("## `src/a.ts`");
    // A markdown file in the code is fenced whole, so its own heading stays inside the fence.
    expect(text).toContain("## `README.md`\n\n```markdown\n# r, read\n```");
    expect(text).toContain("+export const a = b + 1;");
    const diff = (name: string) => readFileSync(join(into, name), "utf8");
    expect(diff("1-one.diff")).toContain("+export const a = b + 1;");
    expect(diff("1-one.diff")).not.toContain("gone.ts");
    expect(diff("2-two.diff")).toContain("deleted file mode");
    expect(diff("2-two.diff")).not.toContain("src/a.ts");
    expect(readFileSync(join(into, "2-two.md"), "utf8")).toBe("# Pull request 2: Title 2\n\nbody\n\n");
    const code = (file: string) => existsSync(join(into, "code", "2", file));
    expect(
      ["src/a.ts", "fixtures/data.json", "README.md", "src/b.ts", "test/a.test.ts", "test/data.test.ts"].map(
        code,
      ),
    ).toStrictEqual([true, true, true, true, true, true]);
    expect(["src/gone.ts", "src/far.ts", "test/far.test.ts", "test/doc.test.ts"].map(code)).toStrictEqual([
      false,
      false,
      false,
      false,
    ]);
    const readme = readFileSync(join(into, "README.md"), "utf8");
    expect(readme).toContain("## On `main`: #1 to #2");
    expect(readme.indexOf("[#1]")).toBeLessThan(readme.indexOf("[#2]"));
    expect(readme).toContain(
      "the 3 files the chain changed that it still has, the 1 other one of them imports, and the 2 other test files near them",
    );
    expect(gitText(co, "worktree", "list").split("\n")).toHaveLength(1);
  });

  it("refuses where no pull request is open, and leaves the code out for diffs alone", () => {
    expect(() => pullsInto(co, join(root, "pulls-none"), [], how)).toThrow("no pull request is open");
    expect(existsSync(join(root, "pulls-none"))).toBe(false);
    const into = join(root, "pulls-diffs");
    pullsInto(co, into, open, { ...how, code: false });
    expect(existsSync(join(into, "code"))).toBe(false);
    expect(existsSync(join(into, "2-two.diff"))).toBe(true);
  });
});

describe("an Oracle document's parts", () => {
  it("prints a finding's log parts from its selectors alone, and a pull request's diff without its tests", () => {
    expect(
      seenParts(
        "run-a comparison.reported{1,~1} Builder:b-1{4-7}; run-b absent, run-c shows the gap; run-d cannot show",
      ),
    ).toEqual([["run-a", ["comparison.reported{1,~1}", "Builder:b-1{4-7}"]]]);
    expect(
      seenParts(
        "run-a Builder:b-1[read_opening,compare]{~1}, comparison.reported{2}. (Examiner:x-2{3}); run-b Builder shows it, e.g. v1.2; comparison.reported{9}",
      ),
    ).toEqual([
      ["run-a", ["Builder:b-1[read_opening,compare]{~1}", "comparison.reported{2}", "Examiner:x-2{3}"]],
    ]);
    const file = (path: string) => `diff --git a/${path} b/${path}\n+x\n`;
    expect(untested(file("src/a.ts") + file("test/a.test.ts") + file("tools/test/b.ts"))).toBe(
      file("src/a.ts") + file("tools/test/b.ts"),
    );
  });

  it("gives each machine one alias across its names and drops home folders", () => {
    const made = sanitised("ran on box-two (ssh two-ssh) from /Users/someone/Developer/x and /home/other/y", [
      ["box-one"],
      ["box-two", "two-ssh"],
    ]);
    expect(made.text).toBe("ran on host-b (ssh host-b) from ~/Developer/x and ~/y");
    const bare = sanitised(
      "cwd /Users/someone, BOX-ONE.local, /tmp/-Users-someone-Developer-x, src/home/a/b.ts",
      [["box-one"]],
    );
    expect(bare.text).toBe("cwd ~, host-a.local, /tmp/-~-Developer-x, src/home/a/b.ts");
    const logins = sanitised(
      "on login 3, logins 1 and 4, claude2, ~/.claude-account3/jobs, TOKEN CLAUDE_CODE_OAUTH_TOKEN1",
      [],
    );
    expect(logins.text).toBe(
      "on a login, a login, a login, ~/.claude-account/jobs, TOKEN CLAUDE_CODE_OAUTH_TOKEN",
    );
  });

  it("drops a tree's name, a session's scratchpad and a login's table row, and keeps a path in the repository", () => {
    const made = sanitised(
      [
        "/Users/someone/Developer/anabasis-after-review/src/a.ts",
        "~/Developer/anabasis",
        "/home/other/anabasis-run/x",
        "/private/tmp/claude-501/-Users-someone-x/0d54-436d/scratchpad/lane/report.md",
        "| Login | 4 (the operator's) |",
        "~/.anabasis/AGENTS.md",
        "https://github.com/someone/anabasis/blob/a.ts",
      ].join("\n"),
      [],
    );
    expect(made.text.split("\n")).toEqual([
      "<tree>/src/a.ts",
      "<tree>",
      "<tree>/x",
      "<scratch>/lane/report.md",
      "| Login | a login (the operator's) |",
      "~/.anabasis/AGENTS.md",
      "https://github.com/someone/anabasis/blob/a.ts",
    ]);
  });
});

describe("consolidate-stack overlap and cache analyzer", () => {
  it("flags churn hotspots, side PRs, checkerDigest, linux-bwrap, ledger ordering, tier inversions, and Mode A blocks", () => {
    expect(parseNumstat("10\t2\tsrc/a.ts\n-\t-\tbin/logo.png\n")).toEqual(
      new Map([
        ["src/a.ts", { adds: 10, dels: 2 }],
        ["bin/logo.png", { adds: 0, dels: 0 }],
      ]),
    );
    const p1 = pull(10, "b-10", "main", ["importance:I2"]);
    const p2 = pull(11, "b-11", "b-10", ["importance:I2"]);
    const p3 = pull(12, "b-12", "b-11", ["importance:I1"]);
    const side = pull(13, "b-side", "b-10", ["importance:I3"]);
    const base = "0".repeat(40);
    const diffs = new Map<string, string>([
      [`${base}..${p1.headRefOid}`, "50\t0\tsrc/hot.ts\n5\t0\ttools/oxlint/rule.ts\n"],
      [`${p1.headRefOid}..${p2.headRefOid}`, "5\t45\tsrc/hot.ts\n1\t0\ttools/oxlint/not-slop.tsv\n"],
      [
        `${p2.headRefOid}..${p3.headRefOid}`,
        "3\t1\tsrc/sandbox/linux-bwrap.ts\n2\t1\ttools/runtime/gate.ts\n",
      ],
      [
        `${base}..${p3.headRefOid}`,
        "10\t0\tsrc/hot.ts\n5\t0\ttools/oxlint/rule.ts\n1\t0\ttools/oxlint/not-slop.tsv\n3\t1\tsrc/sandbox/linux-bwrap.ts\n2\t1\ttools/runtime/gate.ts\n",
      ],
    ]);
    const report = analyzeStack([p1, p2, p3, side], "main", base, {
      diffNumstat: (from, to) => diffs.get(`${from}..${to}`) ?? "",
      commitCount: () => 2,
    });
    expect(report.spans.map(({ number }) => number)).toEqual([10, 11, 12]);
    expect(report.sides.map(({ number }) => number)).toEqual([13]);
    expect(report.modeABlocks).toEqual([[10, 11]]);
    expect(report.hotspots[0]).toMatchObject({ path: "src/hot.ts", touches: 2, gross: 100, net: 10 });
    const rendered = formatAnalysis(report);
    expect(rendered).toContain("checkerDigest: #12");
    expect(rendered).toContain("linux-ci: #12");
    expect(rendered).toContain("ledger-order: #11");
    expect(rendered).toContain("side-prs: #13");
    expect(rendered).toContain("tier-order: higher-priority PRs above lower tiers: #12(I1)");
    expect(rendered).toContain("mode-A adjacent blocks (0 cache invalidation): #10->#11");
    expect(rendered).toContain("10.00x  2t  gross 100 / net 10  src/hot.ts  (#10,#11)");
  });
});
