// A session's notes are kept in its own campaign's store and open the sessions after it, newest
// first and bounded; another campaign's notes, a link and a session the log did not start never do.
import { describe, expect, it } from "bun:test";
import { CONTEXT_OUTPUT_LIMIT } from "../vendor/claude-mem/ContextBudget.ts";
import { builderMemoryBlock, keepMemory, MEMORY_FILE } from "../src/builder/memory.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const scratch = (name: string) => mkdtempSync(join(tmpdir(), `ana-builder-memory-${name}-`));

/** A campaign's store, and a session of it that writes `notes` to its home and ends. */
function campaign() {
  const root = join(scratch("campaign"), "memory");
  const end = (session: string, notes: string) => {
    const home = scratch("home");
    writeFileSync(join(home, MEMORY_FILE), notes);
    keepMemory(home, root, session);
  };
  return { root, end };
}

describe("the notes a campaign keeps", () => {
  it("opens each session on the notes of the sessions before it, newest first under each id", () => {
    const { root, end } = campaign();
    end("b-1", "units are kN\n");
    end("b-2", "the verifier rejects bare floats\n");
    const block = builderMemoryBlock(root, ["b-1", "b-2"]);
    expect(block).toStartWith("Historical notes, model-authored and possibly stale");
    expect(block.indexOf("--- b-2 ---\nthe verifier rejects bare floats")).toBeGreaterThan(0);
    expect(block.indexOf("--- b-2 ---")).toBeLessThan(block.indexOf("--- b-1 ---\nunits are kN"));
    // A first session opens on no block at all, as it would without memory.
    expect(builderMemoryBlock(root, [])).toBe("");
  });

  it("keeps each campaign's notes to itself, two campaigns side by side under the same session ids", () => {
    const one = campaign();
    const other = campaign();
    one.end("b-1", "one: units are kN\n");
    other.end("b-1", "other: units are lbf\n");
    expect(builderMemoryBlock(one.root, ["b-1"])).toContain("one: units are kN");
    expect(builderMemoryBlock(one.root, ["b-1"])).not.toContain("other:");
    expect(builderMemoryBlock(other.root, ["b-1"])).not.toContain("one:");
    // Within a store, only the sessions the campaign's log started before this one are read: a
    // folder no listed session names, such as one a later or foreign session left, is not.
    one.end("b-9", "not of this opening\n");
    expect(builderMemoryBlock(one.root, ["b-1"])).not.toContain("not of this opening");
  });

  it("drops the oldest whole notes to fit claude-mem's limit, and cuts one note too long alone", () => {
    const { root, end } = campaign();
    const sessions = Array.from({ length: 6 }, (_, i) => `b-${String(i + 1)}`);
    for (const session of sessions) end(session, `${session} begins\n${"a lesson\n".repeat(300)}`);
    const block = builderMemoryBlock(root, sessions);
    expect(block.length).toBeLessThanOrEqual(CONTEXT_OUTPUT_LIMIT);
    expect(block).toContain("b-6 begins");
    expect(block).not.toContain("b-1 begins");
    expect(block).not.toContain("characters cut here");
    // One note longer than the limit is kept and shown by its head and tail, inside the limit.
    end("b-7", `the first line\n${"x".repeat(3 * CONTEXT_OUTPUT_LIMIT)}\nthe newest line\n`);
    const kept = readFileSync(join(root, "b-7", MEMORY_FILE), "utf8");
    expect(kept.length).toBeLessThanOrEqual(CONTEXT_OUTPUT_LIMIT + 1);
    const cut = builderMemoryBlock(root, [...sessions, "b-7"]);
    expect(cut.length).toBeLessThanOrEqual(CONTEXT_OUTPUT_LIMIT);
    for (const part of ["--- b-7 ---\nthe first line", "characters cut here", "the newest line"]) {
      expect(cut).toContain(part);
    }
    expect(cut).not.toContain("b-6 begins");
  });

  it("cuts a long note once, where it is kept, and its line counts all that went", () => {
    const { root, end } = campaign();
    const note = `the first line\n${"x".repeat(3 * CONTEXT_OUTPUT_LIMIT)}\nthe newest line`;
    end("b-1", note);
    const block = builderMemoryBlock(root, ["b-1"]);
    expect(block.length).toBeLessThanOrEqual(CONTEXT_OUTPUT_LIMIT);
    // The block shows the note as it was kept, so the read cut nothing more.
    expect(block).toEndWith(`--- b-1 ---\n${readFileSync(join(root, "b-1", MEMORY_FILE), "utf8").trim()}`);
    const counts = [...block.matchAll(/\n\[(\d+) characters cut here\]\n/g)].map(([, count]) =>
      Number(count),
    );
    const shown = block.slice(block.indexOf("--- b-1 ---\n") + "--- b-1 ---\n".length);
    expect(counts).toEqual([note.length - shown.replace(/\n\[\d+ characters cut here\]\n/, "").length]);
  });

  it("opens on a folder kept in the earlier format, both notes files and no helper", () => {
    const root = join(scratch("earlier"), "memory");
    mkdirSync(join(root, "b-1", "scratch"), { recursive: true });
    writeFileSync(join(root, "b-1", MEMORY_FILE), "# Builder memory\n\nunits are kN\n");
    writeFileSync(join(root, "b-1", "SCRATCHPAD.md"), "# Scratchpad\n\n- open: L3 span family\n");
    writeFileSync(join(root, "b-1", "scratch", "gen.md"), "a helper, not a note\n");
    const block = builderMemoryBlock(root, ["b-1"]);
    expect(block).toContain("--- b-1 ---\n# Builder memory\n\nunits are kN\n\n# Scratchpad");
    expect(block).toContain("open: L3 span family");
    expect(block).not.toContain("a helper");
  });

  it("reads no notes through a link, which would carry a file the Builder's wall denies", () => {
    const outside = scratch("outside");
    writeFileSync(join(outside, "hidden.json"), "hidden-values-7f3a\n");
    const { root } = campaign();
    const home = scratch("home");
    symlinkSync(join(outside, "hidden.json"), join(home, MEMORY_FILE));
    keepMemory(home, root, "b-1");
    expect(existsSync(join(root, "b-1"))).toBe(false);
    // A link inside a kept folder, or a kept folder that is itself a link, is read no further.
    mkdirSync(join(root, "b-2"), { recursive: true });
    symlinkSync(join(outside, "hidden.json"), join(root, "b-2", MEMORY_FILE));
    symlinkSync(outside, join(root, "b-3"));
    expect(builderMemoryBlock(root, ["b-1", "b-2", "b-3"])).toBe("");
  });

  it("keeps a session once, nothing of empty notes, and never fails on a home that is gone", () => {
    const { root, end } = campaign();
    end("b-1", "kept first\n");
    end("b-1", "a second keep of the same session\n");
    expect(readFileSync(join(root, "b-1", MEMORY_FILE), "utf8")).toBe("kept first\n");
    end("b-2", "  \n");
    expect(() => keepMemory(join(scratch("gone"), "no-home"), root, "b-3")).not.toThrow();
    expect(readdirSync(root)).toEqual(["b-1"]);
  });
});
