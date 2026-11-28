// A seed placed under the code its run ran: a run launched at one commit and continued at another
// stands at the second, so a seed cut inside the first stretch goes to a tree at the first commit, and
// one cut inside the second to the run's own tree.
import { afterAll, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { EXAMINER_HOMES, restoreHome, snapshotHome } from "../src/examiner/home-store.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { runTextSyncOrThrow } from "../src/meta/subprocess.ts";
import { codeOf } from "../tools/campaign/campaign.ts";
import { atCommit } from "../tools/runs/code.ts";
import { codeLine, seedCampaign, treeAsRan } from "../tools/runs/seed.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-seed-test-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const git = (repo: string, ...args: string[]) => runTextSyncOrThrow(["git", "-C", repo, ...args]).trim();

const main = join(root, "main");
mkdirSync(join(main, "src"), { recursive: true });
for (const part of ["node_modules", "vendor"]) mkdirSync(join(main, part));
git(main, "init", "-q", "-b", "trunk");
writeFileSync(join(main, "package.json"), '{"dependencies":{}}\n');
for (const part of ["node_modules", "vendor"]) writeFileSync(join(main, part, ".keep"), "");
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

  it("refuses where no tree holds the recorded code, naming it", () => {
    const folder = run("lost", "f".repeat(64));
    expect(() => treeAsRan(folder, { before: "b-1" }, main)).toThrow("ran by event 1, ffffffff");
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

  const points = (folder: string) =>
    runTextSyncOrThrow([capturedExecPath, "tools/runs/cli.ts", "seed", "--from", folder, "--points"], {
      cwd: resolve(import.meta.dir, ".."),
    })
      .trim()
      .split("\n");

  it("lists each session, comparison, promotion, starter read and first Referee turn", () => {
    const folder = join(root, "points");
    mkdirSync(folder);
    writeFileSync(join(folder, "log.jsonl"), `${events.map((one) => JSON.stringify(one)).join("\n")}\n`);
    expect(points(folder)).toEqual([
      "0 build.started b-1",
      "2 build.finished b-1",
      "3 comparison.started g-1",
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
    expect(points(folder)).toEqual(["1 build.started b-1", "3 build.started b-2"]);
    expect(readdirSync(own, { recursive: true })).toEqual(before);
  });
});

describe("deduped examiner-home snapshots", () => {
  it("deduplicates blobs across sessions and restores the examiner-home the last session before the cut kept", () => {
    const source = join(root, "snap-source");
    const home = join(source, "examiner-home");
    const store = join(source, EXAMINER_HOMES);
    mkdirSync(join(home, "sub"), { recursive: true });

    writeFileSync(join(home, "shared.txt"), "unchanged across sessions\n");
    writeFileSync(join(home, "NOTES.md"), "draft notes\n");
    writeFileSync(join(home, ".environment"), "keep benign lookalike\n");
    writeFileSync(join(home, "auth.json.bak"), "keep benign lookalike\n");
    for (const secret of [
      ".env",
      ".env.local",
      "prod.env",
      "auth.json",
      "sub/.env.secret",
      "sub/auth.json",
    ]) {
      writeFileSync(join(home, secret), "SECRET=1\n");
    }
    mkdirSync(join(home, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(home, "node_modules", "pkg", "index.js"), "ignored\n");
    writeFileSync(join(home, "sub", "tool.sh"), "#!/bin/sh\necho v1\n");
    chmodSync(join(home, "sub", "tool.sh"), 0o755);
    symlinkSync("shared.txt", join(home, "link.txt"));
    snapshotHome(home, store, "d-1");

    writeFileSync(join(home, "NOTES.md"), "x-1 notes\n");
    writeFileSync(join(home, "gen.py"), "print('x-1')\n");
    snapshotHome(home, store, "x-1");
    snapshotHome(home, store, "x-crash-0");

    rmSync(join(home, "gen.py"));
    writeFileSync(join(home, "NOTES.md"), "x-2 notes\n");
    snapshotHome(home, store, "x-2");
    snapshotHome(home, store, "x-crash");

    const objects = readdirSync(join(store, "objects"));
    expect(objects.length).toBe(7);

    const row = (kind: EventKind, data: JsonObject) =>
      JSON.stringify({ at: "2026-11-26T00:00:00.000Z", kind, data });
    writeFileSync(
      join(source, "log.jsonl"),
      `${[
        row("draft.started", { session: "d-1" }),
        row("draft.finished", { session: "d-1", ended: "stands" }),
        row("build.started", { session: "b-mem" }),
        row("exam.started", { session: "x-1" }),
        row("exam.finished", { session: "x-1", ended: "supplied" }),
        row("exam.started", { session: "x-crash-0" }),
        row("exam.finished", { session: "x-crash-0", ended: "crashed", running: 0 }),
        row("exam.started", { session: "x-crash" }),
        row("exam.finished", { session: "x-crash", ended: "crashed", running: 1 }),
        row("exam.started", { session: "x-2" }),
        row("exam.finished", { session: "x-2", ended: "supplied" }),
        row("exam.started", { session: "x-3" }),
        row("exam.finished", { session: "x-3", ended: "supplied" }),
      ].join("\n")}\n`,
    );
    mkdirSync(join(source, "memory", "b-mem"), { recursive: true });
    writeFileSync(join(source, "memory", "b-mem", "MEMORY.md"), "safe memory\n");

    const seeded = join(root, "sim-before-x2");
    const made = seedCampaign(source, seeded, { before: "x-2" });
    expect(made.examinerHome).toBe(true);
    expect(made.examinerHomeFrom).toBe("x-crash-0");
    expect(readFileSync(join(seeded, "memory", "b-mem", "MEMORY.md"), "utf8")).toBe("safe memory\n");
    expect(readFileSync(join(seeded, "examiner-home", "NOTES.md"), "utf8")).toBe("x-1 notes\n");
    expect(readFileSync(join(seeded, "examiner-home", "gen.py"), "utf8")).toBe("print('x-1')\n");
    expect(readFileSync(join(seeded, "examiner-home", "shared.txt"), "utf8")).toBe(
      "unchanged across sessions\n",
    );
    expect(readlinkSync(join(seeded, "examiner-home", "link.txt"))).toBe("shared.txt");
    expect(statSync(join(seeded, "examiner-home", "sub", "tool.sh")).mode & 0o777).toBe(0o755);
    for (const secret of [
      ".env",
      ".env.local",
      "prod.env",
      "auth.json",
      "sub/.env.secret",
      "sub/auth.json",
    ]) {
      expect(existsSync(join(seeded, "examiner-home", secret))).toBe(false);
    }
    for (const kept of [".environment", "auth.json.bak"]) {
      expect(existsSync(join(seeded, "examiner-home", kept))).toBe(true);
    }
    expect(existsSync(join(seeded, "examiner-home", "node_modules"))).toBe(false);

    const liveSource = join(root, "live-fallback");
    mkdirSync(join(liveSource, "examiner-home"), { recursive: true });
    symlinkSync("missing-target", join(liveSource, "examiner-home", "dangling"));
    writeFileSync(
      join(liveSource, "log.jsonl"),
      `${[
        row("exam.started", { session: "x-1" }),
        row("exam.finished", { session: "x-1", ended: "crashed", running: 0 }),
        row("exam.started", { session: "x-2" }),
        row("exam.finished", { session: "x-2", ended: "supplied" }),
      ].join("\n")}\n`,
    );
    const liveAll = seedCampaign(liveSource, join(root, "sim-live-all"), {});
    expect(liveAll.examinerHome).toBe(true);
    expect(liveAll.examinerHomeFrom).toBeNull();
    expect(readlinkSync(join(root, "sim-live-all", "examiner-home", "dangling"))).toBe("missing-target");
    const liveEarly = seedCampaign(liveSource, join(root, "sim-live-early"), { before: "x-2" });
    expect(liveEarly.examinerHome).toBe(false);
    expect(existsSync(join(root, "sim-live-early", "examiner-home"))).toBe(false);
  });

  it("records nothing for an absent home and refuses unsafe snapshot ids", () => {
    const store = join(root, "bad-store");
    snapshotHome(join(root, "does-not-exist"), store, "absent");
    expect(restoreHome(store, "absent", join(root, "out-0"))).toBe(false);
    expect(() => snapshotHome(join(root, "does-not-exist"), store, "../escape")).toThrow(
      "unsafe examiner home snapshot id",
    );
    expect(() => restoreHome(store, "../escape", join(root, "out-0"))).toThrow(
      "unsafe examiner home snapshot id",
    );
  });
});
