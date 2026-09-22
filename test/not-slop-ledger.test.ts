/**
 * The not-slop ledger: what a site's id hashes, which rows it reads, and how it is written.
 *
 * The id is the ledger's whole claim. It has to survive lines moving above a site, since an answer
 * that returns at every unrelated edit is re-answered by reflex, and it has to change at an edit to
 * any place the site spans, since an answer that outlives its code excuses whatever replaced it.
 * The first ledger hashed a site's first place alone, and the second copy of an answered block
 * could change under the old answer; the hostile cases below are that edit.
 */
import { describe, expect, it } from "bun:test";
import {
  type Answer,
  formatLedger,
  readLedger,
  siteExcerpt,
  siteId,
  unanswerable,
} from "../tools/oxlint/not-slop-ledger.ts";
import { type Diagnostic, lintSite } from "../tools/runtime/lint.ts";

const HEADER = "id\trule\tpath\tanswered\treason\texcerpt";

const row = (overrides: Partial<Answer>): Answer => ({
  id: "0123456789ab",
  rule: "anti-slop/no-runtime-typeof",
  path: "src/meta/json-shape.ts",
  answered: "2026-09-21",
  reason: "the one typeof behind isString",
  excerpt: 'return typeof value === "string";',
  ...overrides,
});

/** A finding at `line`, spanning `head` from its first character, over `source`. */
function finding(
  source: string,
  line: number,
  head: string,
  rule = "anti-slop(no-runtime-typeof)",
): Diagnostic {
  const before = source
    .split("\n")
    .slice(0, line - 1)
    .join("\n");
  const offset =
    new TextEncoder().encode(before).length +
    (line > 1 ? 1 : 0) +
    source.split("\n")[line - 1]!.indexOf(head);
  return {
    message: "m",
    code: rule,
    severity: "error",
    filename: "src/example.ts",
    labels: [{ span: { offset, length: new TextEncoder().encode(head).length, line, column: 1 } }],
  };
}

describe("a site's id", () => {
  const first = { path: "src/a.ts", text: "const kept = rows.filter(Boolean);" };
  const second = { path: "src/b.ts", text: "const kept = rows.filter(Boolean);" };

  it("is the same whichever order a scan found the places in, and however the text is spaced", () => {
    expect(siteId("tree/copied-block", [second, first])).toBe(siteId("tree/copied-block", [first, second]));
    expect(siteId("tree/copied-block", [{ ...first, text: `  ${first.text}\n` }, second])).toBe(
      siteId("tree/copied-block", [first, second]),
    );
  });

  it("changes when the second place changes, not only the first", () => {
    const edited = { ...second, text: "const kept = rows.filter(isString);" };
    expect(siteId("tree/copied-block", [first, edited])).not.toBe(
      siteId("tree/copied-block", [first, second]),
    );
  });

  it("changes with the rule, so one line answered for one rule stays open for another", () => {
    expect(siteId("anti-slop/no-runtime-typeof", [first])).not.toBe(siteId("ana/no-deep-nesting", [first]));
  });

  it("carries an excerpt a reviewer can read, cut at a hundred characters", () => {
    expect(siteExcerpt([first])).toBe(first.text);
    expect(siteExcerpt([{ path: "a", text: "x".repeat(150) }])).toHaveLength(100);
  });
});

describe("a lint finding's site", () => {
  const source = 'export function isString(value: unknown) {\n  return typeof value === "string";\n}\n';
  const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

  it("keeps its id when lines arrive above it, and loses it when its line changes", () => {
    const site = lintSite(finding(source, 2, "typeof value"), bytes(source));
    const moved = `// a note\n\n${source}`;
    const edited = source.replace('"string"', '"number"');
    expect(site).not.toBeNull();
    expect(lintSite(finding(moved, 4, "typeof value"), bytes(moved))?.id).toBe(site?.id);
    expect(lintSite(finding(edited, 2, "typeof value"), bytes(edited))?.id).not.toBe(site?.id);
  });

  it("tells two findings on one line apart by the span each reports", () => {
    const two = 'const both = typeof a === "string" && typeof b === "number";\n';
    const left = lintSite(finding(two, 1, "typeof a"), bytes(two));
    const right = lintSite(finding(two, 1, "typeof b"), bytes(two));
    expect(left?.id).not.toBe(right?.id);
  });

  it("has none for a rule the ledger cannot answer", () => {
    expect(lintSite(finding(source, 2, "typeof value", "eslint(no-shadow)"), bytes(source))).toBeNull();
    expect(
      lintSite(finding(source, 2, "typeof value", "anti-slop(prefer-subpath-import)"), bytes(source)),
    ).toBeNull();
  });
});

describe("the ledger's rows", () => {
  it("reads a row a reviewer can check", () => {
    const ledger = readLedger(formatLedger([row({})]));
    expect(ledger.unread).toStrictEqual([]);
    expect(ledger.answers).toStrictEqual([row({})]);
  });

  it("refuses a short reason, a bad id, a bad date and a header it does not know", () => {
    const text = [
      HEADER,
      Object.values(row({ reason: "not slop" })).join("\t"),
      Object.values(row({ id: "b468e7f2" })).join("\t"),
      Object.values(row({ answered: "yesterday" })).join("\t"),
    ].join("\n");
    expect(readLedger(text).answers).toStrictEqual([]);
    expect(readLedger(text).unread.map((problem) => problem.split(":")[0])).toStrictEqual([
      "line 2",
      "line 3",
      "line 4",
    ]);
    expect(readLedger("id shape path why\n").unread).toHaveLength(1);
  });

  it("refuses a core rule, a rule with a fixer, an unknown rule and the rule that keeps the ledger", () => {
    expect(unanswerable("eslint/no-shadow")).toContain("core rule");
    expect(unanswerable("anti-slop/prefer-subpath-import")).toContain("fixer");
    expect(unanswerable("ana/no-such-rule")).toContain("not a rule");
    expect(unanswerable("ana/no-inline-slop-answer")).toContain("only store");
    expect(unanswerable("anti-slop/no-runtime-typeof")).toBeNull();
    expect(unanswerable("tree/copied-block")).toBeNull();
  });

  it("writes one row per id, sorted, with the later of two answers to one site", () => {
    const text = formatLedger([
      row({ id: "bbbbbbbbbbbb", path: "src/z.ts" }),
      row({ id: "aaaaaaaaaaaa", path: "src/a.ts", reason: "the first answer, since replaced" }),
      row({ id: "aaaaaaaaaaaa", path: "src/a.ts", reason: "the answer a union merge kept last" }),
    ]);
    const lines = text.trimEnd().split("\n");
    expect(lines[0]).toBe(HEADER);
    expect(lines.slice(1).map((line) => line.split("\t")[0])).toStrictEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
    expect(lines[1]).toContain("the answer a union merge kept last");
  });

  it("keeps a tab or a newline in a reason from breaking the columns", () => {
    const text = formatLedger([row({ reason: "one\ttab and\na newline in it" })]);
    expect(readLedger(text).answers[0]?.reason).toBe("one tab and a newline in it");
  });
});
