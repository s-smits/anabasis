import { afterEach, describe, expect, it } from "bun:test";
import {
  compareArchives,
  laneArchives,
  laneKey,
  orderKey,
  renderRecurrence,
  // @ts-expect-error plain-JS skill script without type declarations
} from "../.claude/skills/whole-run-investigation/scripts/finding-recurrence.mjs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function archive(
  root: string,
  name: string,
  runId: string,
  sourceRevision: string,
  states: Record<number, string>,
): void {
  mkdirSync(join(root, name), { recursive: true });
  const angleStates = Object.entries(states).map(([angle, state]) => ({
    angle: Number(angle),
    state,
    session: `angle_${angle}`,
    reason: "protected reason text",
  }));
  writeFileSync(
    join(root, name, "review.json"),
    JSON.stringify({ schema: "wri-archive/v1", identity: { runId, sourceRevision }, angleStates }),
  );
}

describe("finding recurrence across archives", () => {
  it("orders a lane from run ids and classifies recurring, cleared, dropped and re-emerged findings", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-recurrence-"));
    dirs.push(root);
    archive(root, "one", "truss-opus-20260906T100000Z-aaaaaa", "rev1", {
      5: "fail",
      8: "risk",
      9: "risk",
      16: "risk",
      3: "pass",
    });
    archive(root, "two", "truss-opus-20260907T100000000Z-bbbbbb", "rev2", {
      5: "fail",
      8: "risk",
      9: "pass",
      16: "risk",
      3: "risk",
    });
    archive(root, "now", "truss-opus-20260908T100000000Z-cccccc", "rev2", {
      5: "risk",
      8: "pass",
      9: "risk",
      16: "N/A",
      3: "pass",
    });
    archive(root, "other-lane", "truss-sol-20260908T100000000Z-dddddd", "rev2", { 5: "fail" });
    archive(root, "unordered", "truss-opus-run7", "rev0", { 5: "fail" });

    expect(laneKey("truss-opus-20260907T210000000Z-6bf0e9")).toBe("truss-opus");
    expect(laneKey("run52-opus-0903")).toBe("opus");
    expect(orderKey("truss-run6-opus-0902")).toBe("20260902T000000000-0006");
    expect(orderKey("truss-opus-run7")).toBeNull();
    expect(orderKey("truss-opus-20260912-0400")).toBe("20260912T040000000");
    expect(orderKey("truss-opus-20260911T141600Z-5b1c93")).toBe("20260911T141600000");
    expect(orderKey("truss-opus-20260911T205808589Z-2c6a15")).toBe("20260911T205808589");
    expect(orderKey("truss-opus-20260911T1416000Z-5b1c93")).toBeNull();

    const lane = laneArchives(root, "truss-opus");
    expect(lane.map((entry: { runId: string }) => entry.runId).sort()).toEqual([
      "truss-opus-20260906T100000Z-aaaaaa",
      "truss-opus-20260907T100000000Z-bbbbbb",
      "truss-opus-20260908T100000000Z-cccccc",
      "truss-opus-run7",
    ]);
    const current = lane.find((entry: { runId: string }) => entry.runId.endsWith("cccccc"));
    const report = compareArchives(
      current,
      lane.filter((entry: { runId: string }) => entry !== current),
    );
    expect(report.previous.map((entry: { runId: string }) => entry.runId)).toEqual([
      "truss-opus-20260906T100000Z-aaaaaa",
      "truss-opus-20260907T100000000Z-bbbbbb",
    ]);
    expect(report.unordered).toHaveLength(1);
    const byAngle = Object.fromEntries(report.angles.map((row: { angle: number }) => [row.angle, row]));
    expect(byAngle[5]).toMatchObject({
      classification: "recurring",
      streak: 3,
      lifetimeFindings: 3,
      sourceChanged: false,
    });
    expect(byAngle[8]).toMatchObject({ classification: "cleared", sourceChanged: false });
    expect(byAngle[9]).toMatchObject({ classification: "re-emerged", lifetimeFindings: 2 });
    expect(byAngle[16]).toMatchObject({ classification: "dropped-unreviewed" });
    expect(byAngle[3]).toMatchObject({ classification: "cleared", sourceChanged: false });
    expect(report.triggers).toEqual([
      "CLEARED WITHOUT SOURCE CHANGE (angle 25 trigger): angle 3 read risk on truss-opus-20260907T100000000Z-bbbbbb and pass now on the same source",
      "RECURRING FINDING (angle 25 trigger): angle 5 reads risk for the 3rd consecutive review (truss-opus-20260908T100000000Z-cccccc, truss-opus-20260907T100000000Z-bbbbbb, truss-opus-20260906T100000Z-aaaaaa)",
      "CLEARED WITHOUT SOURCE CHANGE (angle 25 trigger): angle 8 read risk on truss-opus-20260907T100000000Z-bbbbbb and pass now on the same source",
      "FINDING DROPPED UNREVIEWED: angle 16 read risk on truss-opus-20260907T100000000Z-bbbbbb and N/A now",
    ]);
    const text = renderRecurrence(report);
    expect(text).toContain(
      "angle  5: recurring          now risk         before fail ← fail · findings 3/3 · same source",
    );
    expect(text).not.toContain("protected reason text");
  });

  it("reads no-opportunity when the lane has no earlier ordered archive and no trigger on a quiet lane", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-recurrence-"));
    dirs.push(root);
    archive(root, "first", "truss-sol-20260908T100000000Z-eeeeee", "rev1", { 5: "risk" });
    const only = laneArchives(root, "truss-sol")[0];
    const alone = compareArchives(only, []);
    expect(alone.angles[0]).toMatchObject({ classification: "new", sourceChanged: null });
    expect(renderRecurrence(alone)).toContain(
      "no earlier ordered archive in this lane — recurrence unobservable; angle 25 reads no-opportunity",
    );

    archive(root, "second", "truss-sol-20260909T100000000Z-ffffff", "rev2", { 5: "risk" });
    const lane = laneArchives(root, "truss-sol");
    const current = lane.find((entry: { runId: string }) => entry.runId.endsWith("ffffff"));
    const report = compareArchives(current, [only]);
    expect(report.angles[0]).toMatchObject({ classification: "recurring", streak: 2, sourceChanged: true });
    expect(renderRecurrence(report)).toContain("angle 25: no trigger");
  });
});
