// The runs zip holds what its level names of a run's folder, a link inside the folder as the link,
// and never an installed package, a link out of the folder or a file named like a secret; it opens
// with a README, the guide and a MANIFEST, and refuses to go over its size.
import { describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { runTextSyncOrThrow } from "../src/meta/subprocess.ts";
import type { Run } from "../tools/runs/registry.ts";
import { fit, zip } from "../tools/runs/zip.ts";

const DIGEST = "ab".repeat(32);
const LOG = [
  { at: "2026-10-08T12:00:00.000Z", kind: "build.started", data: { session: "r1-1" } },
  { at: "2026-10-08T12:10:00.000Z", kind: "build.turn", data: { session: "r1-1", turn: 1, text: "edited" } },
  { at: "2026-10-08T12:30:00.000Z", kind: "comparison.reported", data: { reading: "no-step" } },
  { at: "2026-10-08T12:31:00.000Z", kind: "campaign.ended", data: { ending: "stop" } },
];
/** The commit the round's launch ran at, which is not the one its worktree stands at when zipped. */
const RAN_AT = "c0ffee".repeat(6) + "cafe";
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
        "trajectories tree/r1/trajectories/build-r1-1.json",
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
        expect(made.files.map((file) => `${file.group} ${file.path}`).sort()).toEqual(expected.toSorted());
        const names = runTextSyncOrThrow(["unzip", "-Z1", out]).trim().split("\n");
        expect(names.filter((name) => !name.endsWith("/")).sort()).toEqual(
          [...made.files.map((file) => file.path), "README.md", "GUIDE.md", "MANIFEST.json"]
            .map((path) => `${level}/${path}`)
            .sort(),
        );
      }
      runTextSyncOrThrow(["unzip", "-q", join(root, "medium.zip"), "-d", join(root, "opened")]);
      expect(readlinkSync(join(root, "opened", "medium", "tree", "r1", "states", DIGEST, ".toolchain"))).toBe(
        "../tree-abc",
      );
      // The Builder's session as Harbor reads a run, named by the commit its launch ran at.
      const trajectory = parseJsonAs<{ agent: { version: string }; steps: { message: string }[] }>(
        readFileSync(join(root, "opened", "medium", "tree", "r1", "trajectories", "build-r1-1.json"), "utf8"),
      );
      expect(trajectory.agent.version).toBe(RAN_AT.slice(0, 9));
      expect(trajectory.steps.map(({ message }) => message)).toEqual(["edited"]);
      expect(() =>
        zip([run], "light", { out: join(root, "too-small.zip"), maxBytes: 1, note: null }),
      ).toThrow(/0 KB/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
