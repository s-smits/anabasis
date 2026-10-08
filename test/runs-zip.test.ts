// The runs zip holds what its level names of a run's folder and never an installed package, a link
// or a file named like a secret; it opens with a README, the guide and a MANIFEST, and refuses to go
// over its size.
import { describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { runTextSyncOrThrow } from "../src/meta/subprocess.ts";
import type { Run } from "../tools/runs/pulse.ts";
import { fit, type Level, zip } from "../tools/runs/zip.ts";

const DIGEST = "ab".repeat(32);
const LOG = [
  { at: "2026-10-08T12:00:00.000Z", kind: "build.started", data: { session: "r1-1" } },
  { at: "2026-10-08T12:30:00.000Z", kind: "comparison.reported", data: { reading: "no-step" } },
];

/** A round's folder as a session leaves it, in a repository of its own, and the run that names it. */
function round(root: string): Run {
  const tree = join(root, "tree");
  const folder = join(tree, ".ana", "d2", "r1");
  const file = (path: string, content: string) => {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), content);
  };
  file("log.jsonl", `${LOG.map((event) => JSON.stringify(event)).join("\n")}\n`);
  file("checks/brief.json", "{}");
  file("checks/evaluator.ts", "export const check = 1;\n");
  file(`states/${DIGEST}/agent/tools-spec.json`, "{}");
  file(`states/${DIGEST}/correctness-model/controls.json`, "[]");
  file(`states/${DIGEST}/node_modules/dep/index.js`, "module.exports = 1;\n");
  file(`states/${DIGEST}/auth.json`, "{}");
  file("states/tree-abc/bin/solver", "#!/bin/sh\n");
  file("states/tree-abc/pylibs/numpy-2.0.dist-info/METADATA", "Name: numpy\n");
  file("notes.txt", "kept by hand\n");
  symlinkSync(join(folder, "states", "tree-abc"), join(folder, "states", DIGEST, ".toolchain"));
  for (const path of ["src/prompt.ts", "tools/run.ts", "docs/plan.md", "package.json", "test/a.test.ts"]) {
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
  return { name: "r1", tree, path: join(folder, "log.jsonl"), end: "comparison.reported" };
}

describe("the runs zip", () => {
  it("holds what each level names, and never a package, a link or a file named like a secret", () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-runs-zip-test-")));
    try {
      const run = round(root);
      expect(fit(dirname(run.path)).left).toEqual([
        { path: `states/${DIGEST}/.toolchain`, why: "a link" },
        { path: `states/${DIGEST}/auth.json`, why: "a secret's name" },
        { path: `states/${DIGEST}/node_modules`, why: "installed, cached or built" },
        { path: "states/tree-abc/pylibs", why: "installed, cached or built" },
      ]);
      const listed = (level: Level) => {
        const out = join(root, `${level}.zip`);
        const made = zip([run], level, { out, maxBytes: null, note: null });
        const names = runTextSyncOrThrow(["unzip", "-Z1", out]).trim().split("\n");
        expect(names.filter((name) => !name.endsWith("/")).sort()).toEqual(
          [...made.files.map((file) => file.path), "README.md", "GUIDE.md", "MANIFEST.json"]
            .map((path) => `${level}/${path}`)
            .sort(),
        );
        return made.files.map((file) => `${file.group} ${file.path}`);
      };
      const light = [
        "brief tree/r1/checks/brief.json",
        "log tree/r1/log.jsonl",
        `harness tree/r1/states/${DIGEST}/agent/tools-spec.json`,
      ];
      const medium = [
        ...light,
        "checker tree/r1/checks/evaluator.ts",
        `checker tree/r1/states/${DIGEST}/correctness-model/controls.json`,
        "toolchain tree/r1/states/tree-abc/bin/solver",
      ];
      expect(listed("light").sort()).toEqual(light.sort());
      expect(listed("medium").sort()).toEqual(medium.sort());
      expect(listed("verbose").sort()).toEqual(
        [
          ...medium,
          "rest tree/r1/notes.txt",
          ...["docs/plan.md", "package.json", "src/prompt.ts", "tools/run.ts"].map(
            (path) => `source tree/source/${path}`,
          ),
        ].sort(),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("says each run's commit and ending, carries the note, and refuses a zip over its size", () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-runs-zip-test-")));
    try {
      const run = round(root);
      // A live solve's log lies among the other solves', and only its own goes in.
      const live = join(run.tree, ".ana", "live");
      mkdirSync(live);
      const solved = { at: LOG[0]?.at, kind: "solve.finished", data: { ending: { outcome: "fail" } } };
      writeFileSync(join(live, "s1.jsonl"), `${JSON.stringify(solved)}\n`);
      writeFileSync(join(live, "s2.jsonl"), "");
      const solve: Run = { name: "s1", tree: run.tree, path: join(live, "s1.jsonl"), end: "solve.finished" };
      const note = join(root, "note.md");
      writeFileSync(note, "# What the sender saw\n");
      const out = join(root, "handover.zip");
      const made = zip([run, solve], "light", { out, maxBytes: null, note });
      const told = {
        worktree: run.tree,
        commit: runTextSyncOrThrow(["git", "-C", run.tree, "rev-parse", "HEAD"]).trim(),
        dirty: true,
      };
      expect(made.runs).toEqual([
        { name: "r1", log: "tree/r1/log.jsonl", ...told, events: 2, ended: "no-step" },
        { name: "s1", log: "tree/live/s1.jsonl", ...told, events: 1, ended: "fail" },
      ]);
      expect(made.files.map((file) => file.path).filter((path) => path.includes("live"))).toEqual([
        "tree/live/s1.jsonl",
      ]);
      const read = (name: string) => runTextSyncOrThrow(["unzip", "-p", out, `handover/${name}`]);
      expect(read("NOTES.md")).toBe("# What the sender saw\n");
      expect(read("README.md")).toContain("| tree/r1/log.jsonl |");
      expect(read("README.md")).toContain("| brief | the brief the tasks answer | light | 1 file, 0 KB |");
      expect(read("README.md")).toContain("| checker |");
      expect(read("README.md")).toContain("| medium | not at this level |");
      expect(read("GUIDE.md")).toContain("## How to read this bundle");
      expect(parseJsonAs<{ level: string }>(read("MANIFEST.json")).level).toBe("light");
      expect(() => zip([run], "light", { out, maxBytes: 100, note: null })).toThrow("over its 0 KB");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
