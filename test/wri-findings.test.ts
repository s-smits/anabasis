// The vetted findings are read by their verdict column, whatever a table's other headers, so the
// plan gate, the vet gate and the ledger over every investigation count the same rows. Each shape
// below is one a vetting of 10 to 16 November held; the hostile ones are the tables beside them.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import { tmpdir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";
import { REFERENCES } from "../tools/wri/catalogue.ts";
import {
  findingsIn,
  findingsLedger,
  standingKeys,
  standingLines,
  vettingFaults,
} from "../tools/wri/findings.ts";

const PREDICTIONS = `| id | outcome | recount |
| --- | --- | --- |
| P1 | held | confirmed by the count of 3 |
| P2 | falsified | 0 of 4 |
`;
const KEYS = ["narrow-step", "limits-never-bind"];
const HEAD = `| id | finding | lanes | standing | owner | importance | verdict | fate |
| --- | --- | --- | --- | --- | --- | --- | --- |
`;
const FIXED = `${HEAD}| vet-1 | a | 12.1, 17 | narrow-step | \`src/kernel/compare.ts\` | I1 | confirmed, 6 to 0 twice | operator: the level |
| vet-2 | b | 12.2 | new | \`tools/wri/read.ts\` | I3 | **confirmed** | repair |
| vet-3 | c | primary | limits-never-bind | the setting | | plausible, a rerun would settle it | |
| vet-4 | d | 9 | new | \`src/a.ts\` | I2 | refuted | none: the count was misread |
`;
const REPORTS = `# Reports

- lane 9: ok, finding, 1 finding, at /x/lanes/09-report.md
  - 9.1, observation confirmed, cause plausible, owner host: lane 20: ok, finding, 2 findings,
- lane 12: ok, finding, 2 findings, at /x/lanes/12-report.md
- lane 14: ok, no finding, 0 findings, at /x/lanes/14-report.md
- lane 17: ok, finding, 3 findings, at /x/lanes/17-report.md
`;

const base = mkdtempSync(join(tmpdir(), "ana-wri-findings-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("the findings of a vetting", () => {
  it("reads a row by its verdict column under any first header, in bold, with or without the vet- prefix", () => {
    for (const first of ["#", "id", "vet", "row"]) {
      const vetting = `${PREDICTIONS}\n| ${first} | finding | verdict | read here |\n| --- | --- | --- | --- |\n| 1 | a | **confirmed** | 3 of 3 |\n| vet-2 | b | plausible | one lane |\n| \`vet-3\` | c | Confirmed in part | 2 of 3 |\n| 4 | d | refuted | 0 of 3 |\n`;
      expect(findingsIn(vetting).map(({ id, verdict }) => `${id} ${verdict}`)).toEqual([
        "vet-1 confirmed",
        "vet-2 plausible",
        "vet-3 confirmed",
        "vet-4 refuted",
      ]);
    }
  });

  it("reads the id from its own column where another column comes first", () => {
    const vetting =
      "| verdict | finding | id |\n| --- | --- | --- |\n| confirmed | a | 1 |\n| confirmed | b | vet-2 |\n";
    expect(findingsIn(vetting).map(({ id }) => id)).toEqual(["vet-1", "vet-2"]);
  });

  it("reads no finding from a prediction's row or from a cell that only mentions a verdict", () => {
    // A ledger of predictions has no verdict column, though a recount says "confirmed".
    expect(findingsIn(PREDICTIONS)).toEqual([]);
    // A verdict column that resolves predictions holds none of the three words first.
    const resolved =
      "| id | verdict | note |\n| --- | --- | --- |\n| P1 | held | later confirmed |\n| | confirmed | no id |\n";
    expect(findingsIn(resolved)).toEqual([]);
    // A row that says a finding is not confirmed is not confirmed.
    const negated = "| # | finding | verdict |\n| --- | --- | --- |\n| 1 | a | not confirmed: 0 of 3 |\n";
    expect(findingsIn(negated)).toEqual([]);
  });

  it("reads the fixed columns of a row, a lane by its number or by one of its findings", () => {
    const [first, , third] = findingsIn(FIXED);
    expect(first).toEqual({
      id: "vet-1",
      verdict: "confirmed",
      lanes: ["12.1", "17"],
      standing: "narrow-step",
      owner: "src/kernel/compare.ts",
      importance: "I1",
      fate: "operator",
    });
    expect(third?.lanes).toEqual(["primary"]);
  });

  it("reads the register's keys from the skill's own file", () => {
    expect(standingKeys("| key | finding |\n| --- | --- |\n| a-key | x |\n")).toEqual(["a-key"]);
    expect(standingKeys()).toContain("limits-never-bind");
  });

  it("gives the synthesis each key of the register beside its finding, and the template a slot for them", () => {
    expect(standingLines("| key | finding | owner |\n| --- | --- | --- |\n| a-key | x | y |\n")).toBe(
      "- `a-key`: x",
    );
    expect(standingLines().split("\n")).toHaveLength(standingKeys().length);
    const template = readFileSync(join(REFERENCES, "synthesis.template.md"), "utf8");
    expect(template).toContain("{register}");
    // A lane is given none of it: a lane told what to find finds it.
    expect(readFileSync(join(REFERENCES, "shared-instructions.template.md"), "utf8")).not.toContain(
      "register",
    );
  });
});

