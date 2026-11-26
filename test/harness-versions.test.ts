// The harness-versions script of the harness-audit skill, over a campaign written with the log's own
// `append`: the starter, a child one session froze from it, and a copy of the child kept under a digest
// it does not open as, which the listing must name. A shared tool tree (`tree-*`) beside them is no
// harness.
import { afterAll, describe, expect, it } from "bun:test";
import type { Version } from "#skills/harness-audit/scripts/harness-versions.ts";
import { append } from "../src/kernel/log.ts";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";
import { openHarness } from "../src/harness/open.ts";
import { EXAMPLE, writeStarter } from "../src/harness/starter.ts";
import { writeHarness } from "./helpers/write-harness.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-harness-versions-test-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const log = join(root, "log.jsonl");
const states = join(root, "states");
mkdirSync(states);
const script = join(import.meta.dir, "../.claude/skills/harness-audit/scripts/harness-versions.ts");

/** Write a harness, and keep it under the digest it opens as, as a session's freeze does. */
async function keep(write: (dir: string) => void, into = states): Promise<string> {
  const dir = join(root, "scratch");
  write(dir);
  const { digest } = await openHarness(dir);
  renameSync(dir, join(into, digest));
  return digest;
}

const starter = await keep(writeStarter);
const child = await keep((dir) => writeHarness(dir, EXAMPLE));
const misnamed = "0".repeat(64);
cpSync(join(states, child), join(states, misnamed), { recursive: true });
mkdirSync(join(states, "tree-x", "bin"), { recursive: true });
writeFileSync(join(states, "tree-x", "bin", "tool"), "#!/bin/sh\n");

const short = (digest: string) => digest.slice(0, 8);

append(log, "build.started", { session: "b-1", parent: starter });
append(log, "build.finished", {
  session: "b-1",
  ended: "finished",
  harness: child,
  changed: true,
  practiceSolves: 3,
});
append(log, "harness.version", {
  version: child,
  parent: starter,
  session: "b-1",
  note: "One program and its guide line.",
});
append(log, "comparison.started", { session: "g1", old: starter, fresh: child, solves: 2 });
append(log, "comparison.reported", {
  session: "g1",
  old: starter,
  fresh: child,
  reading: "step",
  scored: { wins: 5, losses: 1, ties: 2 },
});
append(log, "harness.promoted", { harness: child, from: starter, rests: ["g1"] });

const run = (from: string, ...args: string[]) => {
  const result = runSync([capturedExecPath, script, from, ...args]);
  return { code: result.exitCode, stdout: decodeOutput(result.stdout), stderr: decodeOutput(result.stderr) };
};

describe("the command", () => {
  it("prints the chain blind: each version's parts and diff, and nothing of how it was measured", () => {
    const blind = run(log, "--blind");
    expect(blind.code).toBe(0);
    expect(blind.stdout).toContain(`against ${short(starter)}:`);
    expect(blind.stdout).toContain("[starter]");
    const json = run(log, "--blind", "--json");
    expect(json.code).toBe(0);
    for (const result of ["comparison", "promoted", "reference", "latest", "step", "won"]) {
      expect(blind.stdout).not.toContain(result);
    }
    // SAFETY: `--json` prints `{ log, states, versions }`, each version a `Version` (`main`).
    const versions = (JSON.parse(json.stdout) as { versions: Version[] }).versions;
    expect(
      versions.flatMap(({ roles, sessions, compared, promoted }) => [
        ...roles,
        ...sessions,
        ...compared,
        ...promoted,
      ]),
    ).toEqual(["starter"]);
    expect(run(log).stdout).toContain("comparison g1");
  });

  it("refuses a control, a harness with no parent on record, and a digest the campaign does not keep", () => {
    for (const [harness, fact] of [
      ["programs-of:latest", "no control"],
      ["starter", "no parent"],
    ] as const) {
      const refused = run(log, "--diff", harness);
      expect(refused.code).toBe(2);
      expect(refused.stderr).toContain(fact);
    }
    const unkept = run(log, "--diff", "f".repeat(64), "--against", "starter");
    expect(unkept.code).toBe(1);
    expect(unkept.stderr).toContain("is no harness this campaign keeps");
  });
});
