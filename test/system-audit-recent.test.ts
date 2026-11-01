/**
 * The system audit's inventory reads each campaign as a snapshot a report can cite, and orders the
 * campaigns by their last event, read from a log's tail. These tests read temporary logs only.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { lastAt, snapshotOf } from "#skills/system-audit/scripts/recent.ts";
import { sha256 } from "../src/meta/digest.ts";
import { mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { capturedJsonStringify } from "../src/meta/json-runtime.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const root = mkdtempSync(join(tmpdir(), "ana-recent-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const line = (at: string, kind: string, data: JsonObject = {}) =>
  `${capturedJsonStringify({ at, kind, data })}\n`;
const logOf = (name: string, text: string) => {
  const path = join(root, `${name}.jsonl`);
  writeFileSync(path, text);
  return path;
};
const opened = line("2026-10-30T10:00:00.000Z", "campaign.opened");
const turns = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    line(`2026-10-30T11:00:${String(index).padStart(2, "0")}.000Z`, "exam.turn"),
  ).join("");

describe("the recent campaigns", () => {
  it("cites a campaign by the whole lines read, leaving a torn append out of the count and the hash", () => {
    const whole = opened + turns(3);
    const path = logOf("torn", `${whole}{"at":"2026-10-30T12:00`);
    expect(snapshotOf("torn", "here", path, 1)).toMatchObject({
      events: 4,
      lastAt: "2026-10-30T11:00:02.000Z",
      lastKind: "exam.turn",
      sha256: sha256(whole),
      commits: [],
    });
    expect(lastAt(path)).toBe("2026-10-30T11:00:02.000Z");
  });

  it("leaves out a log that opens no campaign, and a launch that ended before it did any work", () => {
    const study = logOf("study", line("2026-10-30T10:00:00.000Z", "solve.started") + turns(60));
    const dead = logOf("dead", opened + turns(10));
    expect(snapshotOf("study", "here", study, 50)).toBeNull();
    expect(snapshotOf("dead", "here", dead, 50)).toBeNull();
    expect(snapshotOf("dead", "here", dead, 5)).not.toBeNull();
  });

  it("reads the last event from the tail, and from the whole log where that event outgrows the tail", () => {
    const long = line("2026-10-30T13:00:00.000Z", "solve.finished", { trace: "x".repeat(1 << 17) });
    expect(lastAt(logOf("long", opened + turns(2) + long))).toBe("2026-10-30T13:00:00.000Z");
    expect(lastAt(logOf("big", "x".repeat(1 << 17) + "\n" + turns(2)))).toBe("2026-10-30T11:00:01.000Z");
  });
});
