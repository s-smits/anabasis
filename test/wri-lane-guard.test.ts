// The wri-lane agent's hook refuses a lane's writes outside its report, its spends and its reads of an
// env file, and lets every read and reader through, so the hard rules a tool call can break hold in code.
import { describe, expect, it } from "bun:test";
import { refusalOf } from "../tools/wri/lane-guard.ts";
import { existsSync, readFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const WRI = "/Users/x/anabasis/.ana/wri/2026-11-04-run";
const bash = (command: string) => refusalOf("Bash", { command });

describe("the lane guard", () => {
  it("lets a lane write its own report, the synthesis and scratch, and nothing else", () => {
    expect(refusalOf("Write", { file_path: `${WRI}/lanes/07-report.md` })).toBeNull();
    expect(refusalOf("Edit", { file_path: `${WRI}/synthesis.md` })).toBeNull();
    expect(refusalOf("Write", { file_path: join(tmpdir(), "lane-07", "counts.txt") })).toBeNull();
    expect(
      refusalOf("Write", { file_path: "/Users/x/.claude-account1/jobs/e6c8/tmp/l5/grade.ts" }),
    ).toBeNull();
    expect(refusalOf("Write", { file_path: `${WRI}/lanes/07-prompt.md` })).not.toBeNull();
    expect(refusalOf("Write", { file_path: `${WRI}/vetting.md` })).not.toBeNull();
    expect(refusalOf("Edit", { file_path: "/Users/x/anabasis/.ana/d2/run/log.jsonl" })).not.toBeNull();
    // A path that climbs out of the lanes folder is read where it lands.
    expect(
      refusalOf("Write", { file_path: `${WRI}/lanes/../../../d2/run/lanes/01-report.md` }),
    ).not.toBeNull();
  });

  it("lets every reader and grade run, and refuses a spend, a run's life and a change to the tree", () => {
    for (const ok of [
      "bun tools/wri/wri.ts read --log /a/log.jsonl",
      "bun tools/wri/wri.ts grade --log /a/log.jsonl --task t-1 --answer /tmp/a.json",
      "bun run runs view jobstat-fresh",
      "git log --oneline -5",
      "grep -c solve.finished /a/.ana/d2/run/log.jsonl",
    ]) {
      expect(bash(ok)).toBeNull();
    }
    for (const refused of [
      "bun tools/d2/harness-builder.ts --dry-run",
      "bun run runs fresh jobstat --yes",
      "bun run runs continue jobstat",
      "bun tools/wri/wri.ts lanes --out /a --agents 4",
      "git commit -m x",
      "cp /tmp/x /a/.ana/d2/run/states/abc",
      "echo x >> /a/.ana/d2/run/log.jsonl",
    ]) {
      expect(bash(refused)).not.toBeNull();
    }
  });

  it("reads what a command runs and where it writes, never what it only names", () => {
    // Each of these was refused by the first guard in a lane session of 4 November, replayed.
    for (const ok of [
      "cd /a/anabasis && sed -n 360,395p tools/d2/harness-builder.ts; grep -n parent tools/d2/session.ts",
      String.raw`grep -rn "runs copy\|seedFrom" tools/wri/*.ts | head`,
      "git merge-base --is-ancestor abc HEAD && echo yes || echo no",
      "git stash list | head -1; git worktree list",
      `cat >> ${WRI}/lanes/02-report.md <<'EOF'\nbun run runs stop x; bun tools/d2/word.ts; echo > /a/.ana/d2/run/log.jsonl; cat .env\nEOF`,
      "S=/tmp/lane; mkdir -p $S/eng; cp /a/.ana/d2/run/exams/x/checks/evaluator.ts $S/eng/",
      "jq -r .data /a/data/runs/h/run/log.jsonl > /tmp/lane/out.txt 2>&1",
      String.raw`grep -n '\.env' src/meta/env.ts`,
      `cd /a/.ana/d2/run/states; sed -i '' 's/a/b/' ${WRI}/lanes/34-report.md`,
    ]) {
      expect(bash(ok)).toBeNull();
    }
    for (const [refused, why] of [
      ["cd /a && bun tools/d2/word.ts --stop x", "a campaign command"],
      [
        "nohup bun --env-file=x tools/d2/harness-builder.ts --name x > /tmp/l.log 2>&1 &",
        "a campaign command",
      ],
      ["RUN_REMOTE=1 bun run runs move foo --host h", "a run's life"],
      ['bash -c "bun run runs stop x"', "a run's life"],
      ["echo $(bun run runs pause x)", "a run's life"],
      ["claude -p hello", "a paid session"],
      ["git -C /a/anabasis commit -qm x", "a change to the tree"],
      ["echo x | tee -a /a/.ana/d2/run/log.jsonl", "a write under a campaign"],
      ["L=/a/.ana/d2/run/log.jsonl; echo x >> $L", "a write under a campaign"],
      ["cd /a/.ana/d2/run && echo x > notes.md", "a write under a campaign"],
      ["rm -rf /a/data/runs/h/run", "a write under a campaign"],
      ["cat > /a/.ana/d2/run/notes.md <<'EOF'\nx\nEOF", "a write under a campaign"],
      ["sed -i -e 's/a/b/' /a/.ana/d2/run/log.jsonl", "a write under a campaign"],
      ["bun --env-file=.env.runs tools/wri/wri.ts read --log x", "an env file"],
    ] as const) {
      expect(bash(refused)).toBe(why);
    }
  });

  it("refuses a read of an env file and not of its committed example", () => {
    expect(refusalOf("Read", { file_path: "/Users/x/anabasis/.env" })).toBe("an env file");
    expect(refusalOf("Read", { file_path: "/Users/x/anabasis/.env.runs" })).toBe("an env file");
    expect(refusalOf("Read", { file_path: "/Users/x/anabasis/.env.runs.example" })).toBeNull();
    expect(bash("cat .env")).toBe("an env file");
    expect(bash("cat .env.runs.example")).toBeNull();
  });

  it("is the hook the agent type runs", () => {
    const agent = readFileSync(join(import.meta.dir, "..", ".claude", "agents", "wri-lane.md"), "utf8");
    expect(agent).toContain("tools/wri/lane-guard.ts");
    expect(existsSync(join(import.meta.dir, "..", "tools", "wri", "lane-guard.ts"))).toBe(true);
  });
});
