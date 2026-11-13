// The page over every investigation reads each folder as it stands, lenient to the older shapes: a
// full one, one without vetting, one written before the template, one with notes alone, one whose
// review or A/B synthesis stands in, one with collected lanes alone. Then it lists every ledger and
// every campaign that moved lately, and never quotes what a labels folder, a ledger or a log holds.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import { tmpdir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";
import { investigationIndex } from "../tools/wri/index.ts";
import type { Run } from "../tools/runs/registry.ts";

const LONG = "word ".repeat(120);
const SYNTHESIS = `# Synthesis: two campaigns

## 1. Whether the reading may be believed

Yes.

## 2. The binding constraint

<!-- the author's comment, never quoted -->

**Supply, not the harness, held the climb at v0.9.1.** The second sentence is never quoted.

## 3. Merged findings

| # | finding | lanes | owner | evidence | outcome |
| --- | --- | --- | --- | --- | --- |
| 1 | a | 2 | \`src/a.ts\` | e | patch |
| 2 | b | 3 | \`src/b.ts\` | e | **decision** (operator) |
| 3 | c | 4 | \`src/c.ts\` | e | patch |

## 4. Conflicts resolved
`;
const VETTING = `# Vetting

| id | finding | verdict | checked |
| --- | --- | --- | --- |
| F1 | a | confirmed | recounted |
| F2 | b | plausible, rests on one lane | read |
| F3 | c | refuted as worded | read |

| row | claim | resolution | witness |
| --- | --- | --- | --- |
| P1 | x | held, 5 of 5 | counted |
| P2 | y | **falsified** in one run, held in another | counted |
| P3 | z | unreached | none |

| Row | Fix | PR | Evidence |
| --- | --- | --- | --- |
| F1 | patched | #1 | confirmed by a test |
`;
const REPORTS = [
  "# Reports",
  "",
  "- lane 1: ok, finding, 2 findings, at `lanes/01-report.md`",
  "- lane 2: ok, no finding, 0 findings, at `lanes/02-report.md`",
  "- lane 3: missing, at `lanes/03-report.md`",
  // A lane left unread, which until 9 November the index counted as one read with no finding.
  "- lane 4: ok, omitted although its trigger fired, 0 findings, at `lanes/04-report.md`",
  "- lane 5: ok, could not read, 0 findings, at `lanes/05-report.md`",
  "",
].join("\n");

const NOW = Date.parse("2026-11-03T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const ledgerTables = (rows: readonly string[]) =>
  ["| time | id | held, falsified or unreached | count |", "| --- | --- | --- | --- |", ...rows, ""].join(
    "\n",
  );

let root = "";
let elsewhere = "";
let runs: Run[] = [];

function folder(name: string, files: Readonly<Record<string, string>>, under = root): void {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(under, name, file, ".."), { recursive: true });
    writeFileSync(join(under, name, file), text);
  }
}

/** A campaign log of `events`, each `[days ago, kind, data]`, as the registry would list it. */
function campaign(
  name: string,
  events: readonly (readonly [number, string, Readonly<Record<string, string>>])[],
  extra: Partial<Run> = {},
): Run {
  const path = join(elsewhere, name, "log.jsonl");
  const lines = events.map(([days, kind, data]) => JSON.stringify({ at: daysAgo(days), kind, data }));
  folder(name, { "log.jsonl": `${lines.join("\n")}\n` }, elsewhere);
  return { name, tree: "/x/anabasis-w", path, end: "comparison.reported", ...extra };
}

