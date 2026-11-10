// What an investigation builds from the catalogue and one log's overview: which lanes open, the
// prompt each session is given, and whether a report has the shape the synthesis reads; and the
// `lanes` verb, run twice over one directory, building each prompt once and listing each session once.
import { afterAll, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join, resolve } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { catalogueText, type Lane, lanesOf, ownersOf } from "../tools/wri/catalogue.ts";
import { READERS } from "../tools/wri/derive.ts";
import {
  lanePrompt,
  movedTo,
  ROWS,
  reportIndex,
  reportOf,
  sharedPrompt,
} from "../tools/wri/investigation.ts";
import { execTextSync } from "./helpers/bun-spawn-sync.ts";
import { containing } from "./helpers/matchers.ts";

const shared =
  "## Orientation\n\nWhy the step.\n\n## Campaigns under review\n\nthe row\n\n## Hard rules\n\n- quote nothing\n";
/** The file `start` writes last and `lanes` reads. */
const INSTRUCTIONS = "shared-instructions.md";
/** The investigation command every verb test runs. */
const WRI = "tools/wri/wri.ts";
const catalogue = catalogueText();
const lanes = lanesOf(catalogue);
const owners = ownersOf(catalogue);
const lane = (number: number): Lane => {
  const found = lanes.find((each) => each.number === number);
  if (found === undefined) throw new Error(`no lane ${String(number)}`);
  return found;
};
describe("an investigation's lanes", () => {
  const rows = [{ id: "A", title: "campaign and log", lines: ["3 events"] }];
  const one = [
    {
      name: "buffer-a",
      log: "/a/log.jsonl",
      overview: {
        rows,
        triggers: [
          { lane: 3, name: "REFUSED UNREAD" as const, detail: "2 of 2" },
          { lane: 4, name: "FAILS ON ONE CHECK" as const, detail: "check-a refused 2 of 2" },
        ],
      },
    },
  ];
  // A second campaign on which lane 3 fired another trigger and lane 4 none.
  const two = [
    ...one,
    {
      name: "buffer-b",
      log: "/b/log.jsonl",
      overview: { rows, triggers: [{ lane: 3, name: "CHECK DEFECT RULED" as const, detail: "1 of 3" }] },
    },
  ];

  const parts = { shared, campaigns: two, catalogue, owners, report: "/r/04.md", common: "/r/shared.md" };

  it("gives the lane that reads the climb side by side the table, or says one campaign is read, and no other lane either", () => {
    expect(lane(22).sideBySide).toBe(true);
    const named = lanePrompt({ ...parts, lane: lane(22), climb: "CLIMB_CANARY" });
    expect(named).toContain("CLIMB_CANARY");
    expect(lanePrompt({ ...parts, campaigns: one, lane: lane(22) })).toContain("One campaign");
    const ordinary = lanePrompt({ ...parts, lane: lane(3), climb: "CLIMB_CANARY" });
    expect(ordinary).not.toContain("CLIMB_CANARY");
    expect(ordinary).not.toContain("side by side");
  });

  it("gives every lane every campaign as an equal, with each trigger under the campaign it fired on", () => {
    const every = sharedPrompt(parts);
    expect(every).toContain("### buffer-a");
    expect(every).toContain("### buffer-b");
    expect(every).toContain("2 campaigns as equals: `buffer-a`, `buffer-b`");
    expect(every).toContain(
      "Seen in: buffer-a <shows | absent | cannot show>, buffer-b <shows | absent | cannot show>",
    );
    const open = lanePrompt({ ...parts, lane: lane(3) });
    expect(open).toContain("Fired on `buffer-a`: `REFUSED UNREAD`");
    expect(open).toContain("on `buffer-b`: `CHECK DEFECT RULED`");
    expect(open).toContain("Not fired: `RULED UNCLEAR`");
    // An isolated lane reads both campaigns too, and of each only its own triggers.
    const isolated = lanePrompt({ ...parts, lane: lane(4), report: "/r/04.md" });
    expect(isolated).toContain("### buffer-b");
    expect(isolated).toContain("FAILS ON ONE CHECK (lane 4)");
    expect(isolated).not.toContain("CHECK DEFECT RULED (lane 3)");
    expect(isolated).not.toContain("REFUSED UNREAD (lane 3)");
    expect(isolated).not.toContain("Why the step.");
    expect(isolated).toContain("quote nothing");
    expect(isolated).toContain("/r/04.md");
    // A blind lane grades before any result, so it is given no orientation, row or trigger.
    expect(lane(27).blind).toBe(true);
    const blind = lanePrompt({ ...parts, lane: lane(27), report: "/r/27.md" });
    expect(blind).not.toContain("Why the step.");
    expect(blind).not.toContain("3 events");
    expect(blind).not.toContain("FAILS ON ONE CHECK (lane 4)");
    expect(blind).toContain("quote nothing");
    expect(blind).toContain("the row");
    // One campaign is read as before, with no section on the others and no Seen in line.
    const alone = sharedPrompt({ ...parts, campaigns: one });
    expect(alone).not.toContain("as equals");
    expect(alone).not.toContain("Seen in:");
  });

  it("keeps what every open lane shares in one file, and gives a lane its own triggers whole", () => {
    const long = "x".repeat(900);
    const fired = [
      {
        name: "buffer-a",
        log: "/a/log.jsonl",
        overview: { rows, triggers: [{ lane: 3, name: "REFUSED UNREAD" as const, detail: long }] },
      },
    ];
    const every = sharedPrompt({ ...parts, campaigns: fired });
    // The shared file holds the question, the rows and every trigger, a long one cut.
    expect(every).toContain("Why the step.");
    expect(every).toContain("A. campaign and log");
    expect(every).toContain(`REFUSED UNREAD (lane 3): ${"x".repeat(300)} [cut at 300 of 900 characters`);
    expect(every).not.toContain(long);
    // The lane's own prompt names that file, holds its trigger whole and repeats nothing shared.
    const open = lanePrompt({ ...parts, campaigns: fired, lane: lane(3) });
    expect(open).toContain("`/r/shared.md`: read it whole once");
    expect(open).toContain(`REFUSED UNREAD (lane 3): ${long}`);
    expect(open).not.toContain("Why the step.");
    expect(open).not.toContain("A. campaign and log");
    expect(open).not.toContain("Who holds which pen");
    // A lane no trigger fired for prints no block, and an alone lane names no shared file.
    expect(lanePrompt({ ...parts, campaigns: fired, lane: lane(7) })).not.toContain(
      "What fired for this lane",
    );
    for (const alone of [lane(4), lane(15), lane(27)]) {
      const prompt = lanePrompt({ ...parts, lane: alone });
      expect(prompt).not.toContain("/r/shared.md");
      expect(prompt).toContain("Who holds which pen");
    }
  });

  it("hands a lane the predictions that name it, holds its report to a line for each, and lists how the lanes resolved them", () => {
    const table = [
      "| id | cause | lanes | claim | falsified by |",
      "| --- | --- | --- | --- | --- |",
      "| A1 | #1 | 3, 7 | CLAIM_ONE | one that does |",
      "| B2 | none | 7, 27, 4 | CLAIM_TWO | a step by validity |",
    ].join("\n");
    const predicting = `${shared}\n## The moved variable and prior state\n\nbefore\n\n${table}\n\nafter\n\n| id | other |\n| --- | --- |\n| Z9 | no lanes column |\n`;
    const open = lanePrompt({ ...parts, shared: predicting, lane: lane(3) });
    expect(open).toContain("## Predictions this lane resolves");
    expect(open).toContain("CLAIM_ONE");
    expect(open).not.toContain("CLAIM_TWO");
    // A lane no row names is handed no section; a lane that freezes or grades first never is.
    expect(lanePrompt({ ...parts, shared: predicting, lane: lane(8) })).not.toContain(
      "Predictions this lane",
    );
    for (const alone of [lane(4), lane(27)]) {
      expect(lanePrompt({ ...parts, shared: predicting, lane: alone })).not.toContain("CLAIM_TWO");
    }
    const head = "# Lane 7: x\nVerdict: no finding, the supply held.\n## Checked\nthe draw\n";
    const of = (text: string, number = 7) => reportOf(lane(number), text, owners, ["buffer-a"], predicting);
    expect(of(head).faults).toEqual([
      "no `Prediction <id>: held | falsified | unreached` line for A1, B2, which the prior state hands this lane",
    ]);
    // A line that names no resolution resolves nothing.
    expect(of(`${head}## Predictions\nPrediction A1: held, 0 of 7\nPrediction B2: likely\n`).faults).toEqual([
      "no `Prediction <id>: held | falsified | unreached` line for B2, which the prior state hands this lane",
    ]);
    const seven = of(
      `${head}## Predictions\nPrediction A1: held, 0 of 7\nPrediction B2: unreached, no step\n`,
    );
    expect(seven).toMatchObject({ state: "ok", resolved: { A1: "held", B2: "unreached" } });
    // A lane left unread owes none, and neither does one the rule keeps from the table.
    expect(of("# Lane 7: x\nVerdict: omitted, lane 11 covers it.\n").faults).toEqual([]);
    expect(of("# Lane 4: x\nVerdict: no finding, sound.\n", 4).faults).toEqual([]);
    const three = of(`${head.replace("Lane 7", "Lane 3")}Prediction A1: falsified, 2 of 7\n`, 3);
    const index = reportIndex([three, seven], (number) => `/r/${String(number)}.md`, one, predicting);
    expect(index).toContain("- A1: held by lane 7; falsified by lane 3");
    expect(index).toContain("- B2: unreached by lane 7; no line from lane 27, 4");
    expect(index).not.toContain("Z9");
    // With no table, the index is the lanes' lines alone.
    expect(reportIndex([three], (number) => `/r/${String(number)}.md`, one)).not.toContain("prediction");
  });

  it("tells an open lane what is already counted and that the record stays open, and an isolated or blind lane neither", () => {
    const every = sharedPrompt({ ...parts, derived: "DERIVED_CANARY" });
    const tools = "tools/wri/log.ts kinds --log <log>";
    expect(catalogue).toContain(tools);
    expect(every).toContain("DERIVED_CANARY");
    expect(every).toContain(tools);
    expect(every).toContain("where to start, not where to stop");
    // With no folder derived, the tools and the freedom are still said.
    expect(sharedPrompt(parts)).toContain("where to start, not where to stop");
    // Lanes 4 and 15 freeze a result first and lane 27 grades blind: a list of every reader's file,
    // readings among them, is what each is kept from.
    for (const alone of [lane(4), lane(15), lane(27)]) {
      const prompt = lanePrompt({ ...parts, lane: alone, report: "/r/x.md", derived: "DERIVED_CANARY" });
      expect(prompt).not.toContain("DERIVED_CANARY");
      expect(prompt).not.toContain(tools);
      expect(prompt).not.toContain("where to start, not where to stop");
    }
  });

  it("names the derived file behind each trigger that fired, to an open lane given the files", () => {
    const pointer = "the rows it counted are in each campaign's derived folder";
    const open = lanePrompt({ ...parts, lane: lane(3), derived: "DERIVED_CANARY" });
    // Both fired triggers share one file; the one that did not fire has no rows to point at.
    expect(open).toContain(`${pointer}: \`rejections.txt\` (\`REFUSED UNREAD\`, \`CHECK DEFECT RULED\`).`);
    // No folder was derived, so no file is named; an isolated lane is handed none.
    expect(lanePrompt({ ...parts, lane: lane(3) })).not.toContain(pointer);
    expect(lanePrompt({ ...parts, lane: lane(4), derived: "DERIVED_CANARY" })).not.toContain(pointer); // Every pointer names a reader the derived folder holds a file of.
    const readers = new Set(READERS.map(({ name }) => name));
    expect(Object.values(ROWS).filter((file) => !readers.has(file))).toEqual([]);
  });

  it("holds each finding of several campaigns to a Seen in line that names every one", () => {
    const finding = [
      "# Lane 3: False rejection among fails",
      "Verdict: finding, one check refuses a valid rounding.",
      "## Findings",
      "### The tolerance",
      "Observation: verdict, 40 of 55 name check-a",
      "Cause: the tolerance is tighter than the published rounding",
      "Owner: pack/evaluator",
      "Reverses if: a refused answer is shown invalid by the rule",
      "Decision: whether a repair is owed",
    ].join("\n");
    for (const [seen, state, missing] of [
      ["buffer-a shows, buffer-b absent", "ok", null],
      [null, "invalid", null],
      ["buffer-a shows", "invalid", "buffer-b"],
      ["buffer-a shows 3, of 4; buffer-b absent", "ok", null],
      ["buffer-a shows 3 and buffer-b too", "invalid", "buffer-b"],
      ["buffer-a-r5 shows, buffer-b absent", "invalid", "buffer-a"],
    ] as const) {
      const text = seen === null ? finding : `${finding}\nSeen in: ${seen}`;
      const report = reportOf(lane(3), text, owners, ["buffer-a", "buffer-b"]);
      expect(report).toMatchObject({ state, findings: 1, verdict: "finding" });
      expect(report.faults).toHaveLength(state === "ok" ? 0 : 1);
      if (missing !== null) expect(report.faults[0]).toContain(missing);
      if (seen === null) {
        expect(report.faults).toEqual([
          "the findings are uneven: Observation: 1, Cause: 1, Owner: 1, Reverses if: 1, Decision: 1, Seen in: 0",
        ]);
      }
    }
  });

  it("lets a session leave an open lane omitted with its reason, never an isolated one, and names one whose trigger fired", () => {
    expect(sharedPrompt(parts)).toContain("Verdict: omitted");
    expect(lanePrompt({ ...parts, lane: lane(4), report: "/r/04.md" })).not.toContain("Verdict: omitted");
    const omitted =
      "# Lane 3: False rejection among fails\nVerdict: omitted, lane 7 of this session covers it.\n";
    const ok = reportOf(lane(3), omitted, owners, ["buffer-a"]);
    expect(ok).toMatchObject({ state: "ok", verdict: "omitted", findings: 0 });
    const written = `${omitted}## Findings\n### x\nObservation: a\nCause: b\nOwner: pack/evaluator\nReverses if: c\nDecision: d\n`;
    expect(reportOf(lane(3), written, owners, ["buffer-a"]).faults).toEqual([
      "the verdict is omitted and the report writes 1 finding",
    ]);
    const isolated = omitted.replace("# Lane 3: False rejection among fails", "# Lane 4: x");
    expect(reportOf(lane(4), isolated, owners, ["buffer-a"]).faults).toEqual([
      "an isolated lane may not be omitted",
    ]);
    const index = reportIndex([ok, { ...ok, lane: 6 }], (number) => `/r/${String(number)}.md`, one);
    expect(index).toContain("lane 3: ok, omitted although its trigger fired");
    expect(index).toContain("lane 6: ok, omitted, 0 findings");
  });

  it("holds a report its session marked provisional as unfinished, and passes the same verdict once final", () => {
    const final = "# Lane 26: The run's launches\nVerdict: could not read, the receipts are gone.\n";
    expect(reportOf(lane(26), final, owners, ["buffer-a"]).faults).toEqual([]);
    const early = final.replace("the receipts are gone", "provisional: reading in progress");
    expect(reportOf(lane(26), early, owners, ["buffer-a"])).toMatchObject({
      state: "invalid",
      faults: ["the verdict is provisional: the session is still writing"],
    });
    // The two lines every prompt has a session write before it reads are no verdict either, while a
    // final sentence may use the word.
    for (const prompt of [
      lanePrompt({ ...parts, lane: lane(26) }),
      lanePrompt({ ...parts, lane: lane(4) }),
    ]) {
      expect(prompt).toContain("Verdict: pending\n```");
    }
    expect(reportOf(lane(26), "# Lane 26: x\nVerdict: pending\n", owners, ["buffer-a"]).faults).toEqual([
      "the verdict is pending: the session is still writing",
    ]);
    const waits = final.replace("the receipts are gone", "a label is pending");
    expect(reportOf(lane(26), waits, owners, ["buffer-a"]).faults).toEqual([]);
  });
});

