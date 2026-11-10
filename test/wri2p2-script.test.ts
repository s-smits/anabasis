// WRI2P2's driver reads each run's trigger from its log and an investigation's next step from its
// folder, so a session or a timer takes the iteration one printed step at a time. Every gate is a
// default a recorded reason passes (operator, 7 November), so each is walked owed, met and deviated.
import { afterAll, describe, expect, it } from "bun:test";
import {
  dueLines,
  ledgerViews,
  lengthsIn,
  movedIn,
  nextOf,
  openingOf,
  unmeasured,
} from "#skills/run-improvement-campaign/scripts/wri2p2.ts";
import { progressOf as rowOf, triggerOf } from "#tools/runs/said.ts";
import { forkOf, idsOf, outcomesOf, pullOf } from "#tools/wri/ledger.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { gitText } from "../src/meta/git.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";

const live = { name: "r", host: "here", live: true };
const SCRIPT = ".claude/skills/run-improvement-campaign/scripts/wri2p2.ts";
const PLAN_FILE = "plan.md";
const PLAN =
  "# Plan\n\nvet-1 in cross-domain.md, by E1, B2 and S1.\n\nPull request: #602\n\n## Intentionally opposed\n\n- none\n";
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
  /** A manifest `file` whose one session owns lane `lane`'s report, written. */
  const lone = (lane: number, file = `launch-${String(lane).padStart(2, "0")}.json`) => {
    const owned = join(dir, "lanes", `${String(lane).padStart(2, "0")}-report.md`);
    write(
      file,
      JSON.stringify({ sessions: [{ name: `lane_${String(lane)}`, task: "Read.", ownedPaths: [owned] }] }),
    );
    writeFileSync(owned, "# Lane\n");
  };
  return { root, dir, cycle, write, ledger, step, lone };
}

const table = (ids: string[], outcome = "x") =>
  `| id | outcome |\n| --- | --- |\n${ids.map((id) => `| ${id} | ${outcome} |`).join("\n")}\n`;

