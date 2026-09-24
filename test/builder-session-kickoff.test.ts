/**
 * What a round prompt tells the Builder: where the workspace is, which notes crossed into it, what
 * the continuation says about the turn just spent, and what the next round will receive.
 *
 * Hypothesis (commit R, prompting): a round that opens in a new workspace is handed what crossed
 * into it instead of relying on what the conversation remembers. Every measured round reopens under
 * a new pass, so a continued conversation moves workspace every round, and compaction cuts the
 * opening that once carried the notes. The notes are also the only handover the Builder writes, and
 * an accepted submit ends the round at that turn, so every round states that before it submits.
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
import { BuilderConversation } from "../src/author/builder-conversation.ts";
import { runBuilderSession } from "../src/author/builder-session.ts";
import { selectCampaignEpoch } from "../src/author/campaign-epoch.ts";
import { initWorkspace } from "../src/author/domain-repo.ts";
import { type RunObserver, createRunObserver } from "../src/observe/run-observer.ts";
import { double } from "./helpers/doubles.ts";
import { ACCEPTED, INPUT, type TurnScript, deps, scriptedOpener } from "./helpers/builder-session-script.ts";

/** The fields one round overrides on INPUT. */
type RoundInput = Partial<Parameters<typeof runBuilderSession>[0]>;

const submits: TurnScript = async (submit) => {
  await submit.execute("t1", {});
  return undefined;
};

