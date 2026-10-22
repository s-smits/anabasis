// The harness-versions script of the harness-audit skill, over a campaign written here with the
// log's own `append`: the starter, the child one session froze from it (the account's worked
// harness, one program and a guide), and a copy of the child kept under a digest it does not open
// as, which `keptAs` refuses and the listing has to name.
import { afterAll, describe, expect, it } from "bun:test";
import { diffOf, versionsOf } from "#skills/harness-audit/scripts/harness-versions.ts";
import { append } from "../src/kernel/log.ts";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";
import { openHarness } from "../src/harness/open.ts";
import { EXAMPLE, writeHarness, writeStarter } from "../src/harness/starter.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-harness-versions-test-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const log = join(root, "log.jsonl");
const states = join(root, "states");
mkdirSync(states);
const script = join(import.meta.dir, "../.claude/skills/harness-audit/scripts/harness-versions.ts");

/** Write a harness, and keep it under the digest it opens as, as a session's freeze does. */
async function keep(write: (dir: string) => void): Promise<string> {
  const dir = join(root, "scratch");
  write(dir);
  const { digest } = await openHarness(dir);
  renameSync(dir, join(states, digest));
  return digest;
}

const starter = await keep(writeStarter);
const child = await keep((dir) => writeHarness(dir, EXAMPLE));
const misnamed = "0".repeat(64);
cpSync(join(states, child), join(states, misnamed), { recursive: true });
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

const run = (...args: string[]) => {
  const result = runSync([capturedExecPath, script, "--log", log, ...args]);
  return { code: result.exitCode, stdout: decodeOutput(result.stdout), stderr: decodeOutput(result.stderr) };
};

describe("the harnesses a campaign keeps", () => {
  it("lists each in the order the log names it, with how it was made, measured and promoted", async () => {
    const [first, second, third, ...rest] = await versionsOf({ log, states });
    expect(rest).toStrictEqual([]);
    expect(first?.digest).toBe(starter);
    expect(first?.roles).toStrictEqual(["starter"]);
    expect(first?.made).toBe("the Starter Built Harness as this checkout writes it");
    expect(first?.sessions).toStrictEqual([`b-1: 3 practice solves, 0 counted fails, left ${short(child)}`]);
    expect(second?.digest).toBe(child);
    expect(second?.opens).toBe("as kept");
    expect(second?.roles).toStrictEqual(["reference", "latest"]);
    expect(second?.made).toBe(`session b-1 from ${short(starter)}, 6-word note`);
    expect(second?.parent).toBe(starter);
    expect(second?.compared).toStrictEqual([
      `g1 as the new harness against ${short(starter)}: step (5 won, 1 lost, 2 tied)`,
    ]);
    expect(second?.promoted).toHaveLength(1);
    expect(second?.parts?.guide).toBe(guideLines);
    expect(second?.parts?.toolTree?.files).toBe(1);
    expect(third?.digest).toBe(misnamed);
    expect(third?.opens).toBe(`as ${short(child)}, not as kept`);
    expect(third?.made).toStartWith("no record of its making");
  });

  it("counts what moved from a parent to its child, part by part, and quotes no line", async () => {
    const moves = await diffOf(join(states, starter), join(states, child));
    expect(moves).toStrictEqual([
      `guide: 0 to ${guideLines} nonblank lines, +${guideLines} -0`,
      "spec: presets read, bash, edit, write to read, bash, edit, write; tools added none, removed none",
      expect.stringMatching(/^tools\.ts: (\d+) to \1 nonblank lines, \+0 -0$/),
      ".toolchain: 0 to 1 files, +1 -0 changed 0, under bin",
      "other files: added none; removed none; changed none",
    ]);
    expect(moves.join("\n")).not.toContain(EXAMPLE.guide.split("\n")[0] ?? "");
  });
});

describe("the command", () => {
  it("reads latest against the parent the log records", () => {
    const diffed = run("--diff", "latest");
    expect(diffed.code).toBe(0);
    expect(diffed.stdout).toStartWith(`${child} against ${starter}\n`);
    const listed = parseJsonAs<{ versions: unknown[] }>(run("--json").stdout);
    expect(listed.versions).toHaveLength(3);
  });

  it("refuses a control, a harness with no parent on record, and a state that opens as another", () => {
    expect(run("--diff", "programs-of:latest").stderr).toContain("takes no control");
    expect(run("--diff", "starter").stderr).toContain("has no parent on record");
    const misread = run("--diff", misnamed, "--against", "starter");
    expect(misread.code).toBe(1);
    expect(misread.stderr).toContain("no longer opens as the harness it is kept as");
  });
});