describe("what a vetting's fixed columns owe", () => {
  it("owes nothing once every row is whole and every lane's finding has a row", () => {
    expect(vettingFaults(FIXED, REPORTS, KEYS)).toEqual([]);
  });

  it("names the columns a table of the older shape lacks, and owes a table at all", () => {
    const older =
      "| # | finding | verdict | read here |\n| --- | --- | --- | --- |\n| 1 | a | confirmed | 3 |\n";
    expect(vettingFaults(older, REPORTS, KEYS)).toEqual([
      "no findings table with the columns id, finding, lanes, standing, owner, importance, verdict, fate (missing: id, lanes, standing, owner, importance, fate)",
    ]);
    expect(vettingFaults(PREDICTIONS, REPORTS, KEYS)[0]).toStartWith("no findings table");
  });

  it("names each row's missing part, a lane's finding in no row and an id written twice", () => {
    const rows = `${HEAD}| vet-1 | a | 12.1 | narrow-steps | o | | confirmed | later |
| vet-1 | b | | new | o | I4 | confirmed | repair |
| vet-3 | c | 9 | new | o | I2 | open | none |
`;
    expect(vettingFaults(rows, REPORTS, KEYS)).toEqual([
      "1 row(s) with no id or no verdict of confirmed, plausible, refuted",
      "vet-1 is written twice",
      'vet-1: standing "narrow-steps" is neither a key of the register nor "new"',
      "vet-1: no importance (I0 to I3)",
      "vet-1: no fate (repair, carry, operator, none)",
      'vet-1: no lane, nor "primary"',
      "vet-1: no importance (I0 to I3)",
      "no row names the lane findings 9.1, 12.2, 17.1, 17.2, 17.3",
    ]);
    // A plausible or refuted row owes neither an importance nor a fate, and a lane named whole covers its findings.
    const partial = `${HEAD}| vet-1 | a | 9, 12, 17 | new | o | | plausible | |\n`;
    expect(vettingFaults(partial, REPORTS, KEYS)).toEqual([]);
  });
});

describe("the ledger over every investigation", () => {
  it("counts each window over its own denominator, and a standing finding only where the columns are fixed", () => {
    const root = join(base, "ledger");
    const put = (folder: string, vetting: string) => {
      mkdirSync(join(root, folder), { recursive: true });
      writeFileSync(join(root, folder, "vetting.md"), vetting);
    };
    put("2026-11-16-one", FIXED);
    put("2026-11-15-two", `${HEAD}| vet-1 | a | 12 | narrow-step | o | I1 | confirmed | carry |\n`);
    put("2026-11-12-older-shape", "| # | finding | verdict |\n| --- | --- | --- |\n| 1 | a | confirmed |\n");
    put("2026-11-05-before", `${HEAD}| vet-1 | a | 3 | narrow-step | o | I2 | refuted | none |\n`);
    put("2026-10-01-outside", FIXED);
    put("notes", FIXED);
    const lines = findingsLedger(root, Date.parse("2026-11-16T00:00:00Z"), 7);
    expect(lines[0]).toBe("# Vetted findings: 2026-11-10 to 2026-11-16 | 2026-11-03 to 2026-11-09");
    expect(lines).toContain("investigations with a vetting: 3 | 1, of which with the fixed columns 2 | 1");
    expect(lines).toContain("confirmed: 4 of 6 | 0 of 1");
    expect(lines).toContain("refuted: 1 of 6 | 1 of 1");
    expect(lines).toContain("- narrow-step: 2 of 2 | 1 of 1");
    expect(lines).toContain("- limits-never-bind: 1 of 2 | 0 of 1");
    expect(lines).toContain("- new: 2 of 5 | 0 of 1 rows");
    expect(lines).toContain(
      "held more than once in the newest window with no row that repairs it: narrow-step",
    );
    expect(lines).toContain("- I1: 2 of 3 | 0 of 0");
    expect(lines).toContain("- operator: 1 of 3 | 0 of 0");
    // Lane 12 fed three rows of the newest window, none refuted, one shared with lane 17.
    expect(lines).toContain("- 12: 3 | 0 | 1");
    expect(lines).toContain("- 9: 1 | 1 | 0");
    // No line carries a finding's text.
    expect(lines.join("\n")).not.toContain("| a |");
  });
});
