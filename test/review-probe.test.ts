/**
 * The epoch reviewer's executing tool. The unit cases fix the mutation rule; the end-to-end cases
 * run the real check program in its confined child over a real candidate tree, because the whole
 * point of a probe is that it executes rather than reasons.
 *
 * A probe changes one field. Where that field is a source file, a second reading of a public rule
 * is one passage inside it, so the probe also takes an exact edit of a text leaf: the reading a
 * reviewer wants to test is written as code, and retyping a sketch of several thousand characters
 * to change one line is a probe nobody runs.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "../src/meta/json-shape.ts";
import {
  PROBE_BUDGET,
  type ReviewProbeRow,
  editedPassage,
  emptyProbeState,
  missingFieldRefusal,
  probeBackedRows,
  probeTool,
  withReplacedField,
} from "../src/review/review-probe.ts";
import { EPOCH_REVIEW_PROMPT } from "../src/review/epoch-review-prompt.ts";
import { runEpochReview } from "../src/review/epoch-reviewer.ts";
import type { ReaderTool } from "../src/review/review-reader.ts";
import { VerifierOperationalStop } from "../src/verify/verifier-lifetime.ts";
import { double } from "./helpers/doubles.ts";
import { uppercaseFixture } from "./helpers/uppercase-fixture.ts";

/** The one field the uppercase candidate's declared check reads. */
const ANSWER = "$.answer";
/** Why an edit that names no single passage of a text leaf is refused. */
const NO_PASSAGE = "it already carries that value, or find does not occur exactly once in text there";

const trees: string[] = [];
afterAll(() => {
  for (const dir of trees) rmSync(dir, { recursive: true, force: true });
});

/** A provenance note longer than any replacement value may be, holding one phrase once, so the
 *  only way to change that phrase is an edit. */
const LONG_NOTE = `${"x".repeat(6_000)} looked it up`;

/** The uppercase candidate, with accept controls whose artifacts carry one field the declared
 *  check reads and one it does not. That second field is the case a reading reviewer cannot
 *  settle: nothing in the source says out loud that no check observes it. */
function candidateTree(): string {
  const dir = mkdtempSync(join(import.meta.dir, ".ana-scratch-review-probe-"));
  trees.push(dir);
  uppercaseFixture(dir);
  writeFileSync(
    join(dir, "correctness-model/controls.json"),
    JSON.stringify({
      accept: [
        { id: "accept-a", taskId: "t0", artifact: { answer: "A", provenance: { method: "looked it up" } } },
        { id: "accept-b", taskId: "t1", artifact: { answer: "AB", provenance: { method: "looked it up" } } },
        { id: "accept-c", taskId: "t2", artifact: { answer: "C", provenance: { method: LONG_NOTE } } },
      ],
      reject: [
        {
          id: "reject-a",
          taskId: "t0",
          artifact: { answer: "" },
          mutationClass: "hollow",
          expectedCheckId: "answer",
        },
      ],
    }),
  );
  return dir;
}

const text = (result: AgentToolResult<null>) =>
  result.content.map((row) => (row.type === "text" ? row.text : "")).join("\n");

/** One reader-tool call with the arguments a model would send; pi validates them in production. */
const run = (tool: ReaderTool, toolCallId: string, args: Record<string, JsonValue>) =>
  tool.execute(toolCallId, double<never>(args));

/** A recorded row, for the cases that only need the state to hold one. */
const heldRow = (id: number, refused: string | null): ReviewProbeRow => ({
  id,
  controlId: "c",
  taskId: "t",
  path: "p",
  change: { value: "1" },
  baseline: null,
  mutated: null,
  movedCheckIds: [],
  refused,
});

