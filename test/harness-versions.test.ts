// The harness-versions script of the harness-audit skill, over a campaign written here with the
// log's own `append`: the starter, the child one session froze from it (the account's worked
// harness, one program and a guide), and a copy of the child kept under a digest it does not open
// as, which `keptAs` refuses and the listing has to name. Beside them lies a shared tool tree
// (`tree-*`), which a kept state links to and which is no harness.
import { afterAll, describe, expect, it } from "bun:test";
import { versionsOf } from "#skills/harness-audit/scripts/harness-versions.ts";
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
const guideLines = EXAMPLE.guide.split("\n").filter((line) => line.trim() !== "").length;
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
  const result = runSync([capturedExecPath, script, "--log", from, ...args]);
  return { code: result.exitCode, stderr: decodeOutput(result.stderr) };
};

describe("the harnesses a campaign keeps", () => {
  it("lists each in the order the log names it, with how it was made, measured and promoted", async () => {
    const [first, second, third, ...rest] = await versionsOf({ log, states });
    expect(rest).toStrictEqual([]);
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("three harnesses");
    }
    expect(first.digest).toBe(starter);
    expect(first.roles).toStrictEqual(["starter"]);
    expect(first.made).toContain("Starter");
    expect(first.sessions).toHaveLength(1);
    for (const fact of ["b-1", "3 practice solves", "0 counted fails", short(child)]) {
      expect(first.sessions[0]).toContain(fact);
    }
    expect(second.digest).toBe(child);
    expect(second.opens).toBe("as kept");
    expect(second.roles).toStrictEqual(["reference", "latest"]);
    expect(second.made).toBe(`session b-1 from ${short(starter)}, 6-word note`);
    expect(second.parent).toBe(starter);
    expect(second.compared).toHaveLength(1);
    for (const fact of ["g1", "new harness", short(starter), "step", "5 won", "1 lost", "2 tied"]) {
      expect(second.compared[0]).toContain(fact);
    }
    expect(second.promoted).toHaveLength(1);
    expect(second.parts).toMatchObject({ guide: guideLines, toolTree: { files: 1 } });
    expect(third.digest).toBe(misnamed);
    expect(third.opens).toBe(`as ${short(child)}, not as kept`);
    expect(third.made).toStartWith("no record of its making");
  });
});

describe("a campaign its Builder leads", () => {
  it("reads each checkpoint's parent as the session's checkpoint before it, or what it began from", async () => {
    // A led conversation freezes with `build.checkpoint` alone: buffer-fresh-opus-v072's compared
    // harnesses all read "no record of its making" (the sweep of 27 October, lane 13).
    const led = join(root, "led");
    const ledStates = join(led, "states");
    mkdirSync(ledStates, { recursive: true });
    for (const digest of [starter, child]) {
      cpSync(join(states, digest), join(ledStates, digest), { recursive: true });
    }
    const later = await keep(
      (dir) => writeHarness(dir, { ...EXAMPLE, guide: `${EXAMPLE.guide}\nOne more line.` }),
      ledStates,
    );
    const ledLog = join(led, "log.jsonl");
    append(ledLog, "build.started", { session: "b-1", parent: starter });
    append(ledLog, "build.checkpoint", { session: "b-1", harness: child });
    append(ledLog, "build.checkpoint", { session: "b-1", harness: later });
    const made = new Map((await versionsOf({ log: ledLog, states: ledStates })).map((v) => [v.digest, v]));
    expect(made.get(child)?.made).toBe(`checkpoint of session b-1 from ${short(starter)}`);
    expect(made.get(later)?.made).toBe(`checkpoint of session b-1 from ${short(child)}`);
    expect(made.get(later)?.parent).toBe(child);
  });

  it("preserves an imported harness's origin when a checkpoint reuses its digest", async () => {
    const imported = join(root, "imported");
    const importedStates = join(imported, "states");
    mkdirSync(importedStates, { recursive: true });
    for (const digest of [starter, child]) {
      cpSync(join(states, digest), join(importedStates, digest), { recursive: true });
    }
    const importedLog = join(imported, "log.jsonl");
    append(importedLog, "harness.imported", { harness: child, from: "handed/harness" });
    const origin = { made: "imported from handed/harness", parent: null };
    expect(
      (await versionsOf({ log: importedLog, states: importedStates })).find((v) => v.digest === child),
    ).toMatchObject(origin);
    append(importedLog, "build.started", { session: "b-1", parent: starter });
    append(importedLog, "build.checkpoint", { session: "b-1", harness: child });
    expect(
      (await versionsOf({ log: importedLog, states: importedStates })).find((v) => v.digest === child),
    ).toMatchObject(origin);
    const diffed = run(importedLog, "--diff", child);
    expect(diffed.code).toBe(2);
    expect(diffed.stderr).toContain("no parent");
    expect(run(importedLog, "--diff", child, "--against", starter).code).toBe(0);
  });
});

describe("the command", () => {
  it("refuses a control, a harness with no parent on record, and a state that opens as another", () => {
    for (const [harness, fact] of [
      ["programs-of:latest", "no control"],
      ["starter", "no parent"],
    ] as const) {
      const refused = run(log, "--diff", harness);
      expect(refused.code).toBe(2);
      expect(refused.stderr).toContain(fact);
    }
    const misread = run(log, "--diff", misnamed, "--against", "starter");
    expect(misread.code).toBe(1);
    expect(misread.stderr).toContain("no longer opens as the harness it is kept as");
  });
});
