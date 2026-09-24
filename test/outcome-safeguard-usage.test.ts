import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import {
  SAFEGUARD_INVENTORY,
  createSafeguardContext,
  safeguardLogDir,
  safeguardLogFile,
  safeguardTriggered,
} from "../src/meta/safeguard.ts";
import { safeguardUsageReport } from "../tools/outcome/usage-reader.ts";

describe("safeguard usage report", () => {
  test("counts what the writer wrote, names unknown ids, and keeps torn lines as malformed", () => {
    const campaign = mkdtempSync(`${tmpdir()}/ana-safeguard-usage-`);
    const live = SAFEGUARD_INVENTORY[0]?.name ?? "";
    const original = console.error;
    try {
      console.error = () => undefined;
      safeguardTriggered(live, "first", createSafeguardContext(safeguardLogDir(campaign, "run-a")));
      safeguardTriggered(live, "second", createSafeguardContext(safeguardLogDir(campaign, "run-b")));
      safeguardTriggered(
        "0-retired-sensor",
        "old",
        createSafeguardContext(safeguardLogDir(campaign, "run-b")),
      );
    } finally {
      console.error = original;
    }
    appendFileSync(safeguardLogFile(campaign, "run-b"), "torn line\n");

    const report = safeguardUsageReport([campaign]);
    const row = report.rows.find((entry) => entry.name === live);
    expect(row?.fired).toBe(2);
    expect(row?.campaigns).toEqual([campaign]);
    expect(row?.firstFired).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row?.lastFired).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.neverFired).not.toContain(live);
    expect(report.unknownNames).toEqual(["0-retired-sensor"]);
    expect(report.logsRead).toBe(2);
    expect(report.malformedLines).toBe(1);
  });
});
