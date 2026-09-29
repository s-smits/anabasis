/**
 * What one Builder round tells the model: where the workspace is, which notes crossed into it, what
 * the continuation says about the turn just spent, what the round hands the next one, and what a
 * refused submission says about the history it joins.
 *
 * A round that opens in a new workspace is handed what crossed into it rather than relying on what
 * the conversation remembers, because every measured round reopens under a new pass and compaction
 * cuts the opening first. A refusal reads the whole submit history the recorder holds, so its text
 * and the execution record cannot disagree about what happened.
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
import { type BuilderExecutionEvidence, submitProjection } from "../src/author/builder-execution.ts";
import { runBuilderSession } from "../src/author/builder-session.ts";
import { selectCampaignEpoch } from "../src/author/campaign-epoch.ts";
import type { CandidateCheckOutcome } from "../src/author/candidate-check.ts";
import { initWorkspace } from "../src/author/domain-repo.ts";
import { BuilderAuthorFeedback } from "../src/builder/author-feedback.ts";
import { createRunObserver } from "../src/observe/run-observer.ts";
import { controllerValidatedFinding, controllerValidatedFindings } from "../src/correctness-bundle/brief.ts";
import { required } from "./helpers/doubles.ts";
import {
  ACCEPTED,
  INPUT,
  REFUSED,
  deps,
  recordSink,
  scriptedOpener,
  submitsOnce,
} from "./helpers/builder-session-script.ts";

/** The fields one round overrides on INPUT. */
type RoundInput = Partial<Parameters<typeof runBuilderSession>[0]>;

