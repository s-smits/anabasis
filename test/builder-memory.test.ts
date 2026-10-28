// Notes cross sessions bounded and attributed; linked notes and scratch files never cross.
// Untouched starters render no opening block, and a carry keeps its marker inside the byte cap.
import { describe, expect, it } from "bun:test";
import {
  builderMemoryBlock,
  keepMemory,
  lastKept,
  MEMORY_CAP_BYTES,
  MEMORY_FILE,
  SCRATCH_LIMITS,
  SCRATCHPAD_FILE,
  STARTER_MEMORY,
  seedMemory,
} from "../src/builder/memory.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

/** A session as a handover sees one: its id, and the home it works in. */
interface Session {
  readonly key: string;
  readonly home: string;
}

/** The sessions of successive rounds, by the ids a campaign's log gives them. */
const FIRST = "b-1";
const PASS_ONE = "b-2";
const PASS_TWO = "b-3";
/** The scratch carry's two limits, as the tests below cross them. */
const PER_FILE = 256 * 1024;
const IN_ALL = 4096 * 1024;
const BYTES = (text: string) => new TextEncoder().encode(text).byteLength;
const count = (text: string, part: string) => text.split(part).length - 1;

const read = (session: Session, file: string) => readFileSync(join(session.home, file), "utf8");

/** A campaign whose first session's home is seeded and holds the given notes. Each successor is
 *  handed over to as a session is: the last home's notes are kept under the campaign's root, and
 *  a new home is seeded from the last session that kept any. */
function campaign(memory: string, scratchpad?: string) {
  const root = mkdtempSync(join(tmpdir(), "ana-kept-memory-"));
  const first: Session = { key: FIRST, home: mkdtempSync(join(tmpdir(), "ana-builder-memory-")) };
  seedMemory(first.home, join(first.home, "kept-nowhere"), null);
  writeFileSync(join(first.home, MEMORY_FILE), memory);
  if (scratchpad !== undefined) writeFileSync(join(first.home, SCRATCHPAD_FILE), scratchpad);
  const sessions = [first];
  /** The next round's session: the one before it ends, and this one opens in a new home. */
  const nextPass = (key: string): Session => {
    const last = sessions.at(-1) ?? first;
    keepMemory(last.home, root, last.key);
    const home = mkdtempSync(join(tmpdir(), "ana-builder-memory-"));
    seedMemory(
      home,
      root,
      lastKept(
        root,
        sessions.map((session) => session.key),
      ),
    );
    const next = { key, home };
    sessions.push(next);
    return next;
  };
  return { root, first, nextPass };
}