const index = (notes = join(elsewhere, "notes")) => investigationIndex(root, { notes, runs, now: NOW });
const section = (text: string, from: string) => text.slice(text.indexOf(from)).split("\n## ")[0] ?? "";
const rowsIn = (text: string, from: string) =>
  section(text, from)
    .split("\n")
    .filter((line) => /^\| (20|undated|unreadable)/u.test(line));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ana-wri-index-"));
  elsewhere = mkdtempSync(join(tmpdir(), "ana-wri-index-beyond-"));
  folder("2026-11-03-full", {
    "investigation.json": JSON.stringify({
      logs: ["/w/.ana/d2/buffer-fresh-opus-a/log.jsonl", "/w/.ana/d2/esp32-fresh-opus-b/log.jsonl"],
    }),
    "synthesis.md": SYNTHESIS,
    "vetting.md": VETTING,
    "reports.md": REPORTS,
  });
  folder("2026-10-20-no-vetting", {
    "investigation.json": JSON.stringify({ log: "/w/.ana/d2/buffer-fresh-opus-r5/log.jsonl", peers: [] }),
    "synthesis.md": SYNTHESIS.replace("Supply, not the harness, held the climb at v0.9.1.", LONG),
  });
  folder("2026-10-27-old-style", {
    "synthesis.md": "# The Examiner: what was tried\n\n## 1. What was tried\n\nMuch.\n",
    "overview.md": "## truss-fresh-opus-v071\n\nA. campaign\n\n## job-fresh-opus-v071\n",
  });
  folder("20261101-notes", { "README.md": "notes" });
  writeFileSync(join(root, "2026-10-21-cross-run.md"), "loose");
  writeFileSync(join(root, "INDEX.md"), "the page before, never read as a folder");
  // (a) what stands in for a synthesis, and a labels folder whose subfolders hold hidden values.
  folder("2026-10-15-multipromotion", {
    "review.md": "# The first review, superseded.\n",
    "review-v2.md": "# Repeated promotions held under the cap. REVIEW-SECRET follows.\n\nBody.\n",
  });
  folder("20261101-gate-validity-b", {
    "ab-synthesis.md": "# A/B synthesis\n\n## 1. What the two draws found\n\nAB-SECRET.\n",
  });
  folder("2026-10-21-final-r5", { "reports.md": REPORTS, "lanes/01-report.md": "LANE-SECRET" });
  folder("labels-2026-11-03", { "buffer-fresh-opus-x/settle-g-1/labels.json": '{"label":"LABEL-SECRET"}' });
  // (b) ledgers in a cycle folder and in `notes/`.
  folder("2026-10-27-cycle-v073", {
    "cycle.md":
      "| # | source | prediction | resolution |\n| --- | --- | --- | --- |\n| 1 | ran on buffer-fresh-opus-a. | LEDGER-SECRET | held, 3 of 3 |\n| 2 | b | c | falsified |\n",
    "Predictions.md": `${ledgerTables(["| 1 | N1 | held | 4 |", "| 2 | N2 | unreached | none |"])}\n| arm | held | note |\n| --- | --- | --- |\n| x | held | falsified |\n`,
  });
  folder(
    "sim-ladder-20261031",
    {
      "predictions.md":
        "| id | outcome | count |\n| --- | --- | --- |\n| S1 | **falsified** | 2 |\n\nOn esp32-fresh-opus-newer only.\n",
    },
    join(elsewhere, "notes"),
  );
  folder("overhaul-20261102", { "predictions.md": "- P1: the count held.\n" }, join(elsewhere, "notes"));
  folder(
    "archive",
    { "plan.md": "| id | outcome |\n| --- | --- |\n| 1 | held |\n" },
    join(elsewhere, "notes"),
  );
  // (c) campaigns, recent and not.
  runs = [
    campaign("buffer-fresh-opus-a", [
      [3, "campaign.opened", {}],
      [2, "task.gate", { text: "RUN-SECRET" }],
      [2, "harness.promoted", { harness: "abc" }],
      [1, "campaign.ended", { ending: "stop" }],
    ]),
    campaign("esp32-fresh-opus-new", [[3, "campaign.opened", {}]], { archived: "peer" }),
    campaign("truss-fresh-opus-old", [[20, "campaign.opened", {}]]),
    campaign("buffer-fresh-opus-seed", [[1, "campaign.opened", {}]], { seed: true }),
    campaign("live-solve", [[1, "solve.started", {}]], { end: "solve.finished" }),
    { name: "gone", tree: "/x/anabasis-w", path: join(elsewhere, "gone.jsonl"), end: "comparison.reported" },
  ];
  folder(
    "job-fresh-opus-torn",
    { "log.jsonl": `not json\n${JSON.stringify({ at: daysAgo(1), kind: "campaign.opened", data: {} })}\n` },
    elsewhere,
  );
  runs.push({
    name: "job-fresh-opus-torn",
    tree: "/x/anabasis-w",
    path: join(elsewhere, "job-fresh-opus-torn", "log.jsonl"),
    end: "comparison.reported",
  });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(elsewhere, { recursive: true, force: true });
});

