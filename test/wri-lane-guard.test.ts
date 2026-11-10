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
    expect(refusalOf("Write", { file_path: `${WRI}/lanes/34a-report.md` })).toBeNull();
    expect(refusalOf("Write", { file_path: `${WRI}/lanes/34-prompt.md` })).not.toBeNull();
    expect(refusalOf("Edit", { file_path: `${WRI}/synthesis.md` })).toBeNull();
    expect(refusalOf("Write", { file_path: join(tmpdir(), "lane-07", "counts.txt") })).toBeNull();
    expect(
      refusalOf("Write", { file_path: "/Users/x/.claude-account1/jobs/e6c8/tmp/l5/grade.ts" }),
    ).toBeNull();
    expect(refusalOf("Write", { file_path: `${WRI}/lanes/07-prompt.md` })).not.toBeNull();
    expect(refusalOf("Write", { file_path: `${WRI}/vetting.md` })).not.toBeNull();
    // The across session writes the investigation's cross-domain note, and only at its root.
    expect(refusalOf("Write", { file_path: `${WRI}/cross-domain.md` })).toBeNull();
    expect(refusalOf("Write", { file_path: `${WRI}/lanes/cross-domain.md` })).not.toBeNull();
    expect(refusalOf("Write", { file_path: `${WRI}/plan.md` })).not.toBeNull();
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
      `cd ${WRI}; sed -i '' 's/a/b/' lanes/34-report.md`,
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
      ["L=/a/.ana/d2/run/log.jsonl > /a/.ana/d2/run/x", "a write under a campaign"],
      ["> /a/.ana/d2/run/log.jsonl", "a write under a campaign"],
      ["cd /a/.ana/d2/run && echo x > notes.md", "a command run inside a campaign"],
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
    expect(bash("grep TOKEN <.env")).toBe("an env file");
    expect(bash("cat .env.runs.example")).toBeNull();
    // Every other `.env*` is closed too: a local override, a glob and direnv's file.
    expect(refusalOf("Read", { file_path: "/Users/x/anabasis/.env.example" })).toBeNull();
    expect(refusalOf("Read", { file_path: "/Users/x/anabasis/.env.local" })).toBe("an env file");
    expect(bash("cat .env.example")).toBeNull();
    expect(bash("cat .env.local")).toBe("an env file");
    expect(bash("cat .env*")).toBe("an env file");
    expect(bash("head -1 /Users/x/anabasis/.envrc")).toBe("an env file");
    expect(refusalOf("Glob", { glob: "**/.env*" })).toBe("an env file");
    expect(refusalOf("Glob", { glob: "**/*.example" })).toBeNull();
    expect(refusalOf("Grep", { path: "/Users/x/anabasis/.env" })).toBe("an env file");
    expect(refusalOf("Glob", { glob: ".env.runs" })).toBe("an env file");
    expect(refusalOf("Grep", { path: "/Users/x/anabasis/src" })).toBeNull();
  });

  it("refuses the rejections command that logs verdicts by its folder, and lets the lane's reader of the same name run", () => {
    for (const refused of [
      "bun tools/c/rejections.ts --log /a/.ana/d2/r/log.jsonl",
      "bun run tools/c/rejections.ts /a/.ana/d2/r/log.jsonl",
      "cd tools/c && bun rejections.ts /a/.ana/d2/r/log.jsonl",
      "cd tools/c && bun run rejections.ts /a/.ana/d2/r/log.jsonl",
    ]) {
      expect(bash(refused)).toBe("a command that logs verdicts");
    }
    for (const ok of [
      "bun tools/wri/rejections.ts /a/.ana/d2/r/log.jsonl",
      "bun run tools/wri/rejections.ts /a/.ana/d2/r/log.jsonl --solve s-1",
      "cd tools/wri && bun rejections.ts /a/.ana/d2/r/log.jsonl",
      "sed -n 120,135p tools/c/rejections.ts",
    ]) {
      expect(bash(ok)).toBeNull();
    }
  });

  it("reads the command a wrapper, a flag or a find runs, and the line after a here-string", () => {
    for (const ok of ["timeout 30 grep -rn solve src", "sed -n 1,40p tools/d2/word.ts"]) {
      expect(bash(ok)).toBeNull();
    }
    for (const [refused, why] of [
      ["timeout 600 bun tools/d2/harness-builder.ts", "a campaign command"],
      ["caffeinate -i bun tools/d2/round.ts", "a campaign command"],
      ["bun --cwd /a tools/d2/harness-builder.ts", "a campaign command"],
      ["find . -name x -exec bun tools/d2/word.ts --stop x ;", "a campaign command"],
      ["bun run runs --host h stop x", "a run's life"],
      ["bun run runs seed a b", "a run's life"],
      ['grep x <<< "y"\nbun tools/d2/word.ts --stop x\ny', "a campaign command"],
      ["export L=/a/.ana/d2/run/log.jsonl; echo x >> $L", "a write under a campaign"],
      ["find /a/.ana/d2/run -delete", "a write under a campaign"],
      [`echo x > ${WRI}/snapshot/run/log.jsonl`, "a write under a campaign"],
    ] as const) {
      expect(bash(refused)).toBe(why);
    }
  });

  it("runs no interpreter on a campaign's path or a program kept in one, and Python with bytecode off", () => {
    // The nearest allowed cases: a campaign's file piped or redirected in, a reader given its path.
    for (const ok of [
      `cat /a/.ana/d2/r/log.jsonl | python3 -B -c "import sys; print(sum(1 for _ in sys.stdin))"`,
      "python3 -B /tmp/lane/count.py < /a/.ana/d2/r/log.jsonl",
      "PYTHONDONTWRITEBYTECODE=1 python3 /tmp/lane/count.py",
      "export PYTHONDONTWRITEBYTECODE=1; python3 -c 'print(1)'",
      "bun tools/wri/wri.ts read --log /a/.ana/d2/r/log.jsonl",
      'bun -e "console.log(1)"',
      "sed -n 1,5p /a/.ana/d2/r/log.jsonl",
      "awk '{print $1}' /a/.ana/d2/r/log.jsonl",
      "perl -ne 'print if /x/' /tmp/lane/x.txt",
    ]) {
      expect(bash(ok)).toBeNull();
    }
    for (const [refused, why] of [
      [`python3 -B -c "open('/a/.ana/d2/r/states/h/x', 'w')"`, "an interpreter naming a campaign"],
      [`bun -e "await Bun.write('/a/.ana/d2/r/states/h/x', '')"`, "an interpreter naming a campaign"],
      ["python3 -B /tmp/lane/x.py /a/.ana/d2/r/log.jsonl", "an interpreter naming a campaign"],
      ["perl -pi -e 's/a/b/' /a/.ana/d2/r/log.jsonl", "an interpreter naming a campaign"],
      [`awk '{print > "/a/.ana/d2/r/out"}' /tmp/x`, "an interpreter naming a campaign"],
      ["sed 's/a/b/w /a/.ana/d2/r/out' /tmp/x", "an interpreter naming a campaign"],
      ["python3 -B /a/.ana/d2/r/states/h/.toolchain/run.py", "a program kept in a campaign"],
      ["/a/.ana/d2/r/states/h/.toolchain/bin/check x", "a program kept in a campaign"],
      ["bun /a/.ana/d2/r/states/h/agent/tools.ts", "a program kept in a campaign"],
      ["bash /a/data/runs/h/r/states/h/.toolchain/go.sh", "a program kept in a campaign"],
    ] as const) {
      expect(bash(refused)).toBe(why);
    }
    expect(bash("python3 /tmp/lane/count.py")).toContain("bytecode");
    expect(bash("PYTHONDONTWRITEBYTECODE= python3 /tmp/lane/count.py")).toContain("bytecode");
    expect(bash("pytest /tmp/lane")).toContain("bytecode");
  });

  it("runs no command inside a campaign's folder, by `cd`, a directory flag or the session's own", () => {
    for (const ok of [
      `cd ${WRI} && grep -c x lanes/07-report.md`,
      "git -C /a/anabasis log -1",
      "grep -C 3 solve /a/.ana/d2/r/log.jsonl",
      "tar -cf /tmp/lane/s.tar /a/.ana/d2/r/states",
      "tar -xf /tmp/lane/s.tar -C /tmp/lane/out",
    ]) {
      expect(bash(ok)).toBeNull();
    }
    for (const refused of [
      `cd /a/.ana/d2/run/states; sed -i '' 's/a/b/' ${WRI}/lanes/34-report.md`,
      "cd /a/.ana/d2/r/states/h && python3 -B run.py",
      "cd /a/.ana/d2/r && ls",
      "tar -C /a/.ana/d2/r/states -xf /tmp/x.tar",
      "tar -xf /tmp/x.tar -C/a/.ana/d2/r/states",
      "git -C /a/.ana/d2/r/states/h status",
      "bun --cwd=/a/.ana/d2/r/states/h x.ts",
      "find /a/.ana/d2/r -name '*.py' -execdir python3 -B {} ;",
    ]) {
      expect(bash(refused)).toBe("a command run inside a campaign");
    }
    expect(refusalOf("Bash", { command: "ls" }, "/a/anabasis")).toBeNull();
    expect(refusalOf("Bash", { command: "ls" }, "/a/.ana/d2/r/states/h")).toBe(
      "a command run inside a campaign",
    );
    expect(refusalOf("Bash", { command: "cd /tmp && ls" }, "/a/.ana/d2/r/states/h")).toBeNull();
  });

  it("lets a shell write reach only the files the Write tool may under an investigation", () => {
    const cycle = "/Users/x/anabasis/.ana/wri/2026-11-07-cycle-v0.10";
    for (const ok of [
      `echo x >> ${WRI}/lanes/07-report.md`,
      `echo x > ${WRI}/cross-domain.md`,
      `perl -pi -e 's/a/b/' ${WRI}/lanes/07-report.md`,
      "echo x > /tmp/lane/vetting.md",
    ]) {
      expect(bash(ok)).toBeNull();
    }
    for (const refused of [
      `echo x > ${WRI}/vetting.md`,
      `cat >> ${cycle}/outcomes-r.md <<'EOF'\nx\nEOF`,
      `cp /tmp/x ${WRI}/plan.md`,
      `cd ${WRI} && echo x > iteration.json`,
      `perl -pi -e 's/a/b/' ${WRI}/vetting.md`,
      `tar -cf ${WRI}/vetting.md /tmp/x`,
      `cd ${WRI} && tar -xf /tmp/x.tar`,
      `sed -i '' 's/a/b/' ${cycle}/predictions-r.md`,
    ]) {
      expect(bash(refused)).toBe("a write to the primary's files");
    }
    for (const step of [
      "bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts open r1",
      "bun tools/wri/wri.ts index",
    ]) {
      expect(bash(step)).toBe("the primary's step");
    }
    expect(bash(`bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts next ${WRI}`)).toBeNull();
    expect(bash("bun tools/wri/wri.ts climb --log /a/.ana/d2/r/log.jsonl")).toBeNull();
  });

  it("reads a word inside quotes and substitutions whole, so a campaign's path runs only as the command", () => {
    // The shapes of the lane refusals of 3 to 9 November that read nothing but a campaign's files.
    for (const ok of [
      `L=/a/.ana/d2/r/log.jsonl; for k in a b; do jq -c "select(.kind==\\"$k\\") | .data | keys" "$L" | head -2; done`,
      `jq -c "select(.kind==\\"x\\")" < /a/data/runs/h/r/log.jsonl`,
      `D=/a/.ana/d2/r/states; for t in t1 t2; do grep -nE "open\\\\(['\\"]/|os\\.environ" $D/$t/lib/*.py | sed "s|$D/||"; done`,
      "S=/a/data/runs/h/r/states; diff <(sed -n 1,9p $S/t/lib/a.py) $S/t/lib/a.py",
      "C=/a/.ana/d2/r/states; readlink $(ls -d $C/ab*)/.toolchain",
      'ls -la /a/x | grep -- "-> ../$(basename /a/y)"',
      "diff -rq /a/.ana/d2/r/states/x /a/.ana/d2/r/states/y | sed -E 's#/a/.ana/d2/r/states/##g'",
      "for f in /a/.ana/d2/*/launch-run-*.json; do jq -r .at \"$f\"; done | sed -E 's#/a/.ana/d2/##'",
      'awk \'{sub("/a/.ana/d2/", "")} 1\' /tmp/lane/x.txt',
      "command -v python3.14",
      "rg -n check /a/.ana/d2/r/states/h/.toolchain",
    ]) {
      expect(bash(ok)).toBeNull();
    }
    // The nearest refused cases: what runs, writes or names an env file inside the same shapes.
    for (const [refused, why] of [
      [
        String.raw`jq "select(.k==\"x\")" /a/x; /a/.ana/d2/r/states/h/.toolchain/bin/check`,
        "a program kept in a campaign",
      ],
      ["x=$(cat /tmp/f) /a/.ana/d2/r/states/h/.toolchain/bin/check", "a program kept in a campaign"],
      ['echo "$(python3 -B /a/.ana/d2/r/states/h/.toolchain/run.py)"', "a program kept in a campaign"],
      ["diff <(bash /a/.ana/d2/r/states/h/.toolchain/go.sh) /tmp/x", "a program kept in a campaign"],
      [
        String.raw`python3 -B -c "open(\"/a/.ana/d2/r/states/x\", \"w\")"`,
        "an interpreter naming a campaign",
      ],
      ["python3 -B /tmp/lane/x.py /a/.ana/d2/r/log.jsonl", "an interpreter naming a campaign"],
      ["sed 's#a#b#w /a/.ana/d2/r/out' /tmp/x", "an interpreter naming a campaign"],
      ["sed -n '1e /a/.ana/d2/r/states/h/.toolchain/bin/check' /tmp/x", "an interpreter naming a campaign"],
      ["awk '{print > \"/a/.ana/d2/r/out\"}' /tmp/x", "an interpreter naming a campaign"],
      ["awk 'BEGIN {system(\"/a/.ana/d2/r/states/h/bin/x\")}'", "an interpreter naming a campaign"],
      ['echo "$(echo x > /a/.ana/d2/r/log.jsonl)"', "a write under a campaign"],
      ["command -v python3 > /a/.ana/d2/r/log.jsonl", "a write under a campaign"],
      ['grep x "$(echo /a/.env)"', "an env file"],
    ] as const) {
      expect(bash(refused)).toBe(why);
    }
    expect(bash("command python3 /tmp/lane/x.py")).toContain("bytecode");
  });

  it("is the hook the agent type runs", () => {
    const agent = readFileSync(join(import.meta.dir, "..", ".claude", "agents", "wri-lane.md"), "utf8");
    expect(agent).toContain("tools/wri/lane-guard.ts");
    // Grep and Glob read files too, and a guard that crashes refuses rather than passes.
    expect(agent).toContain("Read|Grep|Glob|");
    expect(agent).toContain('bun "$f" || exit 2');
    expect(existsSync(join(import.meta.dir, "..", "tools", "wri", "lane-guard.ts"))).toBe(true);
  });
});
