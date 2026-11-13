// A seed placed under the code its run ran, and the points a seed can be cut at. A run launched at
// one commit and continued at another stands at the second, so a seed cut inside the first stretch
// goes to a tree at the first commit, and one cut inside the second to the run's own tree.
import { afterAll, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { runTextSyncOrThrow } from "../src/meta/subprocess.ts";
import { codeOf } from "../tools/d2/campaign.ts";
import { atCommit } from "../tools/runs/code.ts";
import { codeLine, pointsOf, treeAsRan } from "../tools/runs/seed.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-seed-test-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const git = (repo: string, ...args: string[]) => runTextSyncOrThrow(["git", "-C", repo, ...args]).trim();

const main = join(root, "main");
mkdirSync(join(main, "src"), { recursive: true });
for (const part of ["node_modules", "vendor"]) mkdirSync(join(main, part));
git(main, "init", "-q", "-b", "trunk");
writeFileSync(join(main, "package.json"), '{"dependencies":{}}\n');
for (const part of ["node_modules", "vendor"]) writeFileSync(join(main, part, ".keep"), "");
/** Commit the fixture's one source file holding `text`, and give the commit and its host code. */
function commitCode(text: string): { commit: string; host: string } {
  writeFileSync(join(main, "src", "code.ts"), text);
  git(main, "add", "-A");
  git(main, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", text);
  return { commit: git(main, "rev-parse", "HEAD"), host: codeOf(main).host };
}
const a = commitCode("a");
const b = commitCode("b");
// The run's own tree, which `runs continue --at` left at B.
const own = join(root, "anabasis-run");
git(main, "worktree", "add", "-q", "--detach", own, b.commit);

/** A run in `own` launched at A, continued at B, with one condition in each stretch; `host`
 *  replaces the first stretch's code. */
function run(name: string, host = a.host): string {
  const folder = join(own, ".ana", "d2", name);
  mkdirSync(folder, { recursive: true });
  const at = (minute: number) => `2026-11-01T00:0${String(minute)}:00.000Z`;
  const line = (minute: number, kind: EventKind, data: JsonObject) =>
    JSON.stringify({ at: at(minute), kind, data });
  writeFileSync(
    join(folder, "log.jsonl"),
    `${[
      line(1, "condition.recorded", { id: "c-1", condition: { host } }),
      line(2, "build.started", { session: "b-1" }),
      line(4, "condition.recorded", { id: "c-2", condition: { host: b.host } }),
      line(5, "build.started", { session: "b-2" }),
    ].join("\n")}\n`,
  );
  for (const [session, minute, { commit }] of [
    ["run-1", 0, a],
    ["run-2", 3, b],
  ] as const) {
    writeFileSync(
      join(folder, `launch-${session}.json`),
      JSON.stringify({ at: at(minute), commit, dirty: false }),
    );
  }
  return folder;
}

describe("a seed under the code its run ran", () => {
  it("seats a cut inside the first stretch at its commit, and one inside the second in the run's tree", () => {
    const folder = run("r");
    expect(treeAsRan(folder, { before: "b-1" }, main)).toBe(atCommit(main, a.commit));
    expect(treeAsRan(folder, { before: "b-2" }, main)).toBe(own);
    expect(codeLine(atCommit(main, a.commit), join(own, ".ana", "d2", "r"))).toContain("not the");
  });

  it("refuses where no tree holds the recorded code, naming both digests", () => {
    const folder = run("lost", "f".repeat(64));
    expect(() => treeAsRan(folder, { before: "b-1" }, main)).toThrow(
      `ffffffff): ${atCommit(main, a.commit)} holds ${a.host.slice(0, 8)}`,
    );
  });
});

describe("the points a seed can be cut at", () => {
  const event = (kind: EventKind, data: JsonObject): LogEvent => ({ at: "", kind, data });
  const events = [
    event("build.started", { session: "b-1" }),
    event("build.turn", { session: "b-1" }),
    event("build.finished", { session: "b-1" }),
    event("comparison.started", { session: "g-1", starter: "s" }),
    event("referee.turn", { reader: "reader-1" }),
    event("referee.turn", { reader: "reader-1" }),
    event("referee.finding", { reader: "reader-1", solve: "v-1" }),
    event("referee.turn", { reader: "reader-2" }),
    event("comparison.reported", { session: "g-1", reading: "step", old: "s", fresh: "h" }),
    event("harness.promoted", { harness: "h" }),
    event("comparison.started", { session: "g-2" }),
    event("comparison.reported", {
      session: "g-2",
      reading: "no-step",
      old: "h",
      fresh: "s",
      scored: { wins: 0, losses: 1, ties: 0 },
      unbilled: [-0.6],
    }),
  ];

  it("lists each session, comparison, promotion, starter read and first Referee turn", () => {
    expect(pointsOf(events)).toEqual([
      "0 build.started b-1",
      "2 build.finished b-1",
      "4 referee.turn solve v-1",
      "7 referee.turn solve with no finding",
      "8 comparison.reported g-1 step",
      "9 harness.promoted h",
      "10 comparison.started g-2 starter read",
      "11 comparison.reported g-2 no-step",
    ]);
  });

  it("prints a run's points and writes nothing", () => {
    const folder = run("listed");
    const before = readdirSync(own, { recursive: true });
    const said = runTextSyncOrThrow(
      [capturedExecPath, "tools/runs/cli.ts", "seed", "--from", folder, "--points"],
      {
        cwd: resolve(import.meta.dir, ".."),
      },
    );
    expect(said.trim().split("\n")).toEqual(["1 build.started b-1", "3 build.started b-2"]);
    expect(readdirSync(own, { recursive: true })).toEqual(before);
  });
});
