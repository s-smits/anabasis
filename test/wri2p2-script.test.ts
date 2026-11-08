// WRI2P2's driver reads each run's trigger from its log and an investigation's next step from its
// folder, so a session or a timer takes the iteration one printed step at a time. Every gate is a
// default a recorded reason passes (operator, 7 November), so each is walked owed, met and deviated.
import { afterAll, describe, expect, it } from "bun:test";
import { nextOf, rowOf, triggerOf } from "#skills/run-improvement-campaign/scripts/wri2p2.ts";
import { forkOf, idsOf, outcomesOf, pullOf } from "#tools/wri/ledger.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const live = { name: "r", host: "here", live: true };
const PLAN = "# Plan\n\nvet-1 in cross-domain.md, by E1, B2 and S1.\n\nPull request: #602\n";
const base = realpathSync(mkdtempSync(join(tmpdir(), "ana-wri2p2-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));

const OPENED = Date.parse("2026-11-04T00:00:00.000Z");
const at = (hours: number) => new Date(OPENED + hours * 3_600_000).toISOString();
const event = (hours: number, kind: LogEvent["kind"], data: JsonObject = {}): LogEvent => ({
  at: at(hours),
  kind,
  data,
});
const reported = (hours: number, wins: number, losses: number, ties: number, reading = "no-step") =>
  event(hours, "comparison.reported", { reading, scored: { wins, losses, ties } });

describe("the trigger", () => {
  it("opens at the promotions, at an all-tied comparison or at the hours, and never on a live run short of all three", () => {
    const now = OPENED + 3 * 3_600_000;
    const short = rowOf(live, [event(0, "campaign.opened"), reported(2, 3, 1, 4)], now);
    expect(triggerOf(short)).toBeNull();
    const promoted = [
      event(0, "campaign.opened"),
      event(1, "harness.promoted"),
      event(2, "harness.promoted"),
    ];
    expect(triggerOf(rowOf(live, promoted, now))).toBe("2 promotions");
    const tied = rowOf(live, [event(0, "campaign.opened"), reported(2, 0, 0, 8)], now);
    expect(triggerOf(tied)).toBe("a comparison left no task untied");
    // A live run is timed to now, so one in a long wait still reaches the hours.
    expect(triggerOf(short, { promotions: 2, hours: 3 })).toBe("3.0 h since its opening");
  });

  it("reads a comparison that scored nothing as no tie, since it tested nothing", () => {
    const now = OPENED + 3 * 3_600_000;
    const unscored = rowOf(live, [event(0, "campaign.opened"), reported(2, 0, 0, 0, "not-scored")], now);
    expect(triggerOf(unscored)).toBeNull();
  });

  it("opens on a run that closed after a comparison, and not on one that never compared", () => {
    const closed = [
      event(0, "campaign.opened"),
      reported(1, 1, 1, 0),
      event(2, "campaign.ended", { ending: "stop" }),
    ];
    expect(triggerOf(rowOf({ ...live, live: false }, closed, OPENED))).toBe("closed (stop)");
    const empty = [event(0, "campaign.opened"), event(1, "campaign.ended", { ending: "exam" })];
    expect(triggerOf(rowOf({ ...live, live: false }, empty, OPENED))).toBeNull();
  });
});

/** An investigation folder under its own root, reading the run `run`, marked an iteration or not. */
function folder(name: string, run: string, iteration: boolean) {
  const root = join(base, name);
  const dir = join(root, "2026-11-07-investigation");
  const cycle = join(root, "2026-11-07-cycle-test");
  mkdirSync(join(dir, "lanes"), { recursive: true });
  mkdirSync(cycle, { recursive: true });
  const write = (file: string, text: string) => writeFileSync(join(dir, file), text);
  const ledger = (file: string, text: string) => writeFileSync(join(cycle, file), text);
  const report = join(dir, "lanes", "01-report.md");
  write("investigation.json", JSON.stringify({ logs: [`/x/.ana/d2/${run}/log.jsonl`] }));
  if (iteration) write("iteration.json", JSON.stringify({ opened: at(0), runs: [run] }));
  write("shared-instructions.md", "## Orientation\n\nthe question\n\n## Hard rules\n\nkeep\n");
  write(
    "launch.json",
    JSON.stringify({ sessions: [{ name: "lane_01", task: "Read it.", ownedPaths: [report] }] }),
  );
  writeFileSync(report, "# Lane 1\n");
  write("synthesis.md", "notes");
  const step = (launched: string[] = []) => nextOf(dir, () => launched, root);
  return { root, dir, cycle, write, ledger, step };
}

const table = (ids: string[], outcome = "x") =>
  `| id | outcome |\n| --- | --- |\n${ids.map((id) => `| ${id} | ${outcome} |`).join("\n")}\n`;

describe("the next step of an investigation", () => {
  it("walks the shared steps from the shared instructions to the fresh runs", () => {
    const root = join(base, "common");
    const dir = join(root, "x");
    mkdirSync(join(dir, "lanes"), { recursive: true });
    const write = (file: string, text: string) => writeFileSync(join(dir, file), text);
    const report = join(dir, "lanes", "01-report.md");
    const step = (launched: string[] = []) => nextOf(dir, () => launched, root);
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
      "step: reports · 1 lane session(s) owe a report; hand each its line to a wri-lane agent, all in one message",
      "  lane_01: Read it.",
    ]);
    writeFileSync(report, "# Lane 1\n");
    expect(step()[0]).toStartWith("step: synthesise");
    // An unmarked folder keeps the sequence it was started under: no ledger, isolated lane or read across.
    write("synthesis.md", "notes");
    expect(step()[0]).toStartWith("step: vet");
    write("vetting.md", "rows");
    expect(step()[0]).toStartWith("step: plan");
    write("plan.md", "# Plan\n\nrows\n");
    expect(step()[0]).toStartWith("step: implement");
    write("plan.md", "# Plan\n\nPull request: #602 (on the top)\n");
    expect(step()[0]).toStartWith("step: launch");
    expect(step()[1]).toContain("--as forkedPR602");
    expect(step(["jobstat-fresh-opus-forkedPR602"])).toEqual([
      "step: done · #602 is measured by jobstat-fresh-opus-forkedPR602",
    ]);
  });

  it("owes a report from a session that names none, since nothing could show it finished", () => {
    const { write, step } = folder("unowned", "r", false);
    write("launch.json", JSON.stringify({ sessions: [{ name: "lane_02", task: "Read." }] }));
    expect(step()[0]).toStartWith("step: reports · 1 lane session(s)");
  });

  it("walks an iteration through its isolated lanes, each run's ledgers, the read across and a fork's carry", () => {
    const { dir, cycle, write, ledger, step } = folder("iteration", "r", true);
    expect(step()[0]).toStartWith("step: isolated");
    write("launch-04.json", JSON.stringify({ sessions: [] }));
    expect(step()[0]).toStartWith("step: predictions · r has no predictions-r.md");
    ledger("predictions-r.md", "# Predictions\n\nprose, not a table\n");
    expect(step()[0]).toStartWith("step: predictions · ");
    expect(step()[0]).toContain('no table whose first column is "id"');
    ledger("predictions-r.md", table(["P1", "P2"]));
    expect(step()[0]).toContain("resolve P1, P2");
    // An outcome outside the four is unsettled, and an id predicted nowhere is named.
    ledger("outcomes-r.md", `${table(["P1"], "held")}| P2 | maybe |\n| P9 | held |\n`);
    expect(step()[0]).toContain("resolve P2");
    expect(step()[0]).toContain("P9 predicted nowhere");
    ledger("outcomes-r.md", `${table(["P1"], "held")}| P2 | pending |\n`);
    expect(step()[0]).toStartWith("step: still-missing");
    expect(step()[0]).toContain("name P2");
    // A list with an empty section for what stays missing on purpose is not yet the file.
    ledger(
      "still-missing-r.md",
      "# Still missing\n\n- P2\n\n## Intentionally opposed\n\n<!-- trade-offs -->\n",
    );
    expect(step()[0]).toStartWith("step: still-missing");
    ledger("still-missing-r.md", "# Still missing\n\n- P2\n\n## Intentionally opposed\n\n- none\n");
    expect(step()[0]).toStartWith("step: vet · recount");
    write("vetting.md", "| # | finding | verdict |\n| --- | --- | --- |\n| 1 | P1 held | confirmed |\n");
    expect(step()[0]).toBe(
      `step: vet · ${join(dir, "vetting.md")} has no row for r:P2: backtrack every prediction first, an id two runs share as <run>:<id>`,
    );
    write(
      "vetting.md",
      "| # | finding | verdict |\n| --- | --- | --- |\n| 1 | P1 held | confirmed |\n| 2 | P2 pending | plausible |\n",
    );
    expect(step()[0]).toStartWith("step: across");
    write("cross-domain.md", "rows");
    expect(step()[0]).toStartWith("step: plan · repairs");
    write("plan.md", "# Plan\n\nrows by E1 and Z9\n");
    expect(step()[0]).toContain("name vet-1, cross-domain.md");
    expect(step()[0]).toContain("(1 named)");
    write("plan.md", PLAN.replace("\n\nPull request: #602", ""));
    expect(step()[0]).toStartWith("step: implement");
    write("plan.md", PLAN);
    expect(step()[0]).toStartWith("step: launch");
    // The fork owes its own predictions, then what it carries from the iteration that made it.
    const fork = "r-forkedPR602";
    expect(step([fork])[0]).toStartWith(`step: predictions · ${fork} has no`);
    // An id carried by a longer one's name is not carried: r:P20 is not r:P2.
    writeFileSync(
      join(cycle, `predictions-${fork}.md`),
      `${table(["F1"])}\n## Carried\n\n- r:P20, still-missing-r.md\n`,
    );
    expect(step([fork])[0]).toStartWith(`step: carry · the "## Carried" section of`);
    writeFileSync(join(cycle, `predictions-${fork}.md`), `${table(["F1"])}\n## Carried\n\n- r:P1\n`);
    expect(step([fork])[0]).toBe(
      `step: carry · the "## Carried" section of ${join(cycle, `predictions-${fork}.md`)} names r:P2, still-missing-r.md: each id the iteration that made this fork did not hold, and its runs' still-missing files with their opposed trade-offs`,
    );
    writeFileSync(
      join(cycle, `predictions-${fork}.md`),
      `${table(["F1"])}\n## Carried\n\n- r:P2, from still-missing-r.md\n`,
    );
    expect(step([fork])).toEqual([`step: done · #602 is measured by ${fork}`]);
  });

  it("reopens a row left unreached or pending once the log grows past its count, and keeps it while the log stands", () => {
    const { dir, root, write, ledger } = folder("stale", "r", true);
    write("launch-04.json", JSON.stringify({ sessions: [] }));
    ledger("predictions-r.md", table(["P1", "P2", "P3"]));
    const resolved = `${table(["P1"], "held")}| P2 | unreached |\n| P3 | pending |\n`;
    const step = (events: number | null) =>
      nextOf(
        dir,
        () => [],
        root,
        () => events,
      )[0] ?? "";
    // A resolution names the count to record beside it.
    expect(step(120)).toContain("resolve P1, P2, P3");
    expect(step(120)).toContain('record "Log events at resolution: 120"');
    ledger("outcomes-r.md", `Log events at resolution: 120\n\n${resolved}`);
    expect(step(120)).toStartWith("step: still-missing");
    // The run went on: its unreached and pending rows are open again, and its held one is not.
    expect(step(121)).toBe(
      `step: outcomes · ${join(root, "2026-11-07-cycle-test", "outcomes-r.md")}: P2, P3 read unreached or pending at 120 events and the log holds 121 now: resolve them again, and record "Log events at resolution: 121" on its own line`,
    );
    // A ledger that records no count was read at none, and a log this machine cannot read stales nothing.
    ledger("outcomes-r.md", resolved);
    expect(step(120)).toContain("P2, P3 read unreached or pending at no recorded count");
    expect(step(null)).toStartWith("step: still-missing");
    ledger("outcomes-r.md", `Log events at resolution: 121\n\n${table(["P1", "P2", "P3"], "held")}`);
    expect(step(400)).toStartWith("step: still-missing");
  });

  it("refuses to choose between two copies of one ledger", () => {
    const { ledger, write, step } = folder("twice", "r", true);
    write("launch-15.json", JSON.stringify({ sessions: [] }));
    ledger("predictions-r.md", table(["P1"]));
    write("predictions-r.md", table(["P1"]));
    expect(step()[0]).toContain("keep one");
    // A deviation passes the conflict at the gate it names, and the run's next gate still names it
    // rather than reading whichever copy a folder lists first.
    write("deviations.md", "| step | reason |\n| --- | --- |\n| predictions:r | both are drafts |\n");
    expect(step()[0]).toStartWith("step: outcomes · predictions-r.md is in ");
    expect(step()[0]).toContain("keep one");
  });

  it("asks a vetting over two runs to name an id they share once for each run", () => {
    const { root, dir, cycle, write, ledger } = folder("shared-id", "a", true);
    write(
      "investigation.json",
      JSON.stringify({ logs: ["/x/.ana/d2/a/log.jsonl", "/x/.ana/d2/b/log.jsonl"] }),
    );
    write("launch-04.json", JSON.stringify({ sessions: [] }));
    for (const run of ["a", "b"]) {
      ledger(`predictions-${run}.md`, table(["P1", `Q${run}`]));
      ledger(`outcomes-${run}.md`, table(["P1", `Q${run}`], "held"));
      writeFileSync(join(cycle, `still-missing-${run}.md`), "- none\n\n## Intentionally opposed\n\n- none\n");
    }
    const step = () => nextOf(dir, () => [], root);
    // One bare P1 cannot backtrack both runs' P1, while an id only one run holds may stay bare.
    write("vetting.md", "| # | finding |\n| --- | --- |\n| 1 | P1 held |\n| 2 | Qa, Qb held |\n");
    expect(step()[0]).toContain("has no row for a:P1, b:P1");
    write("vetting.md", "| # | finding |\n| --- | --- |\n| 1 | a:P1 and b:P1 held |\n| 2 | Qa, Qb held |\n");
    expect(step()[0]).toStartWith("step: across");
  });

  it("passes any gate but the last on a recorded reason, and says so beside the step it reaches", () => {
    const { write, step } = folder("deviated", "r", true);
    write(
      "deviations.md",
      "| step | reason |\n| --- | --- |\n| isolated | no trigger fired |\n| predictions:r | written before the marker |\n| done | never |\n",
    );
    const [first, ...passed] = step();
    // With no predictions there is no outcome to owe, and what the run still lacks is owed as ever.
    expect(first).toStartWith("step: still-missing");
    expect(passed).toEqual([
      "deviated: isolated · no trigger fired",
      "deviated: predictions:r · written before the marker",
    ]);
    // A row with no reason is no deviation.
    write("deviations.md", "| step | reason |\n| --- | --- |\n| isolated | |\n");
    expect(step()[0]).toStartWith("step: isolated");
  });

  it("reads a fork's parent by its whole number, so #60 never takes #600's runs", () => {
    expect(forkOf("esp32-fresh-opus-forkedPR600-host")).toBe(600);
    expect(forkOf("esp32-fresh-opus-forkedPR60-host")).toBe(60);
    expect(forkOf("esp32-fresh-opus")).toBeNull();
    const { write, ledger, step } = folder("parent", "p", true);
    write("launch-04.json", JSON.stringify({ sessions: [] }));
    ledger("predictions-p.md", table(["P1"]));
    ledger("outcomes-p.md", table(["P1"], "falsified"));
    ledger("still-missing-p.md", "- P1\n\n## Intentionally opposed\n\n- none\n");
    write("vetting.md", "| # | finding |\n| --- | --- |\n| 1 | P1 |\n");
    write("cross-domain.md", "rows");
    write("plan.md", "cross-domain.md, by E1, B2 and S1.\n\nPull request: #600\n");
    for (const fork of ["p-forkedPR60", "p-forkedPR600"]) ledger(`predictions-${fork}.md`, table(["F1"]));
    // The fork of #60 is no fork of this iteration, whose plan names #600, so it carries nothing from it.
    expect(step(["p-forkedPR60"])[0]).toStartWith("step: done");
    expect(step(["p-forkedPR600"])[0]).toStartWith("step: carry");
    expect(step(["p-forkedPR600"])[0]).toContain("names p:P1, still-missing-p.md");
  });

  it("reads a ledger's ids from each id table's rows, past its header and rule, and no other table", () => {
    expect(
      idsOf(
        "# P\n\n| id | claim |\n| :-- | --- |\n| P1 | a |\n|P2|b|\ntext | not a row\n\n| # | x |\n| --- | --- |\n| 7 | y |\n",
      ),
    ).toEqual(["P1", "P2"]);
    // An outcome is its first word, however it is emphasised or followed.
    expect([...outcomesOf("| id | outcome |\n| --- | --- |\n| P1 | **Held**, 4 of 4 |\n| P2 | |\n")]).toEqual(
      [
        ["P1", "held"],
        ["P2", ""],
      ],
    );
  });

  it("reads the pull request only from its own line, not from a number cited in the prose", () => {
    expect(pullOf("Fixed on #602, after #601's round.\n")).toBeNull();
    expect(pullOf("# Plan\n\nPull request: #603\n")).toBe(603);
  });
});
