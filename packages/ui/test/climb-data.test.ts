import { expect, test } from "bun:test";
import { climbPoints } from "../src/views/climb-data.js";

test("climb preserves chronology and missing scores without borrowing other denominators", () => {
  const battery = (runId: string, createdAt: string | null, verified: number) => ({
    runId,
    claim: { createdAt, taskSetHash: "tasks", agentHash: "agent", correctnessModelHash: "truth" },
    identity: {
      backendPins: ["model"],
      builderIds: [],
      buildInputsHashes: [],
      slugs: [],
      variants: [],
      isolationStrengths: {},
      isolationUnproven: 0,
    },
    cases: {
      total: verified + 5,
      verified,
      passed: verified / 2,
      failed: verified / 2,
      unaccepted: 3,
      nonResults: { total: 2, byKind: { provider: 2 }, environmentOwnedKinds: ["provider"] },
    },
  });
  const points = climbPoints([
    battery("last", "2026-09-02", 10),
    battery("undated", null, 20),
    battery("first", "2026-09-01", 0),
  ]);
  expect(points.map((p) => p.id)).toEqual(["first", "last"]);
  expect(points.map((p) => p.rate)).toEqual([null, 0.5]);
  expect(points[1]).toMatchObject({ passed: 5, verified: 10, unaccepted: 3, nonResults: 2 });
});