describe("withReplacedField — one field of a known-correct artifact", () => {
  it("replaces an existing leaf, or a whole member, and leaves the original artifact alone", () => {
    const artifact: JsonValue = { answer: "A", layout: { members: [{ area: 2 }, { area: 3 }] } };
    expect(withReplacedField(artifact, "$.layout.members[1].area", 0.5)).toEqual({
      answer: "A",
      layout: { members: [{ area: 2 }, { area: 0.5 }] },
    });
    expect(withReplacedField(artifact, "$.layout.members[0]", null)).toEqual({
      answer: "A",
      layout: { members: [null, { area: 3 }] },
    });
    expect(artifact).toEqual({ answer: "A", layout: { members: [{ area: 2 }, { area: 3 }] } });
    expect(withReplacedField({ note: null }, "$.note", "set")).toEqual({ note: "set" });
  });

  it("reads the spelling the declared checks use, and only a field the artifact already carries", () => {
    // A reviewer copies a path out of the check declarations it is reading. A probe that added a
    // field would report "no check reads it" about something the artifact never carried.
    const artifact: JsonValue = { answer: "A", layout: { members: [{ area: 2 }] } };
    for (const path of [
      "layout.members.0.area",
      "$layout",
      "$.layout.members.0.area",
      "$.layout.members[9].area",
      "$.layout.thickness",
      "$.answer.inner",
      "$.layout..members",
      "$",
      "",
    ]) {
      expect(withReplacedField(artifact, path, 1)).toBeNull();
    }
  });

  it("reaches one file of a file map through a quoted key, and only a file it already carries", () => {
    // The declared checks read `$.firmware` whole, and every key holds a dot.
    const artifact: JsonValue = { firmware: { "fw_logic.cpp": "old", "src/a.h": "h" } };
    expect(withReplacedField(artifact, "$.firmware['fw_logic.cpp']", "new")).toEqual({
      firmware: { "fw_logic.cpp": "new", "src/a.h": "h" },
    });
    expect(withReplacedField(artifact, '$.firmware["src/a.h"]', "x")).toEqual({
      firmware: { "fw_logic.cpp": "old", "src/a.h": "x" },
    });
    for (const path of [
      "$.firmware.fw_logic.cpp",
      "$.firmware['main.cpp']",
      "$.firmware['']",
      "$.firmware['fw_logic.cpp'",
    ]) {
      expect(withReplacedField(artifact, path, "new")).toBeNull();
    }
  });
});

describe("editedPassage — one passage of a text leaf", () => {
  // The recorded shape: a whole Arduino sketch is the one field, over six thousand characters, and
  // the two readings of the alarm-hysteresis rule differ in the line that anchors the hold.
  const sketch = [
    "static uint8_t alarmState = 0;",
    "static unsigned long alarmRaised = 0;",
    "x".repeat(6_000),
    "if (armed) { if (!alarmState) alarmRaised = now; alarmState = 1; }",
    "if (alarmState && (now - alarmRaised >= ALARM_HOLD_MS)) { alarmState = 0; }",
  ].join("\n");
  const SKETCH = "$.firmware['fw.ino']";
  const edit = (source: string, find: string, replace: string) =>
    editedPassage({ firmware: { "fw.ino": source } }, SKETCH, { find, replace });

  it("changes the one occurrence and keeps every other byte", () => {
    expect(
      edit(sketch, "if (!alarmState) alarmRaised = now;", "if (armed && !wasArmed) alarmRaised = now;"),
    ).toBe(
      sketch.replace(
        "if (!alarmState) alarmRaised = now;",
        () => "if (armed && !wasArmed) alarmRaised = now;",
      ),
    );
    // Deleting a passage is an edit too.
    expect(edit("a; b; c;", " b;", "")).toBe("a; c;");
  });

  it("writes the replacement literally, so code holding a dollar sign is not read as a pattern", () => {
    expect(edit("price = 1;", "1", "$& + $1")).toBe("price = $& + $1;");
  });

  it("leaves the leaf as it was unless it is text holding find exactly once, overlapping occurrences counted", () => {
    for (const [source, find] of [
      [sketch, "alarmFired"],
      [sketch, "alarmRaised"],
      ["aaa", "aa"],
    ] as const) {
      expect(edit(source, find, "x")).toBe(source);
    }
    expect(editedPassage({ limit: 10 }, "$.limit", { find: "1", replace: "2" })).toBe(10);
  });
});

