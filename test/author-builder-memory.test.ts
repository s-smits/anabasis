/**
 * The two Markdown files the Builder writes in its workspace, and what a later epoch inherits from
 * them. They sit outside the accepted bundle and carry no correctness authority, so nothing here is
 * about whether the notes are right; it is about whether they arrive, bounded and attributed,
 * without disturbing a prompt that has to stay byte-identical.
 *
 * That last part is why the empty case is the load-bearing one. An untouched starter must render
 * nothing at all — not an empty block, not a bare heading — because a prompt digest is a recorded
 * condition identity, which means a stray newline out of this module does not make the prompt
 * slightly different, it makes every run after it a different measured condition from every run
 * before it.
 *
 * The rest is inheritance and its ceiling, and the ceiling is where the interesting failures live.
 * `src/author/builder-memory.ts` caps MEMORY.md at 8,000 bytes and SCRATCHPAD.md at 2,000, applying
 * each on the inherited write and again on the prompt read, so four separate paths can meet a
 * ceiling: the inherited block, a file the Builder hand-wrote, a carried
 * file, and a carried file the Builder then edited back over it. The fourth is the one that really
 * needs its own case, because truncating it must not take the carry marker with it — a carried file
 * that loses its marker reads as the successor's own work, and the next Builder then treats a
 * predecessor's conclusions as notes it wrote itself. For the same reason a file carried across
 * several epochs names only its immediate predecessor, so the header cannot grow into a chain.
 *
 * Around that sit the ordinary rules: scratch is carried selectively, small top-level helpers but
 * not output directories, an epoch that already has memory of its own is never overwritten by an
 * inherited one, and a missing predecessor leaves the successor with no inherited notes rather than
 * failing the campaign, since a first epoch has no predecessor by definition.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { describe, expect, it } from "bun:test";
import {
  MEMORY_CAP_BYTES,
  MEMORY_FILE,
  SCRATCHPAD_FILE,
  WORKSPACE_DIR,
  builderMemoryBlock,
  withoutRepeatedSections,
  carryMemoryForward,
} from "../src/author/builder-memory.ts";
import { initWorkspace } from "../src/author/domain-repo.ts";

/** A real seeded workspace: the starter bytes come from the one owner that writes them. */
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "ana-builder-memory-"));
  initWorkspace(dir);
  return dir;
}

const read = (dir: string, file: string): string => readFileSync(join(dir, file), "utf8");

/** The successor epoch every case carries memory into, under whichever root it was given. */
function successor(root: string) {
  return { key: "epoch-bbbb", dir: join(root, "epoch-bbbb"), supersedes: "epoch-aaaa" };
}

