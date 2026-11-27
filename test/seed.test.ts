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
import { CLAUDE_SESSIONS_DIR } from "../src/agent/backends/claude-transcript.ts";
import { EXAMINER_HOMES, restoreHome, snapshotHome } from "../src/examiner/home-store.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { errorMessage } from "../src/meta/runtime-values.ts";
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

describe("deduped examiner-home snapshots and claude-session seeding", () => {
  it("deduplicates blobs across sessions, restores historical examiner-home at --before, and copies relevant claude sessions", () => {
    const source = join(root, "snap-source");
    const home = join(source, "examiner-home");
    const store = join(source, EXAMINER_HOMES);
    const sessions = join(source, CLAUDE_SESSIONS_DIR);
    mkdirSync(join(home, "sub"), { recursive: true });
    mkdirSync(sessions, { recursive: true });

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
        row("build.started", { session: "../evil-mem" }),
        row("exam.started", { session: "x-1", conversation: "x-parent-before" }),
        row("exam.finished", { session: "x-1", ended: "supplied" }),
        row("exam.started", { session: "x-crash-0" }),
        row("exam.finished", { session: "x-crash-0", ended: "crashed", running: 0 }),
        row("exam.started", { session: "x-crash" }),
        row("exam.finished", { session: "x-crash", ended: "crashed", running: 1 }),
        row("exam.started", { session: "../evil" }),
        row("build.finished", { session: "b-unrelated-only" }),
        row("build.finished", { session: "x-2", conversation: "x-wrong-kind" }),
        row("exam.started", { session: "x-2", conversation: "x-parent-tail" }),
        row("exam.started", { session: "x-other", conversation: "x-wrong-session" }),
        row("exam.finished", { session: "x-2", ended: "supplied" }),
        row("exam.started", { session: "x-3" }),
        row("exam.finished", { session: "x-3", ended: "supplied" }),
      ].join("\n")}\n`,
    );
    mkdirSync(join(source, "memory", "b-mem"), { recursive: true });
    writeFileSync(join(source, "memory", "b-mem", "MEMORY.md"), "safe memory\n");
    writeFileSync(join(source, "evil-mem"), "must not copy\n");
    writeFileSync(join(source, "evil.jsonl"), '{"sessionId":"00000000-0000-0000-0000-000000000009"}\n');
    for (const id of [
      "d-1",
      "x-1",
      "x-parent-before",
      "x-2",
      "x-3",
      "b-unrelated-only",
      "x-parent-tail",
      "x-wrong-kind",
      "x-wrong-session",
    ]) {
      writeFileSync(join(sessions, `${id}.jsonl`), `{"sessionId":"00000000-0000-0000-0000-000000000001"}\n`);
    }

    const seeded = join(root, "sim-before-x2");
    const made = seedCampaign(source, seeded, { before: "x-2" });
    expect(made.examinerHome).toBe(true);
    expect(made.examinerHomeFrom).toBe("x-crash-0");
    expect(existsSync(join(seeded, "evil.jsonl"))).toBe(false);
    expect(existsSync(join(seeded, "evil-mem"))).toBe(false);
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

    expect(existsSync(join(seeded, CLAUDE_SESSIONS_DIR, "d-1.jsonl"))).toBe(true);
    expect(existsSync(join(seeded, CLAUDE_SESSIONS_DIR, "x-1.jsonl"))).toBe(true);
    expect(existsSync(join(seeded, CLAUDE_SESSIONS_DIR, "x-parent-before.jsonl"))).toBe(true);
    expect(existsSync(join(seeded, CLAUDE_SESSIONS_DIR, "x-2.jsonl"))).toBe(true);
    expect(existsSync(join(seeded, CLAUDE_SESSIONS_DIR, "x-parent-tail.jsonl"))).toBe(true);
    expect(existsSync(join(seeded, CLAUDE_SESSIONS_DIR, "x-wrong-kind.jsonl"))).toBe(false);
    expect(existsSync(join(seeded, CLAUDE_SESSIONS_DIR, "x-wrong-session.jsonl"))).toBe(false);
    expect(existsSync(join(seeded, CLAUDE_SESSIONS_DIR, "b-unrelated-only.jsonl"))).toBe(false);
    expect(existsSync(join(seeded, CLAUDE_SESSIONS_DIR, "x-3.jsonl"))).toBe(false);

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
    expect(liveAll.examinerHomeFrom).toBeUndefined();
    expect(readlinkSync(join(root, "sim-live-all", "examiner-home", "dangling"))).toBe("missing-target");
    const liveEarly = seedCampaign(liveSource, join(root, "sim-live-early"), { before: "x-2" });
    expect(liveEarly.examinerHome).toBe(false);
    expect(existsSync(join(root, "sim-live-early", "examiner-home"))).toBe(false);
  });

  it("refuses manifests with escaping paths, unsafe ids, corrupt entries, or missing blobs on restore", () => {
    const store = join(root, "bad-store");
    mkdirSync(join(store, "objects"), { recursive: true });
    snapshotHome(join(root, "does-not-exist"), store, "absent");
    expect(existsSync(join(store, "absent.json"))).toBe(false);
    expect(() => snapshotHome(store, store, "../escape")).toThrow("unsafe examiner home snapshot id");
    expect(() => restoreHome(store, "../escape", join(root, "out-0"))).toThrow(
      "unsafe examiner home snapshot id",
    );

    writeFileSync(
      join(store, "escape.json"),
      JSON.stringify({ session: "escape", entries: [{ path: "../outside.txt", kind: "dir" }] }),
    );
    expect(() => restoreHome(store, "escape", join(root, "out-1"))).toThrow("escapes target");

    writeFileSync(
      join(store, "missing.json"),
      JSON.stringify({
        session: "missing",
        entries: [{ path: "a.txt", kind: "file", sha256: "a".repeat(64), mode: 0o644 }],
      }),
    );
    expect(() => restoreHome(store, "missing", join(root, "out-2"))).toThrow("missing examiner home blob");

    const outsideSym = join(root, "outside-sym");
    mkdirSync(outsideSym, { recursive: true });
    for (const [id, parents] of [
      ["sym-depth-0", []],
      ["sym-depth-1", ["sub"]],
      ["sym-depth-2", ["sub", "sub/deep"]],
    ] as const) {
      const linkPath = parents.length === 0 ? "linkdir" : `${parents.at(-1)}/linkdir`;
      writeFileSync(
        join(store, `${id}.json`),
        JSON.stringify({
          session: id,
          entries: [
            ...parents.map((path) => ({ path, kind: "dir" })),
            { path: linkPath, kind: "symlink", target: outsideSym },
            { path: `${linkPath}/pwn.txt`, kind: "dir" },
          ],
        }),
      );
      expect(() => restoreHome(store, id, join(root, `out-${id}`))).toThrow("traverses symlink");
      expect(existsSync(join(outsideSym, "pwn.txt"))).toBe(false);
    }
    for (const [id, secondPath] of [
      ["sym-overwrite", "linkdir"],
      ["sym-dot-prefix", "./linkdir/pwn.txt"],
      ["sym-dotdot-norm", "sub/../linkdir/pwn.txt"],
    ] as const) {
      writeFileSync(
        join(store, `${id}.json`),
        JSON.stringify({
          session: id,
          entries: [
            { path: "linkdir", kind: "symlink", target: outsideSym },
            { path: secondPath, kind: "dir" },
          ],
        }),
      );
      expect(() => restoreHome(store, id, join(root, `out-${id}`))).toThrow("traverses symlink");
    }

    const invalidManifests: readonly [string, unknown, string][] = [
      ["bad-array", { session: "bad-array", entries: "nope" }, "bad-array: invalid examiner home manifest"],
      ["bad-null", { session: "bad-null", entries: [null] }, "invalid examiner home snapshot entry"],
      [
        "bad-empty",
        { session: "bad-empty", entries: [{ path: "", kind: "dir" }] },
        "bad-empty: examiner home entry escapes target: ",
      ],
      [
        "bad-kind",
        { session: "bad-kind", entries: [{ path: "a", kind: "socket" }] },
        "invalid examiner home snapshot entry for a",
      ],
      [
        "bad-sym",
        { session: "bad-sym", entries: [{ path: "a", kind: "symlink" }] },
        "invalid examiner home snapshot entry for a",
      ],
      [
        "bad-hash",
        { session: "bad-hash", entries: [{ path: "a", kind: "file", sha256: "short", mode: 0o644 }] },
        "invalid examiner home snapshot entry for a",
      ],
      [
        "bad-mode",
        { session: "bad-mode", entries: [{ path: "a", kind: "file", sha256: "a".repeat(64), mode: "644" }] },
        "invalid examiner home snapshot entry for a",
      ],
    ];
    for (const [id, payload, message] of invalidManifests) {
      writeFileSync(join(store, `${id}.json`), JSON.stringify(payload));
      let thrown = "";
      try {
        restoreHome(store, id, join(root, `out-${id}`));
      } catch (error) {
        thrown = errorMessage(error);
      }
      expect(thrown).toBe(message);
    }
  });
});