describe("missingFieldRefusal — a refused path is refused for the reason that is true of it", () => {
  const fileMap: JsonValue = { files: { "firmware/config.h": "x", "build-report.json": "{}" } };

  it("names the grammar when the path is not a rooted path, instead of denying a field that exists", () => {
    const why = missingFieldRefusal(fileMap, "files.firmware/config.h", "accept-a");
    expect(why).toContain("files.firmware/config.h is not a rooted path");
    expect(why).toContain("$.files['src/main.cpp']");
    expect(why).not.toContain("not an existing field");
  });

  it("offers the quoted spelling when an unquoted dot split a key the artifact carries", () => {
    const artifact: JsonValue = { firmware: { "design.json": "{}", "fw_config.h": "" } };
    const why = missingFieldRefusal(artifact, "$.firmware.design.json", "accept-a");
    expect(why).toContain("$.firmware.design.json is not an existing field of control accept-a");
    expect(why).toContain("$.firmware['design.json']");
    expect(withReplacedField(artifact, "$.firmware['design.json']", "[]")).not.toBeNull();
  });

  it("says what the deepest present step carries, and suggests nothing for a key that is absent", () => {
    const absent = missingFieldRefusal(fileMap, "$.files['main.cpp']", "accept-a");
    expect(absent).toContain("$.files['main.cpp'] is not an existing field of control accept-a");
    expect(absent).toContain("$.files carries firmware/config.h, build-report.json");
    expect(absent).not.toContain("is quoted, as in");
    const artifact: JsonValue = { layout: { members: [{ area: 2 }] }, answer: "A" };
    expect(missingFieldRefusal(artifact, "$.layout.members[9].area", "c")).toContain(
      "$.layout.members holds 1 element",
    );
    expect(missingFieldRefusal(artifact, "$.answer.inner", "c")).toContain("$.answer is a leaf");
  });
});

describe("probeBackedRows — a finding rests on results, not on requests", () => {
  const side = (outcome: "pass" | "fail" | "non-result") => ({ outcome, blockingCheckIds: [] });
  const row = (id: number, refused: string | null, baseline = side("pass"), mutated = side("fail")) => ({
    ...heldRow(id, refused),
    baseline,
    mutated,
  });

  it("keeps only the cited probes that executed", () => {
    const state = emptyProbeState();
    state.rows.push(row(1, null), row(2, "budget"), row(3, null));
    expect(probeBackedRows(state, [3, 1, 1, 2, 9]).map((probe) => probe.id)).toEqual([1, 3]);
    expect(probeBackedRows(state, undefined)).toEqual([]);
    expect(probeBackedRows(state, "1")).toEqual([]);
  });

  // `runControls` records a timeout, a thrown check, an unknown task or a pending cleanup as an
  // ordinary receipt with outcome `non-result` and no blocking checks. A pair like that is
  // indistinguishable from "no check moved" by the moved ids alone, and the first occurrence of an
  // agent-side defect must not be admitted blocking on it.
  it("refuses a pair that returned without deciding, and one whose original never passed", () => {
    const state = emptyProbeState();
    state.rows.push(
      row(1, null, side("pass"), side("non-result")),
      row(2, null, side("non-result"), side("pass")),
      row(3, null, side("fail"), side("fail")),
      row(4, null),
    );
    expect(probeBackedRows(state, [1, 2, 3, 4]).map((probe) => probe.id)).toEqual([4]);
  });
});