describe("a run's step at its trigger", () => {
  const row = { name: "r1", host: "here", live: true };
  const pausing = (args: string[]) => [{ pid: 1, cwd: "/w", args }];

  it("pauses a live run after its next comparison before its investigation opens", () => {
    expect(openingOf(row, "2 promotions", [])).toEqual([
      "step: pause · 2 promotions; the investigation opens once the run stops after its next comparison",
      "  bun run runs pause r1 --after reported --yes",
    ]);
  });

  it("waits while a pause of the run is armed, and opens once the run has stopped", () => {
    const armed = pausing(["bun", "tools/runs/cli.ts", "pause", "r1", "--after", "reported", "--yes"]);
    expect(openingOf(row, "2 promotions", armed)[0]).toStartWith("step: waits");
    expect(openingOf(row, "2 promotions", pausing(["bun", "cli.ts", "pause", "r2"]))[0]).toStartWith(
      "step: pause",
    );
    expect(openingOf({ ...row, live: false }, "2 promotions", armed)[0]).toBe("step: open · 2 promotions");
    expect(openingOf(row, null, [])).toEqual(["step: run"]);
  });

  it("pauses a peer's run on its own host", () => {
    expect(openingOf({ ...row, host: "peer" }, "12.0 h since its opening", [])[1]).toBe(
      "  bun run runs on peer pause r1 --after reported --yes",
    );
  });
});

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
    write(PLAN_FILE, "# Plan\n\nrows\n");
    expect(step()[0]).toStartWith("step: implement");
    write(PLAN_FILE, "# Plan\n\nPull request: #602 (on the top)\n");
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

  it("reads a folder that `open` left between its record and the start as owing the open, then as an iteration", () => {
    const root = join(base, "crashed");
    const dir = join(root, "2026-11-07-investigation");
    mkdirSync(dir, { recursive: true });
    // `open` writes the record first, so a crash before the start leaves it alone in the folder.
    writeFileSync(join(dir, "iteration.json"), JSON.stringify({ opened: at(0), runs: ["r"] }));
    expect(nextOf(dir, () => [], root)).toEqual([`step: open · no investigation in ${dir}`]);
    // A second `open` starts into the same folder, which then takes the iteration's own gates.
    const { step } = folder("crashed", "r", true);
    expect(step()[0]).toStartWith("step: isolated");
  });

  it("passes the isolated gate on a lone lane's report in this folder only, never on one of that name elsewhere", () => {
    const { write, step } = folder("lone-elsewhere", "r", true);
    const elsewhere = join(base, "lone-elsewhere", "other", "lanes", "04-report.md");
    mkdirSync(dirname(elsewhere), { recursive: true });
    writeFileSync(elsewhere, "# Lane\n");
    write(
      "launch-04.json",
      JSON.stringify({ sessions: [{ name: "lane_4", task: "Read.", ownedPaths: [elsewhere] }] }),
    );
    expect(step()[0]).toStartWith("step: isolated");
  });

  it("walks an iteration through its isolated lanes, each run's ledgers, the read across and a fork's carry", () => {
    const { dir, cycle, write, ledger, step, lone } = folder("iteration", "r", true);
    expect(step()[0]).toStartWith("step: isolated");
    // A manifest counts by the lanes its sessions own, never by its name: one named for lane 4 that
    // holds lane 3 passes nothing, and lane 4 in the first manifest passes the gate.
    lone(3, "launch-04.json");
    expect(step()[0]).toStartWith("step: isolated");
    lone(4, "launch.json");
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
    // What the run still lacks is derived, so no file of it is owed.
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
    write(PLAN_FILE, "# Plan\n\nrows by E1 and Z9\n");
    expect(step()[0]).toContain("name vet-1, cross-domain.md");
    expect(step()[0]).toContain("(1 named)");
    // What the plan leaves out on purpose is its own section, and an empty one is not yet said.
    write(PLAN_FILE, PLAN.replace("- none", "<!-- trade-offs -->"));
    expect(step()[0]).toBe(
      `step: plan · ${join(dir, PLAN_FILE)}: add "## Intentionally opposed" with at least one line ("none" counts): what stays missing on purpose, each as a trade-off, what leaving it out buys, what it costs and why (a trade-off of AGENTS.md section 1, a principle or the operator's word)`,
    );
    write(PLAN_FILE, PLAN.replace("Pull request: #602\n\n", ""));
    expect(step()[0]).toStartWith("step: implement");
    write(PLAN_FILE, PLAN);
    expect(step()[0]).toStartWith("step: launch");
    // The fork owes its own predictions, then what it carries from the iteration that made it.
    const fork = "r-forkedPR602";
    expect(step([fork])[0]).toStartWith(`step: predictions · ${fork} has no`);
    // An id carried by a longer one's name is not carried: r:P20 is not r:P2.
    writeFileSync(join(cycle, `predictions-${fork}.md`), `${table(["F1"])}\n## Carried\n\n- r:P20\n`);
    expect(step([fork])[0]).toStartWith(`step: carry · the "## Carried" section of`);
    writeFileSync(join(cycle, `predictions-${fork}.md`), `${table(["F1"])}\n## Carried\n\n- r:P1\n`);
    expect(step([fork])[0]).toBe(
      `step: carry · the "## Carried" section of ${join(cycle, `predictions-${fork}.md`)} names r:P2: each id the iteration that made this fork did not hold`,
    );
    writeFileSync(join(cycle, `predictions-${fork}.md`), `${table(["F1"])}\n## Carried\n\n- r:P2\n`);
    expect(step([fork])).toEqual([`step: done · #602 is measured by ${fork}`]);
  });

  it("reopens a row left unreached or pending once the log grows past its count, and keeps it while the log stands", () => {
    const { dir, root, ledger, lone } = folder("stale", "r", true);
    lone(4);
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
    expect(step(120)).toStartWith("step: vet");
    // The run went on: its unreached and pending rows are open again, and its held one is not.
    expect(step(121)).toBe(
      `step: outcomes · ${join(root, "2026-11-07-cycle-test", "outcomes-r.md")}: P2, P3 read unreached or pending at 120 events and the log holds 121 now: resolve them again, and record "Log events at resolution: 121" on its own line`,
    );
    // A ledger that records no count was read at none, and a log this machine cannot read stales nothing.
    ledger("outcomes-r.md", resolved);
    expect(step(120)).toContain("P2, P3 read unreached or pending at no recorded count");
    expect(step(null)).toStartWith("step: vet");
    ledger("outcomes-r.md", `Log events at resolution: 121\n\n${table(["P1", "P2", "P3"], "held")}`);
    expect(step(400)).toStartWith("step: vet");
  });

  it("counts a run's log only once nothing writes it, so a live run's growth reopens no row", () => {
    const tree = join(base, "lengths");
    const path = join(tree, ".ana", "d2", "wri2p2-lengths", "log.jsonl");
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(
      path,
      `${[event(0, "campaign.opened"), event(1, "build.started")].map((each) => JSON.stringify(each)).join("\n")}\n`,
    );
    const run = { name: "wri2p2-lengths", tree, path, end: "comparison.reported" } as const;
    const writer = { pid: 1, cwd: tree, args: ["bun", "tools/d2/harness-builder.ts", "--name", run.name] };
    expect(lengthsIn([run], () => [writer])(run.name)).toBeNull();
    expect(lengthsIn([run], () => [])(run.name)).toBe(2);
    expect(lengthsIn([run], () => [])("another")).toBeNull();
  });

  it("refuses to choose between two copies of one ledger", () => {
    const { ledger, write, step, lone } = folder("twice", "r", true);
    lone(15);
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
    const { root, dir, write, ledger, lone } = folder("shared-id", "a", true);
    write(
      "investigation.json",
      JSON.stringify({ logs: ["/x/.ana/d2/a/log.jsonl", "/x/.ana/d2/b/log.jsonl"] }),
    );
    lone(4);
    for (const run of ["a", "b"]) {
      ledger(`predictions-${run}.md`, table(["P1", `Q${run}`]));
      ledger(`outcomes-${run}.md`, table(["P1", `Q${run}`], "held"));
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
    // With no predictions there is no outcome to owe, so the vetting is next.
    expect(first).toStartWith("step: vet · recount");
    expect(passed).toEqual([
      "deviated: isolated · no trigger fired",
      "deviated: predictions:r · written before the marker",
    ]);
    // A row with no reason is no deviation.
    write("deviations.md", "| step | reason |\n| --- | --- |\n| isolated | |\n");
    expect(step()[0]).toStartWith("step: isolated");
  });

  it("derives the cycle view and each run's still-missing view from its two ledgers and its plan", () => {
    const { root, dir, cycle, write, ledger } = folder("views", "r", true);
    ledger("predictions-r.md", table(["P1", "P2", "P3"]));
    ledger("outcomes-r.md", `Log events at resolution: 50\n\n${table(["P1"], "held")}| P2 | unreached |\n`);
    write(
      PLAN_FILE,
      "# Plan\n\n## Not done: the operator's decisions\n\n- engines for drafted exams\n\n## Intentionally opposed\n\n- the solve limits stay\n",
    );
    const views = (events: number | null) => ledgerViews(dir, root, () => events);
    expect(views(50)).toEqual([
      `# Ledger views of ${dir}`,
      "",
      "Derived from each run's predictions and outcomes and its iteration's plan: never write them by hand.",
      "",
      "| run | id | outcome |",
      "| --- | --- | --- |",
      "| r | P1 | held |",
      "| r | P2 | unreached |",
      "| r | P3 | unresolved |",
      "",
      "# Still missing: r",
      "",
      "## Not held",
      "",
      "- P2: unreached",
      "- P3: unresolved",
      "",
      "## Not done",
      "",
      "- engines for drafted exams",
      "",
      "## Intentionally opposed",
      "",
      "- the solve limits stay",
    ]);
    // The log grew, so the unreached row reads stale in both views, and the held one does not.
    expect(views(51)).toContain("| r | P2 | unreached, stale |");
    expect(views(51)).toContain("- P2: unreached, stale");
    expect(views(51)).toContain("| r | P1 | held |");
    // A cycle's folder holds the same views, the plan read from the iteration that names the run.
    expect(ledgerViews(cycle, root, () => 50).slice(4)).toEqual(views(50).slice(4));
    // A plan with no opposed section shows a run's older still-missing file, never "none" over it.
    write(PLAN_FILE, "# Plan\n\n## Not done\n\n- engines for drafted exams\n");
    expect(views(50).slice(-1)).toEqual(["- none"]);
    ledger(
      "still-missing-r.md",
      "## Not done\n\n- old\n\n## Intentionally opposed\n\n- no session repairs the pack\n",
    );
    expect(views(50).slice(-1)).toEqual(["- no session repairs the pack"]);
    // The plan's own section, where it has one, is the owner and wins.
    write(PLAN_FILE, "# Plan\n\n## Intentionally opposed\n\n- the solve limits stay\n");
    expect(views(50).slice(-1)).toEqual(["- the solve limits stay"]);
  });

  it("reads a fork's parent by its whole number, so #60 never takes #600's runs", () => {
    expect(forkOf("esp32-fresh-opus-forkedPR600-host")).toBe(600);
    expect(forkOf("esp32-fresh-opus-forkedPR60-host")).toBe(60);
    expect(forkOf("esp32-fresh-opus")).toBeNull();
    const { write, ledger, step, lone } = folder("parent", "p", true);
    lone(4);
    ledger("predictions-p.md", table(["P1"]));
    ledger("outcomes-p.md", table(["P1"], "falsified"));
    // A run that kept its opposed trade-offs in a still-missing file before 8 November has said them.
    ledger("still-missing-p.md", "- P1\n\n## Intentionally opposed\n\n- none\n");
    write("vetting.md", "| # | finding |\n| --- | --- |\n| 1 | P1 |\n");
    write("cross-domain.md", "rows");
    write(PLAN_FILE, "cross-domain.md, by E1, B2 and S1.\n\nPull request: #600\n");
    for (const fork of ["p-forkedPR60", "p-forkedPR600"]) ledger(`predictions-${fork}.md`, table(["F1"]));
    // The fork of #60 is no fork of this iteration, whose plan names #600, so it carries nothing from it.
    expect(step(["p-forkedPR60"])[0]).toStartWith("step: done");
    expect(step(["p-forkedPR600"])[0]).toStartWith("step: carry");
    expect(step(["p-forkedPR600"])[0]).toContain("names p:P1:");
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

describe("the short view a timer reads", () => {
  const now = OPENED + 100 * 3_600_000;
  const standing = (name: string, isLive: boolean, dir: string | null, step: string[], last = 99) => ({
    row: rowOf({ name, host: "here", live: isLive }, [event(0, "campaign.opened")], now),
    last: OPENED + last * 3_600_000,
    dir,
    step,
  });
  // Each folder was last written this many hours after the opening.
  const written = new Map([
    ["/wri/a", 97],
    ["/wri/b", 60],
    ["/wri/old", 10],
  ]);
  const changedAt = (dir: string) => OPENED + (written.get(dir) ?? 0) * 3_600_000;

  it("says nothing is owed while every run runs on or is measured, and counts the live ones", () => {
    const lines = dueLines(
      [
        standing("r1", true, null, ["step: run"]),
        standing("r2", false, "/wri/a", ["step: done · #7 is measured by r2-forkedPR7"]),
      ],
      changedAt,
      now,
    );
    expect(lines).toEqual(["due at 2026-11-08T04:00Z · nothing owed · 1 run(s) live"]);
  });

  it("lists a live run's trigger first, then the longest-standing step, one line a folder's step", () => {
    const lines = dueLines(
      [
        standing("r1", false, "/wri/a", ["deviated: lanes · by hand", "step: vet · vetting.md names no P2"]),
        standing("r2", false, "/wri/b", ["step: outcomes · resolve C1"]),
        standing("r3", false, "/wri/b", ["step: outcomes · resolve C1"]),
        // A live run at its trigger owes its pause, and the line names the pause, never `open`.
        standing("r4", true, null, openingOf({ name: "r4", host: "here", live: true }, "2 promotions", [])),
        standing("r5", false, null, ["step: open · closed (budget)"], 88),
      ],
      changedAt,
      now,
    );
    expect(lines[0]).toBe(
      "due at 2026-11-08T04:00Z · 4 step(s) owed, the oldest listed for 40.0 h · 1 run(s) live",
    );
    expect(lines.slice(1).map((line) => line.split(" · ").slice(0, 3).join(" · "))).toEqual([
      "pause · new · r4",
      "outcomes · 40.0 h · r2 and 1 more",
      "open · 12.0 h · r5",
      "vet · 3.0 h · r1",
    ]);
    // Each line ends in the command that prints its step whole.
    const commands = lines.slice(1, 3).map((line) => line.split(" · ").at(-1));
    expect(commands).toEqual(["bun run runs pause r4 --after reported --yes", `bun ${SCRIPT} next /wri/b`]);
    // A stopped run's step that carries no command line still opens.
    expect(lines[3]?.split(" · ").at(-1)).toBe(`bun ${SCRIPT} open r5`);
  });

  it("only counts a step nobody has taken for the days, a closed run's unread trigger included", () => {
    const lines = dueLines(
      [
        standing("r1", false, "/wri/old", ["step: plan · plan.md is missing"]),
        standing("r2", false, null, ["step: open · closed"], 40),
        standing("r3", false, "/wri/a", ["step: plan · plan.md is missing"]),
      ],
      changedAt,
      now,
    );
    // Three owed in all, one listed, and the two older than the days counted on the last line.
    expect(lines.map((line) => /\d+(?= step| of them)/u.exec(line)?.[0])).toEqual(["3", undefined, "2"]);
    expect(lines[1]?.split(" · ").slice(0, 3)).toEqual(["plan", "3.0 h", "r3"]);
    // The same steps are all listed once the window is widened to hold them.
    expect(dueLines([standing("r1", false, "/wri/old", ["step: plan · x"])], changedAt, now, 5)).toHaveLength(
      2,
    );
  });

  it("counts and names the step that `nextOf` prints for a real folder, so a change of its wording shows", () => {
    for (const iteration of [false, true]) {
      const { dir, step } = folder(`due-${String(iteration)}`, "rx", iteration);
      const printed = step();
      const name = /^step: (\w+)/u.exec(printed.find((line) => line.startsWith("step: ")) ?? "")?.[1] ?? "";
      // An owed step: neither the running nor the measured one, which the view leaves out.
      expect(name).toMatch(/^(?!run$|done$)\w+$/u);
      const lines = dueLines([{ ...standing("rx", false, dir, []), step: printed }], () => now, now);
      expect(lines[0]).toContain("1 step(s) owed");
      expect(lines[1]?.split(" · ").slice(0, 3)).toEqual([name, "0.0 h", "rx"]);
    }
  });

  it("never says nothing is owed while every owed step has stood for the days", () => {
    const lines = dueLines([standing("r1", false, "/wri/old", ["step: plan · x"])], changedAt, now);
    expect(lines).toHaveLength(2);
    expect(lines[0]).not.toContain("nothing owed");
    expect(lines.map((line) => /\d+(?= step| of them)/u.exec(line)?.[0])).toEqual(["1", "1"]);
  });

  it("reads the window from a log's last event, so a closed run that ended before it is left out and a live one stays", () => {
    // The file's time is no part of the reading: a copy fetched again is a file written now.
    const ended = standing("r-ended", false, null, ["step: open · closed"], 40);
    const recent = standing("r-recent", false, null, ["step: open · closed"], 60);
    const running = standing("r-live", true, null, ["step: run"], 40);
    const names = (days: number) => movedIn([ended, recent, running], now, days).map(({ row }) => row.name);
    expect(names(2)).toEqual(["r-recent", "r-live"]);
    expect(names(3)).toEqual(["r-ended", "r-recent", "r-live"]);
    // What is left out is owed nowhere, where before it was counted as owed for the days.
    expect(dueLines(movedIn([ended], now, 2), changedAt, now)[0]).toContain("nothing owed");
    expect(dueLines([ended], changedAt, now)[0]).toContain("1 step(s) owed");
  });
});

describe("what a live run does not measure", () => {
  it("counts a change to a campaign command beside the source, and none to a test or a skill", () => {
    const repo = join(base, "measures");
    const put = (path: string, text: string) => {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), text);
    };
    const commit = () => {
      gitText(repo, "add", "-A");
      gitText(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "c");
      return gitText(repo, "rev-parse", "HEAD");
    };
    mkdirSync(repo, { recursive: true });
    gitText(repo, "init", "-q");
    for (const path of ["src/a.ts", "tools/d2/b.ts", "test/c.test.ts", ".claude/skills/s/SKILL.md"]) {
      put(path, "one\n");
    }
    const from = commit();
    put("test/c.test.ts", "two\n");
    put(".claude/skills/s/SKILL.md", "two\n");
    const unrun = commit();
    put("tools/d2/b.ts", "two\n");
    const run = commit();
    const standing = {
      row: rowOf(live, [event(0, "campaign.opened")], OPENED),
      last: OPENED,
      commit: from,
      dir: null,
      step: [],
    };
    expect(unmeasured(repo, unrun, standing)).toContain("changes nothing it runs");
    expect(unmeasured(repo, run, standing)).toContain("1 file(s) of the code a solve runs differ");
  });
});
