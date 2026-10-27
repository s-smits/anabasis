// What an investigation builds from the catalogue and one log's overview: which lanes open, the
// prompt each session is given, and whether a report has the shape the synthesis reads; and the
// `lanes` verb, run twice over one directory, building each prompt once and listing each session once;
// and the `read` verb's host line, which finds the code a campaign ran in the tree its log sits in;
// and the `grade` verb, which holds an answer to a drafted exam's format before its checks.
import { afterAll, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { type Condition, conditionId } from "../src/kernel/condition.ts";
import { append } from "../src/kernel/log.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { codeOf } from "../tools/d2/campaign.ts";
import { stageExam } from "../tools/d2/exam.ts";
import { catalogueText, type Lane, lanesOf, ownersOf } from "../tools/wri/catalogue.ts";
import {
  blankSections,
  filled,
  lanePrompt,
  numbersOf,
  reportOf,
  selected,
} from "../tools/wri/investigation.ts";
import { execTextSync } from "./helpers/bun-spawn-sync.ts";
import { SOUND } from "./helpers/examiner-seat.ts";

const shared =
  "## Orientation\n\nWhy the step.\n\n## Campaigns under review\n\nthe row\n\n## Hard rules\n\n- quote nothing\n";
const catalogue = catalogueText();
const lanes = lanesOf(catalogue);
const owners = ownersOf(catalogue);
const lane = (number: number): Lane => {
  const found = lanes.find((each) => each.number === number);
  if (found === undefined) throw new Error(`no lane ${String(number)}`);
  return found;
};
const numbers = (some: readonly Lane[]) => some.map((each) => each.number);
const fired = (...started: number[]) =>
  started.map((number) => ({ lane: number, name: "CHAIN" as const, detail: "" }));

describe("an investigation's lanes", () => {
  it("opens the triggered and the standing lanes, and leaves an isolated lane waiting", () => {
    const { open, isolated, waiting } = selected(lanes, fired(4, 5, 29), null);
    expect(numbers(open)).toEqual([1, 4, 18, 23, 29]);
    expect(isolated).toEqual([]);
    expect(numbers(waiting)).toEqual([5]);
  });

  it("builds a named isolated lane only on its trigger", () => {
    expect(numbers(selected(lanes, fired(5), numbersOf("3-4,5")).isolated)).toEqual([5]);
    expect(() => selected(lanes, fired(4), [19])).toThrow("runs only on its trigger");
    const wins = { lane: 19, name: "WINS" as const, detail: "" };
    expect(() => selected(lanes, [wins], [19])).toThrow("runs only on its trigger");
    const program = { lane: 19, name: "ANSWER FROM A PROGRAM" as const, detail: "" };
    expect(numbers(selected(lanes, [wins, program], [19]).isolated)).toEqual([19]);
    expect(() => selected(lanes, [], [37])).toThrow("no lane 37");
  });

  it("refuses shared instructions with a section left blank", () => {
    expect(blankSections("## Orientation\n\n<!-- AUTHOR: write it -->\n\n## Hard rules\n\n- one\n")).toEqual([
      "Orientation",
    ]);
  });

  const rows = [{ id: "A", title: "campaign and log", lines: ["3 events"] }];
  const one = [
    {
      name: "buffer-a",
      log: "/a/log.jsonl",
      overview: {
        rows,
        triggers: [
          { lane: 4, name: "REFUSED UNREAD" as const, detail: "2 of 2" },
          { lane: 5, name: "FAILS ON ONE CHECK" as const, detail: "check-a refused 2 of 2" },
        ],
      },
    },
  ];
  // A second campaign on which lane 4 fired another trigger and lane 5 none.
  const two = [
    ...one,
    {
      name: "buffer-b",
      log: "/b/log.jsonl",
      overview: { rows, triggers: [{ lane: 4, name: "CHECK DEFECT RULED" as const, detail: "1 of 3" }] },
    },
  ];

  it("gives an open lane the shared instructions and every trigger", () => {
    const prompt = lanePrompt({
      lane: lane(4),
      shared,
      campaigns: one,
      catalogue,
      owners,
      report: "/r/04.md",
    });
    expect(prompt).toContain("Why the step.");
    expect(prompt).toContain("FAILS ON ONE CHECK (lane 5)");
    expect(prompt).toContain("**4. False rejection among fails.**");
    expect(prompt).toContain("Write your report to `/r/04.md`");
  });

  it("gives an isolated lane the hard rules and its own trigger, and not the operator's question", () => {
    const prompt = lanePrompt({
      lane: lane(5),
      shared,
      campaigns: one,
      catalogue,
      owners,
      report: "/r/05.md",
    });
    expect(prompt).toContain("- quote nothing");
    expect(prompt).toContain("FAILS ON ONE CHECK (lane 5)");
    expect(prompt).not.toContain("Why the step.");
    expect(prompt).not.toContain("REFUSED UNREAD");
  });

  it("says which of the lane's own triggers fired and which did not, so a name in its body is no lead", () => {
    const parts = { shared, campaigns: one, catalogue, owners, report: "/r/04.md" };
    const prompt = lanePrompt({ ...parts, lane: lane(4) });
    expect(prompt).toContain("Fired on this campaign: `REFUSED UNREAD`");
    expect(prompt).toContain("Not fired: `CHECK DEFECT RULED`, `RULED UNCLEAR`.");
    // Lane 16's body names `NEVER CHECKED`, which buffer-a's lane 14 read as fired (11 October).
    const standing = lanePrompt({ ...parts, lane: lane(16) });
    expect(standing).toContain("None of these triggers fired on this campaign");
    expect(standing).toContain("Not fired: `NEVER CHECKED`, `TOOLS CALLED`, `TOOL CALLS ERRED`.");
  });

  it("gives the lane that reads the climb side by side the table, or says one campaign is read, and no other lane either", () => {
    const parts = { shared, campaigns: two, catalogue, owners, report: "/r/31.md" };
    expect(lane(27).sideBySide).toBe(true);
    const named = lanePrompt({ ...parts, lane: lane(27), climb: "### The climb, side by side" });
    expect(named).toContain("## The campaigns side by side");
    expect(named).toContain("### The climb, side by side");
    expect(lanePrompt({ ...parts, campaigns: one, lane: lane(27) })).toContain(
      "One campaign is under review",
    );
    expect(lanePrompt({ ...parts, lane: lane(4), climb: "### The climb" })).not.toContain("side by side");
  });

  it("gives every lane every campaign as an equal, with each trigger under the campaign it fired on", () => {
    const parts = { shared, campaigns: two, catalogue, owners, report: "/r/04.md" };
    const open = lanePrompt({ ...parts, lane: lane(4) });
    expect(open).toContain("### buffer-a");
    expect(open).toContain("### buffer-b");
    expect(open).toContain("## Every campaign is under review");
    expect(open).toContain("Fired on `buffer-a`: `REFUSED UNREAD`; on `buffer-b`: `CHECK DEFECT RULED`");
    expect(open).toContain("Not fired: `RULED UNCLEAR`.");
    expect(open).toContain("Seen in: buffer-a <shows | absent | cannot show>, buffer-b");
    // An isolated lane reads both campaigns too, and of each only its own triggers.
    const isolated = lanePrompt({ ...parts, lane: lane(5), report: "/r/05.md" });
    expect(isolated).toContain("### buffer-b");
    expect(isolated).toContain("FAILS ON ONE CHECK (lane 5)");
    expect(isolated).not.toContain("CHECK DEFECT RULED (lane 4)");
    // One campaign is read as before, with no section on the others and no Seen in line.
    const alone = lanePrompt({ ...parts, campaigns: one, lane: lane(4) });
    expect(alone).not.toContain("## Every campaign is under review");
    expect(alone).not.toContain("Seen in:");
  });

  it("holds a report to its shape", () => {
    const good = [
      "# Lane 4: False rejection among fails",
      "Verdict: finding, one check refuses a valid rounding.",
      "## Findings",
      "### The tolerance",
      "Observation: verdict, 40 of 55 name check-a",
      "Cause: the tolerance is tighter than the published rounding",
      "Owner: pack/evaluator",
      "Reverses if: a refused answer is shown invalid by the rule",
      "Decision: whether a repair is owed",
    ].join("\n");
    expect(reportOf(lane(4), good, owners, [])).toMatchObject({
      state: "ok",
      verdict: "finding",
      findings: 1,
    });
    expect(reportOf(lane(4), null, owners, []).state).toBe("missing");
    expect(reportOf(lane(4), good.replace("pack/evaluator", "the checker"), owners, []).faults).toEqual([
      "1 of 1 owners are not in the owner table",
    ]);
    expect(reportOf(lane(4), "# Lane 4: x\nVerdict: finding\n", owners, []).faults).toEqual([
      "the verdict is a finding and none is written",
    ]);
    // Recode's lane 15 on 10 October: no finding said, two written, and accepted.
    const denied = `${good.replace("Verdict: finding", "Verdict: no finding")}\n${good.split("\n").slice(3).join("\n")}`;
    expect(reportOf(lane(4), denied, owners, [])).toMatchObject({
      state: "invalid",
      faults: ["the verdict is no finding and the report writes 2 findings"],
    });
    expect(
      reportOf(lane(4), "# Lane 4: x\nVerdict: no finding, all sound\n## Findings\n", owners, []).state,
    ).toBe("ok");
  });

  it("holds each finding of several campaigns to a Seen in line that names every one", () => {
    const finding = [
      "# Lane 4: False rejection among fails",
      "Verdict: finding, one check refuses a valid rounding.",
      "## Findings",
      "### The tolerance",
      "Observation: verdict, 40 of 55 name check-a",
      "Cause: the tolerance is tighter than the published rounding",
      "Owner: pack/evaluator",
      "Reverses if: a refused answer is shown invalid by the rule",
      "Decision: whether a repair is owed",
    ].join("\n");
    const names = ["buffer-a", "buffer-b"];
    expect(
      reportOf(lane(4), `${finding}\nSeen in: buffer-a shows, buffer-b absent`, owners, names).state,
    ).toBe("ok");
    expect(reportOf(lane(4), finding, owners, names).faults).toEqual([
      "the findings are uneven: Observation: 1, Cause: 1, Owner: 1, Reverses if: 1, Decision: 1, Seen in: 0",
    ]);
    expect(reportOf(lane(4), `${finding}\nSeen in: buffer-a shows`, owners, names).faults).toEqual([
      "a Seen in: line leaves out buffer-b",
    ]);
    // A semicolon parts two entries as a comma does, so a triage may hold commas.
    expect(
      reportOf(lane(4), `${finding}\nSeen in: buffer-a shows 3, of 4; buffer-b absent`, owners, names).state,
    ).toBe("ok");
    expect(
      reportOf(lane(4), `${finding}\nSeen in: buffer-a shows 3 and buffer-b too`, owners, names).faults,
    ).toEqual(["a Seen in: line leaves out buffer-b"]);
    // A name that holds another as its prefix stands for that campaign alone.
    expect(
      reportOf(lane(4), `${finding}\nSeen in: buffer-a-r5 shows, buffer-b absent`, owners, names).faults,
    ).toEqual(["a Seen in: line leaves out buffer-a"]);
  });

  it("fills a template's slots and names one it cannot fill", () => {
    expect(filled("<!-- note -->\nto {out}\n", { out: "/d" })).toBe("to /d\n");
    expect(() => filled("{reports}", {})).toThrow("which nothing fills");
  });
});

describe("the lanes verb", () => {
  const REPO = resolve(import.meta.dir, "..");
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ana-wri-")));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  // One pass and two refusals that both name check-a: lane 5's trigger fires, among the open lanes'.
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
          `${JSON.stringify({ at: new Date(index * 1_000).toISOString(), kind, data })}\n`,
      )
      .join(""),
  );
  const out = join(dir, "out");
  const lanesVerb = (...more: string[]) =>
    execTextSync(capturedExecPath, ["tools/wri/wri.ts", "lanes", "--out", out, ...more], { cwd: REPO });
  const prompts = () =>
    Object.fromEntries(
      readdirSync(join(out, "lanes")).map((name) => [name, readFileSync(join(out, "lanes", name), "utf8")]),
    );
  const sessions = () =>
    parseJsonAs<{ sessions: { name: string; task: string; ownedPaths: string[] }[] }>(
      readFileSync(join(out, "launch.json"), "utf8"),
    ).sessions;

  it("keeps a prompt built before, and launches only the lanes each call built", () => {
    mkdirSync(join(out, "lanes"), { recursive: true });
    writeFileSync(join(out, "investigation.json"), JSON.stringify({ logs: [log] }));
    writeFileSync(join(out, "shared-instructions.md"), shared);
    lanesVerb();
    const [built, first] = [prompts(), sessions()];
    expect(first).toHaveLength(Object.keys(built).length);
    expect(first.map(({ name }) => name)).toContain("lane_04");
    expect(parseJsonAs<{ search: boolean }>(readFileSync(join(out, "launch.json"), "utf8")).search).toBe(
      false,
    );
    expect(Object.keys(built)).toContain("04-prompt.md");
    expect(Object.keys(built)).not.toContain("05-prompt.md");
    // The primary rewrites the orientation after the first sessions wrote against the first prompts.
    writeFileSync(join(out, "shared-instructions.md"), shared.replace("Why the step.", "Another question."));
    expect(lanesVerb()).toContain("nothing to launch");
    expect(prompts()).toEqual(built);
    expect(sessions()).toEqual(first);
    expect(lanesVerb("--lanes", "4-5")).toContain("lane 4: built before, kept");
    expect(sessions()).toEqual([
      {
        name: "lane_05",
        task: expect.stringContaining("05-prompt.md"),
        ownedPaths: [join(out, "lanes", "05-report.md")],
      },
    ]);
    expect(prompts()["04-prompt.md"]).toBe(built["04-prompt.md"]);
  });

  it("starts over two hosts' copies of one campaign name, and builds lanes that name each by its host", () => {
    const copies = ["m1", "linux"].map((host) => {
      mkdirSync(join(dir, host, "twin"), { recursive: true });
      const copy = join(dir, host, "twin", "log.jsonl");
      writeFileSync(copy, readFileSync(log, "utf8"));
      return copy;
    });
    const twins = join(dir, "twins");
    execTextSync(capturedExecPath, ["tools/wri/wri.ts", "start", "--log", copies.join(","), "--out", twins], {
      cwd: REPO,
    });
    const instructions = readFileSync(join(twins, "shared-instructions.md"), "utf8");
    expect(instructions).toContain("| twin@m1 |");
    expect(instructions).toContain("| twin@linux |");
    // `lanes` names no `--log`: it reads the logs `start` saved, and keeps both names apart.
    writeFileSync(join(twins, "shared-instructions.md"), shared);
    execTextSync(capturedExecPath, ["tools/wri/wri.ts", "lanes", "--out", twins], { cwd: REPO });
    const prompt = readFileSync(join(twins, "lanes", "04-prompt.md"), "utf8");
    expect(prompt).toContain("twin@m1");
    expect(prompt).toContain("twin@linux");
  });
});

