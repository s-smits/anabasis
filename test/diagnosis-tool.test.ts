/**
 * What a diagnosis may not say.
 *
 * A recorded diagnosis carries a cause, a first divergence and a falsifier, and attaches to an
 * issue the reader was actually offered. Naming a task in the battery, borrowing another
 * issue's contrast or inventing an intervention class are each refused rather than recorded,
 * because a fragment reaching the advicePacket is worse than no diagnosis at all.
 */
import { describe, expect, test } from "bun:test";
import { BEAMS, JOINTS, call, diagnosisSink, issue } from "./helpers/review-fixtures.ts";
import { recordDiagnosisTool } from "../src/review/diagnosis-reader.ts";

describe("the diagnosis tool refuses what a diagnosis may not say", () => {
  const good = {
    issueId: BEAMS.slice(0, 12),
    cause: "the writer cannot express a pinned joint",
    falsifier: "a beams task passes with one",
    firstDivergence: "the writer's second call omits the joint list",
    interventionClass: "tools-spec",
    confidence: "medium",
  };

  const quoted = new Map([[BEAMS, { samples: [good.firstDivergence], contrast: null }]]);

  test("a supported diagnosis is recorded once", async () => {
    const sink = diagnosisSink();
    const tool = recordDiagnosisTool([issue()], ["t1"], sink, quoted);
    expect(await call(tool, good)).toContain("recorded");
    expect(sink.diagnoses).toHaveLength(1);
    expect(await call(tool, good)).toContain("already diagnosed");
    expect(sink.refused).toBe(1);
  });

  test("a diagnosis cannot invent its boundary or borrow a contrast from another issue", async () => {
    const sink = diagnosisSink();
    const supplied = new Map([
      [BEAMS, { samples: [good.firstDivergence], contrast: null }],
      [JOINTS, { samples: ["the joint tool failed"], contrast: "the joint tool completed" }],
    ]);
    const tool = recordDiagnosisTool([issue()], [], sink, supplied);
    for (const firstDivergence of ["a plausible invented failure", "the joint tool failed"]) {
      expect(await call(tool, { ...good, firstDivergence })).toContain("supplied matching trace");
    }
    expect(await call(tool, { ...good, contrastSuccess: "the joint tool completed" })).toContain(
      "supplied passing trace",
    );
    expect(await call(tool, { ...good, confidence: "certain" })).toContain("confidence must");
    expect(sink.diagnoses).toHaveLength(0);
    expect(
      await call(tool, {
        issueId: good.issueId,
        abstainReason: "The supplied sample does not show whether the omitted tool call recovered.",
      }),
    ).toContain("abstained");
    expect(sink.abstentions).toHaveLength(1);
    expect(await call(tool, good)).toContain("explicitly declined");
  });

  test("an abstention resolves only its offered issue and cannot carry a second diagnosis", async () => {
    const sink = diagnosisSink();
    const tool = recordDiagnosisTool([issue()], [], sink, quoted);
    expect(await call(tool, { ...good, abstainReason: "Insufficient context" })).toContain("needs only");
    expect(
      await call(tool, { issueId: JOINTS.slice(0, 12), abstainReason: "Insufficient context" }),
    ).toContain("no offered issue");
    expect(sink.abstentions ?? []).toHaveLength(0);
    expect(await call(tool, good)).toContain("recorded");
  });

  test("an issue that was not offered is refused", async () => {
    const sink = diagnosisSink();
    expect(
      await call(recordDiagnosisTool([issue()], [], sink, quoted), { ...good, issueId: "0".repeat(12) }),
    ).toContain("no offered issue");
    expect(sink.diagnoses).toHaveLength(0);
  });

  test("overlong diagnosis fields are returned for shortening without recording a fragment", async () => {
    for (const [field, limit] of [
      ["cause", 700],
      ["falsifier", 400],
      ["firstDivergence", 500],
      ["contrastSuccess", 500],
    ] as const) {
      const sink = diagnosisSink();
      const supplied = new Map([
        [BEAMS, { samples: [good.firstDivergence, "x".repeat(limit)], contrast: "x".repeat(limit) }],
      ]);
      const tool = recordDiagnosisTool([issue()], [], sink, supplied);
      expect(await call(tool, { ...good, [field]: "x".repeat(limit + 1) })).toContain(
        `${field} exceeds ${limit}`,
      );
      expect(sink.diagnoses).toHaveLength(0);
      expect(await call(tool, { ...good, [field]: "x".repeat(limit) })).toContain("recorded");
      expect(sink.diagnoses[0]?.[field]).toBe("x".repeat(limit));
    }
  });

  test("a cause naming a task in the battery is refused", async () => {
    const sink = diagnosisSink();
    const text = await call(recordDiagnosisTool([issue()], ["beam-load-07"], sink, quoted), {
      ...good,
      cause: "beam-load-07 asks for a pinned joint",
    });
    expect(text).toContain("may not name an individual task");
    expect(sink.diagnoses).toHaveLength(0);
  });

  test("a cause without a falsifier is refused", async () => {
    const sink = diagnosisSink();
    expect(
      await call(recordDiagnosisTool([issue()], [], sink, quoted), { ...good, falsifier: "  " }),
    ).toContain("both cause and falsifier");
  });

  test("a cause with no first divergence is refused: it would restate the counts", async () => {
    const sink = diagnosisSink();
    expect(
      await call(recordDiagnosisTool([issue()], [], sink, quoted), { ...good, firstDivergence: " " }),
    ).toContain("firstDivergence is required");
    expect(sink.diagnoses).toHaveLength(0);
  });

  test("an invented intervention class is refused rather than recorded as advice", async () => {
    const sink = diagnosisSink();
    expect(
      await call(recordDiagnosisTool([issue()], [], sink, quoted), {
        ...good,
        interventionClass: "the-verifier",
      }),
    ).toContain("interventionClass");
    expect(sink.diagnoses).toHaveLength(0);
  });

  test("a family with no passing case records a null contrast rather than an invented one", async () => {
    const sink = diagnosisSink();
    await call(recordDiagnosisTool([issue()], [], sink, quoted), good);
    expect(sink.diagnoses[0]?.contrastSuccess).toBeNull();
    expect(sink.diagnoses[0]?.confidence).toBe("medium");
    expect(sink.diagnoses[0]?.interventionClass).toBe("tools-spec");
  });

  test("a task named in the first divergence or the contrast is refused too", async () => {
    for (const field of ["firstDivergence", "contrastSuccess"]) {
      const sink = diagnosisSink();
      const text = await call(recordDiagnosisTool([issue()], ["beam-load-07"], sink, quoted), {
        ...good,
        [field]: "beam-load-07 diverges here",
      });
      expect(text).toContain("may not name an individual task");
      expect(sink.diagnoses).toHaveLength(0);
    }
  });
});