/** A workspace holding `memory` as its MEMORY.md, or none when absent. */
function workspace(label: string, memory?: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ana-round-${label}-`));
  if (memory !== undefined) writeFileSync(join(dir, MEMORY_FILE), memory);
  return dir;
}

/** The first prompt of a fresh session over `input`. */
async function freshPrompt(input: RoundInput): Promise<string> {
  const { open, opened } = scriptedOpener([submits]);
  await runBuilderSession(
    { ...INPUT, ...input },
    deps(open, () => ACCEPTED),
  );
  return opened.prompts[0] ?? "";
}

/** The opening prompts of two rounds in one conversation: the first in `first`, the next in `next`. */
async function twoRounds(first: RoundInput, next: RoundInput): Promise<[string, string]> {
  const { open, opened } = scriptedOpener([submits, submits]);
  const conversation = new BuilderConversation();
  await runBuilderSession({ ...INPUT, ...first }, { ...deps(open, () => ACCEPTED), conversation });
  await runBuilderSession({ ...INPUT, ...next }, { ...deps(open, () => ACCEPTED), conversation });
  await conversation.close();
  return [opened.prompts[0] ?? "", opened.prompts[1] ?? ""];
}

describe("where the round prompt says the workspace is", () => {
  it("names the workspace by its physical path when the controller reaches it through a symlink", async () => {
    // The run worktree's `campaigns/` is a symlink into the main checkout and the isolation grants
    // the physical roots, so a Builder handed the lexical spelling has its first `cd` refused.
    const root = mkdtempSync(join(tmpdir(), "ana-session-symlink-"));
    const physical = join(root, "checkout", "campaigns", "demo", "workspace");
    mkdirSync(physical, { recursive: true });
    mkdirSync(join(root, "worktree"));
    symlinkSync(join(root, "checkout", "campaigns"), join(root, "worktree", "campaigns"));
    const lexical = join(root, "worktree", "campaigns", "demo", "workspace");
    const first = await freshPrompt({ workspace: lexical, maxTurns: 1 });
    expect(first).toContain(`Work in ${realpathSync(physical)} (project matching)`);
    expect(first).not.toContain(lexical);
  });

  it("keeps an unresolvable workspace spelling as given", async () => {
    expect(await freshPrompt({ workspace: "/nonexistent/ana-ws", maxTurns: 1 })).toContain(
      "Work in /nonexistent/ana-ws (project matching)",
    );
  });
});

describe("the continuation within a round", () => {
  it("names the last turn's tool failures in the next prompt and tallies them to the observer", async () => {
    const root = mkdtempSync(join(tmpdir(), "ana-session-tools-"));
    const { open, opened } = scriptedOpener([
      () => ({ toolCalls: { byName: { Bash: 4, Read: 1 }, failedByName: { Bash: 2 }, failed: 2, total: 5 } }),
      () => ({ toolCalls: { byName: { Write: 2 }, failedByName: {}, failed: 0, total: 2 } }),
      submits,
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
    const { open } = scriptedOpener([submits]);
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
});

describe("the notes a round opens on", () => {
  it("opens a fresh session on the notes an earlier pass wrote, exactly once, above the request", async () => {
    const dir = workspace(
      "fresh",
      "<!-- carried forward from epoch-aaaa: the binding changed, this memory did not. -->\n\n" +
        "# Builder memory\n\nOpenSees 3.5 is pinned\n",
    );
    const first = await freshPrompt({ workspace: dir, advisory: "the previous attempt failed" });
    expect(first.startsWith("Historical notes, model-authored and possibly stale.")).toBe(true);
    expect(first.split("OpenSees 3.5 is pinned").length - 1).toBe(1);
    const note = first.indexOf("OpenSees 3.5 is pinned");
    for (const current of [
      "The user's request, unchanged:",
      "Build and check the candidate",
      "Authoring context:",
    ]) {
      expect(first.indexOf(current)).toBeGreaterThan(note);
    }
    expect(first).toContain(dir);
    expect(first).toContain("carried forward from epoch-aaaa");
  });

  it.each([
    ["the next pass on the same request", { pass: "experiment:1" }, true],
    ["a corrected request", { kickoff: "design a steel truss bridge, with connections" }, false],
  ] as const)(
    "quotes the previous epoch's scratchpad after %s only when it crossed",
    async (_, change, quoted) => {
      const root = mkdtempSync(join(tmpdir(), "ana-session-memory-epochs-"));
      const prior = join(
        selectCampaignEpoch(root, { kickoff: "design a steel truss bridge" }).dir,
        WORKSPACE_DIR,
      );
      initWorkspace(prior);
      writeFileSync(join(prior, MEMORY_FILE), "# Builder memory\n\nunits are kN\n");
      writeFileSync(join(prior, SCRATCHPAD_FILE), "# Scratchpad\n\n- open: which mesh density\n");
      const epoch = selectCampaignEpoch(root, { kickoff: "design a steel truss bridge", ...change });
      carryMemoryForward(root, epoch);
      const first = await freshPrompt({ workspace: join(epoch.dir, WORKSPACE_DIR) });
      expect(first).toContain("units are kN");
      expect(first.includes("open: which mesh density")).toBe(quoted);
      expect(first.includes(`--- ${SCRATCHPAD_FILE} ---`)).toBe(quoted);
    },
  );

  it("leaves the kickoff byte-identical between a seeded starter and no notes at all", async () => {
    const dir = workspace("empty");
    const withoutFiles = await freshPrompt({ workspace: dir });
    // The seeded starter is not a note, so it earns no block and no sentence explaining its absence.
    writeFileSync(join(dir, MEMORY_FILE), STARTER_MEMORY);
    expect(await freshPrompt({ workspace: dir })).toBe(withoutFiles);
    expect(withoutFiles).not.toContain("Historical notes, model-authored");
  });

  // Every measured round reopens under a new pass in a new workspace, and pi compacts the opening
  // turn first, so a continued conversation cannot be trusted to still hold the notes it opened on.
  it("hands a continued conversation the notes of the new workspace it moved into", async () => {
    const [, next] = await twoRounds(
      { workspace: workspace("before") },
      { workspace: workspace("after", "# Builder memory\n\nunits are kN\n"), seed: "adopted" },
    );
    expect(next).toStartWith("A new round opens in this conversation.");
    expect(next).toContain("Historical notes, model-authored and possibly stale.");
    expect(next.split("units are kN").length - 1).toBe(1);
    expect(next.indexOf("units are kN")).toBeLessThan(next.indexOf("The user's request, unchanged:"));
  });

  it("does not repeat the notes to a conversation that stays in the same workspace", async () => {
    const dir = workspace("same", "# Builder memory\n\nunits are kN\n");
    const [first, next] = await twoRounds({ workspace: dir }, { workspace: dir });
    expect(first).toContain("units are kN");
    expect(next).not.toContain("units are kN");
    expect(next).toContain("the same workspace as last round");
  });

  // A starter-seeded workspace still receives the carried notes before it opens, so saying nothing
  // crossed told the Builder to disbelieve the block printed above it.
  it("does not tell a starter-seeded round that nothing crossed when its notes did", async () => {
    const [, next] = await twoRounds(
      { workspace: workspace("before") },
      { workspace: workspace("starter", "# Builder memory\n\nunits are kN\n"), seed: "starter" },
    );
    expect(next).toContain("units are kN");
    expect(next).toContain("a new workspace from the starter");
    expect(next).not.toContain("nothing from the previous workspace");
  });
});

describe("what a round says it hands the next one", () => {
  // Acceptance ends the round at that turn's boundary, and the model never answers the result, so a
  // note it meant to write after a clear submit is never written.
  it("tells every round, fresh or continued, that the notes are the handover and to update them before submitting", async () => {
    const [first, next] = await twoRounds({ workspace: workspace("a") }, { workspace: workspace("b") });
    for (const prompt of [first, next]) {
      expect(prompt).toContain(`${MEMORY_FILE}, ${SCRATCHPAD_FILE} and scratch/`);
      expect(prompt).toContain("before you submit");
    }
  });

  // A continued conversation received each standing refusal as the submit result that ended its
  // round, so only a fresh session is told the campaign's earlier attempts and refusals.
  it("states the earlier attempts to a fresh session and not again to a continued one", async () => {
    const input = { advisory: "Task count: exactly 4.", freshContext: "Earlier errors: [shape] tasks." };
    const [fresh, continued] = await twoRounds(input, input);
    expect(fresh).toContain("Authoring context:\nTask count: exactly 4.\n\nEarlier errors: [shape] tasks.");
    expect(continued).toStartWith("A new round opens in this conversation.");
    expect(continued).toContain("Authoring context:\nTask count: exactly 4.");
    expect(continued).not.toContain("Earlier errors");
  });
});