describe("the investigation index", () => {
  it("rows every folder newest first, and counts how much of each it read", () => {
    const { text, parsed, rows } = index();
    expect(rowsIn(text, "| date | folder | campaigns").map((row) => row.split(" | ")[1])).toEqual([
      "`labels-2026-11-03`",
      "`2026-11-03-full`",
      "`20261101-notes`",
      "`20261101-gate-validity-b`",
      "`2026-10-27-old-style`",
      "`2026-10-27-cycle-v073`",
      "`2026-10-21-final-r5`",
      "`2026-10-20-no-vetting`",
      "`2026-10-15-multipromotion`",
    ]);
    expect(rows).toEqual({ investigations: 9, ledgers: 3, runs: 3, pulls: 0 });
    expect(parsed).toEqual({
      "read whole": 2,
      "read in part": 2,
      "held, not read": 1,
      "lanes collected, not synthesised": 1,
      "no synthesis or vetting": 3,
    });
    expect(text).toContain("Files at the root: `2026-10-21-cross-run.md`.");
  });

  it("quotes the binding constraint's first sentence only, and counts findings, verdicts and predictions", () => {
    const { text } = index();
    const full = text.split("\n").find((line) => line.includes("`2026-11-03-full`")) ?? "";
    expect(full).toContain("| **Supply, not the harness, held the climb at v0.9.1.** |");
    expect(text).not.toContain("never quoted");
    expect(full).toContain("patch 2, decision 1");
    expect(full).toContain(
      "confirmed 1, plausible 1, refuted 1; predictions falsified 1, held 1, unreached 1",
    );
    expect(full).toContain("buffer: `buffer-fresh-opus-a`; esp32: `esp32-fresh-opus-b`");
    expect(full).toContain("synthesis, vetting, reports, 5 lanes; read whole");
  });

  it("reads an older folder as far as it goes and never throws", () => {
    const { text } = index();
    const line = (name: string) => text.split("\n").find((each) => each.includes(`\`${name}\``)) ?? "";
    const cut = /\| (\*\*word[^|]*…) \|/u.exec(line("2026-10-20-no-vetting"))?.[1] ?? "";
    expect(cut.length).toBeGreaterThan(200);
    expect(cut.length).toBeLessThanOrEqual(301);
    expect(line("2026-10-20-no-vetting")).toContain("buffer: `buffer-fresh-opus-r5`");
    expect(line("2026-10-27-old-style")).toContain("no binding constraint section");
    expect(line("2026-10-27-old-style")).toContain(
      "truss: `truss-fresh-opus-v071`; job: `job-fresh-opus-v071`",
    );
    expect(line("20261101-notes")).toContain("| none named | no synthesis | none | none | notes only;");
  });

  it("lets a review or an A/B synthesis stand in, marks collected lanes, and only counts a labels folder", () => {
    const { text } = index();
    const line = (name: string) => text.split("\n").find((each) => each.includes(`| \`${name}\` |`)) ?? "";
    expect(line("2026-10-15-multipromotion")).toContain("| title: Repeated promotions held under the cap. |");
    expect(line("2026-10-15-multipromotion")).toContain("review-v2; read in part");
    expect(line("20261101-gate-validity-b")).toContain("| title: A/B synthesis |");
    expect(line("2026-10-21-final-r5")).toContain("reports, 5 lanes; lanes collected, not synthesised");
    expect(line("labels-2026-11-03")).toContain("1 other subfolder; no synthesis or vetting");
    for (const hidden of [
      "REVIEW-SECRET",
      "first review",
      "AB-SECRET",
      "LANE-SECRET",
      "LABEL-SECRET",
      "settle-g-1",
      "buffer-fresh-opus-x",
    ]) {
      expect(text).not.toContain(hidden);
    }
  });

  it("rows each cycle folder and ledger by its resolutions, and reads a missing notes folder as none", () => {
    const { text } = index();
    const ledgers = rowsIn(text, "## Cycles and ledgers");
    expect(ledgers).toEqual(
      [
        "| 2026-10-31 | `sim-ladder-20261031` | `notes` | predictions.md | falsified 1 |",
        "| 2026-10-27 | `2026-10-27-cycle-v073` | `.ana/wri` | Predictions.md, cycle.md | held 2, falsified 1, unreached 1 |",
        "| 2026-11-02 | `overhaul-20261102` | `notes` | predictions.md | none |",
      ]
        .toSorted()
        .toReversed(),
    );
    expect(text).not.toContain("LEDGER-SECRET");
    expect(text).not.toContain("`archive`");
    const bare = index(join(elsewhere, "absent"));
    expect(bare.rows.ledgers).toBe(1);
  });

  it("rows each campaign that moved in fourteen days with its ending, promotions, investigations and ledgers", () => {
    const { text } = index();
    expect(rowsIn(text, "## Runs of the last 14 days")).toEqual([
      "| unreadable | `job-fresh-opus-torn` | worktree `anabasis-w` | unreadable log | unknown | none | none |",
      "| 2026-11-02 | `buffer-fresh-opus-a` | worktree `anabasis-w` | stop | 1, 0 confirmed | `2026-11-03-full` | `2026-10-27-cycle-v073` |",
      "| 2026-10-31 | `esp32-fresh-opus-new` | archive, peer | no ending | 0, 0 confirmed | none | none |",
    ]);
    expect(text).toContain("3 campaigns took an event in the 14 days to 2026-11-03.");
    // A log whose file is new and whose last event is older than the window (a gathered copy) is
    // dropped by that event alone: its body is never parsed, so a torn line in it is no row.
    folder(
      "truss-fresh-opus-old-torn",
      {
        "log.jsonl": `not json\n${JSON.stringify({ at: daysAgo(20), kind: "campaign.opened", data: {} })}\n`,
      },
      elsewhere,
    );
    runs.push({
      name: "truss-fresh-opus-old-torn",
      tree: "/x/anabasis-w",
      path: join(elsewhere, "truss-fresh-opus-old-torn", "log.jsonl"),
      end: "comparison.reported",
    });
    expect(rowsIn(index().text, "## Runs of the last 14 days")).toHaveLength(3);
    for (const hidden of [
      "RUN-SECRET",
      "truss-fresh-opus-old",
      "buffer-fresh-opus-seed",
      "live-solve",
      "`gone`",
    ]) {
      expect(text).not.toContain(hidden);
    }
  });

  it("lists each group's investigations oldest first, with lane counts and no lane prose", () => {
    const { text } = index();
    const groups = text.slice(text.indexOf("## By campaign group"));
    const buffer = groups.slice(groups.indexOf("### buffer"), groups.indexOf("### esp32"));
    expect(buffer).toContain("### buffer (2 investigations)");
    expect(buffer.indexOf("2026-10-20-no-vetting")).toBeLessThan(buffer.indexOf("2026-11-03-full"));
    expect(buffer).toContain("lanes: 1 with findings, 1 with none, 2 unread, 1 missing or invalid");
    expect(groups).toContain("### truss (1 investigation)");
    expect(groups).not.toContain("lanes/01-report.md");
  });
});