describe("probe_check — the candidate's own checks over one changed field", () => {
  it("names the checks a changed field moves, and reports the silence when none does", async () => {
    const dir = candidateTree();
    const state = emptyProbeState();
    const probe = probeTool(dir, join(dir, "probe-lifetime"), state);
    try {
      const moved = await run(probe.tool, "1", { controlId: "accept-a", path: ANSWER, value: '"a"' });
      expect(text(moved)).toContain("original: pass");
      expect(text(moved)).toContain("changed: fail");
      expect(text(moved)).toContain("1 declared check(s) moved: answer");

      const silent = await run(probe.tool, "2", {
        controlId: "accept-a",
        path: "$.provenance.method",
        value: '"guessed"',
      });
      expect(text(silent)).toContain("no declared check changed its verdict for this replacement");
      // `mass <= maxMass` reads `mass` and accepts 8 and 9 alike against a limit of 10. The host
      // reports the verdicts and refuses to draw non-observation from them.
      expect(text(silent)).toContain("does not show $.provenance.method is unobserved");
      expect(text(silent)).not.toContain("inconclusive");

      expect(
        state.rows.map((row) => ({
          id: row.id,
          change: row.change,
          moved: row.movedCheckIds,
          refused: row.refused,
        })),
      ).toEqual([
        { id: 1, change: { value: '"a"' }, moved: ["answer"], refused: null },
        { id: 2, change: { value: '"guessed"' }, moved: [], refused: null },
      ]);
      expect(state.rows[0]?.baseline).toEqual({ outcome: "pass", blockingCheckIds: [] });
      expect(state.rows[0]?.mutated).toEqual({ outcome: "fail", blockingCheckIds: ["answer"] });
    } finally {
      await probe.close(false);
    }
  }, 120_000);

  it("edits one passage of a text leaf, however long the leaf, and records the edit it ran", async () => {
    const dir = candidateTree();
    const state = emptyProbeState();
    const probe = probeTool(dir, join(dir, "probe-lifetime"), state);
    try {
      const moved = await run(probe.tool, "1", {
        controlId: "accept-b",
        path: ANSWER,
        find: "B",
        replace: "b",
      });
      expect(text(moved)).toContain("$.answer edited");
      expect(text(moved)).toContain("1 declared check(s) moved: answer");

      // Past the ceiling a whole replacement value may reach, which is where the edit is needed.
      const silent = await run(probe.tool, "2", {
        controlId: "accept-c",
        path: "$.provenance.method",
        find: "looked it up",
        replace: "guessed",
      });
      expect(text(silent)).toContain("$.provenance.method edited");
      expect(text(silent)).toContain("no declared check changed its verdict");
      // The reply names the edit without echoing the leaf back.
      expect(text(silent).length).toBeLessThan(1_500);

      expect(state.rows.map((row) => ({ change: row.change, moved: row.movedCheckIds }))).toEqual([
        { change: { find: "B", replace: "b" }, moved: ["answer"] },
        { change: { find: "looked it up", replace: "guessed" }, moved: [] },
      ]);
      // An executed edit backs a finding exactly as a replaced value does.
      expect(probeBackedRows(state, [1, 2]).map((row) => row.id)).toEqual([1, 2]);
    } finally {
      await probe.close(false);
    }
  }, 120_000);

  it("refuses an unknown control, an absent path, a malformed change and the probe past the budget", async () => {
    const dir = candidateTree();
    const state = emptyProbeState();
    const probe = probeTool(dir, join(dir, "probe-lifetime"), state);
    const refusal = async (id: string, args: Record<string, JsonValue>) =>
      text(await run(probe.tool, id, args));
    try {
      expect(await refusal("1", { controlId: "reject-a", path: ANSWER, value: '"x"' })).toContain(
        "no accept control is named reject-a",
      );
      expect(await refusal("2", { controlId: "accept-a", path: "$.invented", value: "1" })).toContain(
        "is not an existing field of control accept-a",
      );
      // The field is there; the spelling is not in the grammar, and the refusal says which.
      expect(await refusal("3", { controlId: "accept-a", path: "answer", value: '"x"' })).toContain(
        "answer is not a rooted path",
      );
      expect(await refusal("4", { controlId: "accept-a", path: ANSWER, value: "not json" })).toContain(
        "value must be JSON text",
      );
      // A value past the ceiling is a redesigned artifact rather than one changed field, and the
      // refusal names the edit that changes one passage of a long text instead.
      const long = await refusal("5", {
        controlId: "accept-a",
        path: "$.provenance.method",
        value: `"${"x".repeat(4_000)}"`,
      });
      expect(long).toContain("value, find and replace must each be at most 4000 characters");
      expect(long).toContain("change one passage of a long text with find and replace");
      // A change equal to what is already there cannot move a verdict, so its silence would be the
      // emptiest possible evidence of an unobserved field.
      expect(await refusal("6", { controlId: "accept-a", path: ANSWER, value: '"A"' })).toContain(
        "control accept-a is unchanged at $.answer: it already carries that value",
      );
      expect(state.refused).toBe(6);

      // The change is a value or an edit, never both and never neither.
      expect(await refusal("7", { controlId: "accept-a", path: "", value: "1" })).toContain(
        "controlId and path are required, with either value or find and replace",
      );
      expect(await refusal("8", { controlId: "accept-a", path: ANSWER })).toContain(
        "controlId and path are required, with either value or find and replace",
      );
      expect(
        await refusal("9", {
          controlId: "accept-a",
          path: ANSWER,
          value: '"a"',
          find: "A",
          replace: "a",
        }),
      ).toContain("with either value or find and replace, not both");
      // A replace beside a value is refused, not ignored; a replace with no find is an edit whose empty
      // find does not occur exactly once in a text that holds anything.
      expect(
        await refusal("10", { controlId: "accept-a", path: ANSWER, value: '"a"', replace: "a" }),
      ).toContain("with either value or find and replace, not both");
      expect(await refusal("11", { controlId: "accept-a", path: ANSWER, replace: "a" })).toContain(
        `unchanged at $.answer: ${NO_PASSAGE}`,
      );
      expect(
        await refusal("12", {
          controlId: "accept-a",
          path: ANSWER,
          find: "A".repeat(4_001),
          replace: "a",
        }),
      ).toContain("value, find and replace must each be at most 4000 characters");
      // An edit reaches one passage of one text leaf, found exactly once; anything else leaves the
      // artifact as it was, and is refused as a change that changes nothing.
      expect(
        await refusal("13", { controlId: "accept-a", path: "$.provenance", find: "up", replace: "x" }),
      ).toContain(`unchanged at $.provenance: ${NO_PASSAGE}`);
      expect(
        await refusal("14", {
          controlId: "accept-a",
          path: "$.provenance.method",
          find: "guessed",
          replace: "x",
        }),
      ).toContain(`unchanged at $.provenance.method: ${NO_PASSAGE}`);
      expect(
        await refusal("15", { controlId: "accept-c", path: "$.provenance.method", find: "xx", replace: "y" }),
      ).toContain(`unchanged at $.provenance.method: ${NO_PASSAGE}`);
      expect(
        await refusal("16", { controlId: "accept-a", path: "$.invented", find: "a", replace: "b" }),
      ).toContain("is not an existing field of control accept-a");
      expect(await refusal("17", { controlId: "accept-a", path: ANSWER, find: "A", replace: "A" })).toContain(
        "unchanged at $.answer",
      );
      expect(state.rows).toEqual([]);
      expect(state.refused).toBe(17);

      for (let i = 0; i < PROBE_BUDGET; i += 1) state.rows.push(heldRow(i + 1, null));
      expect(await refusal("18", { controlId: "accept-a", path: ANSWER, value: '"x"' })).toContain(
        `a review runs at most ${PROBE_BUDGET} probes`,
      );
    } finally {
      await probe.close(false);
    }
  }, 120_000);

  it("runs overlapping probes one at a time, so ids stay distinct and the budget holds", async () => {
    const dir = candidateTree();
    const state = emptyProbeState();
    for (let i = 0; i < PROBE_BUDGET - 2; i += 1) state.rows.push(heldRow(i + 1, "held"));
    const probe = probeTool(dir, join(dir, "probe-lifetime"), state);
    try {
      // Four calls issued together: each awaits the candidate load and the check run before it
      // records, which is where two unserialised probes once read the same row count.
      const replies = await Promise.all(
        ['"a"', '"b"', '"c"', '"d"'].map((value, index) =>
          run(probe.tool, String(index), { controlId: "accept-a", path: ANSWER, value }),
        ),
      );
      expect(state.rows.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(replies.filter((reply) => text(reply).includes(`at most ${PROBE_BUDGET} probes`))).toHaveLength(
        2,
      );
      expect(state.rows.slice(-2).map((row) => row.refused)).toEqual([null, null]);
    } finally {
      await probe.close(false);
    }
  }, 120_000);

  it("reports unresolved verifier cleanup after a successful probe unless a primary failure is propagating", async () => {
    for (const failed of [false, true]) {
      const dir = candidateTree();
      const lifetimeRoot = join(dir, "probe-lifetime");
      // An unreadable receipt left by an earlier owner is unresolved cleanup from the start.
      mkdirSync(join(lifetimeRoot, "stale-receipt"), { recursive: true });
      const probe = probeTool(dir, lifetimeRoot, emptyProbeState());
      await run(probe.tool, "1", { controlId: "accept-a", path: ANSWER, value: '"a"' });
      if (failed) await probe.close(true);
      else await expect(probe.close(false)).rejects.toBeInstanceOf(VerifierOperationalStop);
    }
  }, 120_000);

  it("settles the probe lifetime before a review's reader failure propagates", async () => {
    const dir = candidateTree();
    let settled = false;
    const review = {
      enabled: true,
      kind: "codex",
      model: "gpt-6-astra",
      reasoningEffort: "low",
      source: "operator",
    } as const;
    const outcome = runEpochReview({
      repoRoot: dir,
      slug: "probe",
      runId: "r1",
      treeRoot: ".",
      analysis: null,
      priorAdvice: null,
      publicRequest: null,
      review,
      readerTurn: async ({ tools }) => {
        const probe = tools.find((tool) => tool.name === "probe_check")!;
        run(probe, "1", { controlId: "accept-a", path: ANSWER, value: '"a"' }).then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );
        throw new Error("provider budget denied");
      },
    });
    // The reader's own failure keeps its identity, and the review does not return while its probe
    // and the lifetime it opened are still running.
    await expect(outcome).rejects.toThrow("provider budget denied");
    expect(settled).toBe(true);
  }, 120_000);

  it("records a candidate it cannot load as a refused row rather than throwing the review away", async () => {
    const dir = mkdtempSync(join(import.meta.dir, ".ana-scratch-review-probe-empty-"));
    trees.push(dir);
    const state = emptyProbeState();
    const probe = probeTool(dir, join(dir, "probe-lifetime"), state);
    try {
      expect(
        text(await run(probe.tool, "1", { controlId: "accept-a", path: ANSWER, value: '"x"' })),
      ).toContain("probe 1 did not run:");
      expect(state.rows[0]?.refused).toContain("correctness model could not be loaded");
      // The load is attempted once per review, so the refusal says every later probe fails the same
      // way rather than letting the reader spend its budget finding that out.
      expect(state.rows[0]?.refused).toContain("no probe can run in this review");
      expect(probeBackedRows(state, [1])).toEqual([]);
    } finally {
      await probe.close(false);
    }
  }, 60_000);
});

