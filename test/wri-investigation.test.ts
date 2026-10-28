// What an investigation builds from the catalogue and one log's overview: which lanes open, the
// prompt each session is given, and whether a report has the shape the synthesis reads; and the
// `lanes` verb, run twice over one directory, building each prompt once and listing each session once.
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
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { catalogueText, type Lane, lanesOf, ownersOf } from "../tools/wri/catalogue.ts";
import { lanePrompt, reportOf } from "../tools/wri/investigation.ts";
import { execTextSync } from "./helpers/bun-spawn-sync.ts";
import { containing } from "./helpers/matchers.ts";

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
describe("an investigation's lanes", () => {
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

  const parts = { shared, campaigns: two, catalogue, owners, report: "/r/04.md" };

  it("gives the lane that reads the climb side by side the table, or says one campaign is read, and no other lane either", () => {
    expect(lane(27).sideBySide).toBe(true);
    const named = lanePrompt({ ...parts, lane: lane(27), climb: "CLIMB_CANARY" });
    expect(named).toContain("CLIMB_CANARY");
    expect(lanePrompt({ ...parts, campaigns: one, lane: lane(27) })).toContain("One campaign");
    const ordinary = lanePrompt({ ...parts, lane: lane(4), climb: "CLIMB_CANARY" });
    expect(ordinary).not.toContain("CLIMB_CANARY");
    expect(ordinary).not.toContain("side by side");
  });

  it("gives every lane every campaign as an equal, with each trigger under the campaign it fired on", () => {
    const open = lanePrompt({ ...parts, lane: lane(4) });
    expect(open).toContain("### buffer-a");
    expect(open).toContain("### buffer-b");
    expect(open).toContain("2 campaigns as equals: `buffer-a`, `buffer-b`");
    expect(open).toContain("Fired on `buffer-a`: `REFUSED UNREAD`");
    expect(open).toContain("on `buffer-b`: `CHECK DEFECT RULED`");
    expect(open).toContain("Not fired: `RULED UNCLEAR`");
    expect(open).toContain(
      "Seen in: buffer-a <shows | absent | cannot show>, buffer-b <shows | absent | cannot show>",
    );
    // An isolated lane reads both campaigns too, and of each only its own triggers.
    const isolated = lanePrompt({ ...parts, lane: lane(5), report: "/r/05.md" });
    expect(isolated).toContain("### buffer-b");
    expect(isolated).toContain("FAILS ON ONE CHECK (lane 5)");
    expect(isolated).not.toContain("CHECK DEFECT RULED (lane 4)");
    expect(isolated).not.toContain("REFUSED UNREAD (lane 4)");
    expect(isolated).not.toContain("Why the step.");
    expect(isolated).toContain("quote nothing");
    expect(isolated).toContain("/r/05.md");
    // One campaign is read as before, with no section on the others and no Seen in line.
    const alone = lanePrompt({ ...parts, campaigns: one, lane: lane(4) });
    expect(alone).not.toContain("as equals");
    expect(alone).not.toContain("Seen in:");
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
    for (const [seen, state, missing] of [
      ["buffer-a shows, buffer-b absent", "ok", null],
      [null, "invalid", null],
      ["buffer-a shows", "invalid", "buffer-b"],
      ["buffer-a shows 3, of 4; buffer-b absent", "ok", null],
      ["buffer-a shows 3 and buffer-b too", "invalid", "buffer-b"],
      ["buffer-a-r5 shows, buffer-b absent", "invalid", "buffer-a"],
    ] as const) {
      const text = seen === null ? finding : `${finding}\nSeen in: ${seen}`;
      const report = reportOf(lane(4), text, owners, ["buffer-a", "buffer-b"]);
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
          `${JSON.stringify({ at: new Date(index * 1000).toISOString(), kind, data })}\n`,
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
    execTextSync(capturedExecPath, ["tools/wri/wri.ts", "start", "--log", copies.join(","), "--out", out], {
      cwd: REPO,
    });
    const instructions = readFileSync(join(out, "shared-instructions.md"), "utf8");
    for (const name of ["twin@m1", "twin@linux"]) expect(instructions).toContain(`| ${name} |`);
    writeFileSync(join(out, "shared-instructions.md"), shared);
    lanesVerb();
    const built = prompts();
    const first = manifest();
    expect(first.search).toBe(false);
    expect(first.sessions).toHaveLength(Object.keys(built).length);
    expect(first.sessions.map(({ name }) => name)).toContain("lane_04");
    expect(Object.keys(built)).toContain("04-prompt.md");
    expect(Object.keys(built)).not.toContain("05-prompt.md");
    for (const name of ["twin@m1", "twin@linux"]) expect(built["04-prompt.md"]).toContain(name);
    writeFileSync(join(out, "shared-instructions.md"), shared.replace("Why the step.", "Another question."));
    lanesVerb();
    expect(prompts()).toEqual(built);
    expect(manifest()).toEqual(first);
    lanesVerb("--lanes", "4-5");
    expect(manifest().sessions).toEqual([
      {
        name: "lane_05",
        task: containing("05-prompt.md"),
        ownedPaths: [join(out, "lanes", "05-report.md")],
      },
    ]);
    expect(prompts()["04-prompt.md"]).toBe(built["04-prompt.md"]);
  });
});
