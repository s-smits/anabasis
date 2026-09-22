/**
 * What a Builder session is opened and continued with: where the workspace is said to be, which
 * notes an earlier pass left that this one may read, and what the continuation tells the model
 * about the turn it just spent.
 */
import { describe, expect, it } from "bun:test";

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import {
  MEMORY_FILE,
  SCRATCHPAD_FILE,
  STARTER_MEMORY,
  WORKSPACE_DIR,
  carryMemoryForward,
} from "../src/author/builder-memory.ts";
import { runBuilderSession } from "../src/author/builder-session.ts";
import { initWorkspace } from "../src/author/domain-repo.ts";
import { type RunObserver, createRunObserver } from "../src/observe/run-observer.ts";
import { double } from "./helpers/doubles.ts";
import { ACCEPTED, INPUT, deps, scriptedOpener } from "./helpers/builder-session-script.ts";

describe("the Builder session kickoff", () => {
  it("names the workspace by its physical path when the controller reaches it through a symlink", async () => {
    // truss-run6-opus-0902 and run47-opus-0902: the run worktree's `campaigns/` is a symlink into
    // the main checkout, the isolation grants the physical roots, and the Builder's first `cd` into
    // the lexical spelling was refused in both runs.
    const root = mkdtempSync(join(tmpdir(), "ana-session-symlink-"));
    const physical = join(root, "checkout", "campaigns", "demo", "workspace");
    mkdirSync(physical, { recursive: true });
    mkdirSync(join(root, "worktree"));
    symlinkSync(join(root, "checkout", "campaigns"), join(root, "worktree", "campaigns"));
    const lexical = join(root, "worktree", "campaigns", "demo", "workspace");
    const { open, opened } = scriptedOpener([() => ({ status: "completed", assistantText: "done" })]);

    await runBuilderSession(
      { ...INPUT, workspace: lexical, maxTurns: 1 },
      deps(open, () => ACCEPTED),
    );

    const first = opened.prompts[0] ?? "";
    expect(first).toContain(`Work in ${realpathSync(physical)} (project matching)`);
    expect(first).not.toContain(lexical);
  });

  it("keeps an unresolvable workspace spelling as given", async () => {
    const { open, opened } = scriptedOpener([() => ({ status: "completed", assistantText: "done" })]);
    await runBuilderSession(
      { ...INPUT, workspace: "/nonexistent/ana-ws", maxTurns: 1 },
      deps(open, () => ACCEPTED),
    );
    expect(opened.prompts[0]).toContain("Work in /nonexistent/ana-ws (project matching)");
  });

  it("names the last turn's tool failures in the next prompt and tallies them to the observer (run 66)", async () => {
    const root = mkdtempSync(join(tmpdir(), "ana-session-tools-"));
    const { open, opened } = scriptedOpener([
      () => ({ toolCalls: { byName: { Bash: 4, Read: 1 }, failedByName: { Bash: 2 }, failed: 2, total: 5 } }),
      () => ({ toolCalls: { byName: { Write: 2 }, failedByName: {}, failed: 0, total: 2 } }),
      async (submit) => {
        await submit.execute("t1", {});
        return undefined;
      },
    ]);
    await runBuilderSession(INPUT, {
      ...deps(open, () => ACCEPTED),
      observer: createRunObserver(root, "demo", "run-01"),
    });
    expect(opened.prompts[1]).toContain("Continue towards this round's goal");
    expect(opened.prompts[1]).toContain("Note: last turn 2 of 5 tool calls failed (Bash x2)");
    // A clean turn gets the plain continuation: no note to act on, so none is written.
    expect(opened.prompts[2]).toContain("Continue towards this round's goal");
    expect(opened.prompts[2]).not.toContain("Note: last turn");
    const tallies = readFileSync(join(root, "campaigns", "demo", "observability", "run-01.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map(
        (line) =>
          /* SAFETY: the observer under test writes one JSON object per line; a non-object row
             would fail the toMatchObject assertion below. */ JSON.parse(line) as Record<string, JsonValue>,
      )
      .filter((row) => row.type === "turn-tools-tallied");
    expect(tallies).toMatchObject([
      { level: "warning", turn: 1, toolCalls: 5, failed: 2, failedByName: { Bash: 2 } },
      { level: "default", turn: 2, toolCalls: 2, failed: 0, failedByName: {} },
    ]);
  });

  it("records the exact prompts at the direct model caller", async () => {
    const prompts: string[] = [];
    const { open } = scriptedOpener([
      async (submit) => {
        await submit.execute("t1", {});
        return undefined;
      },
    ]);
    await runBuilderSession(INPUT, {
      ...deps(open, () => ACCEPTED),
      observer: double<RunObserver>({
        prompt: (event: Parameters<RunObserver["prompt"]>[0]) => {
          prompts.push(event.prompt);
          return "prompt-1";
        },
      }),
    });
    expect(prompts).toEqual([expect.stringContaining(INPUT.kickoff)]);
  });

  /**
   * Read-back. Curation writes MEMORY.md after every refused pass, but from commit a55b8e44 until
   * this interface nothing delivered those bytes back: runs esp32-sol-329, esp32-w22, esp32-w28 and
   * truss-w30 each opened on notes the campaign had paid to write and never showed. The block is
   * unconditional on the previous pass's outcome, and it arrives once.
   */
  it("opens the session on the notes an earlier pass wrote, exactly once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ana-session-memory-"));
    writeFileSync(
      join(dir, MEMORY_FILE),
      "# Builder memory\n\n## Engine and verifier\n\nOpenSees 3.5 is pinned\n",
    );
    const { open, opened } = scriptedOpener([
      async (submit) => {
        await submit.execute("t1", {});
        return undefined;
      },
    ]);
    await runBuilderSession(
      { ...INPUT, workspace: dir },
      deps(open, () => ACCEPTED),
    );
    const first = opened.prompts[0] ?? "";
    expect(first).toContain("Historical notes, model-authored and possibly stale");
    expect(first.split("OpenSees 3.5 is pinned").length - 1).toBe(1);
  });

  /**
   * Order. The notes are the stalest text in the kickoff; appended last they read as the newest
   * and most authoritative. They now lead, under a header naming their authorship, their possible
   * staleness and their origin, with everything the controller states for this round below them.
   */
  it("puts a carried note above the current request and under the stale-notes header", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ana-session-memory-order-"));
    writeFileSync(
      join(dir, MEMORY_FILE),
      "<!-- carried forward from epoch-aaaa: the binding changed, this memory did not. -->\n\n" +
        "# Builder memory\n\nOpenSees 3.5 is pinned\n",
    );
    const { open, opened } = scriptedOpener([
      async (submit) => {
        await submit.execute("t1", {});
        return undefined;
      },
    ]);
    await runBuilderSession(
      { ...INPUT, workspace: dir, advisory: "the previous attempt failed" },
      deps(open, () => ACCEPTED),
    );
    const first = opened.prompts[0] ?? "";
    expect(first.startsWith("Historical notes, model-authored and possibly stale.")).toBe(true);
    const note = first.indexOf("OpenSees 3.5 is pinned");
    for (const current of [
      "The user's request, unchanged:",
      "Build and check the candidate",
      "Authoring context:",
    ]) {
      expect(first.indexOf(current)).toBeGreaterThan(note);
    }
    // The origin the branch already carries: the workspace, and the epoch the file names itself.
    expect(first).toContain(dir);
    expect(first).toContain("carried forward from epoch-aaaa");
  });

  it("leaves a previous epoch's scratchpad out of the kickoff entirely", async () => {
    // SCRATCHPAD.md no longer crosses a binding change (builder-memory.ts carryMemoryForward), so
    // a successor epoch's workspace has none and the kickoff cannot quote one.
    const root = mkdtempSync(join(tmpdir(), "ana-session-memory-epochs-"));
    const prior = join(root, "epoch-aaaa", WORKSPACE_DIR);
    initWorkspace(prior);
    writeFileSync(join(prior, MEMORY_FILE), "# Builder memory\n\nunits are kN\n");
    writeFileSync(join(prior, SCRATCHPAD_FILE), "# Scratchpad\n\n- open: which mesh density\n");
    const dir = join(root, "epoch-bbbb", WORKSPACE_DIR);
    carryMemoryForward(root, { key: "epoch-bbbb", dir: join(root, "epoch-bbbb"), supersedes: "epoch-aaaa" });
    const { open, opened } = scriptedOpener([
      async (submit) => {
        await submit.execute("t1", {});
        return undefined;
      },
    ]);
    await runBuilderSession(
      { ...INPUT, workspace: dir },
      deps(open, () => ACCEPTED),
    );
    const first = opened.prompts[0] ?? "";
    expect(first).toContain("units are kN");
    expect(first).not.toContain("open: which mesh density");
    expect(first).not.toContain(SCRATCHPAD_FILE);
  });

  it("leaves the kickoff byte-identical while no pass has written notes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ana-session-memory-empty-"));
    const first = async (): Promise<string> => {
      const { open, opened } = scriptedOpener([
        async (submit) => {
          await submit.execute("t1", {});
          return undefined;
        },
      ]);
      await runBuilderSession(
        { ...INPUT, workspace: dir },
        deps(open, () => ACCEPTED),
      );
      return opened.prompts[0] ?? "";
    };
    const withoutFiles = await first();
    // The seeded starter is not a note. A first build's kickoff must stay exactly what it was
    // before this owner existed, with no empty starter sentence to explain an absent block.
    writeFileSync(join(dir, MEMORY_FILE), STARTER_MEMORY);
    expect(await first()).toBe(withoutFiles);
    expect(withoutFiles).not.toContain("Historical notes, model-authored");
  });
});