describe("the handover between sessions", () => {
  it("carries both notes to the next session, marked as an earlier session's", () => {
    const { first, nextPass } = campaign(
      "# Builder memory\n\nunits are kN\n",
      "# Scratchpad\n\n- open: L3 span family\n",
    );
    const next = nextPass(PASS_ONE);
    expect(read(next, MEMORY_FILE)).toContain("units are kN");
    expect(read(next, SCRATCHPAD_FILE)).toContain("open: L3 span family");
    for (const file of [MEMORY_FILE, SCRATCHPAD_FILE]) {
      expect(read(next, file).split("\n")[0]).toContain(`carried forward from ${first.key}`);
    }
    // The next session's opening read delivers the carried scratchpad too.
    expect(builderMemoryBlock(next.home)).toContain("open: L3 span family");
  });

  it("carries small top-level scratch helpers and leaves a file over the per-file limit", () => {
    const { first, nextPass } = campaign("# Builder memory\n\nunits are kN\n");
    const prior = first.home;
    mkdirSync(join(prior, "scratch"), { recursive: true });
    writeFileSync(join(prior, "scratch", "gen.ts"), "export const gen = 1;\n");
    writeFileSync(join(prior, "scratch", "trace.bin"), new Uint8Array(PER_FILE + 1));
    const next = nextPass(PASS_ONE);
    expect(readFileSync(join(next.home, "scratch", "gen.ts"), "utf8")).toBe("export const gen = 1;\n");
    expect(existsSync(join(next.home, "scratch", "trace.bin"))).toBe(false);
    expect(read(next, MEMORY_FILE)).toContain(`scratch/ holds ${first.key}'s 1 helper file: gen.ts;`);
    expect(read(next, MEMORY_FILE)).toContain(SCRATCH_LIMITS);
    expect(read(next, MEMORY_FILE)).toContain("trace.bin");
    // A second carry names only its own predecessor's helpers, in one line.
    const third = read(nextPass(PASS_TWO), MEMORY_FILE);
    expect(count(third, "scratch/ holds")).toBe(1);
    expect(third).toContain(`scratch/ holds ${next.key}'s 1 helper file: gen.ts. -->`);
  });

  it("leaves a tree over the ceiling behind whole and names it, keeping the small ones", () => {
    const { first, nextPass } = campaign("# Builder memory\n\nunits are kN\n");
    const prior = join(first.home, "scratch");
    mkdirSync(join(prior, "dump"), { recursive: true });
    mkdirSync(join(prior, "lib"), { recursive: true });
    // Each file is under the per-file limit; together they pass the ceiling by one file.
    for (let i = 0; i <= IN_ALL / PER_FILE; i++) {
      writeFileSync(join(prior, "dump", `part-${String(i).padStart(2, "0")}.bin`), new Uint8Array(PER_FILE));
    }
    writeFileSync(join(prior, "lib", "util.py"), "print(3)\n");
    writeFileSync(join(prior, "gen.ts"), "export const gen = 1;\n");
    const next = nextPass(PASS_ONE);
    const carried = join(next.home, "scratch");
    expect(existsSync(join(carried, "dump"))).toBe(false);
    expect(existsSync(join(carried, "lib", "util.py"))).toBe(true);
    expect(existsSync(join(carried, "gen.ts"))).toBe(true);
    const note = read(next, MEMORY_FILE);
    for (const fact of [first.key, "2 helper files", "gen.ts", "lib/util.py", SCRATCH_LIMITS, "dump/"]) {
      expect(note).toContain(fact);
    }
  });

  it("never follows a link out of scratch, whether the link is inside it or is scratch itself", () => {
    const outside = mkdtempSync(join(tmpdir(), "ana-outside-"));
    mkdirSync(join(outside, "tree"));
    writeFileSync(join(outside, "tree", "secret.txt"), "not scratch\n");
    const { first, nextPass } = campaign("# Builder memory\n\nunits are kN\n");
    const prior = join(first.home, "scratch");
    mkdirSync(join(prior, "build"), { recursive: true });
    writeFileSync(join(prior, "build", "gen.py"), "print(1)\n");
    symlinkSync(join(outside, "tree"), join(prior, "linked-tree"));
    symlinkSync(join(outside, "tree", "secret.txt"), join(prior, "linked-file.txt"));
    symlinkSync(join(outside, "tree"), join(prior, "build", "inner-link"));
    const next = nextPass(PASS_ONE);
    const carried = join(next.home, "scratch");
    expect(readdirSync(carried)).toEqual(["build"]);
    expect(readdirSync(join(carried, "build"))).toEqual(["gen.py"]);

    const linked = campaign("# Builder memory\n\nunits are kN\n");
    symlinkSync(outside, join(linked.first.home, "scratch"));
    expect(existsSync(join(linked.nextPass(PASS_ONE).home, "scratch"))).toBe(false);
  });

  it.each([
    [MEMORY_FILE, MEMORY_CAP_BYTES],
    [SCRATCHPAD_FILE, 2_000],
  ] as const)("caps carried %s and keeps its marker and newest lesson", (file, cap) => {
    const newest = "units are kN and the verifier rejects bare floats";
    const run = campaign("# Builder memory\n\nunits are kN\n");
    writeFileSync(join(run.first.home, file), `${"an early lesson\n".repeat(cap / 8)}${newest}\n`);
    const { first, nextPass } = run;
    const next = nextPass(PASS_ONE);
    const carried = read(next, file);
    expect(BYTES(carried)).toBeLessThanOrEqual(cap);
    expect(carried).toContain(`carried forward from ${first.key}`);
    expect(carried).toContain(newest);
    expect(count(carried, "memory cut to")).toBe(1);
    // The read path passes a capped carried file through whole.
    expect(builderMemoryBlock(next.home)).toContain(newest);
  });

  it("never overwrites notes a successor already has, and never fails on a missing predecessor", () => {
    const { root, first } = campaign(
      "# Builder memory\n\nthe predecessor's text\n",
      "# Scratchpad\n\n- theirs\n",
    );
    const own = join(root, "own");
    mkdirSync(own);
    writeFileSync(join(own, MEMORY_FILE), "# Builder memory\n\nthis session's own text\n");
    writeFileSync(join(own, SCRATCHPAD_FILE), "# Scratchpad\n\n- mine\n");
    // A carry made again writes into no slot that is written: the successor's notes outrank its parent's.
    keepMemory(first.home, root, "own");
    expect(readFileSync(join(own, MEMORY_FILE), "utf8")).not.toContain("carried forward");
    expect(readFileSync(join(own, SCRATCHPAD_FILE), "utf8")).toContain("mine");
    // A predecessor that is gone leaves the successor without notes, and without a throw.
    rmSync(first.home, { recursive: true, force: true });
    const orphan = join(root, "orphan");
    expect(() => keepMemory(first.home, root, "orphan")).not.toThrow();
    expect(existsSync(orphan)).toBe(false);
  });
});

