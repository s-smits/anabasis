/**
 * What one Builder session leaves the next. The Builder writes two Markdown files in its home,
 * MEMORY.md for what the next session would otherwise learn again and SCRATCHPAD.md for the open
 * questions and next steps, and neither carries correctness authority. What matters is whether they
 * arrive, bounded and attributed.
 *
 * Copied from v1 with the module it tests (`test/author-builder-memory.test.ts`, s-smits/anabasis
 * at 3f93d06). v1 handed over between epochs under one campaign root; a v2 session's home is gone
 * when it ends, so here a handover is `keepMemory` out of the old home and `seedMemory` into the
 * new one, and the cases are v1's. Two of v1's are not taken, with what they tested: the carry
 * across a changed request, and the controller's line at the head of MEMORY.md. Three are v2's
 * own, at the end: a link in a notes file's place, a session that leaves nothing, and the starters.
 *
 * The empty case is load-bearing. An untouched starter renders nothing at all, so a first session
 * receives the opening message a session without memory would. The ceilings are the other place
 * failures live: each file is capped on the carry and again on the read, and neither cut may take
 * the carry marker with it, since a carried file that loses its marker reads as the successor's
 * own work.
 */
import { describe, expect, it } from "bun:test";
import {
  builderMemoryBlock,
  keepMemory,
  lastKept,
  MEMORY_CAP_BYTES,
  MEMORY_FILE,
  memoryOverCapNotice,
  SCRATCH_LIMITS,
  SCRATCHPAD_FILE,
  STARTER_MEMORY,
  seedMemory,
} from "../src/builder/memory.ts";
import {
  appendFileSync,
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

/** A home seeded as a first session's is: the starter bytes come from the one owner that writes them. */
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "ana-builder-memory-"));
  seedMemory(dir, join(dir, "kept-nowhere"), null);
  return dir;
}

const workspaceOf = (session: Session) => session.home;
const read = (session: Session, file: string) => readFileSync(join(session.home, file), "utf8");

/** A campaign whose first session's home is seeded and holds the given notes. Each successor is
 *  handed over to as a session is: the last home's notes are kept under the campaign's root, and
 *  a new home is seeded from the last session that kept any. */
