import { describe, expect, it } from "bun:test";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import type { BuilderSubmitAttempt } from "../src/author/builder-execution.ts";
import { renderRefusal } from "../src/gate/submit-tool.ts";
import {
  controllerValidatedFinding,
  controllerValidatedFindings,
  generatedExecutionFinding,
  projectFindingForAuthor,
} from "../src/truth/brief.ts";
import {
  discriminationDisclosure,
  identityComposedFinding,
} from "../src/truth/discrimination-author-detail.ts";

import {
  BuilderAuthorFeedback,
  authorFindingOverview,
  authorFindingPage,
  groupAuthorFindings,
} from "../src/builder/author-feedback.ts";

describe("the shared Builder repair feedback", () => {
  function feedback(findings: Parameters<BuilderAuthorFeedback["recordCheck"]>[1]) {
    const store = new BuilderAuthorFeedback();
    store.recordCheck("gates", findings);
    return store;
  }
  it.each([
    "generated-evaluate-result",
    "generated-evaluate-throw",
    "verifier-tool-input",
    "verifier-tool-binding",
    "verifier-tool-request",
  ] as const)("keeps protected verifier text out of %s", (classification) => {
    const render = (detail: string) =>
      JSON.stringify(
        feedback([
          generatedExecutionFinding(
            { code: "DISCRIMINATION_ACCEPT_REJECTED", path: "correctness-model/controls.json", detail },
            classification,
          ),
        ]).page(),
      );
    expect(render("private A")).toBe(render("private B"));
    expect(render("private A")).not.toContain("private A");
  });
  it("fails closed on an unmarked finding", () => {
    const rendered = JSON.stringify(
      feedback([{ code: "x", path: "private/path", detail: "private detail" }]).page(),
    );
    expect(rendered).not.toContain("private/path");
    expect(rendered).not.toContain("private detail");
    expect(rendered).toContain("generated-execution-unclassified");
  });
  it("renders the same submit refusal when only protected verifier detail changes", () => {
    // The submit refusal is the other Builder-visible surface beside the feedback page above. Its
    // rows arrive as recorded, so the projection its grouping applies must leave the rendered text
    // byte-identical when a withheld detail and an unmarked finding's private path and detail change.
    const attempt: BuilderSubmitAttempt = {
      kind: "candidate",
      ordinal: 2,
      turn: 3,
      atMs: 1,
      outcome: "refused",
      stage: "validation",
      commit: "c".repeat(40),
      findingsDigest: "digest",
      findingCodes: ["DISCRIMINATION_ACCEPT_REJECTED", "x"],
      repeatedFindings: false,
      findingsDelta: { carried: 1, resolved: 0, introduced: 1 },
      workspaceChanged: true,
      treeFirstSubmittedAsAttempt: null,
      terminal: false,
    };
    const refusal = (detail: string) =>
      renderRefusal(
        {
          ok: false,
          stage: "validation",
          commit: attempt.commit,
          findings: [
            generatedExecutionFinding(
              { code: "DISCRIMINATION_ACCEPT_REJECTED", path: "correctness-model/controls.json", detail },
              "generated-evaluate-result",
            ),
            { code: "x", path: `private/${detail}`, detail },
          ],
        },
        attempt,
        10,
        null,
      );
    const a = refusal("private verifier result A");
    const b = refusal("different private verifier result B");
    expect(a).toBe(b);
    expect(a).toContain("DISCRIMINATION_ACCEPT_REJECTED");
    expect(a).toContain("generated-execution-unclassified");
    expect(a).not.toContain("private");
  });

  it("keeps every distinct repair path reachable and folds exact duplicates", () => {
    const paths = ["tasks[0].inputs", "tasks[7].inputs", "tasks[9].inputs", "tasks[24].inputs"];
    const rows = paths.map((path) => ({ code: "task-shape", path, detail: "repair " + path }));
    const store = feedback(
      controllerValidatedFindings([...Array.from({ length: 300 }, () => rows[0]!), ...rows.slice(1)]),
    );
    expect(store.page()).toMatchObject({ totalFindings: 303, totalGroups: 4 });
    paths.forEach((path, index) =>
      expect(store.page({ group: index + 1, field: "path" })).toMatchObject({
        text: path,
        count: index === 0 ? 300 : 1,
      }),
    );
  });
});

const row = (code: string, detail: string, subject?: string) =>
  controllerValidatedFinding({
    code,
    path: "correctness-model/controls.json",
    detail,
    ...keyIfDefined("subject", subject),
  });

