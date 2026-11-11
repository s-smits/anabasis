// The table of rejections on an invented log. Each hostile case is one a naive join of the log gets
// wrong: the first of two findings, a refused verdict on a crashed solve counted as a rejection, an
// Examiner rehearsal counted as scored, and a ruling read over a person's label.
import { describe, expect, it } from "bun:test";
import { refusalOf } from "../tools/wri/lane-guard.ts";
import { probeLines, rejectionRows } from "../tools/wri/rejections.ts";
import { verdictCampaign } from "./helpers/verdict-log.ts";

describe("rejectionRows", () => {
  const lines = rejectionRows(verdictCampaign());
  const row = (id: string) => lines.find((each) => each.startsWith(`${id}  `)) ?? "";

  it("reads the last of two findings, and its cited probe that moved", () => {
    expect(row("s-1")).toContain("check-defect");
    expect(row("s-1")).toContain("1/1");
    expect(row("s-1")).not.toContain("earned, no probe cited");
  });

  it("lets a person's label stand over the ruling", () => {
    expect(row("s-2").split("  ").slice(7, 11)).toEqual([
      "check-defect",
      "1/not recorded",
      "earned",
      "earned",
    ]);
  });

  it("counts a refused verdict on a crashed solve apart, as no rejection", () => {
    expect(row("s-3")).toBe("");
    expect(lines.at(-1)).toContain("no rejection: 1 (sandbox-crash 1)");
  });

  it("marks an Examiner rehearsal and a practice rejection, and keeps them", () => {
    expect(row("e-1").split("  ")[2]).toBe("examiner");
    expect(row("p-1").split("  ")[2]).toBe("practice");
    expect(lines.find((each) => each.startsWith("totals:"))).toContain("scored 2");
  });

  it("prints the probe rows of one finding, and says where a finding holds none", () => {
    const s1 = probeLines(verdictCampaign(), "s-1").join("\n");
    expect(s1).toContain("probe 1 (cited)");
    expect(s1).toContain("$.x = 2");
    expect(probeLines(verdictCampaign(), "s-2").join("\n")).toContain("probe rows not recorded");
  });

  it("passes the lane guard as a lane runs it and the grade it leads to", () => {
    for (const command of [
      "bun tools/wri/rejections.ts data/runs/here/x/log.jsonl --solve s-1",
      "bun tools/wri/wri.ts grade --log data/runs/here/x/log.jsonl --solve s-1 --set '$.x=2'",
    ]) {
      expect(refusalOf("Bash", { command })).toBeNull();
    }
  });
});