describe("the read verb's host line", () => {
  const REPO = resolve(import.meta.dir, "..");
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ana-wri-host-")));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const tree = join(dir, "tree");
  mkdirSync(join(tree, "src"), { recursive: true });
  mkdirSync(join(tree, "vendor"), { recursive: true });
  writeFileSync(join(tree, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(tree, "vendor", "v.txt"), "v\n");
  writeFileSync(join(tree, "package.json"), '{ "dependencies": {} }\n');
  const treeHost = codeOf(tree).host;
  const hostLine = (host: string) => {
    const log = join(tree, ".ana", "d2", "c", "log.jsonl");
    mkdirSync(join(tree, ".ana", "d2", "c"), { recursive: true });
    // A condition as `tools/d2/campaign.ts` records one; only its host is read here.
    const condition: Condition = {
      contract: "c1",
      harness: "h1",
      task: "t1",
      model: "p/m",
      effort: "high",
      prices: { "p/m": { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } },
      runtime: {},
      compaction: "off",
      solverTools: "s1",
      verifierTools: "v1",
      sandbox: "x1",
      limits: {
        wallSeconds: 1,
        turns: 1,
        shellDefaultSeconds: 1,
        shellMaxSeconds: 1,
        concurrency: 1,
      },
      host,
      side: "test",
    };
    const event = {
      at: new Date(0).toISOString(),
      kind: "condition.recorded",
      data: { id: conditionId(condition), condition },
    };
    writeFileSync(log, `${JSON.stringify(event)}\n`);
    return execTextSync(capturedExecPath, ["tools/wri/wri.ts", "read", "--log", log], { cwd: REPO })
      .trim()
      .split("\n")
      .at(-1);
  };

  it("sends a lane to the campaign's own tree when that tree holds the code it ran", () => {
    expect(hostLine(treeHost)).toContain(`which the campaign's own tree \`${tree}\` holds as it stands`);
  });

  it("says source is another tree when neither the checkout nor the campaign's tree holds it", () => {
    expect(hostLine("0".repeat(64))).toContain("so every statement about source is about another tree");
  });
});

describe("the grade verb", () => {
  const REPO = resolve(import.meta.dir, "..");
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ana-wri-grade-")));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  // A drafted exam whose format refuses a key it does not name, and whose check reads one key alone.
  const answerFormat = {
    type: "object",
    properties: { answer: { type: "string" } },
    required: ["answer"],
    additionalProperties: false,
  };
  const draft = { ...SOUND, answerFormat };
  const log = join(dir, "log.jsonl");
  append(log, "exam.drafted", { session: "d-1", draft: parseJsonAs<JsonObject>(JSON.stringify(draft)) });
  stageExam(dir, draft);
  const graded = (answer: JsonObject) => {
    const file = join(dir, "answer.json");
    writeFileSync(file, JSON.stringify(answer));
    const args = ["tools/wri/wri.ts", "grade", "--log", log, "--task", "ex-001", "--answer", file];
    return execTextSync(capturedExecPath, args, { cwd: REPO }).trim();
  };

  it("refuses an answer outside the format before any check reads it, as the host refuses a solver's", () => {
    expect(graded({ answer: "12", note: "x" })).toStartWith("fail format: ");
    expect(graded({ answer: "12" })).toBe("pass");
  });
});