describe("groupAuthorFindings", () => {
  it("folds rows that differ only in their declared subject into one variant naming the rest", () => {
    // An Opus run on 2026-08-22, submit 3: 30 accept rows named the same eight checks and differed by id.
    const findings = [
      row("A", 'valid example "one" was rejected on checks [x, y]. Fix it', "one"),
      row("A", 'valid example "two" was rejected on checks [x, y]. Fix it', "two"),
      row("A", 'valid example "three" was rejected on checks [x, y]. Fix it', "three"),
      row("A", 'valid example "four" was rejected on checks [z]. Fix it', "four"),
      row("B", "no quoted identifier here"),
      row("B", "no quoted identifier here"),
    ];
    const groups = groupAuthorFindings(findings);
    expect(groups.map((g) => [g.code, g.count, g.variants.length])).toEqual([
      ["A", 4, 2],
      ["B", 2, 1],
    ]);
    expect(groups[0]?.variants[0]).toMatchObject({
      detail: 'valid example "one" was rejected on checks [x, y]. Fix it',
      count: 3,
      alsoFor: ["two", "three"],
    });
    expect(groups[0]?.detail).toContain(
      '[variant 1/2 ×3, 57 chars]\nvalid example "one" was rejected on checks [x, y]. Fix it Also for: "two", "three".',
    );
    expect(groups[0]?.detail).toContain(
      '[variant 2/2 ×1, 55 chars]\nvalid example "four" was rejected on checks [z]. Fix it',
    );
    expect(groups[1]?.detail).toBe("no quoted identifier here");
  });

  it("keeps rows apart when no producer declared a subject, even if they differ only in a quoted name", () => {
    // The first-quote guess folded two different tools into one repair before 2026-09-15.
    const groups = groupAuthorFindings([
      row("T", 'generated tool "a" failed'),
      row("T", 'generated tool "b" failed'),
    ]);
    expect(groups.map((g) => g.variants.length)).toEqual([2]);
    expect(groups[0]?.detail).not.toContain("Also for");
  });

  it("indexes every variant of a group in the overview and the refusal text, count first", () => {
    // 189 recorded refusals of 2026-08-30 to 09-13: a group held 7 variants at the median and the
    // 240-character preview showed the first, so a Builder repaired one check per round.
    const findings = [
      ...Array.from({ length: 36 }, (_, i) =>
        row("R", `receipt for control "r${i}" expected fail on check-${i % 34}`, `r${i}`),
      ),
      row("S", "one variant only"),
    ];
    const overview = authorFindingOverview(findings);
    expect(overview.groups[0]?.variants).toBe(34);
    expect(overview.groups[0]?.variantIndex).toEqual([
      '×2 receipt for control "r0" expected fail on check-0 Also for: "r34".',
      '×2 receipt for control "r1" expected fail on check-1 Also for: "r35".',
      ...Array.from(
        { length: 30 },
        (_, i) => `×1 receipt for control "r${i + 2}" expected fail on check-${i + 2}`,
      ),
      "(2 more variants; page this group's detail)",
    ]);
    expect(overview.groups[1]?.variantIndex).toBeUndefined();
    const text = renderRefusal(
      { ok: false, stage: "gates", commit: "d".repeat(40), findings: controllerValidatedFindings(findings) },
      {
        kind: "candidate",
        ordinal: 1,
        turn: 1,
        atMs: 0,
        outcome: "refused",
        stage: "gates",
        commit: "d".repeat(40),
        findingsDigest: "x",
        findingCodes: [],
        repeatedFindings: null,
        findingsDelta: null,
        workspaceChanged: null,
        treeFirstSubmittedAsAttempt: null,
        terminal: false,
      },
      10,
      null,
    );
    expect(text).toContain("- group 1 ×36 R correctness-model/controls.json: [variant 1/34 ×2");
    expect(text).toContain(
      '\n    · ×2 receipt for control "r0" expected fail on check-0 Also for: "r34".\n    · ×2',
    );
    expect(text).toContain("\n    · (2 more variants; page this group's detail)\n- group 2 S");
    // The round plan's advice closes the refusal and changes nothing above it.
    expect(text).not.toContain("Advice:");
    const advised = renderRefusal(
      {
        ok: false,
        stage: "gates",
        commit: "d".repeat(40),
        findings: controllerValidatedFindings(findings),
        advice: ["Advice: a stand-in line."],
      },
      {
        kind: "candidate",
        ordinal: 1,
        turn: 1,
        atMs: 0,
        outcome: "refused",
        stage: "gates",
        commit: "d".repeat(40),
        findingsDigest: "x",
        findingCodes: [],
        repeatedFindings: null,
        findingsDelta: null,
        workspaceChanged: null,
        treeFirstSubmittedAsAttempt: null,
        terminal: false,
      },
      10,
      null,
    );
    expect(advised).toBe(`${text}\nAdvice: a stand-in line.`);
  });

  it("returns the code delta against the previous stored result on every recorded check", () => {
    const store = new BuilderAuthorFeedback();
    expect(store.recordCheck("gates", [row("A", "a"), row("A", "a2"), row("B", "b")])).toBeNull();
    expect(store.recordCheck("gates", [row("A", "a"), row("C", "c")])).toEqual({
      carried: 1,
      resolved: 2,
      introduced: 1,
    });
    expect(store.recordCheck("gates", [])).toEqual({ carried: 0, resolved: 2, introduced: 0 });
  });

  it("keeps every folded identifier readable through the exact-field pager", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => row("A", `task "t${i}" failed`, `t${i}`));
    const [group] = groupAuthorFindings(tasks);
    expect(group?.variants).toHaveLength(1);
    expect(group?.detail).toBe(
      `task "t0" failed Also for: ${tasks
        .slice(1)
        .map((_, i) => `"t${i + 1}"`)
        .join(", ")}.`,
    );
    const mixed = [
      ...tasks,
      ...Array.from({ length: 12 }, (_, i) => row("A", `control "c${i}" expected fail`, `c${i}`)),
    ];
    let text = "";
    for (let offset = 1, more = true; more; offset += 40) {
      const page = authorFindingPage(mixed, { group: 1, field: "detail", offset, limit: 40 });
      if (!("text" in page)) throw new Error("stale group");
      text += page.text;
      more = page.more;
    }
    for (const id of [...tasks.keys()].flatMap((i) => [`"t${i}"`, `"c${i}"`])) expect(text).toContain(id);
  });
});

