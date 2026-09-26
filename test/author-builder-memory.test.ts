/**
 * What one authoring pass leaves the next. The Builder writes two Markdown files in its workspace,
 * MEMORY.md for what the next build would otherwise learn again and SCRATCHPAD.md for the open
 * questions and next steps, and neither carries correctness authority. What matters is whether they
 * arrive, bounded and attributed, without disturbing a prompt that has to stay byte-identical.
 *
 * Every measured round reopens the product under a new authoring pass, which opens a new epoch and
 * a new workspace, so the carry between epochs is the ordinary way a round hands over, not a rare
 * one. It has two cases, and the epoch record says which. A new pass on the same request and
 * Builder carries both files, because the open questions were written for exactly this next build.
 * A changed request or Builder condition carries MEMORY.md alone: under another binding the old
 * questions are neither answered nor open, only unattributable.
 *
 * The empty case is load-bearing. An untouched starter renders nothing at all, because a prompt
 * digest is a recorded condition identity, and a stray newline out of this module would make every
 * later run a different measured condition from every earlier one. The ceilings are the other
 * place failures live: each file is capped on the carry and again on the read, and neither cut may
 * take the carry marker with it, since a carried file that loses its marker reads as the
 * successor's own work.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { describe, expect, it } from "bun:test";
import {
  MEMORY_CAP_BYTES,
  MEMORY_FILE,
  SCRATCHPAD_FILE,
  STARTER_MEMORY,
  WORKSPACE_DIR,
  builderMemoryBlock,
  carryMemoryForward,
  noteAtMemoryHead,
} from "../src/author/builder-memory.ts";
import { type CampaignEpochEvidence, selectCampaignEpoch } from "../src/author/campaign-epoch.ts";
import { initWorkspace } from "../src/author/domain-repo.ts";

const ASK = "design steel roof trusses to Eurocode 3";
const CORRECTED_ASK = "design steel roof trusses to Eurocode 3, including connections";
/** The authoring passes of successive measured rounds, in the spelling the controller records. */
const PASS_ONE = "experiment:1";
const PASS_TWO = "experiment:2";
const BYTES = (text: string) => new TextEncoder().encode(text).byteLength;
const count = (text: string, part: string) => text.split(part).length - 1;

/** A real seeded workspace: the starter bytes come from the one owner that writes them. */
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "ana-builder-memory-"));
  initWorkspace(dir);
  return dir;
}

const workspaceOf = (epoch: CampaignEpochEvidence) => join(epoch.dir, WORKSPACE_DIR);
const read = (epoch: CampaignEpochEvidence, file: string) =>
  readFileSync(join(workspaceOf(epoch), file), "utf8");

/** A campaign whose first epoch is seeded and holds the given notes. Successors are selected
 *  through the real epoch record, so the carry reads the binding it was actually written under. */
function campaign(memory: string, scratchpad?: string) {
  const root = mkdtempSync(join(tmpdir(), "ana-epochs-"));
  const first = selectCampaignEpoch(root, { kickoff: ASK });
  initWorkspace(workspaceOf(first));
  writeFileSync(join(workspaceOf(first), MEMORY_FILE), memory);
  if (scratchpad !== undefined) writeFileSync(join(workspaceOf(first), SCRATCHPAD_FILE), scratchpad);
  /** The next measured round: same request and Builder, a new authoring pass. */
  const nextPass = (pass: string) => {
    const epoch = selectCampaignEpoch(root, { kickoff: ASK, pass });
    carryMemoryForward(root, epoch);
    return epoch;
  };
  /** A corrected request: the binding itself changed. */
  const nextAsk = () => {
    const epoch = selectCampaignEpoch(root, { kickoff: CORRECTED_ASK });
    carryMemoryForward(root, epoch);
    return epoch;
  };
  return { root, first, nextPass, nextAsk };
}

