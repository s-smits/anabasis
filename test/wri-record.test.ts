// The reads the primary makes while an investigation's lanes work are written by one command,
// each under its own heading with when it ran, so a gate counts the reads still owed instead of
// the file's existence. The hostile cases are a failed read and a heading that names another pack.
import { describe, expect, it } from "bun:test";
import { readsOf, recordOwed, recordWith } from "../tools/wri/record.ts";

describe("the record across runs", () => {
  const names = ["buffer-fresh-opus-forkedPR1-h", "buffer-fresh-opus-forkedPR2-h"];

  it("owes a pack's reads once, a replay a run and the findings ledger", () => {
    expect(readsOf(names).map((words) => words.join(" "))).toEqual([
      ".claude/skills/promotion-tuner/scripts/trend.ts --pack buffer",
      ".claude/skills/promotion-tuner/scripts/table.ts --name buffer --rows promotions",
      ".claude/skills/comparison-reading/scripts/starter-reads.ts --all --name buffer",
      `.claude/skills/promotion-tuner/scripts/replay.ts --name ${names[0] ?? ""} --totals`,
      `.claude/skills/promotion-tuner/scripts/replay.ts --name ${names[1] ?? ""} --totals`,
      "tools/wri/wri.ts findings",
    ]);
  });

  it("writes each read under its command with when it ran, keeps a read already made and owes a failed one", () => {
    let reports = 1;
    const stand = () => `2026-11-17T01:00:00.000Z, ${String(reports)} of 4 lane reports written`;
    const ran: string[] = [];
    const run = (fail: string) => (words: readonly string[]) => {
      ran.push(words.join(" "));
      return words.join(" ").includes(fail)
        ? { exitCode: 1, text: "no such pack\n" }
        : { exitCode: 0, text: "rows\n" };
    };
    const first = recordWith("", names, stand, run("table.ts"));
    expect(first.failed).toEqual([
      ".claude/skills/promotion-tuner/scripts/table.ts --name buffer --rows promotions",
    ]);
    expect(first.text).toStartWith(
      "# The record across runs\n\n## `bun .claude/skills/promotion-tuner/scripts/trend.ts --pack buffer`\n\nread at 2026-11-17T01:00:00.000Z, 1 of 4 lane reports written, exit 0\n\n```text\nrows\n```\n",
    );
    expect(recordOwed(first.text, names)).toHaveLength(1);
    // The second call, after the lanes returned, makes the failed read alone and keeps the first's times.
    reports = 4;
    ran.length = 0;
    const second = recordWith(first.text, names, stand, run("nothing fails"));
    expect(ran).toEqual([".claude/skills/promotion-tuner/scripts/table.ts --name buffer --rows promotions"]);
    expect(second.failed).toEqual([]);
    expect(recordOwed(second.text, names)).toEqual([]);
    expect(second.text.match(/1 of 4 lane reports written/gu)).toHaveLength(6);
    expect(second.text.match(/4 of 4 lane reports written, exit 0/gu)).toHaveLength(1);
  });

  it("owes every read of a file that only has a title, and of one whose heading names another pack", () => {
    expect(recordOwed("# The record across runs\n", names)).toHaveLength(6);
    const other =
      "## `bun .claude/skills/promotion-tuner/scripts/trend.ts --pack jobstat`\n\nread at t, 0 of 4 lane reports written, exit 0\n";
    expect(recordOwed(other, names)).toHaveLength(6);
  });
});