describe("the pull requests and their forks", () => {
  const PARENT = "esp32-fresh-opus-p1";
  const FORK = "esp32-fresh-opus-forkedPR60-a";
  const ledger = (header: string, rows: readonly string[]) =>
    [header, `|${" --- |".repeat(header.split("|").length - 2)}`, ...rows, ""].join("\n");
  const predictions = (ids: readonly string[]) =>
    ledger(
      "| id | PR | labels | lanes | group | claim, as a count | falsified by |",
      ids.map((id) => `| ${id} | #60 | I1 | 2 | g | a count | a count |`),
    );
  const outcomes = (rows: readonly (readonly [string, string])[]) =>
    ledger(
      "| id | outcome | event or count | time |",
      rows.map(([id, outcome]) => `| ${id} | ${outcome} | PER-RUN-SECRET | t |`),
    );
  const rowOfPull = (text: string, pull: string) =>
    section(text, "## Pull requests")
      .split("\n")
      .find((line) => line.startsWith(`| ${pull} |`)) ?? "";

  beforeEach(() => {
    folder("2026-11-06-parent", {
      "investigation.json": JSON.stringify({ logs: [`/w/.ana/d2/${PARENT}/log.jsonl`] }),
      "plan.md": "# Plan\n\nPull request: #60 (this iteration's)\n",
    });
    folder("2026-11-06-other", { "plan.md": "Pull request: #600\n" });
    folder("2026-11-06-cycle-v100", {
      [`predictions-${PARENT}.md`]: predictions(["N1", "N2", "N3"]),
      [`outcomes-${PARENT}.md`]: outcomes([
        ["N1", "held"],
        ["N2", "**falsified**"],
        ["N3", "unreached"],
      ]),
      [`predictions-${FORK}.md`]: `${predictions(["F1", "F2", "F3"])}\n## Carried\n\n- \`${PARENT}:N2\`, see still-missing-${PARENT}.md\n- ${PARENT}:N30 is another id\n`,
      [`outcomes-${FORK}.md`]: outcomes([
        ["F1", "held"],
        ["F2", "pending"],
      ]),
      [`still-missing-${FORK}.md`]:
        "F3 is not resolved.\n\n## Intentionally opposed\n\n<!-- - a comment -->\n- the first trade-off\n  carried on\n- the second\n\n```\n- an example\n```\n",
      "outcomes-esp32-fresh-opus-forkedPR61-c.md": outcomes([["X1", "held"]]),
    });
    folder("2026-11-07-cycle-v101", {
      "outcomes-esp32-fresh-opus-forkedPR61-c.md": outcomes([["X1", "held"]]),
      "still-missing-esp32-fresh-opus-forkedPR62-d.md": "## Intentionally opposed\n\nnone\n",
    });
    runs.push(
      campaign("esp32-fresh-opus-forkedPR600-b", [[1, "campaign.opened", {}]]),
      campaign("buffer-fresh-gpt-forkedPR223_v0_5_4-r2", [[30, "campaign.opened", {}]], { archived: "peer" }),
    );
  });

  it("rows a pull request with its fork's outcomes, unresolved predictions, opposed items and carried ids", () => {
    const { text, rows } = index();
    expect(rowOfPull(text, "#60")).toBe(
      `| #60 | \`2026-11-06-parent\` | \`${FORK}\` | held 1, falsified 0, unreached 0, pending 1 | ${FORK}:F3 | 2 | ${FORK}: 1 of 2 carried, missing ${PARENT}:N3 |`,
    );
    expect(rows.pulls).toBe(5);
    expect(text).not.toContain("PER-RUN-SECRET");
  });

  it("matches a fork to its pull request exactly, and reads a fork before the per-run files as such", () => {
    const { text } = index();
    expect(rowOfPull(text, "#600")).toBe(
      "| #600 | `2026-11-06-other` | `esp32-fresh-opus-forkedPR600-b` (no per-run files) | no per-run files | no per-run files | no per-run files | no per-run files |",
    );
    expect(rowOfPull(text, "#223")).toContain(
      "| none | `buffer-fresh-gpt-forkedPR223_v0_5_4-r2` (no per-run files) | no per-run files |",
    );
    expect(rowOfPull(text, "#60")).not.toContain("forkedPR600");
    const order = section(text, "## Pull requests")
      .split("\n")
      .flatMap((line) => /^\| (#\d+) \|/u.exec(line)?.[1] ?? []);
    expect(order).toEqual(["#600", "#223", "#62", "#61", "#60"]);
  });

  it("lists under a pull request the fork its iteration's `launch` deviation names, whatever number it carries", () => {
    const child = "esp32-fresh-opus-forkedPR64-f";
    folder("2026-11-06-parent", {
      "deviations.md": `| step | reason |\n| --- | --- |\n| launch | measured by \`${child}\`, at the child of #60 |\n`,
    });
    folder("2026-11-06-cycle-v100", {
      [`predictions-${child}.md`]: `${predictions(["G1"])}\n## Carried\n\n- ${PARENT}:N2\n- ${PARENT}:N3\n`,
    });
    const row = rowOfPull(index().text, "#60");
    expect(row).toContain(`| \`${FORK}\`, \`${child}\` |`);
    expect(row).toContain(`${child}: 2 of 2 carried`);
  });

  it("counts what a fork leaves out on purpose from the plan of the iteration that read it", () => {
    const later = "esp32-fresh-opus-forkedPR63-e";
    folder("2026-11-08-later", {
      "investigation.json": JSON.stringify({ logs: [`/w/.ana/d2/${later}/log.jsonl`] }),
      "plan.md": "# Plan\n\n## Not done\n\n- a row\n\n## Intentionally opposed\n\n- one\n- two\n- three\n",
    });
    folder("2026-11-08-cycle-v102", { [`predictions-${later}.md`]: predictions(["E1"]) });
    expect(rowOfPull(index().text, "#63")).toContain(`${later}:E1 | 3 |`);
    // Without the section in its plan, the fork has said nothing of it.
    folder("2026-11-08-later", { "plan.md": "# Plan\n\n## Not done\n\n- a row\n" });
    expect(rowOfPull(index().text, "#63")).toContain(`${later}:E1 | 0; 1 without the section |`);
  });

  it("names a ledger two folders hold, counts `none` as no opposed item, and says when no parent kept files", () => {
    const { text } = index();
    expect(rowOfPull(text, "#61")).toContain(
      "`esp32-fresh-opus-forkedPR61-c` (outcomes-esp32-fresh-opus-forkedPR61-c.md in 2 folders)",
    );
    expect(rowOfPull(text, "#62")).toBe(
      "| #62 | none | `esp32-fresh-opus-forkedPR62-d` | held 0, falsified 0, unreached 0, pending 0 | none | 0 | esp32-fresh-opus-forkedPR62-d: parents: no per-run files |",
    );
  });
});
