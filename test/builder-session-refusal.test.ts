/**
 * What a refused submission tells the model: the attempt's ordinal, how its findings moved against
 * the last one, whether the tree moved at all, and — when neither of those can see it — which
 * earlier attempt this tree or a closer one already was.
 */
import { describe, expect, it } from "bun:test";

import type { BuilderExecutionEvidence } from "../src/author/builder-execution.ts";
import { runBuilderSession } from "../src/author/builder-session.ts";
import type { CandidateCheckOutcome } from "../src/author/candidate-check.ts";
import { BuilderAuthorFeedback } from "../src/builder/author-feedback.ts";
import { controllerValidatedFinding, controllerValidatedFindings } from "../src/truth/brief.ts";
import { required } from "./helpers/doubles.ts";
import { INPUT, REFUSED, deps, scriptedOpener } from "./helpers/builder-session-script.ts";

describe("what a refusal tells the Builder", () => {
  // Run 35 submitted 141 times in 43 minutes and reverted byte-identically to its first guess. The
  // model could not see either fact: every refusal read the same, and nothing told it the tree had
  // not moved. Both readings come from the execution recorder, so the text and the evidence cannot
  // disagree about what happened.
  it("states the attempt ordinal and whether the findings and the tree repeated", async () => {
    const texts: string[] = [];
    const { open } = scriptedOpener([
      async (submit) => {
        texts.push((await submit.execute("t1", {})).content[0]?.text ?? "");
        texts.push((await submit.execute("t2", {})).content[0]?.text ?? "");
        return undefined;
      },
    ]);
    await runBuilderSession(
      { ...INPUT, maxTurns: 4 },
      deps(open, () => REFUSED),
    );
    expect(texts[0]).toContain("Submit 1 was refused at bundle (turn 1 of 4, submit 1 of 4)");
    expect(texts[0]).not.toContain("finding codes against submit");
    expect(texts[1]).toContain("Submit 2 was refused at bundle (turn 1 of 4, submit 2 of 4)");
    expect(texts[1]).toContain("finding codes against submit 1: 1 carried over, 0 resolved, 0 new");
    expect(texts[1]).toContain("agent/ or correctness-model/ changed since submit 1: no");
    // An immediate resubmission is already stated by the line above, so the whole-history echo
    // stays silent rather than saying the same thing twice in one refusal.
    expect(texts[1]).not.toContain("already refused in submit");
  });

  it("counts a fix that traded one finding class for another instead of calling it clean", async () => {
    // Run 68's submit 3 was told "same issues as submit 2: no" while one class fell 50 to 15 and
    // a new class arrived at 100 — the digest boolean read a worse tree as progress. The counts
    // separate carried, resolved and introduced work.
    const first: CandidateCheckOutcome = {
      ok: false,
      stage: "bundle",
      findings: [
        { code: "task-access-opaque-copy", path: "correctness-model/tasks.json", detail: "a" },
        { code: "task-access-opaque-copy", path: "correctness-model/tasks.json", detail: "b" },
        { code: "task-access-opaque-copy", path: "correctness-model/tasks.json", detail: "c" },
      ],
      commit: "d".repeat(40),
    };
    const second: CandidateCheckOutcome = {
      ok: false,
      stage: "bundle",
      findings: [
        { code: "task-access-opaque-copy", path: "correctness-model/tasks.json", detail: "a" },
        { code: "task-public-path-absent", path: "correctness-model/tasks.json", detail: "x" },
        { code: "task-public-path-absent", path: "correctness-model/tasks.json", detail: "y" },
      ],
      commit: "e".repeat(40),
    };
    const texts: string[] = [];
    const outcomes = [first, second];
    const { open } = scriptedOpener([
      async (submit) => {
        texts.push((await submit.execute("t1", {})).content[0]?.text ?? "");
        texts.push((await submit.execute("t2", {})).content[0]?.text ?? "");
        return undefined;
      },
    ]);
    await runBuilderSession(
      { ...INPUT, maxTurns: 8 },
      deps(open, () => outcomes.shift() ?? REFUSED),
    );
    expect(texts[1]).toContain("finding codes against submit 1: 1 carried over, 2 resolved, 2 new");
    expect(texts[1]).not.toContain("same issues");
  });

  it("folds a mechanism that reported once per task into one repair line with its count", async () => {
    // The task interpreter probe runs per task and reports the same code, path and detail each
    // time, so one defect arrived as 25 identical lines. The count stays: it says how far the
    // mechanism reached. A finding that differs in any field is a second thing to fix.
    const repeated = {
      code: "task-access-opaque-copy",
      path: "agent/tools.ts#read_slots",
      detail: "enumerated",
    };
    const texts: string[] = [];
    const { open } = scriptedOpener([
      async (submit) => {
        texts.push((await submit.execute("t1", {})).content[0]?.text ?? "");
        return undefined;
      },
    ]);
    await runBuilderSession(
      { ...INPUT, maxTurns: 8 },
      {
        ...deps(open, () => ({
          ...REFUSED,
          findings: controllerValidatedFindings([
            ...Array.from({ length: 25 }, () => repeated),
            { ...repeated, path: "agent/tools.ts#read_parts" },
          ]),
        })),
      },
    );
    const rows = (texts[0] ?? "").split("\n").filter((line) => line.startsWith("- "));
    expect(rows).toEqual([
      "- group 1 ×25 task-access-opaque-copy agent/tools.ts#read_slots: enumerated",
      "- group 2 task-access-opaque-copy agent/tools.ts#read_parts: enumerated",
    ]);
    expect(texts[0]).toContain('Use harness_inspect {"action":"feedback"}');
  });

  it("bounds a thousand distinct submit fixes while retaining every exact detail page", async () => {
    const feedback = new BuilderAuthorFeedback();
    const findings = Array.from({ length: 1_000 }, (_, index) =>
      controllerValidatedFinding({
        code: `finding-${index}`,
        path: `agent/tools.ts#tool-${index}`,
        detail: `fix-${index}-${"x".repeat(index === 999 ? 20_000 : 2_000)}`,
      }),
    );
    let refusal = "";
    const { open } = scriptedOpener([
      async (submit) => {
        refusal = (await submit.execute("large-refusal", {})).content[0]?.text ?? "";
        return undefined;
      },
    ]);
    await runBuilderSession(
      { ...INPUT, maxTurns: 8 },
      {
        ...deps(open, () => ({ ...REFUSED, findings })),
        feedback,
      },
    );
    expect(new TextEncoder().encode(refusal).byteLength).toBeLessThan(64 * 1024);
    expect(refusal).toContain("Showing repair groups 1-20 of 1000 (1000 finding rows)");

    const expected = findings[999]?.detail ?? "";
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
    expect(parts.join("")).toBe(expected);
  });

  // The two lines above compare against the PREVIOUS submission only. Run 35 ended byte-identical
  // to its first submission after 141 attempts: a session that goes A-B-A reads "workspace changed:
  // yes" at every step, truthfully, while resubmitting a tree the candidate check has already refused. Only a
  // comparison against the whole history can say so, and the recorder already holds every commit.
  it("names the earlier attempt when a tree the session already submitted comes back", async () => {
    const commits = ["a", "b", "a"].map((letter) => letter.repeat(40));
    const completed: BuilderExecutionEvidence[] = [];
    const texts: string[] = [];
    let index = 0;
    const { open } = scriptedOpener([
      async (submit) => {
        for (let call = 0; call < commits.length; call += 1) {
          texts.push((await submit.execute(`t${call}`, {})).content[0]?.text ?? "");
        }
        return undefined;
      },
    ]);
    await runBuilderSession(
      { ...INPUT, maxTurns: 8 },
      {
        ...deps(open, () => ({ ...REFUSED, commit: required(commits[index++], "the next scripted commit") })),
        onExecution: (evidence) => completed.push(evidence),
      },
    );
    expect(texts[2]).toContain("these exact files were already refused in submit 1");
    // The depth-1 line still reads "yes" on that same attempt, which is why the echo is needed.
    expect(texts[2]).toContain("agent/ or correctness-model/ changed since submit 2: yes");
    expect(texts[1]).not.toContain("already refused in submit");
    expect(completed[0]?.submits.map((s) => s.treeFirstSubmittedAsAttempt)).toEqual([null, null, 1]);
    // Three submissions over two trees. The controller validates each tree once, so this pair also
    // says how many times the probes and the adoption gates executed, and how often they did not.
    expect(completed[0]).toMatchObject({ uniqueCandidateTrees: 2, repeatedTreeSubmits: 1 });
  });

  // The depth-1 delta and the byte-identical echo are both blind to a session moving AWAY from
  // its best tree on always-fresh commits: esp32-w33 wandered from 221 findings at submit 13 to
  // 638 at submit 16 with "files changed: yes" true at every step and nothing naming the loss.
  it("names the session's closest tree when a later submit comes back worse", async () => {
    const finding = (n: number) => ({ code: `f-${n}`, path: "agent/tools.ts", detail: "broken" });
    const batches = [
      [finding(1), finding(2)],
      [finding(1), finding(2), finding(3), finding(4), finding(5)],
      [finding(1)],
      [finding(1), finding(2), finding(3)],
    ];
    const texts: string[] = [];
    let index = 0;
    const { open } = scriptedOpener([
      async (submit) => {
        for (let call = 0; call < batches.length; call += 1) {
          texts.push((await submit.execute(`t${call}`, {})).content[0]?.text ?? "");
        }
        return undefined;
      },
    ]);
    await runBuilderSession(
      { ...INPUT, maxTurns: 8 },
      {
        ...deps(open, () => ({
          ...REFUSED,
          commit: String(index).repeat(40).slice(0, 40),
          findings: required(batches[index++], "the next scripted findings"),
        })),
      },
    );
    // Submit 1 has no history; submit 2 regressed against submit 1's two findings.
    expect(texts[0]).not.toContain("closest tree so far");
    expect(texts[1]).toContain(
      `your closest tree so far is submit 1 (commit ${"0".repeat(12)}, 2 findings); this tree has 5`,
    );
    // Submit 3 beats the best; an improving session gets no drift line.
    expect(texts[2]).not.toContain("closest tree so far");
    // Submit 4 regresses against it, and the single-finding best read "1 findings".
    expect(texts[3]).toContain(
      `your closest tree so far is submit 3 (commit ${"2".repeat(12)}, 1 finding); this tree has 3`,
    );
  });
});