function campaign(memory: string, scratchpad?: string) {
  const root = mkdtempSync(join(tmpdir(), "ana-kept-memory-"));
  const first: Session = { key: FIRST, home: workspace() };
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

/** A campaign whose first session has authored memory for a carry to cross, and the `scratch/` path
 *  that session's Builder would fill. */
function scratchCampaign() {
  const run = campaign("# Builder memory\n\nunits are kN\n");
  return { ...run, prior: join(workspaceOf(run.first), "scratch") };
}

describe("the notes block a fresh session opens on", () => {
  // The header comes first and says whose the notes are and that what follows overrides them.
  it("renders nothing until a pass has written something, then heads the notes with their origin", () => {
    const dir = workspace();
    expect(builderMemoryBlock(dir)).toBe("");
    expect(builderMemoryBlock(join(dir, "absent"))).toBe("");
    writeFileSync(join(dir, MEMORY_FILE), "# Builder memory\n\n## Programs and tools\n\nOpenSees 3.5\n");
    const block = builderMemoryBlock(dir);
    expect(block).toContain(`--- ${MEMORY_FILE} ---`);
    expect(block).toContain("OpenSees 3.5");
    // The scratchpad is still the untouched starter, so it stays out of the block entirely.
    expect(block).not.toContain(`--- ${SCRATCHPAD_FILE} ---`);
    const header = block.slice(0, block.indexOf(`--- ${MEMORY_FILE} ---`));
    expect(header).toContain("Historical notes, model-authored and possibly stale.");
    expect(header).toContain("Everything below this block\nis current and overrides it.");
  });

  it("bounds a hand-written file on the read and keeps the end the Builder wrote last", () => {
    const dir = workspace();
    const line = "a lesson the Builder wrote by hand\n";
    const newest = "the last thing the Builder wrote by hand";
    writeFileSync(
      join(dir, MEMORY_FILE),
      `${line.repeat(Math.ceil((MEMORY_CAP_BYTES * 3) / line.length))}${newest}\n`,
    );
    const block = builderMemoryBlock(dir);
    // The slack covers the cut marker plus the header.
    expect(BYTES(block)).toBeLessThanOrEqual(MEMORY_CAP_BYTES + 600);
    expect(block).toContain(`memory cut to ${MEMORY_CAP_BYTES} bytes`);
    expect(block).toContain(newest);
  });

  it("keeps the newest note of a newest-first file over the cap, and the section that closes it", () => {
    const dir = workspace();
    const newest = "## 2026-09-27 newest\nthe verifier wants kN, not N";
    const older = Array.from({ length: 400 }, (_, i) => `## older entry ${String(i)}\nsome lesson\n`).join(
      "",
    );
    writeFileSync(join(dir, MEMORY_FILE), `# Builder memory\n\n${newest}\n${older}## Risk\nfloat rounding\n`);
    const block = builderMemoryBlock(dir);
    expect(block).toContain(newest);
    expect(block).toContain("## Risk\nfloat rounding");
    expect(block).not.toContain("older entry 200\n");
    expect(block).toMatch(/memory cut to 8000 bytes: \d+ bytes dropped here/);
    expect(memoryOverCapNotice(dir)).toContain(`${MEMORY_FILE} is `);
    writeFileSync(join(dir, MEMORY_FILE), "# Builder memory\n\nshort\n");
    expect(memoryOverCapNotice(dir)).toBeNull();
  });

  it("keeps one copy of an exact repeated section and drops a heading with nothing under it", () => {
    const dir = workspace();
    writeFileSync(
      join(dir, MEMORY_FILE),
      "# Notes\n\n## Status\nsubmitted once\n\n## Status\nsubmitted once\n\n## Open\n\n## Status\nsubmitted twice\n",
    );
    const block = builderMemoryBlock(dir);
    expect(count(block, "submitted once")).toBe(1);
    // A section that differs by one word is not a repeat.
    expect(block).toContain("submitted twice");
    expect(block).not.toContain("## Open");
  });
});

describe("the handover between sessions", () => {
  // Run custom-sol-20260929T132256243Z-2d7812: round 1 wrote its whole next-experiment plan as one
  // paragraph a few dozen bytes over the scratchpad's limit, and a cut back to whole lines carried
  // only the heading, since neither end of a single line has a line break inside its budget.
  it("keeps both ends of a one-paragraph scratchpad over its limit, cut at words", () => {
    const plan = `Latest clear preview snapshot precedes submission. ${"If the battery passes, add a genuinely different integration. ".repeat(32)}The bench runs a host mock, not target machine code.`;
    const { nextPass } = campaign("# Builder memory\n\nunits are kN\n", `# Next experiment\n\n${plan}\n`);
    const carried = read(nextPass(PASS_ONE), SCRATCHPAD_FILE);
    expect(BYTES(carried)).toBeLessThanOrEqual(2_000);
    expect(carried).toContain("# Next experiment\n\nLatest clear preview snapshot precedes submission. If");
    expect(carried).toMatch(/\S <!-- memory cut to 2000 bytes: \d+ bytes dropped here -->\n\S/);
    expect(carried).toContain("The bench runs a host mock, not target machine code.");
  });

  it("carries both notes to the next session, marked as an earlier session's", () => {
    const { first, nextPass } = campaign(
      "# Builder memory\n\nunits are kN\n",
      "# Scratchpad\n\n- open: L3 span family\n",
    );
    const next = nextPass(PASS_ONE);
    expect(read(next, MEMORY_FILE)).toContain("units are kN");
    expect(read(next, SCRATCHPAD_FILE)).toContain("open: L3 span family");
    for (const file of [MEMORY_FILE, SCRATCHPAD_FILE]) {
      expect(read(next, file)).toStartWith(
        `<!-- carried forward from ${first.key}, an earlier session of this campaign. Correct what no longer holds. -->\n`,
      );
    }
    // The next session's opening read delivers the carried scratchpad too.
    expect(builderMemoryBlock(workspaceOf(next))).toContain("open: L3 span family");
  });

  it("caps a carried scratchpad to its own ceiling and keeps the marker and newest line", () => {
    const newest = "- open: does the verifier accept bare floats";
    const { nextPass } = campaign(
      "# Builder memory\n\nunits are kN\n",
      `${"- an old question\n".repeat(400)}${newest}\n`,
    );
    const carried = read(nextPass(PASS_ONE), SCRATCHPAD_FILE);
    expect(BYTES(carried)).toBeLessThanOrEqual(2_000);
    expect(carried).toContain("carried forward from");
    expect(carried).toContain(newest);
  });

  it("carries small top-level scratch helpers and leaves a file over the per-file limit", () => {
    const { first, nextPass } = campaign("# Builder memory\n\nunits are kN\n");
    const prior = workspaceOf(first);
    mkdirSync(join(prior, "scratch"), { recursive: true });
    writeFileSync(join(prior, "scratch", "gen.ts"), "export const gen = 1;\n");
    writeFileSync(join(prior, "scratch", "trace.bin"), new Uint8Array(PER_FILE + 1));
    const next = nextPass(PASS_ONE);
    expect(readFileSync(join(workspaceOf(next), "scratch", "gen.ts"), "utf8")).toBe(
      "export const gen = 1;\n",
    );
    expect(existsSync(join(workspaceOf(next), "scratch", "trace.bin"))).toBe(false);
    expect(read(next, MEMORY_FILE)).toContain(`scratch/ holds ${first.key}'s 1 helper file: gen.ts;`);
    expect(read(next, MEMORY_FILE)).toContain("left behind, over the limit of");
    expect(read(next, MEMORY_FILE)).toContain(": trace.bin. -->");
    // A second carry names only its own predecessor's helpers, in one line.
    const third = read(nextPass(PASS_TWO), MEMORY_FILE);
    expect(count(third, "scratch/ holds")).toBe(1);
    expect(third).toContain(`scratch/ holds ${next.key}'s 1 helper file: gen.ts. -->`);
  });

  it("carries a nested helper beside its siblings, by path, and names a nested file that is too large", () => {
    const { first, nextPass, prior } = scratchCampaign();
    mkdirSync(join(prior, "build", "deep"), { recursive: true });
    writeFileSync(join(prior, "build", "gen.py"), "print(1)\n");
    writeFileSync(join(prior, "build", "deep", "more.py"), "print(2)\n");
    writeFileSync(join(prior, "build", "big.json"), new Uint8Array(PER_FILE + 1));
    const next = nextPass(PASS_ONE);
    const carried = join(workspaceOf(next), "scratch", "build");
    expect(readFileSync(join(carried, "gen.py"), "utf8")).toBe("print(1)\n");
    expect(readFileSync(join(carried, "deep", "more.py"), "utf8")).toBe("print(2)\n");
    expect(existsSync(join(carried, "big.json"))).toBe(false);
    expect(read(next, MEMORY_FILE)).toContain(
      `scratch/ holds ${first.key}'s 2 helper files: build/deep/more.py, build/gen.py; left behind`,
    );
    expect(read(next, MEMORY_FILE)).toContain(": build/big.json. -->");
  });

  it("leaves a tree over the ceiling behind whole and names it, keeping the small ones", () => {
    const { first, nextPass, prior } = scratchCampaign();
    mkdirSync(join(prior, "dump"), { recursive: true });
    mkdirSync(join(prior, "lib"), { recursive: true });
    // Each file is under the per-file limit; together they pass the ceiling by one file.
    for (let i = 0; i <= IN_ALL / PER_FILE; i++) {
      writeFileSync(join(prior, "dump", `part-${String(i).padStart(2, "0")}.bin`), new Uint8Array(PER_FILE));
    }
    writeFileSync(join(prior, "lib", "util.py"), "print(3)\n");
    writeFileSync(join(prior, "gen.ts"), "export const gen = 1;\n");
    const next = nextPass(PASS_ONE);
    const carried = join(workspaceOf(next), "scratch");
    expect(existsSync(join(carried, "dump"))).toBe(false);
    expect(existsSync(join(carried, "lib", "util.py"))).toBe(true);
    expect(existsSync(join(carried, "gen.ts"))).toBe(true);
    expect(read(next, MEMORY_FILE)).toContain(
      `scratch/ holds ${first.key}'s 2 helper files: gen.ts, lib/util.py; left behind, over the limit of ${SCRATCH_LIMITS}: dump/. -->`,
    );
  });

  it("holds the whole carry to the ceiling, so a later tree that no longer fits stays behind", () => {
    const { nextPass, prior } = scratchCampaign();
    // Each tree fits alone; the second would take the carry past the ceiling.
    for (const tree of ["a-first", "b-second"]) {
      mkdirSync(join(prior, tree), { recursive: true });
      for (let i = 0; i < (IN_ALL / PER_FILE) * 0.6; i++) {
        writeFileSync(join(prior, tree, `part-${String(i)}.bin`), new Uint8Array(PER_FILE));
      }
    }
    const next = nextPass(PASS_ONE);
    expect(existsSync(join(workspaceOf(next), "scratch", "a-first", "part-0.bin"))).toBe(true);
    expect(existsSync(join(workspaceOf(next), "scratch", "b-second"))).toBe(false);
    expect(read(next, MEMORY_FILE)).toContain(": b-second/. -->");
  });

  it("takes the smaller top-level entry first, so a large folder sorting early cannot starve it", () => {
    const { nextPass, prior } = scratchCampaign();
    // Each fits alone, and together they pass the ceiling: whichever is taken first keeps the other out.
    for (const [tree, files] of [
      ["a-cache", IN_ALL / PER_FILE - 1],
      ["z-scripts", 2],
    ] as const) {
      mkdirSync(join(prior, tree), { recursive: true });
      for (let i = 0; i < files; i++) {
        writeFileSync(join(prior, tree, `part-${String(i).padStart(2, "0")}.bin`), new Uint8Array(PER_FILE));
      }
    }
    const next = nextPass(PASS_ONE);
    expect(existsSync(join(workspaceOf(next), "scratch", "z-scripts", "part-01.bin"))).toBe(true);
    expect(existsSync(join(workspaceOf(next), "scratch", "a-cache"))).toBe(false);
    expect(read(next, MEMORY_FILE)).toContain(": a-cache/. -->");
  });

  it("says so when nothing in scratch fits, and carries no empty scratch directory", () => {
    const { first, nextPass, prior } = scratchCampaign();
    mkdirSync(prior, { recursive: true });
    writeFileSync(join(prior, "trace.bin"), new Uint8Array(PER_FILE + 1));
    const next = nextPass(PASS_ONE);
    expect(existsSync(join(workspaceOf(next), "scratch"))).toBe(false);
    expect(read(next, MEMORY_FILE)).toContain(`scratch/ holds none of ${first.key}'s files; left behind`);
    expect(read(next, MEMORY_FILE)).toContain(": trace.bin. -->");
  });

  it("never follows a link out of scratch, whether the link is inside it or is scratch itself", () => {
    const outside = mkdtempSync(join(tmpdir(), "ana-outside-"));
    mkdirSync(join(outside, "tree"));
    writeFileSync(join(outside, "tree", "secret.txt"), "not scratch\n");
    const { nextPass, prior } = scratchCampaign();
    mkdirSync(join(prior, "build"), { recursive: true });
    writeFileSync(join(prior, "build", "gen.py"), "print(1)\n");
    symlinkSync(join(outside, "tree"), join(prior, "linked-tree"));
    symlinkSync(join(outside, "tree", "secret.txt"), join(prior, "linked-file.txt"));
    symlinkSync(join(outside, "tree"), join(prior, "build", "inner-link"));
    const next = nextPass(PASS_ONE);
    const carried = join(workspaceOf(next), "scratch");
    expect(readdirSync(carried)).toEqual(["build"]);
    expect(readdirSync(join(carried, "build"))).toEqual(["gen.py"]);

    const linked = scratchCampaign();
    symlinkSync(outside, linked.prior);
    expect(existsSync(join(workspaceOf(linked.nextPass(PASS_ONE)), "scratch"))).toBe(false);
  });

  it("names at most five helpers and counts the rest", () => {
    const { first, nextPass } = campaign("# Builder memory\n\nunits are kN\n");
    mkdirSync(join(workspaceOf(first), "scratch"), { recursive: true });
    for (let i = 0; i < 120; i++) {
      writeFileSync(join(workspaceOf(first), "scratch", `gen-${String(i).padStart(3, "0")}.ts`), "1\n");
    }
    const line =
      read(nextPass(PASS_ONE), MEMORY_FILE)
        .split("\n")
        .find((row) => row.includes("scratch/ holds")) ?? "";
    expect(line).toContain(
      "120 helper files: gen-000.ts, gen-001.ts, gen-002.ts, gen-003.ts, gen-004.ts and 115 more.",
    );
    expect(line).not.toContain("gen-005.ts");
  });

  it("names only the immediate predecessor when a carried file is carried again", () => {
    const { nextPass } = campaign("# Builder memory\n\nunits are kN\n", "# Scratchpad\n\n- open: L3\n");
    const second = nextPass(PASS_ONE);
    const third = nextPass(PASS_TWO);
    for (const file of [MEMORY_FILE, SCRATCHPAD_FILE]) {
      expect(count(read(third, file), "carried forward from")).toBe(1);
      expect(read(third, file)).toContain(`carried forward from ${second.key}`);
    }
    expect(read(third, MEMORY_FILE)).toContain("units are kN");
  });

  it("caps a carried memory file and keeps the carry marker inside the ceiling", () => {
    const newest = "units are kN and the verifier rejects bare floats";
    const { first, nextPass } = campaign(
      `${"an early lesson\n".repeat(Math.ceil((MEMORY_CAP_BYTES * 2) / 16))}${newest}\n`,
    );
    const next = nextPass(PASS_ONE);
    const carried = read(next, MEMORY_FILE);
    expect(BYTES(carried)).toBeLessThanOrEqual(MEMORY_CAP_BYTES);
    expect(carried).toContain(`carried forward from ${first.key}`);
    expect(carried).toContain(newest);
    expect(count(carried, "memory cut to")).toBe(1);
    // The read path passes a capped carried file through whole.
    expect(builderMemoryBlock(workspaceOf(next))).toContain(newest);
  });

  it("keeps the carry marker when the Builder edits a carried file back over the ceiling", () => {
    // A newest-first cut takes the head, which is where the marker sits.
    const { first, nextPass } = campaign("units are kN\n");
    const next = nextPass(PASS_ONE);
    const newest = "the newest hand-written lesson";
    appendFileSync(
      join(workspaceOf(next), MEMORY_FILE),
      `${"a lesson the Builder wrote by hand\n".repeat(400)}${newest}\n`,
    );
    expect(BYTES(read(next, MEMORY_FILE))).toBeGreaterThan(MEMORY_CAP_BYTES);
    const block = builderMemoryBlock(workspaceOf(next));
    expect(block).toContain(`carried forward from ${first.key}`);
    expect(block).toContain(newest);
    expect(block).toContain("memory cut to");
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

  it("seeds a first home with both starters, and never over a file the home already has", () => {
    const dir = workspace();
    expect(readFileSync(join(dir, MEMORY_FILE), "utf8")).toBe(STARTER_MEMORY);
    expect(readFileSync(join(dir, SCRATCHPAD_FILE), "utf8")).toStartWith("# Scratchpad\n");
    writeFileSync(join(dir, MEMORY_FILE), "mine\n");
    seedMemory(dir, join(dir, "kept-nowhere"), null);
    expect(readFileSync(join(dir, MEMORY_FILE), "utf8")).toBe("mine\n");
  });
});
