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