describe("the lanes verb", () => {
  const REPO = resolve(import.meta.dir, "..");
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ana-wri-")));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  // One pass and two refusals that both name check-a: lane 4's trigger fires, among the open lanes'.
  const events = [
    ["solve.started", { solve: "s1", condition: "c" }],
    ["solve.finished", { solve: "s1", ending: { outcome: "pass" } }],
    ["solve.started", { solve: "s2", condition: "c" }],
    ["solve.finished", { solve: "s2", ending: { outcome: "fail", kind: "rejected" } }],
    ["verdict", { solve: "s2", kind: "fail", blocking: ["check-a", "check-b"] }],
    ["solve.started", { solve: "s3", condition: "c" }],
    ["solve.finished", { solve: "s3", ending: { outcome: "fail", kind: "rejected" } }],
    ["verdict", { solve: "s3", kind: "fail", blocking: ["check-a"] }],
  ] as const;
  const log = join(dir, "log.jsonl");
  writeFileSync(
    log,
    events
      .map(
        ([kind, data], index) =>
          `${JSON.stringify({ at: new Date(index * 1000).toISOString(), kind, data })}\n`,
      )
      .join(""),
  );
  const out = join(dir, "out");
  const lanesVerb = (...more: string[]) =>
    execTextSync(capturedExecPath, [WRI, "lanes", "--out", out, ...more], { cwd: REPO });
  const prompts = () =>
    Object.fromEntries(
      readdirSync(join(out, "lanes")).map((name) => [name, readFileSync(join(out, "lanes", name), "utf8")]),
    );
  const manifest = () =>
    parseJsonAs<{
      search: boolean;
      sessions: { name: string; task: string; ownedPaths: string[] }[];
    }>(readFileSync(join(out, "launch.json"), "utf8"));

  it("keeps host-qualified campaigns and old prompts while launching only newly built lanes", () => {
    const copies = ["m1", "linux"].map((host) => {
      mkdirSync(join(dir, host, "twin"), { recursive: true });
      const copy = join(dir, host, "twin", "log.jsonl");
      writeFileSync(copy, readFileSync(log, "utf8"));
      return copy;
    });
    execTextSync(capturedExecPath, [WRI, "start", "--log", copies.join(","), "--out", out], {
      cwd: REPO,
    });
    const instructions = readFileSync(join(out, INSTRUCTIONS), "utf8");
    for (const name of ["twin@m1", "twin@linux"]) expect(instructions).toContain(`| ${name} |`);
    writeFileSync(join(out, INSTRUCTIONS), shared);
    lanesVerb();
    const built = prompts();
    const first = manifest();
    expect(first.search).toBe(false);
    // Without --agents the lanes go to four sessions, each lane in exactly one.
    expect(first.sessions).toHaveLength(4);
    expect(first.sessions.flatMap(({ ownedPaths }) => ownedPaths).toSorted()).toEqual(
      Object.keys(built)
        .filter((name) => name.endsWith("-prompt.md"))
        .map((name) => join(out, "lanes", name.replace("-prompt", "-report")))
        .toSorted(),
    );
    expect(Object.keys(built)).toContain("03-prompt.md");
    expect(Object.keys(built)).not.toContain("04-prompt.md");
    // One file holds what the open lanes share, and each of their prompts names it.
    const commons = () => Object.keys(prompts()).filter((name) => name.startsWith("shared-"));
    const [common = ""] = commons();
    expect(commons()).toHaveLength(1);
    for (const name of ["twin@m1", "twin@linux", "Why the step."]) expect(built[common]).toContain(name);
    expect(built["03-prompt.md"]).toContain(join(out, "lanes", common));
    expect(built["03-prompt.md"]).not.toContain("Why the step.");
    writeFileSync(join(out, INSTRUCTIONS), shared.replace("Why the step.", "Another question."));
    lanesVerb();
    expect(prompts()).toEqual(built);
    expect(manifest()).toEqual(first);
    lanesVerb("--lanes", "3-4");
    // A lane that runs alone gets a manifest of its own, beside the open lanes' one.
    expect(manifest()).toEqual(first);
    expect(
      parseJsonAs<{ sessions: unknown[] }>(readFileSync(join(out, "launch-04.json"), "utf8")).sessions,
    ).toEqual([
      {
        name: "lane_04",
        task: containing("04-prompt.md"),
        ownedPaths: [join(out, "lanes", "04-report.md")],
      },
    ]);
    expect(prompts()["03-prompt.md"]).toBe(built["03-prompt.md"]);
    // A later build of an open lane gets one too: until 9 November it wrote over `launch.json`, and
    // the sessions the first build had launched were owed by no manifest.
    const later = Array.from({ length: 31 }, (_, index) => index + 1).find(
      (number) => ![4, 15].includes(number) && !(`${String(number).padStart(2, "0")}-prompt.md` in prompts()),
    );
    const stemOf = String(later).padStart(2, "0");
    lanesVerb("--lanes", String(later));
    expect(manifest()).toEqual(first);
    expect(
      parseJsonAs<{ sessions: { name: string }[] }>(
        readFileSync(join(out, `launch-${stemOf}.json`), "utf8"),
      ).sessions.map(({ name }) => name),
    ).toEqual([`lane_${stemOf}`]);
    // It was built under the edited instructions, so it names a shared file of its own beside the
    // first, which the earlier prompts still point at unchanged.
    const newer = commons().find((name) => name !== common) ?? "";
    expect(commons()).toHaveLength(2);
    expect(prompts()[newer]).toContain("Another question.");
    expect(prompts()[`${stemOf}-prompt.md`]).toContain(join(out, "lanes", newer));
    expect(prompts()[common]).toBe(built[common]);
  });

  it("writes the shared instructions last, so a start that failed can be run again", () => {
    const failed = join(dir, "failed-out");
    // A folder in the overview's place makes the start fail as it writes.
    mkdirSync(join(failed, "overview.md"), { recursive: true });
    const begin = () =>
      execTextSync(capturedExecPath, [WRI, "start", "--log", log, "--out", failed], {
        cwd: REPO,
      });
    expect(begin).toThrow();
    expect(existsSync(join(failed, INSTRUCTIONS))).toBe(false);
    rmSync(join(failed, "overview.md"), { recursive: true });
    begin();
    expect(existsSync(join(failed, "investigation.json"))).toBe(true);
    expect(existsSync(join(failed, INSTRUCTIONS))).toBe(true);
  });

  it("checks out no tree for a launch whose commit this repository does not hold", () => {
    const gone = join(dir, "gone", "log.jsonl");
    mkdirSync(dirname(gone), { recursive: true });
    writeFileSync(gone, readFileSync(log, "utf8"));
    const receipt = {
      at: new Date(0).toISOString(),
      commit: "0".repeat(40),
      dirty: false,
      load: 1,
      cores: 4,
    };
    writeFileSync(join(dirname(gone), "launch-run-1.json"), JSON.stringify(receipt));
    execTextSync(capturedExecPath, [WRI, "start", "--log", gone, "--out", join(dir, "gone-out")], {
      cwd: REPO,
    });
    const instructions = readFileSync(join(dir, "gone-out", INSTRUCTIONS), "utf8");
    expect(instructions).toContain("| gone |");
    expect(instructions).not.toContain("is checked out at");
  });

  it("packs the lanes it builds into as many sessions as asked, each lane in exactly one", () => {
    const packed = join(dir, "packed");
    execTextSync(capturedExecPath, [WRI, "start", "--log", log, "--out", packed], {
      cwd: REPO,
    });
    writeFileSync(join(packed, INSTRUCTIONS), shared);
    execTextSync(capturedExecPath, [WRI, "lanes", "--out", packed, "--agents", "2"], {
      cwd: REPO,
    });
    const { sessions } = parseJsonAs<{ sessions: { name: string; ownedPaths: string[] }[] }>(
      readFileSync(join(packed, "launch.json"), "utf8"),
    );
    const built = readdirSync(join(packed, "lanes")).filter((name) => name.endsWith("-prompt.md"));
    expect(sessions).toHaveLength(2);
    expect(sessions.flatMap(({ ownedPaths }) => ownedPaths).toSorted()).toEqual(
      built.map((name) => join(packed, "lanes", name.replace("-prompt", "-report"))).toSorted(),
    );
    expect(new Set(sessions.map(({ name }) => name)).size).toBe(2);
  });

  it("reads a stored log that moved from where its campaign stands, and refuses one no run holds instead of reading no event", () => {
    const stored = "/trees/run/.ana/d2/retired-run/log.jsonl";
    const held = [
      { name: "other-run", path: "/archive/here/other-run/log.jsonl" },
      { name: "retired-run", path: "/archive/here/retired-run/log.jsonl" },
    ];
    expect(movedTo(stored, held)).toBe("/archive/here/retired-run/log.jsonl");
    expect(() => movedTo(stored, held.slice(0, 1))).toThrow("is gone");
    // The verb: lane 4's trigger is in this log, and without the log the build would open no such lane.
    const nowhere = join(dir, "ana-wri-held-by-no-run", "log.jsonl");
    mkdirSync(dirname(nowhere), { recursive: true });
    writeFileSync(nowhere, readFileSync(log, "utf8"));
    const at = join(dir, "moved-out");
    execTextSync(capturedExecPath, [WRI, "start", "--log", nowhere, "--out", at], { cwd: REPO });
    writeFileSync(join(at, INSTRUCTIONS), shared);
    rmSync(nowhere);
    const build = () => execTextSync(capturedExecPath, [WRI, "lanes", "--out", at], { cwd: REPO });
    expect(build).toThrow("no worktree or archive holds a campaign ana-wri-held-by-no-run");
    expect(existsSync(join(at, "launch.json"))).toBe(false);
  });

  it("gives the heaviest sessions high effort and the rest medium where --high names how many", () => {
    const at = join(dir, "efforts");
    execTextSync(capturedExecPath, [WRI, "start", "--log", log, "--out", at], { cwd: REPO });
    writeFileSync(join(at, INSTRUCTIONS), shared);
    const printed = execTextSync(
      capturedExecPath,
      [WRI, "lanes", "--out", at, "--agents", "3", "--high", "1"],
      { cwd: REPO },
    );
    const { sessions } = parseJsonAs<{ sessions: { name: string; effort: string }[] }>(
      readFileSync(join(at, "launch.json"), "utf8"),
    );
    const weights = [...printed.matchAll(/weight ([\d.]+), (\w+) effort/gu)].map(([, weight, effort]) => [
      Number(weight),
      effort,
    ]);
    expect(sessions.map(({ effort }) => effort).toSorted()).toEqual(["high", "medium", "medium"]);
    const [heaviest] = weights.toSorted(([one], [other]) => Number(other) - Number(one));
    expect(heaviest?.[1]).toBe("high");
  });

  const begun = (name: string) => {
    const at = join(dir, name);
    execTextSync(capturedExecPath, [WRI, "start", "--log", log, "--out", at], { cwd: REPO });
    writeFileSync(join(at, INSTRUCTIONS), shared);
    return at;
  };
  const verbAt = (at: string, ...more: string[]) =>
    execTextSync(capturedExecPath, [WRI, "lanes", "--out", at, ...more], { cwd: REPO });

  it("packs again only the built lanes with no report, and only with --regroup", () => {
    const at = begun("regrouped");
    verbAt(at, "--agents", "2");
    const { sessions } = parseJsonAs<{ sessions: { ownedPaths: string[] }[] }>(
      readFileSync(join(at, "launch.json"), "utf8"),
    );
    // The first lane of each of the two sessions stays unreported, and every other lane is reported.
    const open = sessions.flatMap(({ ownedPaths: [first] }) => (first === undefined ? [] : [first]));
    expect(open).toHaveLength(2);
    for (const report of sessions.flatMap(({ ownedPaths }) => ownedPaths)) {
      if (!open.includes(report)) writeFileSync(report, "a report\n");
    }
    const promptBytes = () =>
      Object.fromEntries(
        readdirSync(join(at, "lanes"))
          .filter((name) => name.endsWith("-prompt.md"))
          .map((name) => [name, readFileSync(join(at, "lanes", name), "utf8")]),
      );
    const before = promptBytes();
    const manifests = () => readdirSync(at).filter((name) => name.startsWith("launch"));
    verbAt(at, "--agents", "1");
    expect(manifests()).toEqual(["launch.json"]);
    verbAt(at, "--agents", "1", "--regroup");
    const stems = open.map((path) => path.split("/").at(-1)?.slice(0, 2) ?? "").toSorted();
    const regrouped = parseJsonAs<{ sessions: { ownedPaths: string[] }[] }>(
      readFileSync(join(at, `launch-${stems.join("-")}.json`), "utf8"),
    ).sessions;
    expect(regrouped).toHaveLength(1);
    expect(regrouped[0]?.ownedPaths.toSorted()).toEqual(open.toSorted());
    expect(promptBytes()).toEqual(before);
  });

  it("creates the lanes folder where it is missing", () => {
    const at = begun("bare");
    rmSync(join(at, "lanes"), { recursive: true });
    verbAt(at);
    const built = readdirSync(join(at, "lanes")).filter((name) => name.endsWith("-prompt.md"));
    expect(built.length).toBeGreaterThan(0);
    expect(
      parseJsonAs<{ sessions: unknown[] }>(readFileSync(join(at, "launch.json"), "utf8")).sessions,
    ).toHaveLength(Math.min(4, built.length));
  });
});