describe("the notes block a fresh session opens on", () => {
  // The header comes first and names the workspace the notes were read from; the wording is the
  // producer's. A carry within one request is no binding change, so the header claims none.
  it("renders nothing until a pass has written something, then heads the notes with their origin", () => {
    const dir = workspace();
    expect(builderMemoryBlock(dir)).toBe("");
    expect(builderMemoryBlock(join(dir, "absent"))).toBe("");
    writeFileSync(join(dir, MEMORY_FILE), "# Builder memory\n\n## Tools and verifier\n\nOpenSees 3.5\n");
    const block = builderMemoryBlock(dir);
    expect(block).toContain(`--- ${MEMORY_FILE} ---`);
    expect(block).toContain("OpenSees 3.5");
    // The scratchpad is still the untouched starter, so it stays out of the block entirely.
    expect(block).not.toContain(`--- ${SCRATCHPAD_FILE} ---`);
    const header = block.slice(0, block.indexOf(`--- ${MEMORY_FILE} ---`));
    expect(header).toContain(dir);
    expect(header).not.toContain("binding");
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
    // The slack covers the cut marker plus the header and its workspace path.
    expect(BYTES(block)).toBeLessThanOrEqual(MEMORY_CAP_BYTES + 600);
    expect(block).toContain(`memory cut to ${MEMORY_CAP_BYTES} bytes`);
    expect(block).toContain(newest);
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

  it("seeds a memory starter whose every heading is distinct", () => {
    // Two headings for one subject split the notes between them, and the next pass finds half.
    const headings = STARTER_MEMORY.split("\n").filter((line) => line.startsWith("## "));
    expect(new Set(headings).size).toBe(headings.length);
    expect(headings.filter((heading) => heading.includes("Tools"))).toHaveLength(1);
  });
});

describe("the handover between measured rounds", () => {
  it("carries both notes to the next pass on the same request, marked as an earlier pass", () => {
    const { first, nextPass } = campaign(
      "# Builder memory\n\nunits are kN\n",
      "# Scratchpad\n\n- open: L3 span family\n",
    );
    const next = nextPass(PASS_ONE);
    expect(next.supersedes).toBe(first.key);
    expect(read(next, MEMORY_FILE)).toContain("units are kN");
    expect(read(next, SCRATCHPAD_FILE)).toContain("open: L3 span family");
    for (const file of [MEMORY_FILE, SCRATCHPAD_FILE]) {
      expect(read(next, file)).toContain(`carried forward from ${first.key}`);
      // Nothing about the request or the Builder changed, so nothing says it did.
      expect(read(next, file)).not.toContain("the binding changed");
    }
    // The next pass's fresh-session read delivers the carried scratchpad too.
    expect(builderMemoryBlock(workspaceOf(next))).toContain("open: L3 span family");
  });

  it("carries memory alone across a changed request, marked as predating the new binding", () => {
    const { first, nextAsk } = campaign("# Builder memory\n\nunits are kN\n", "# Scratchpad\n\n- open: L3\n");
    const next = nextAsk();
    expect(read(next, MEMORY_FILE)).toContain("units are kN");
    expect(read(next, MEMORY_FILE)).toContain(`carried forward from ${first.key}: the binding changed`);
    expect(existsSync(join(workspaceOf(next), SCRATCHPAD_FILE))).toBe(false);
    // Initialisation finds the inherited file present, so it enters the successor's root commit.
    initWorkspace(workspaceOf(next));
    expect(read(next, MEMORY_FILE)).toContain("units are kN");
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

  it("carries small top-level scratch helpers and leaves output directories and large files", () => {
    const { first, nextPass } = campaign("# Builder memory\n\nunits are kN\n");
    const prior = workspaceOf(first);
    mkdirSync(join(prior, "scratch", "run"), { recursive: true });
    writeFileSync(join(prior, "scratch", "gen.ts"), "export const gen = 1;\n");
    writeFileSync(join(prior, "scratch", "run", "out.json"), "{}");
    writeFileSync(join(prior, "scratch", "trace.bin"), new Uint8Array(512 * 1024));
    const next = nextPass(PASS_ONE);
    expect(readFileSync(join(workspaceOf(next), "scratch", "gen.ts"), "utf8")).toBe(
      "export const gen = 1;\n",
    );
    expect(existsSync(join(workspaceOf(next), "scratch", "run"))).toBe(false);
    expect(existsSync(join(workspaceOf(next), "scratch", "trace.bin"))).toBe(false);
    expect(read(next, MEMORY_FILE)).toContain(`scratch/ holds ${first.key}'s helper files`);
    expect(read(next, MEMORY_FILE)).toContain("gen.ts");
    // A second carry names only its own predecessor's helpers, in one line.
    const third = read(nextPass(PASS_TWO), MEMORY_FILE);
    expect(count(third, "scratch/ holds")).toBe(1);
    expect(third).toContain(`scratch/ holds ${next.key}'s helper files`);
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

  it("hands the next epoch the notes and not the controller line about how this one was seeded", () => {
    const seeded = "seeding copied the adopted product's .toolchain into this workspace";
    const { first, nextPass } = campaign("# Builder memory\n\nunits are kN\n");
    noteAtMemoryHead(workspaceOf(first), seeded);
    expect(read(first, MEMORY_FILE).startsWith(`<!-- controller: ${seeded} -->\n`)).toBe(true);
    const next = nextPass(PASS_ONE);
    expect(read(next, MEMORY_FILE)).toContain("units are kN");
    expect(read(next, MEMORY_FILE)).not.toContain("controller:");
    // A carried file over its ceiling opens on a cut's marker. The line goes under it, which is the
    // only place a later cut still recognises that marker, and stays inside the ceiling.
    const newest = "units are kN and the verifier rejects bare floats";
    const long = campaign(`${"an early lesson\n".repeat(Math.ceil((MEMORY_CAP_BYTES * 2) / 16))}${newest}\n`);
    const cut = long.nextPass(PASS_ONE);
    noteAtMemoryHead(workspaceOf(cut), seeded);
    const noted = read(cut, MEMORY_FILE);
    expect(noted.startsWith("<!-- memory cut to")).toBe(true);
    expect(noted.split("\n")[1]).toBe(`<!-- controller: ${seeded} -->`);
    expect(count(noted, "memory cut to")).toBe(1);
    expect(BYTES(noted)).toBeLessThanOrEqual(MEMORY_CAP_BYTES);
    expect(builderMemoryBlock(workspaceOf(cut))).toContain(newest);
    // A cut file the Builder has since trimmed under its ceiling is carried uncut, so the carry's
    // own strip is all that stands between the successor and its predecessor's head lines. It has
    // to take the cut's marker too, or the strip stops at the first line and keeps them all.
    const trimmed = campaign(
      `<!-- memory cut to ${String(MEMORY_CAP_BYTES)} bytes: 900 older bytes dropped -->\n# Builder memory\n\nunits are kN\n`,
    );
    noteAtMemoryHead(workspaceOf(trimmed.first), seeded);
    const after = read(trimmed.nextPass(PASS_ONE), MEMORY_FILE);
    expect(after).toContain("units are kN");
    expect(after).not.toContain("controller:");
    expect(after).not.toContain("memory cut to");
    expect(count(after, "carried forward from")).toBe(1);
  });

  it("never overwrites notes an epoch already has, and never fails on a missing predecessor", () => {
    const { root, nextPass } = campaign(
      "# Builder memory\n\nthe predecessor's text\n",
      "# Scratchpad\n\n- theirs\n",
    );
    const own = selectCampaignEpoch(root, { kickoff: ASK, pass: PASS_ONE });
    initWorkspace(workspaceOf(own));
    writeFileSync(join(workspaceOf(own), MEMORY_FILE), "# Builder memory\n\nthis epoch's own text\n");
    writeFileSync(join(workspaceOf(own), SCRATCHPAD_FILE), "# Scratchpad\n\n- mine\n");
    // Resume re-runs the carry on every invocation; the epoch's own notes outrank its parent's.
    const resumed = nextPass(PASS_ONE);
    expect(read(resumed, MEMORY_FILE)).not.toContain("carried forward");
    expect(read(resumed, SCRATCHPAD_FILE)).toContain("mine");
    rmSync(workspaceOf(resumed), { recursive: true, force: true });
    const orphan = nextPass(PASS_TWO);
    expect(existsSync(join(workspaceOf(orphan), MEMORY_FILE))).toBe(false);
    // A first epoch has no predecessor, and an unrecorded epoch has no binding to compare.
    const fresh = mkdtempSync(join(tmpdir(), "ana-epochs-fresh-"));
    expect(() => carryMemoryForward(fresh, selectCampaignEpoch(fresh, { kickoff: ASK }))).not.toThrow();
    expect(() =>
      carryMemoryForward(fresh, { key: "epoch-x", dir: join(fresh, "x"), supersedes: "epoch-gone" }),
    ).not.toThrow();
    expect(existsSync(join(fresh, "x", WORKSPACE_DIR, MEMORY_FILE))).toBe(false);
  });
});