describe("what v2's wall and its sessions add to the handover", () => {
  it("reads no notes through a link, which would carry a file the Builder's wall denies", () => {
    const outside = mkdtempSync(join(tmpdir(), "ana-outside-"));
    writeFileSync(join(outside, "hidden.json"), "# Hidden\n\nhidden-values-7f3a\n");
    const { root, first, nextPass } = campaign("# Builder memory\n\nunits are kN\n");
    rmSync(join(first.home, MEMORY_FILE));
    symlinkSync(join(outside, "hidden.json"), join(first.home, MEMORY_FILE));
    expect(builderMemoryBlock(first.home)).toBe("");
    const next = nextPass(PASS_ONE);
    // Nothing was kept of the session, and its successor opens on the starter.
    expect(existsSync(join(root, first.key))).toBe(false);
    expect(read(next, MEMORY_FILE)).toBe(STARTER_MEMORY);
    expect(builderMemoryBlock(next.home)).toBe("");
  });

  it("keeps nothing of a session that left its starters untouched, and hands on the last notes kept", () => {
    const { root, first, nextPass } = campaign("# Builder memory\n\nunits are kN\n");
    const second = nextPass(PASS_ONE);
    expect(readdirSync(root)).toEqual([first.key]);
    // The second session leaves the notes it was handed as they are: they are kept on under its
    // own id, so the last folder holds all that crossed.
    const third = nextPass(PASS_TWO);
    expect(readdirSync(root).sort()).toEqual([first.key, second.key]);
    expect(read(third, MEMORY_FILE)).toContain(`carried forward from ${second.key},`);
    expect(read(third, MEMORY_FILE)).toContain("units are kN");
    // A session whose notes are the starters keeps no folder, and is passed over by the next.
    const blank = campaign(STARTER_MEMORY);
    blank.nextPass(PASS_ONE);
    expect(readdirSync(blank.root)).toEqual([]);
    expect(lastKept(blank.root, [FIRST, PASS_ONE])).toBeNull();
    expect(lastKept(root, [FIRST, PASS_ONE, PASS_TWO, "b-4"])).toBe(second.key);
  });
});