describe("Builder memory", () => {
  it("renders nothing until a pass has written something", () => {
    const dir = workspace();
    expect(builderMemoryBlock(dir)).toBe("");
    expect(builderMemoryBlock(join(dir, "absent"))).toBe("");
    writeFileSync(join(dir, MEMORY_FILE), "# Builder memory\n\n## Engine and verifier\n\nOpenSees 3.5\n");
    const block = builderMemoryBlock(dir);
    expect(block).toContain("Historical notes, model-authored and possibly stale");
    expect(block).toContain(`--- ${MEMORY_FILE} ---`);
    expect(block).toContain("OpenSees 3.5");
    // The scratchpad is still the untouched starter, so it stays out of the block entirely.
    expect(block).not.toContain(`--- ${SCRATCHPAD_FILE} ---`);
  });

  it("heads the block with its origin, its authorship and what overrides it", () => {
    // The block is the stalest text in a prompt and used to sit in its most authoritative
    // position. It now leads, so the header must carry the three facts the position carried.
    const dir = workspace();
    writeFileSync(join(dir, MEMORY_FILE), "# Builder memory\n\nthe engine is pinned\n");
    const block = builderMemoryBlock(dir);
    expect(block.startsWith("Historical notes, model-authored and possibly stale.")).toBe(true);
    // Origin: the workspace the notes were written in, and the epoch marker a carried file keeps.
    expect(block).toContain(dir);
    expect(block).toContain('"carried forward from <epoch>"');
    expect(block).toContain("before the current binding");
    expect(block).toContain("Everything below this\nblock is current and overrides it");
    // The header precedes the bodies it describes.
    expect(block.indexOf("Historical notes")).toBeLessThan(block.indexOf(`--- ${MEMORY_FILE} ---`));
  });

  it("bounds a hand-written memory file when it is read back into a prompt", () => {
    // Carry-forward caps inherited notes. The Builder also edits MEMORY.md itself with
    // its file tools, so the bytes on disk can still be any size; the read-back must not carry a
    // transcript into the next pass's kickoff, and must keep the end the Builder last wrote.
    const dir = workspace();
    const line = "a lesson the Builder wrote by hand\n";
    const newest = "the last thing the Builder wrote by hand";
    writeFileSync(
      join(dir, MEMORY_FILE),
      `${line.repeat(Math.ceil((MEMORY_CAP_BYTES * 3) / line.length))}${newest}\n`,
    );
    const block = builderMemoryBlock(dir);
    // The slack covers the cut marker plus the stale-notes header and its workspace path.
    expect(new TextEncoder().encode(block).byteLength).toBeLessThanOrEqual(MEMORY_CAP_BYTES + 600);
    expect(block).toContain(`memory cut to ${MEMORY_CAP_BYTES} bytes`);
    expect(block).toContain(newest);
    expect(block).toContain(line.trim());
  });

  it("opens a successor epoch on its predecessor's memory, marked as predating the new binding", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-epochs-"));
    const prior = join(root, "epoch-aaaa", WORKSPACE_DIR);
    initWorkspace(prior);
    writeFileSync(join(prior, MEMORY_FILE), "# Builder memory\n\nunits are kN\n");
    writeFileSync(join(prior, SCRATCHPAD_FILE), "# Scratchpad\n\n- open: L3\n");
    const epoch = successor(root);
    carryMemoryForward(root, epoch);
    const carried = read(join(root, "epoch-bbbb", WORKSPACE_DIR), MEMORY_FILE);
    expect(carried).toContain("units are kN");
    expect(carried).toContain("carried forward from epoch-aaaa");
    // The scratchpad is one binding's open-question list and is dropped, not migrated.
    expect(existsSync(join(root, "epoch-bbbb", WORKSPACE_DIR, SCRATCHPAD_FILE))).toBe(false);
    // Initialisation finds the inherited file already present, so it enters the successor's root commit.
    initWorkspace(join(root, "epoch-bbbb", WORKSPACE_DIR));
    expect(read(join(root, "epoch-bbbb", WORKSPACE_DIR), MEMORY_FILE)).toContain("units are kN");
  });

  it("carries small top-level scratch helpers and leaves output directories and large files behind", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-epochs-scratch-"));
    const prior = join(root, "epoch-aaaa", WORKSPACE_DIR);
    initWorkspace(prior);
    writeFileSync(join(prior, MEMORY_FILE), "# Builder memory\n\nunits are kN\n");
    mkdirSync(join(prior, "scratch", "run"), { recursive: true });
    writeFileSync(join(prior, "scratch", "gen.ts"), "export const gen = 1;\n");
    writeFileSync(join(prior, "scratch", "run", "out.json"), "{}");
    writeFileSync(join(prior, "scratch", "trace.bin"), new Uint8Array(512 * 1024));
    carryMemoryForward(root, successor(root));
    const next = join(root, "epoch-bbbb", WORKSPACE_DIR);
    expect(read(join(next, "scratch"), "gen.ts")).toBe("export const gen = 1;\n");
    expect(existsSync(join(next, "scratch", "run"))).toBe(false);
    expect(existsSync(join(next, "scratch", "trace.bin"))).toBe(false);
    expect(read(next, MEMORY_FILE)).toContain(
      "scratch/ holds epoch-aaaa's helper files, written for its binding: gen.ts.",
    );
    // A second carry names only its own predecessor's helpers, one line.
    carryMemoryForward(root, { key: "epoch-cccc", dir: join(root, "epoch-cccc"), supersedes: "epoch-bbbb" });
    const third = read(join(root, "epoch-cccc", WORKSPACE_DIR), MEMORY_FILE);
    expect(third.split("scratch/ holds").length - 1).toBe(1);
    expect(third).toContain("scratch/ holds epoch-bbbb's helper files");
  });

  it("names only the immediate predecessor when a carried file is carried again", () => {
    // Without this, a fourth epoch opens on three stacked markers.
    const root = mkdtempSync(join(tmpdir(), "ana-epochs-chain-"));
    const first = join(root, "epoch-aaaa", WORKSPACE_DIR);
    initWorkspace(first);
    writeFileSync(join(first, MEMORY_FILE), "# Builder memory\n\nunits are kN\n");
    carryMemoryForward(root, successor(root));
    carryMemoryForward(root, { key: "epoch-cccc", dir: join(root, "epoch-cccc"), supersedes: "epoch-bbbb" });
    const carried = read(join(root, "epoch-cccc", WORKSPACE_DIR), MEMORY_FILE);
    expect(carried.split("carried forward from").length - 1).toBe(1);
    expect(carried).toContain("carried forward from epoch-bbbb");
    expect(carried).toContain("units are kN");
  });

  it("caps a carried file and keeps the carry marker inside the ceiling", () => {
    // An over-ceiling MEMORY.md carried three epochs deep gains a marker each time. The carry
    // marker must survive the cut, and the file must arrive under the ceiling.
    const root = mkdtempSync(join(tmpdir(), "ana-epochs-cap-"));
    const prior = join(root, "epoch-aaaa", WORKSPACE_DIR);
    initWorkspace(prior);
    const newest = "units are kN and the verifier rejects bare floats";
    writeFileSync(
      join(prior, MEMORY_FILE),
      `${"an early lesson\n".repeat(Math.ceil((MEMORY_CAP_BYTES * 2) / 16))}${newest}\n`,
    );
    const epoch = successor(root);
    carryMemoryForward(root, epoch);
    const carried = read(join(root, "epoch-bbbb", WORKSPACE_DIR), MEMORY_FILE);
    expect(new TextEncoder().encode(carried).byteLength).toBeLessThanOrEqual(MEMORY_CAP_BYTES);
    expect(carried).toContain("carried forward from epoch-aaaa");
    expect(carried).toContain(newest);
    expect(carried.split("memory cut to").length - 1).toBe(1);
    // The read path passes a capped carried file through whole: no second cut on the way in.
    expect(builderMemoryBlock(join(root, "epoch-bbbb", WORKSPACE_DIR))).toContain(newest);
  });

  it("keeps the carry marker when the Builder edits a carried file back over the ceiling", () => {
    // The successor arrives under the ceiling, then the Builder appends to it with its own file
    // tools. A newest-first cut takes the head, which is exactly where the marker sits: without
    // pinning it, the read-back would hand the author a predecessor's notes with nothing saying
    // the binding changed.
    const root = mkdtempSync(join(tmpdir(), "ana-epochs-carry-cut-"));
    const prior = join(root, "epoch-aaaa", WORKSPACE_DIR);
    initWorkspace(prior);
    writeFileSync(join(prior, MEMORY_FILE), "units are kN\n");
    const epoch = successor(root);
    carryMemoryForward(root, epoch);
    const next = join(root, "epoch-bbbb", WORKSPACE_DIR);
    const newest = "the newest hand-written lesson";
    appendFileSync(
      join(next, MEMORY_FILE),
      `${"a lesson the Builder wrote by hand\n".repeat(400)}${newest}\n`,
    );

    const block = builderMemoryBlock(next);

    expect(block).toContain("carried forward from epoch-aaaa");
    expect(block).toContain(newest);
    expect(block).toContain("memory cut to");
    // The marker is inside the ceiling, not extra room granted on top of it.
    const stored = read(next, MEMORY_FILE);
    expect(new TextEncoder().encode(stored).byteLength).toBeGreaterThan(MEMORY_CAP_BYTES);
  });

  it("never overwrites an epoch that has its own memory, and never fails on a missing predecessor", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-epochs-resume-"));
    const dir = join(root, "epoch-bbbb");
    const next = join(dir, WORKSPACE_DIR);
    initWorkspace(join(root, "epoch-aaaa", WORKSPACE_DIR));
    writeFileSync(
      join(root, "epoch-aaaa", WORKSPACE_DIR, MEMORY_FILE),
      "# Builder memory\n\nthe predecessor's text",
    );
    initWorkspace(next);
    writeFileSync(join(next, MEMORY_FILE), "# Builder memory\n\nthis epoch's own text");
    // Resume re-runs the carry every invocation; the successor's own memory outranks its parent's.
    carryMemoryForward(root, { key: "epoch-bbbb", dir, supersedes: "epoch-aaaa" });
    expect(read(next, MEMORY_FILE)).toContain("this epoch's own text");
    expect(read(next, MEMORY_FILE)).not.toContain("carried forward");
    // A first epoch and an absent predecessor are both silent no-ops.
    for (const supersedes of [null, "epoch-gone"]) {
      expect(() =>
        carryMemoryForward(root, { key: "epoch-cccc", dir: join(root, "c"), supersedes }),
      ).not.toThrow();
    }
    expect(existsSync(join(root, "c", WORKSPACE_DIR, MEMORY_FILE))).toBe(false);
  });
});

describe("repeated memory sections", () => {
  it("keeps one copy of an exact repeated section and drops an empty heading", () => {
    const text =
      "# Notes\n\n## Status\nsubmitted once\n\n## Status\nsubmitted once\n\n## Open\n\n## Status\nsubmitted twice\n";
    expect(withoutRepeatedSections(text)).toBe(
      "# Notes\n\n## Status\nsubmitted once\n\n## Status\nsubmitted twice\n",
    );
    // A section that differs by one word is not a repeat.
    expect(withoutRepeatedSections("## A\nx\n## A\ny\n")).toBe("## A\nx\n## A\ny\n");
  });
});
