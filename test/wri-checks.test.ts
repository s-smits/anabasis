// The per-check table on an invented log. Each hostile case is one a naive join gets wrong: a
// refusal by two checks counted once, rows read from the last reading instead of the frozen one,
// and a verdict under an earlier program counted under the frozen one.
import { describe, expect, it } from "bun:test";
import { checkRows } from "../tools/wri/checks.ts";
import { indexOf, refusalsByCheck } from "../tools/wri/folds.ts";
import { refusalOf } from "../tools/wri/lane-guard.ts";
import { verdictCampaign } from "./helpers/verdict-log.ts";

describe("checkRows", () => {
  const disk = { where: "invented", version: null, brief: null };
  const lines = checkRows(verdictCampaign(), disk);
  const row = (id: string) => (lines.find((each) => each.startsWith(`${id}  `)) ?? "").split("  ");

  it("names the frozen program's reading and the drafts and readings on the first line", () => {
    expect(lines[0]).toContain("read at p-new, the frozen one");
    expect(lines[0]).toContain("3 checker.read");
    expect(row("c-z")).toEqual([""]);
  });

  it("counts a refusal by two checks under each, as REFUSALS BY CHECK does", () => {
    const totals = refusalsByCheck(indexOf(verdictCampaign()));
    expect([row("c-a")[5], row("c-b")[5]]).toEqual([String(totals["c-a"]), String(totals["c-b"])]);
    expect(totals).toEqual({ "c-a": 4, "c-b": 3 });
  });

  it("splits by side and who asked, and counts the earlier program's verdict apart", () => {
    // c-a: s-1 new, s-2 reference, e-1 examiner, e-0 under p-old.
    expect(row("c-a").slice(6, 10)).toEqual(["1/1", "1", "0", "1"]);
    // Stands: s-1 check-defect, s-2 earned by its label.
    expect(row("c-a")[10]).toBe("1/1/0/0");
    expect(row("c-a")[11]).toBe("1");
  });

  it("prints each check's passes and refusals over every control, and the do-nothing answer", () => {
    expect(row("c-b").at(-1)).toBe("3/1");
    expect(row("c-a").at(-1)).toBe("not recorded");
    expect(lines).toContain("controls read: 4; the do-nothing answer: refused on 1 of 2 tasks");
  });

  it("passes the lane guard as a lane runs it", () => {
    expect(
      refusalOf("Bash", { command: "bun tools/wri/wri.ts reader checks --log data/runs/here/x/log.jsonl" }),
    ).toBeNull();
  });
});
