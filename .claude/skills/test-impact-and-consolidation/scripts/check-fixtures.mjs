// Hostile fixtures for case-census.mjs — checks the character scanner against the listed shapes the
// regex predecessor got wrong, plus the properties deletion decisions quietly rely on.
//
//   bun check-fixtures.mjs          run the fixtures, exit 1 on any failure
//
// Fixtures:
//   1 nested describes produce full lexical ancestry
//   2 sibling describes do not leak scope into each other
//   3 identical 30-line prefix + different final assertion = TITLE-TWIN, never a clone
//   4 identical callbacks followed by different neighbours = IDENTICAL-SOURCE
//     (the old 25-line window hash could see either of the last two wrongly)
//   5 duplicate titles inside ONE file are reported with two owners
//   6 .test.js suites parse and count
//   7 it.each is flagged parametrized and counted once per declaration

import { runtimeProcess } from "#src/meta/process.ts";
import { analyseSuite, buildReport } from "./case-census.mjs";

const failures = [];
const sameBody = 'it("copy", () => {\n  const v = compute(7);\n  expect(v).toBe(14);\n});\n';
const cText = `function compute(n) { return n * 2; }\n${sameBody}`;
const dText = `function compute(n) { return n * 3; }\nconst other = 1;\n${sameBody}`;
function expect(label, actual, wanted) {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted);
  if (!ok) failures.push(`${label}: got ${JSON.stringify(actual)}, wanted ${JSON.stringify(wanted)}`);
  console.error(`  ${ok ? "ok" : "FAIL"} ${label}`);
}

const pad = Array.from({ length: 30 }, (_, i) => `    const pad${i} = ${i};`).join("\n");

// 1. nested ancestry
const nested = analyseSuite(
  "x.test.ts",
  'describe("outer", () => {\n  describe("inner", () => {\n    it("deep", () => { expect(1).toBe(1); });\n  });\n});\n',
);
expect(
  "nested ancestry",
  nested.cases.map((c) => c.describe),
  ["outer > inner"],
);

// 2. sibling scope isolation
const sib = analyseSuite(
  "x.test.ts",
  'describe("A", () => { it("x", () => {}); });\ndescribe("B", () => { it("y", () => {}); });\n',
);
expect(
  "sibling scopes",
  sib.cases.map((c) => `${c.describe}::${c.title}`),
  ["A::x", "B::y"],
);

// 3+4. cross-file classification
function twinSource(lastLine) {
  return `describe("g", () => {\n  it("same title", () => {\n${pad}\n    ${lastLine}\n  });\n});\n`;
}
const a = analyseSuite("a.test.ts", twinSource("expect(a).toBe(1);"));
const b = analyseSuite("b.test.ts", twinSource("expect(b).toBe(2);"));
const twinReport = buildReport(
  new Map([
    ["a.test.ts", { ...a, modules: new Set() }],
    ["b.test.ts", { ...b, modules: new Set() }],
  ]),
);
expect(
  "prefix-clone is TITLE-TWIN",
  twinReport.duplicateGroups.map((g) => g.kind),
  ["TITLE-TWIN"],
);

const cloneReport = buildReport(
  new Map([
    ["c.test.ts", { ...analyseSuite("c.test.ts", cText), modules: new Set() }],
    ["d.test.ts", { ...analyseSuite("d.test.ts", dText), modules: new Set() }],
  ]),
);
expect(
  "true clones are IDENTICAL-SOURCE despite different neighbourhoods",
  cloneReport.duplicateGroups.map((g) => g.kind),
  ["IDENTICAL-SOURCE"],
);

// 5. duplicate titles inside one file get two owner rows
const dupFile = analyseSuite(
  "dup.test.ts",
  'describe("g", () => {\n  it("twice", () => { expect(1).toBe(1); });\n  it("twice", () => { expect(1).toBe(2); });\n});\n',
);
const dupReport = buildReport(new Map([["dup.test.ts", { ...dupFile, modules: new Set() }]]));
expect("in-file duplicates counted as instances", dupReport.ledger.instanceTotal, 2);
expect("in-file duplicate group exists", dupReport.duplicateGroups.length, 1);

// 6. .test.js suites parse
const js = analyseSuite(
  "legacy.test.js",
  'describe("js", () => { it("works", () => { expect(1).toBe(1); }); });\n',
);
expect(
  ".test.js parsed",
  js.cases.map((c) => c.title),
  ["works"],
);

// 7. it.each flagged parametrized, one declaration
const each = analyseSuite(
  "each.test.ts",
  'describe("t", () => {\n  it.each([[1], [2], [3]])("row %i", (n) => { expect(n).toBeGreaterThan(0); });\n});\n',
);
expect(
  "it.each parametrized flag",
  each.cases.map((c) => c.parametrized),
  [true],
);
expect("it.each counted once per declaration", each.cases.length, 1);

if (failures.length > 0) {
  console.error(`\ncheck-fixtures: FAILED — ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  ${f}`);
  runtimeProcess.exit(1);
}
console.error("\ncheck-fixtures: all fixture properties hold");
