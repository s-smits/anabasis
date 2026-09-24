/**
 * The epoch reviewer's executing tool. The unit cases fix the mutation rule; the end-to-end case
 * runs the real check program in its confined child over a real candidate tree, because the whole
 * point of a probe is that it executes rather than reasons.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "../src/meta/json-shape.ts";
import {
  PROBE_BUDGET,
  emptyProbeState,
  missingFieldRefusal,
  probeBackedRows,
  probeTool,
  withReplacedField,
} from "../src/review/review-probe.ts";
import { runEpochReview } from "../src/review/epoch-reviewer.ts";
import type { ReaderTool } from "../src/review/review-reader.ts";
import { VerifierOperationalStop } from "../src/verify/verifier-lifetime.ts";
import { double } from "./helpers/doubles.ts";
import { uppercaseFixture } from "./helpers/uppercase-fixture.ts";

const trees: string[] = [];
afterAll(() => {
  for (const dir of trees) rmSync(dir, { recursive: true, force: true });
});

/** The uppercase candidate, with two accept controls whose artifacts carry one field the declared
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

describe("withReplacedField — one field of a known-correct artifact", () => {
  it("replaces an existing leaf and leaves the original artifact alone", () => {
    const artifact: JsonValue = { answer: "A", layout: { members: [{ area: 2 }, { area: 3 }] } };
    expect(withReplacedField(artifact, "$.layout.members[1].area", 0.5)).toEqual({
      answer: "A",
      layout: { members: [{ area: 2 }, { area: 0.5 }] },
    });
    expect(artifact).toEqual({ answer: "A", layout: { members: [{ area: 2 }, { area: 3 }] } });
    // The whole member, not a leaf inside it, is one field too.
    expect(withReplacedField(artifact, "$.layout.members[0]", null)).toEqual({
      answer: "A",
      layout: { members: [null, { area: 3 }] },
    });
  });

  it("reads the spelling the declared checks use, and no second one", () => {
    // A reviewer copies a path out of the check declarations it is reading. Under the bare dotted
    // grammar this file used to assert, every one of those came back as "not an existing field".
    const artifact: JsonValue = { answer: "A", layout: { members: [{ area: 2 }] } };
    expect(withReplacedField(artifact, "$.layout.members[0].area", 1)).toEqual({
      answer: "A",
      layout: { members: [{ area: 1 }] },
    });
    expect(withReplacedField(artifact, "layout.members.0.area", 1)).toBeNull();
    expect(withReplacedField(artifact, "$layout", 1)).toBeNull();
    expect(withReplacedField(artifact, "$.layout.members.0.area", 1)).toBeNull();
  });

  it("refuses a path the artifact does not already carry, so an absent check is never reported about an absent field", () => {
    const artifact: JsonValue = { answer: "A", layout: { members: [{ area: 2 }] } };
    expect(withReplacedField(artifact, "$.layout.members[9].area", 1)).toBeNull();
    expect(withReplacedField(artifact, "$.layout.thickness", 1)).toBeNull();
    expect(withReplacedField(artifact, "$.answer.inner", 1)).toBeNull();
    expect(withReplacedField(artifact, "$.layout..members", 1)).toBeNull();
    expect(withReplacedField(artifact, "$", 1)).toBeNull();
    expect(withReplacedField(artifact, "", 1)).toBeNull();
  });

  it("reaches one file of a file map through a quoted key, and only a file it already carries", () => {
    // Run 08c0f2: the declared checks read `$.firmware` whole, and every key holds a dot.
    const artifact: JsonValue = { firmware: { "fw_logic.cpp": "old", "src/a.h": "h" } };
    expect(withReplacedField(artifact, "$.firmware['fw_logic.cpp']", "new")).toEqual({
      firmware: { "fw_logic.cpp": "new", "src/a.h": "h" },
    });
    expect(withReplacedField(artifact, '$.firmware["src/a.h"]', "x")).toEqual({
      firmware: { "fw_logic.cpp": "old", "src/a.h": "x" },
    });
    expect(withReplacedField(artifact, "$.firmware.fw_logic.cpp", "new")).toBeNull();
    expect(withReplacedField(artifact, "$.firmware['main.cpp']", "new")).toBeNull();
    expect(withReplacedField(artifact, "$.firmware['']", "new")).toBeNull();
    expect(withReplacedField(artifact, "$.firmware['fw_logic.cpp'", "new")).toBeNull();
  });

  it("replaces a null leaf, which is a present field", () => {
    expect(withReplacedField({ note: null }, "$.note", "set")).toEqual({ note: "set" });
  });
});

describe("missingFieldRefusal — a refused path is refused for the reason that is true of it", () => {
  const fileMap: JsonValue = { files: { "firmware/config.h": "x", "build-report.json": "{}" } };

  it("names the grammar when the path is not a rooted path, instead of denying a field that exists", () => {
    // The spelling this tool used to take. The file is there; the path is simply not in the grammar.
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
    id,
    controlId: "c",
    taskId: "t",
    path: "p",
    value: "1",
    baseline,
    mutated,
    movedCheckIds: [],
    refused,
  });

  it("keeps only the cited probes that executed", () => {
    const state = emptyProbeState();
    state.rows.push(row(1, null), row(2, "budget"), row(3, null));
    expect(probeBackedRows(state, [3, 1, 1, 2, 9]).map((probe) => probe.id)).toEqual([1, 3]);
    expect(probeBackedRows(state, undefined)).toEqual([]);
    expect(probeBackedRows(state, "1")).toEqual([]);
  });

  // `runControls` records a timeout, a thrown check, an unknown task or a pending cleanup as an
  // ordinary receipt with outcome `non-result` and no blocking checks, and returns. A pair like
  // that is indistinguishable from "no check moved" by the moved ids alone, and the first
  // occurrence of an agent-side defect must not be admitted blocking on it.
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
      const moved = await run(probe.tool, "1", { controlId: "accept-a", path: "$.answer", value: '"a"' });
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
        state.rows.map((row) => ({ id: row.id, moved: row.movedCheckIds, refused: row.refused })),
      ).toEqual([
        { id: 1, moved: ["answer"], refused: null },
        { id: 2, moved: [], refused: null },
      ]);
      expect(state.rows[0]?.baseline).toEqual({ outcome: "pass", blockingCheckIds: [] });
      expect(state.rows[0]?.mutated).toEqual({ outcome: "fail", blockingCheckIds: ["answer"] });
    } finally {
      await probe.close(false);
    }
  }, 120_000);

  it("refuses an unknown control, an absent path, a non-JSON value and the probe past the budget", async () => {
    const dir = candidateTree();
    const state = emptyProbeState();
    const probe = probeTool(dir, join(dir, "probe-lifetime"), state);
    try {
      expect(
        text(await run(probe.tool, "1", { controlId: "reject-a", path: "$.answer", value: '"x"' })),
      ).toContain("no accept control is named reject-a");
      expect(
        text(await run(probe.tool, "2", { controlId: "accept-a", path: "$.invented", value: "1" })),
      ).toContain("is not an existing field of control accept-a");
      // The field is there; the spelling is not in the grammar, and the refusal says which.
      expect(
        text(await run(probe.tool, "2b", { controlId: "accept-a", path: "answer", value: '"x"' })),
      ).toContain("answer is not a rooted path");
      expect(
        text(await run(probe.tool, "3", { controlId: "accept-a", path: "$.answer", value: "not json" })),
      ).toContain("value must be JSON text");
      expect(text(await run(probe.tool, "4", { controlId: "accept-a", path: "", value: "1" }))).toContain(
        "controlId, path and value are all required",
      );
      // One file fits; a value past it is a redesigned artifact rather than one changed field.
      expect(
        text(
          await run(probe.tool, "4b", {
            controlId: "accept-a",
            path: "$.file",
            value: `"${"x".repeat(4_000)}"`,
          }),
        ),
      ).toContain("value must be at most 4000 characters");
      // A replacement equal to the value already there cannot move a verdict, so its silence would
      // be the emptiest possible evidence of an unobserved field.
      expect(
        text(await run(probe.tool, "5", { controlId: "accept-a", path: "$.answer", value: '"A"' })),
      ).toContain("already carries that value at $.answer");
      expect(state.rows).toEqual([]);
      expect(state.refused).toBe(7);

      for (let i = 0; i < PROBE_BUDGET; i += 1) {
        state.rows.push({
          id: i + 1,
          controlId: "c",
          taskId: "t",
          path: "p",
          value: "1",
          baseline: null,
          mutated: null,
          movedCheckIds: [],
          refused: null,
        });
      }
      expect(
        text(await run(probe.tool, "6", { controlId: "accept-a", path: "$.answer", value: '"x"' })),
      ).toContain(`a review runs at most ${PROBE_BUDGET} probes`);
    } finally {
      await probe.close(false);
    }
  }, 120_000);

  it("runs overlapping probes one at a time, so ids stay distinct and the budget holds", async () => {
    const dir = candidateTree();
    const state = emptyProbeState();
    for (let i = 0; i < PROBE_BUDGET - 2; i += 1) {
      state.rows.push({
        id: i + 1,
        controlId: "c",
        taskId: "t",
        path: "p",
        value: "1",
        baseline: null,
        mutated: null,
        movedCheckIds: [],
        refused: "held",
      });
    }
    const probe = probeTool(dir, join(dir, "probe-lifetime"), state);
    try {
      // Four calls issued together: each awaits the candidate load and the check run before it
      // records, which is where two unserialised probes once read the same row count.
      const replies = await Promise.all(
        ['"a"', '"b"', '"c"', '"d"'].map((value, index) =>
          run(probe.tool, String(index), { controlId: "accept-a", path: "$.answer", value }),
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
      await run(probe.tool, "1", { controlId: "accept-a", path: "$.answer", value: '"a"' });
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
        run(probe, "1", { controlId: "accept-a", path: "$.answer", value: '"a"' }).then(
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
        text(await run(probe.tool, "1", { controlId: "accept-a", path: "$.answer", value: '"x"' })),
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
