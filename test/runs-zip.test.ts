// The runs zip holds what its level names of a run's folder, a link inside the folder as the link,
// and never an installed package, a link out of the folder or a file named like a secret; it opens
// with a README, the guide and a MANIFEST, and refuses to go over its size.
import { describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { runTextSyncOrThrow } from "../src/meta/subprocess.ts";
import type { Run } from "../tools/runs/registry.ts";
import { fit, momentOf, newest, secondsOf, zip } from "../tools/runs/zip.ts";

const DIGEST = "ab".repeat(32);
const LOG = [
  { at: "2026-10-08T12:00:00.000Z", kind: "build.started", data: { session: "r1-1" } },
  { at: "2026-10-08T12:10:00.000Z", kind: "build.turn", data: { session: "r1-1", turn: 1, text: "edited" } },
  { at: "2026-10-08T12:30:00.000Z", kind: "comparison.reported", data: { reading: "no-step" } },
  { at: "2026-10-08T12:31:00.000Z", kind: "campaign.ended", data: { ending: "stop" } },
];
/** The commit the round's launch ran at, which is not the one its worktree stands at when zipped. */
const RAN_AT = `${"c0ffee".repeat(6)}cafe`;
const RECEIPT = {
  at: "2026-10-08T11:59:00.000Z",
  pid: 1,
  flags: ["--cap", "5"],
  envFile: null,
  commit: RAN_AT,
  dirty: false,
  load: 1.5,
  cores: 8,
};

describe("the runs zip", () => {
  it("holds what each level names, a link inside the folder as the link, and never a package, a link out of it or a secret", () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-runs-zip-test-")));
    try {
      const tree = join(root, "tree");
      const folder = join(tree, ".ana", "d2", "r1");
      const put = (path: string, content: string) => {
        mkdirSync(dirname(join(folder, path)), { recursive: true });
        writeFileSync(join(folder, path), content);
      };
      // The log of a live run: its last line is the append in flight.
      put("log.jsonl", `${LOG.map((event) => JSON.stringify(event)).join("\n")}\n{"at":`);
      put("launch-b-1.json", JSON.stringify(RECEIPT));
      put("checks/brief.json", "{}");
      put("checks/evaluator.ts", "export const check = 1;\n");
      put(`exams/${DIGEST}/checks/brief.json`, "{}");
      put(`exams/${DIGEST}/checks/evaluator.ts`, "export const check = 1;\n");
      put(`states/${DIGEST}/agent/tools-spec.json`, "{}");
      put(`states/${DIGEST}/correctness-model/controls.json`, "[]");
      put(`states/${DIGEST}/node_modules/dep/index.js`, "module.exports = 1;\n");
      put(`states/${DIGEST}/auth.json`, "{}");
      put("states/tree-abc/bin/solver", "#!/bin/sh\n");
      put("states/tree-abc/pylibs/numpy-2.0.dist-info/METADATA", "Name: numpy\n");
      put("notes.txt", "kept by hand\n");
      symlinkSync("../tree-abc", join(folder, "states", DIGEST, ".toolchain"));
      symlinkSync(join(folder, "states", "tree-abc"), join(folder, "states", DIGEST, "absolute"));
      symlinkSync("../../../outside", join(folder, "states", DIGEST, "outside"));
      for (const path of [
        "src/prompt.ts",
        "tools/run.ts",
        "docs/plan.md",
        "package.json",
        "test/a.test.ts",
      ]) {
        mkdirSync(dirname(join(tree, path)), { recursive: true });
        writeFileSync(join(tree, path), `${path}\n`);
      }
      for (const args of [
        ["init", "-q"],
        ["add", "src", "tools", "docs", "package.json", "test"],
        ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x"],
      ]) {
        runTextSyncOrThrow(["git", "-C", tree, ...args]);
      }
      const run: Run = { name: "r1", tree, path: join(folder, "log.jsonl"), end: "comparison.reported" };
      expect(fit(dirname(run.path)).left).toEqual([
        { path: `states/${DIGEST}/absolute`, why: "a link out of its folder" },
        { path: `states/${DIGEST}/auth.json`, why: "a secret's name" },
        { path: `states/${DIGEST}/node_modules`, why: "installed, cached or built" },
        { path: `states/${DIGEST}/outside`, why: "a link out of its folder" },
        { path: "states/tree-abc/pylibs", why: "installed, cached or built" },
      ]);
      const light = [
        "brief tree/r1/checks/brief.json",
        `brief tree/r1/exams/${DIGEST}/checks/brief.json`,
        "log tree/r1/launch-b-1.json",
        "log tree/r1/log.jsonl",
        `harness tree/r1/states/${DIGEST}/agent/tools-spec.json`,
      ];
      const medium = [
        ...light,
        "checker tree/r1/checks/evaluator.ts",
        `checker tree/r1/exams/${DIGEST}/checks/evaluator.ts`,
        `checker tree/r1/states/${DIGEST}/correctness-model/controls.json`,
        "toolchain tree/r1/states/tree-abc/bin/solver",
        `toolchain tree/r1/states/${DIGEST}/.toolchain`,
      ];
      const verbose = [
        ...medium,
        "rest tree/r1/notes.txt",
        ...["docs/plan.md", "package.json", "src/prompt.ts", "tools/run.ts"].map(
          (path) => `source tree/source/${path}`,
        ),
      ];
      for (const [level, expected] of [
        ["light", light],
        ["medium", medium],
        ["verbose", verbose],
      ] as const) {
        const out = join(root, `${level}.zip`);
        const made = zip([run], level, { out, maxBytes: null, note: null });
        expect(made.files.map((file) => `${file.group} ${file.path}`).toSorted()).toEqual(
          expected.toSorted(),
        );
        const names = runTextSyncOrThrow(["unzip", "-Z1", out]).trim().split("\n");
        expect(names.filter((name) => !name.endsWith("/")).toSorted()).toEqual(
          [...made.files.map((file) => file.path), "README.md", "GUIDE.md", "MANIFEST.json"]
            .map((path) => `${level}/${path}`)
            .toSorted(),
        );
      }
      runTextSyncOrThrow(["unzip", "-q", join(root, "medium.zip"), "-d", join(root, "opened")]);
      expect(readlinkSync(join(root, "opened", "medium", "tree", "r1", "states", DIGEST, ".toolchain"))).toBe(
        "../tree-abc",
      );
      expect(() =>
        zip([run], "light", { out: join(root, "too-small.zip"), maxBytes: 1, note: null }),
      ).toThrow(/0 KB/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("picks the newest campaigns with enough promotions and enough time, and no seed or live solve", () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-runs-pick-test-")));
    try {
      const make = (name: string, from: string, to: string, promotions: number, rest: Partial<Run> = {}) => {
        const events = [
          { at: from, kind: "build.started", data: {} },
          ...Array.from({ length: promotions }, () => ({
            at: from,
            kind: "harness.promoted",
            // A task's text that names the kind is no promotion: only the event's own kind counts.
            data: { note: "harness.promoted" },
          })),
          { at: to, kind: "build.turn", data: { text: "harness.promoted" } },
        ];
        const path = join(root, name, "log.jsonl");
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${events.map((event) => JSON.stringify(event)).join("\n")}\n{"at":`);
        return { name, tree: root, path, end: "comparison.reported", ...rest } satisfies Run;
      };
      const old = make("old", "2026-11-01T00:00:00.000Z", "2026-11-01T05:00:00.000Z", 3);
      const long = make("long", "2026-11-08T08:00:00.000Z", "2026-11-08T12:00:00.000Z", 1);
      const short = make("short", "2026-11-08T11:00:00.000Z", "2026-11-08T12:30:00.000Z", 2);
      const bare = make("bare", "2026-11-08T06:00:00.000Z", "2026-11-08T13:00:00.000Z", 0);
      const seed = make("seed", "2026-11-08T06:00:00.000Z", "2026-11-08T14:00:00.000Z", 2, { seed: true });
      const solve = make("solve", "2026-11-08T06:00:00.000Z", "2026-11-08T14:00:00.000Z", 2, {
        end: "solve.finished",
      });
      const runs = [old, long, short, bare, seed, solve];
      const open = { since: -Infinity, until: Infinity };
      const names = (pick: Omit<Parameters<typeof newest>[1], "since" | "until"> & Partial<typeof open>) =>
        newest(runs, { ...open, ...pick }).map((run) => run.name);
      expect(names({ latest: null, promotions: 0, seconds: 0 })).toEqual(["bare", "short", "long", "old"]);
      expect(names({ latest: 2, promotions: 1, seconds: 0 })).toEqual(["short", "long"]);
      expect(names({ latest: null, promotions: 1, seconds: secondsOf("2h") })).toEqual(["long", "old"]);
      expect(names({ latest: 1, promotions: 4, seconds: 0 })).toEqual([]);
      expect(
        newest([make("empty", "2026-11-08T00:00:00.000Z", "2026-11-08T00:00:00.000Z", 0)], {
          ...open,
          latest: null,
          promotions: 0,
          seconds: 1,
        }),
      ).toEqual([]);
      // A window keeps a run whose record overlaps it, so one that began before it still counts.
      const any = { latest: null, promotions: 0, seconds: 0 };
      expect(names({ ...any, since: Date.parse("2026-11-08T00:00:00Z") })).toEqual(["bare", "short", "long"]);
      expect(names({ ...any, until: Date.parse("2026-11-07T00:00:00Z") })).toEqual(["old"]);
      expect(
        names({
          ...any,
          since: Date.parse("2026-11-08T12:15:00Z"),
          until: Date.parse("2026-11-08T12:45:00Z"),
        }),
      ).toEqual(["bare", "short"]);
      expect(names({ ...any, since: Date.parse("2026-11-09T00:00:00Z") })).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads a moment as a date, a time with a zone or how long ago, and refuses the rest", () => {
    const now = Date.parse("2026-11-08T12:00:00Z");
    expect([
      momentOf("--since", "2026-11-06", now),
      momentOf("--since", "2026-11-06T12:30Z", now),
      momentOf("--since", "2026-11-06T12:30:15+01:00", now),
      momentOf("--since", "36h", now),
    ]).toEqual([
      Date.parse("2026-11-06T00:00:00Z"),
      Date.parse("2026-11-06T12:30:00Z"),
      Date.parse("2026-11-06T11:30:15Z"),
      Date.parse("2026-11-07T00:00:00Z"),
    ]);
    for (const text of ["yesterday", "2026-11-06T12:00", "11-06", "2026-13-45", "", "36"]) {
      expect(() => momentOf("--until", text, now)).toThrow(/--until/);
    }
  });

  it("reads a duration as a number and one unit, and refuses the rest", () => {
    expect(["2h", "90m", "45s", "1.5d"].map(secondsOf)).toEqual([7200, 5400, 45, 129_600]);
    for (const text of ["2", "h", "2 h", "-2h", "2w", ""]) expect(() => secondsOf(text)).toThrow(/--minTime/);
  });
});