describe("the census disclosure", () => {
  it("projects the sentence the producer composed, not the finding message", () => {
    const message = 'valid example "a1" was rejected. Blocking issues: [io-behaviour] <verifier text>';
    const authorSentence = 'valid example "a1" was rejected by the correctnessModel on check [io-behaviour]';
    const finding = identityComposedFinding(
      { code: "DISCRIMINATION_ACCEPT_REJECTED", message },
      authorSentence,
    );
    const projected = projectFindingForAuthor({
      code: finding.code,
      path: "correctness-model/controls.json",
      detail: finding.message,
      disclosure: discriminationDisclosure(finding),
    });
    expect(projected.detail).toBe(authorSentence);
    expect(projected.detail).not.toContain("<verifier text>");
    expect(projectFindingForAuthor(projected)).toEqual(projected);
    // The disclosure is a field of the row, so a copied or recorded row keeps the producer's decision.
    expect(discriminationDisclosure({ ...finding })).toEqual({ class: "authored", detail: authorSentence });
    expect(discriminationDisclosure(JSON.parse(JSON.stringify(finding)))).toEqual({
      class: "authored",
      detail: authorSentence,
    });
  });

  // Run c1d2a7 established that a best-answer domain's published limit is only as tight as the
  // reference search behind it, and the gate wall that search runs under is set by the candidate's
  // own agent/config.yaml. The bare label left the author with nothing to change.
  it("names the wall a timed-out reference solve hit, and still carries no verifier text", () => {
    const projected = projectFindingForAuthor(
      generatedExecutionFinding(
        {
          code: "solvability-witness-failed",
          path: "correctness-model/tasks.json#t1",
          detail: "reference solve child exceeded 120000ms",
        },
        "generated-solve-timeout",
      ),
    );
    expect(projected.detail).toContain("gate.reference_solve_seconds");
    expect(projected.detail).toContain("gate.census_minutes");
    expect(projected.detail).toContain("reference/");
    expect(projected.detail).not.toContain("120000");
    expect(projected.path).toBe("generated-execution");
    // A classification with no sentence still projects its bare label rather than the detail.
    expect(
      projectFindingForAuthor(
        generatedExecutionFinding(
          {
            code: "solvability-witness-failed",
            path: "correctness-model/tasks.json#t1",
            detail: "reference artifact was rejected on [mass]",
          },
          "generated-evaluate-result",
        ),
      ).detail,
    ).toBe("generated-evaluate-result");
  });

  it("refuses an opt-in that names no author sentence, and keeps the row withheld if one slips through", () => {
    const finding = { code: "DISCRIMINATION_ACCEPT_REJECTED" as const, message: "raw census message" };
    // @ts-expect-error — the author sentence is required; if this directive goes unused, a producer
    // can opt in by omission again and ship whatever the finding message holds.
    identityComposedFinding(finding);
    expect(discriminationDisclosure(finding)).toEqual({
      class: "withheld",
      classification: "generated-evaluate-result",
    });
  });
});