describe("what the reviewer is told a probe can reach", () => {
  it("the tool contract offers the edit as the alternative to a value", () => {
    const dir = candidateTree();
    const { tool } = probeTool(dir, join(dir, "probe-lifetime"), emptyProbeState());
    const contract = JSON.stringify(tool.parameters);
    expect(contract).toContain('"required":["controlId","path"]');
    expect(contract).toContain('"find"');
    expect(contract).toContain('"replace"');
    expect(tool.description).toContain("send `find` and `replace` in place of `value`");
    expect(tool.description).toContain("`find` must occur exactly once in that leaf");
  });

  // The measured review of the only battery that landed on the aim settled a rule with two
  // readings from source alone: "the probe I wanted — the reference sketch with only the hold
  // anchor changed — was refused", because the one field was the whole sketch. Every accept control
  // followed the reference reading, so no control could separate the two either.
  it("the prompt names the edit, and where a second reading is worth a probe", () => {
    expect(EPOCH_REVIEW_PROMPT).toContain("send `find` and `replace` in place of `value`");
    expect(EPOCH_REVIEW_PROMPT).toContain(
      "a public rule that states a boundary or an anchor — a threshold, a tolerance, a hold, the instant a duration counts from",
    );
    expect(EPOCH_REVIEW_PROMPT).toContain("the control census cannot tell a second reading from the first");
    // Stated once, in the probe paragraph, which already owns the two-readings duty.
    expect(EPOCH_REVIEW_PROMPT.split("two readings of a requirement").length - 1).toBe(1);
    expect(EPOCH_REVIEW_PROMPT.split("`find`").length - 1).toBe(2);
  });
});