/** A workspace holding `memory` as its MEMORY.md, or none when absent. */
function workspace(label: string, memory?: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ana-round-${label}-`));
  if (memory !== undefined) writeFileSync(join(dir, MEMORY_FILE), memory);
  return dir;
}

/** The first prompt of a fresh session over `input`. */
async function freshPrompt(input: RoundInput): Promise<string> {
  const { open, opened } = scriptedOpener([submitsOnce]);
  await runBuilderSession(
    { ...INPUT, ...input },
    deps(open, () => ACCEPTED),
  );
  return opened.prompts[0] ?? "";
}

/** The opening prompts of two rounds in one conversation. */
async function twoRounds(first: RoundInput, next: RoundInput): Promise<[string, string]> {
  const { open, opened } = scriptedOpener([submitsOnce, submitsOnce]);
  const conversation = new BuilderConversation();
  await runBuilderSession({ ...INPUT, ...first }, { ...deps(open, () => ACCEPTED), conversation });
  await runBuilderSession({ ...INPUT, ...next }, { ...deps(open, () => ACCEPTED), conversation });
  await conversation.close();
  return [opened.prompts[0] ?? "", opened.prompts[1] ?? ""];
}

/** Submit every outcome in order inside one turn, returning each refusal's text and the settled record. */
async function refusalTexts(
  outcomes: CandidateCheckOutcome[],
  feedback = new BuilderAuthorFeedback(),
): Promise<{ texts: string[]; evidence: BuilderExecutionEvidence }> {
  const texts: string[] = [];
  let next = 0;
  const { open } = scriptedOpener([
    async (submit) => {
      for (let call = 0; call < outcomes.length; call += 1) {
        texts.push((await submit.execute(`t${call}`, {})).content[0]?.text ?? "");
      }
      return undefined;
    },
  ]);
  const sink = recordSink();
  await runBuilderSession(
    { ...INPUT, maxTurns: 8 },
    {
      ...deps(open, () => required(outcomes[next++], "the next scripted outcome")),
      ...sink,
      feedback,
    },
  );
  return { texts, evidence: required(sink.settled[0], "the settled record") };
}

const refused = (commit: string, findings: Array<{ code: string; path: string; detail: string }>) =>
  ({ ...REFUSED, commit, findings: controllerValidatedFindings(findings) }) satisfies CandidateCheckOutcome;

describe("where the round prompt says the workspace is", () => {
  it("names the workspace by its physical path when the controller reaches it through a symlink", async () => {
    // A run worktree reaches its workspace through a symlink while the isolation grants the
    // physical roots, so a Builder handed the lexical spelling has its first `cd` refused.
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
  it("names the last turn's tool failures in the next prompt and records prompts and tallies to the observer", async () => {
    const root = mkdtempSync(join(tmpdir(), "ana-session-tools-"));
    const { open, opened } = scriptedOpener([
      () => ({ toolCalls: { byName: { Bash: 4, Read: 1 }, failedByName: { Bash: 2 }, failed: 2, total: 5 } }),
      () => ({ toolCalls: { byName: { Write: 2 }, failedByName: {}, failed: 0, total: 2 } }),
      submitsOnce,
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
    const rows = readFileSync(join(root, "campaigns", "demo", "observability", "run-01.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map(
        (line) =>
          /* SAFETY: the observer under test writes one JSON object per line; a non-object row
             would fail the assertions below. */ JSON.parse(line) as Record<string, JsonValue>,
      );
    // The observer records the exact prompt the model received, not a reconstruction of it.
    expect(rows.filter((row) => row.type === "prompt-ingested").map((row) => row.prompt)).toEqual(
      opened.prompts,
    );
    expect(rows.filter((row) => row.type === "turn-tools-tallied")).toMatchObject([
      { level: "warning", turn: 1, toolCalls: 5, failed: 2, failedByName: { Bash: 2 } },
      { level: "default", turn: 2, toolCalls: 2, failed: 0, failedByName: {} },
    ]);
  });

  // "Unchanged" is byte identity of the owned paths against the round's opening.
  it.each([
    ["states that the owned files are untouched", false, true],
    ["says nothing once a turn writes an owned file", true, false],
  ])("%s", async (_, writes, noted) => {
    const dir = mkdtempSync(join(tmpdir(), "ana-owned-"));
    mkdirSync(join(dir, "agent"));
    mkdirSync(join(dir, "correctness-model"));
    const { open, opened } = scriptedOpener([
      () => {
        if (writes) writeFileSync(join(dir, "agent/tools.ts"), "export const ready = true;\n");
        return undefined;
      },
      submitsOnce,
    ]);
    await runBuilderSession(
      { ...INPUT, workspace: dir },
      deps(open, () => ACCEPTED),
    );
    expect(opened.prompts[1]).toContain("Continue towards this round's goal");
    expect(opened.prompts[1]?.includes("has changed since this round opened")).toBe(noted);
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
      "Build, check and rehearse the candidate",
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

  it.each([
    ["an adopted workspace", "adopted", "units are kN", "The user's request, unchanged:"],
    // Saying nothing crossed would tell the Builder to disbelieve the block printed above it.
    [
      "a starter-seeded workspace",
      "starter",
      "a new workspace from the starter",
      "nothing from the previous workspace",
    ],
  ] as const)(
    "hands a continued conversation the notes of %s it moved into",
    async (_, seed, says, after) => {
      const [, next] = await twoRounds(
        { workspace: workspace("before") },
        { workspace: workspace("after", "# Builder memory\n\nunits are kN\n"), seed },
      );
      expect(next).toStartWith("A new round opens in this conversation.");
      expect(next.split("units are kN").length - 1).toBe(1);
      expect(next).toContain(says);
      if (seed === "adopted") {
        expect(next.indexOf("units are kN")).toBeLessThan(next.indexOf(after));
      } else {
        expect(next).not.toContain(after);
      }
    },
  );

  it("does not repeat the notes to a conversation that stays in the same workspace", async () => {
    const dir = workspace("same", "# Builder memory\n\nunits are kN\n");
    const [first, next] = await twoRounds({ workspace: dir }, { workspace: dir });
    expect(first).toContain("units are kN");
    expect(next).not.toContain("units are kN");
    expect(next).toContain("the same workspace as last round");
  });

  // Acceptance ends the round at that turn's boundary, so a note meant for after a clear submit is
  // never written; and a continued conversation already received each standing refusal as the
  // submit result that ended its round, so only a fresh session is told the earlier attempts.
  it("names the notes as the handover every round, and states earlier attempts to a fresh session only", async () => {
    const input = { advisory: "Task count: exactly 4.", freshContext: "Earlier errors: [shape] tasks." };
    const [fresh, continued] = await twoRounds(
      { ...input, workspace: workspace("a") },
      { ...input, workspace: workspace("b") },
    );
    for (const prompt of [fresh, continued]) {
      expect(prompt).toContain(`${MEMORY_FILE}, ${SCRATCHPAD_FILE} and scratch/`);
      expect(prompt).toContain("before you submit");
    }
    expect(fresh).toContain("Authoring context:\nTask count: exactly 4.\n\nEarlier errors: [shape] tasks.");
    expect(continued).toStartWith("A new round opens in this conversation.");
    expect(continued).toContain("Authoring context:\nTask count: exactly 4.");
    expect(continued).not.toContain("Earlier errors");
  });
});

describe("what a refusal tells the Builder", () => {
  it("states the attempt ordinal and whether the findings and the tree repeated", async () => {
    const { texts } = await refusalTexts([REFUSED, REFUSED]);
    expect(texts[0]).toContain("Submit 1 was refused at bundle (turn 1 of 8, submit 1 of 8)");
    expect(texts[0]).not.toContain("finding codes against submit");
    expect(texts[1]).toContain("Submit 2 was refused at bundle (turn 1 of 8, submit 2 of 8)");
    expect(texts[1]).toContain("finding codes against submit 1: 1 carried over, 0 resolved, 0 new");
    expect(texts[1]).toContain("agent/ or correctness-model/ changed since submit 1: no");
    // An immediate resubmission is already stated by the line above, so the history echo stays silent.
    expect(texts[1]).not.toContain("already refused in submit");
  });

  it("counts a fix that traded one finding class for another instead of calling it clean", async () => {
    const path = "correctness-model/tasks.json";
    const opaque = (detail: string) => ({ code: "task-access-opaque-copy", path, detail });
    const absent = (detail: string) => ({ code: "task-public-path-absent", path, detail });
    const { texts } = await refusalTexts([
      refused("d".repeat(40), [opaque("a"), opaque("b"), opaque("c")]),
      refused("e".repeat(40), [opaque("a"), absent("x"), absent("y")]),
    ]);
    expect(texts[1]).toContain("finding codes against submit 1: 1 carried over, 2 resolved, 2 new");
    expect(texts[1]).not.toContain("same issues");
  });

  it("folds a mechanism that reported once per task into one repair line with its count", async () => {
    // A finding that differs in any field is a second thing to fix; the count says how far one reached.
    const repeated = {
      code: "task-access-opaque-copy",
      path: "agent/tools.ts#read_slots",
      detail: "enumerated",
    };
    const { texts } = await refusalTexts([
      refused("d".repeat(40), [
        ...Array.from({ length: 25 }, () => repeated),
        { ...repeated, path: "agent/tools.ts#read_parts" },
      ]),
    ]);
    expect((texts[0] ?? "").split("\n").filter((line) => line.startsWith("- "))).toEqual([
      "- group 1 ×25 task-access-opaque-copy agent/tools.ts#read_slots: enumerated",
      "- group 2 task-access-opaque-copy agent/tools.ts#read_parts: enumerated",
    ]);
    expect(texts[0]).toContain('Use harness_inspect {"action":"feedback"}');
  });

  it("bounds a thousand distinct findings while retaining every exact detail page", async () => {
    const feedback = new BuilderAuthorFeedback();
    const findings = Array.from({ length: 1_000 }, (_, index) =>
      controllerValidatedFinding({
        code: `finding-${index}`,
        path: `agent/tools.ts#tool-${index}`,
        detail: `fix-${index}-${"x".repeat(index === 999 ? 20_000 : 2_000)}`,
      }),
    );
    const { texts } = await refusalTexts([{ ...REFUSED, findings }], feedback);
    const refusal = texts[0] ?? "";
    expect(new TextEncoder().encode(refusal).byteLength).toBeLessThan(64 * 1024);
    expect(refusal).toContain("Showing repair groups 1-20 of 1000 (1000 finding rows)");

    const parts: string[] = [];
    let offset = 1;
    let more = true;
    while (more) {
      const page = feedback.page({ group: 1_000, field: "detail", offset });
      if (!page.available || !("text" in page)) throw new Error("expected one exact feedback page");
      parts.push(page.text);
      more = page.more;
      offset = page.to + 1;
    }
    expect(parts.join("")).toBe(findings[999]?.detail ?? "");
  });

  // A session going A-B-A reads "changed: yes" at every step, truthfully, while resubmitting a tree
  // already refused; only the whole history can say so.
  it("names the earlier attempt when a tree the session already submitted comes back", async () => {
    const { texts, evidence } = await refusalTexts(
      ["a", "b", "a"].map((letter) => ({ ...REFUSED, commit: letter.repeat(40) })),
    );
    expect(texts[1]).not.toContain("already refused in submit");
    expect(texts[2]).toContain("these exact files were already refused in submit 1");
    expect(texts[2]).toContain("agent/ or correctness-model/ changed since submit 2: yes");
    expect(evidence.submits.map((s) => s.treeFirstSubmittedAsAttempt)).toEqual([null, null, 1]);
    // The controller validates each tree once, so this pair is also how often the gates executed.
    expect(submitProjection(evidence.submits)).toMatchObject({
      uniqueCandidateTrees: 2,
      repeatedTreeSubmits: 1,
    });
  });

  // Both lines above are blind to a session moving away from its best tree on always-fresh commits.
  it("names the session's closest tree when a later submit comes back worse", async () => {
    const finding = (n: number) => ({ code: `f-${n}`, path: "agent/tools.ts", detail: "broken" });
    const sizes = [2, 5, 1, 3];
    const { texts } = await refusalTexts(
      sizes.map((size, index) =>
        refused(
          String(index).repeat(40),
          Array.from({ length: size }, (_, n) => finding(n + 1)),
        ),
      ),
    );
    expect(texts[0]).not.toContain("closest tree so far");
    expect(texts[1]).toContain(
      `your closest tree so far is submit 1 (commit ${"0".repeat(12)}, 2 findings); this tree has 5`,
    );
    // An improving session gets no drift line.
    expect(texts[2]).not.toContain("closest tree so far");
    expect(texts[3]).toContain(
      `your closest tree so far is submit 3 (commit ${"2".repeat(12)}, 1 finding); this tree has 3`,
    );
  });
});
