// WRI2P2's driver reads each run's trigger from its log and an investigation's next step from its
// folder, so a session or a timer takes the iteration one printed step at a time.
import { afterAll, describe, expect, it } from "bun:test";
import { nextOf, pullOf, rowOf, triggerOf } from "#skills/run-improvement-campaign/scripts/wri2p2.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-wri2p2-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const OPENED = Date.parse("2026-11-04T00:00:00.000Z");
const at = (hours: number) => new Date(OPENED + hours * 3_600_000).toISOString();
const event = (hours: number, kind: LogEvent["kind"], data: JsonObject = {}): LogEvent => ({
  at: at(hours),
  kind,
  data,
});
const reported = (hours: number, wins: number, losses: number, ties: number) =>
  event(hours, "comparison.reported", { scored: { wins, losses, ties } });

describe("the trigger", () => {
  it("opens at the promotions, at an all-tied comparison or at the hours, and never on a live run short of all three", () => {
    const now = OPENED + 3 * 3_600_000;
    const short = rowOf(
      { name: "r", host: "here", live: true },
      [event(0, "campaign.opened"), reported(2, 3, 1, 4)],
      now,
    );
    expect(triggerOf(short)).toBeNull();
    const promoted = [
      event(0, "campaign.opened"),
      event(1, "harness.promoted"),
      event(2, "harness.promoted"),
    ];
    expect(triggerOf(rowOf({ name: "r", host: "here", live: true }, promoted, now))).toBe("2 promotions");
    const tied = rowOf(
      { name: "r", host: "here", live: true },
      [event(0, "campaign.opened"), reported(2, 0, 0, 8)],
      now,
    );
    expect(triggerOf(tied)).toBe("a comparison left no task untied");
    // A live run is timed to now, so one in a long wait still reaches the hours.
    expect(triggerOf(short, { promotions: 2, hours: 3 })).toBe("3.0 h since its opening");
  });

  it("opens on a run that closed after a comparison, and not on one that never compared", () => {
    const closed = [
      event(0, "campaign.opened"),
      reported(1, 1, 1, 0),
      event(2, "campaign.ended", { ending: "stop" }),
    ];
    expect(triggerOf(rowOf({ name: "r", host: "here", live: false }, closed, OPENED))).toBe("closed (stop)");
    const empty = [event(0, "campaign.opened"), event(1, "campaign.ended", { ending: "exam" })];
    expect(triggerOf(rowOf({ name: "r", host: "here", live: false }, empty, OPENED))).toBeNull();
  });
});

describe("the next step of an investigation", () => {
  const dir = join(root, "iteration");
  const write = (file: string, text: string) => writeFileSync(join(dir, file), text);
  const report = join(dir, "lanes", "01-report.md");
  const step = (launched: string[] = []) => nextOf(dir, () => launched);

  it("walks the iteration's order from the shared instructions to the fresh runs", () => {
    mkdirSync(join(dir, "lanes"), { recursive: true });
    expect(step()[0]).toStartWith("step: open");
    write("investigation.json", JSON.stringify({ logs: ["/x/.ana/d2/r/log.jsonl"] }));
    write("shared-instructions.md", "## Orientation\n\n<!-- AUTHOR: why -->\n\n## Hard rules\n\nkeep\n");
    expect(step()[0]).toBe(`step: instruct · write "Orientation" in ${join(dir, "shared-instructions.md")}`);
    write("shared-instructions.md", "## Orientation\n\nthe question\n\n## Hard rules\n\nkeep\n");
    expect(step()).toEqual(["step: lanes", `  bun tools/wri/wri.ts lanes --out ${dir} --agents 4`]);
    // A manifest a later build numbered counts beside the first.
    write(
      "launch-02.json",
      JSON.stringify({ sessions: [{ name: "lane_01", task: "Read it.", ownedPaths: [report] }] }),
    );
    expect(step()).toEqual([
      "step: reports · 1 lane session(s) owe a report; hand each its line, all in one message",
      "  lane_01: Read it.",
    ]);
    writeFileSync(report, "# Lane 1\n");
    expect(step()[0]).toStartWith("step: synthesise");
    write("synthesis.md", "notes");
    expect(step()[0]).toStartWith("step: vet");
    write("vetting.md", "rows");
    expect(step()[0]).toStartWith("step: plan");
    write("plan.md", "# Plan\n\nrows\n");
    expect(step()[0]).toStartWith("step: implement");
    write("plan.md", "# Plan\n\nPull request: #602 (on the top)\n");
    expect(step()[0]).toStartWith("step: launch");
    expect(step()[1]).toContain("--as forkedPR602");
    expect(step(["jobstat-fresh-opus-forkedPR602-stijn-pro"])).toEqual([
      "step: done · #602 is measured by jobstat-fresh-opus-forkedPR602-stijn-pro",
    ]);
  });

  it("reads the pull request only from its own line, not from a number cited in the prose", () => {
    expect(pullOf("Fixed on #602, after #601's round.\n")).toBeNull();
    expect(pullOf("# Plan\n\nPull request: #603\n")).toBe(603);
  });
});
