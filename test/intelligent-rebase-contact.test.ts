import { describe, expect, it } from "bun:test";
import { danglingRefs, renameHints } from "../.claude/skills/intelligent-rebase/scripts/dangling-refs.mts";
import type { ImportView } from "../.claude/skills/intelligent-rebase/scripts/dangling-refs.mts";
import {
  changedTokens,
  literalContact,
} from "../.claude/skills/intelligent-rebase/scripts/literal-contact.mts";

const ORACLE = "src/grader/oracle.ts";
const CALLER = "src/run/caller.ts";

const names = (entries: [string, string[]][]): Map<string, Set<string>> =>
  new Map(entries.map(([file, list]) => [file, new Set(list)]));
const texts = (entries: [string, string][]): Map<string, string> => new Map(entries);
const side = (entries: [string, string, string][]): Map<string, { before: string; after: string }> =>
  new Map(entries.map(([file, before, after]) => [file, { before, after }]));

/** What one file imports: `["name", "from/file.ts"]` for a named import, `[alias, file]` for `* as`. */
const view = (named: [string, string][], namespaces: [string, string][] = []): ImportView => ({
  named: new Map(named.map(([name, from]) => [name, [from]])),
  namespaces: new Map(namespaces),
});

const call = (over: Partial<Parameters<typeof danglingRefs>[0]>) =>
  danglingRefs({
    remover: "A",
    user: "B",
    removed: names([[ORACLE, ["solve"]]]),
    added: names([]),
    before: texts([[CALLER, "const x = 1;\n"]]),
    after: texts([[CALLER, "const x = 1;\n"]]),
    imports: new Map(),
    ...over,
  });

describe("a name one side removed and the other still uses", () => {
  it("calls it a break when the other side imports that name from that exact file", () => {
    const [row, ...rest] = call({
      after: texts([[CALLER, "solve(input);\n"]]),
      imports: new Map([[CALLER, view([["solve", ORACLE]])]]),
    });
    expect(rest).toEqual([]);
    expect(row?.severity).toBe(6);
    expect(row?.kind).toContain("imported by name");
    expect(row?.detail).toContain(`solve left ${ORACLE}`);
    expect(row?.detail).toContain("newly imports it");
    expect(row?.detail).toContain(`${CALLER} (new)`);
  });

  it("separates a use the other side merely carried from one it wrote", () => {
    const [row] = call({
      before: texts([[CALLER, "solve(input);\n"]]),
      after: texts([[CALLER, "solve(input);\n"]]),
      imports: new Map([[CALLER, view([["solve", ORACLE]])]]),
    });
    expect(row?.severity).toBe(6);
    expect(row?.detail).toContain("imports it");
    expect(row?.detail).not.toContain("(new)");
  });

  it("follows a namespace import, where the name never appears in the import statement", () => {
    const [row] = call({
      after: texts([[CALLER, "oracle.solve(input);\n"]]),
      imports: new Map([[CALLER, view([], [["oracle", ORACLE]])]]),
    });
    expect(row?.severity).toBe(6);
    expect(row?.kind).toContain("reached through oracle");
  });

  it("does not call a local of the same name a break, because no import backs it", () => {
    const [row] = call({ after: texts([[CALLER, "const solve = (x) => x;\n"]]) });
    expect(row?.severity).toBe(2);
    expect(row?.detail).toContain("names it");
  });

  it("does not call it a break when the import of that name comes from somewhere else", () => {
    const [row] = call({
      after: texts([[CALLER, "solve(input);\n"]]),
      imports: new Map([[CALLER, view([["solve", "src/grader/solver.ts"]])]]),
    });
    expect(row?.severity).toBe(2);
  });

  it("reports a name the remover moved to another of its own files as a move, not a break", () => {
    const [row] = call({
      added: names([["src/grader/solver.ts", ["solve"]]]),
      after: texts([[CALLER, "solve(input);\n"]]),
    });
    expect(row?.severity).toBe(3);
    expect(row?.kind).toContain("moved export");
    expect(row?.detail).toContain(`${ORACLE} → src/grader/solver.ts`);
  });

  it("still calls a move a break where the other side imports it from the old file", () => {
    const [row] = call({
      added: names([["src/grader/solver.ts", ["solve"]]]),
      after: texts([[CALLER, "solve(input);\n"]]),
      imports: new Map([[CALLER, view([["solve", ORACLE]])]]),
    });
    expect(row?.severity).toBe(6);
    expect(row?.kind).toContain("moved export still imported from the old file");
  });

  it("gives one row per evidence band, not one per file", () => {
    const rows = call({
      after: texts([
        [CALLER, "solve(input);\n"],
        ["src/run/other.ts", "solve(input);\n"],
        ["src/run/third.ts", "// solve is gone\n"],
      ]),
      imports: new Map([
        [CALLER, view([["solve", ORACLE]])],
        ["src/run/other.ts", view([["solve", ORACLE]])],
      ]),
    });
    expect(rows.map((r) => r.severity)).toEqual([6, 2]);
    expect(rows[0]?.detail).toContain(CALLER);
    expect(rows[0]?.detail).toContain("src/run/other.ts");
    expect(rows[1]?.detail).toContain("src/run/third.ts");
  });

  it("matches whole words, so a longer name containing the removed one is not a use", () => {
    expect(call({ after: texts([[CALLER, "resolveAll(input);\n"]]) })).toEqual([]);
  });

  it("leaves the same file on both sides to the import scan, which already ranks it 5", () => {
    expect(call({ after: texts([[ORACLE, "solve(input);\n"]]) })).toEqual([]);
  });

  it("says nothing when the other side never names it", () => {
    expect(call({})).toEqual([]);
  });
});

describe("rename hints", () => {
  it("pairs what a file lost with what it gained", () => {
    expect(
      renameHints(names([["src/x.ts", ["repairOwner"]]]), names([["src/x.ts", ["repairSlot"]]])),
    ).toEqual(["src/x.ts: repairOwner → repairSlot"]);
  });

  it("stays quiet for a pure removal, which the break rows already carry", () => {
    expect(renameHints(names([["src/x.ts", ["gone"]]]), names([]))).toEqual([]);
  });
});

describe("literals both sides changed", () => {
  it("finds an env variable name two changes spell, with no import between them", () => {
    const rows = literalContact(
      side([["src/backends/env.ts", "", 'const key = "CLAUDE_CODE_OAUTH_TOKEN4";\n']]),
      side([["AGENTS.md", "", "set CLAUDE_CODE_OAUTH_TOKEN4 first\n"]]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token).toBe("CLAUDE_CODE_OAUTH_TOKEN4");
    expect(rows[0]?.a).toEqual(["src/backends/env.ts"]);
    expect(rows[0]?.b).toEqual(["AGENTS.md"]);
  });

  it("finds a policy key two changes moved in the same file", () => {
    const rows = literalContact(
      side([
        ["tools/loc/source-policy.json", '  "src/backends/env.ts": 66,\n', '  "src/backends/env.ts": 87,\n'],
      ]),
      side([
        ["tools/loc/source-policy.json", '  "src/backends/env.ts": 66,\n', '  "src/backends/env.ts": 91,\n'],
      ]),
    );
    expect(rows.map((r) => r.token)).toContain("src/backends/env.ts");
  });

  it("says nothing about a literal only one side moved", () => {
    expect(
      literalContact(
        side([["src/a.ts", "", 'const kind = "claude";\n']]),
        side([["src/b.ts", "", 'const other = "codex";\n']]),
      ),
    ).toEqual([]);
  });

  it("reads a removal as a change, since a literal one side deleted still couples", () => {
    const rows = literalContact(
      side([["src/a.ts", 'const kind = "verified-pass";\n', ""]]),
      side([["src/b.ts", "", 'if (kind === "verified-pass") return;\n']]),
    );
    expect(rows.map((r) => r.token)).toEqual(["verified-pass"]);
  });

  it("drops short, numeric and bare-word tokens, which carry no identity", () => {
    const tokens = [
      ...changedTokens(
        side([["src/a.ts", "", 'x("ab", "900", "1.5e3", "over-cpu-budget", "kind");\n']]),
      ).keys(),
    ];
    expect(tokens).toEqual(["over-cpu-budget"]);
  });

  it("puts the narrowest contact first, since a token in many files is vocabulary", () => {
    const rows = literalContact(
      side([
        ["src/a.ts", "", 'const k = "busyWallSeconds";\n'],
        ["src/b.ts", "", 'const k = "busyWallSeconds";\nconst j = "loadAtEnd";\n'],
      ]),
      side([["src/c.ts", "", 'read("busyWallSeconds");\nread("loadAtEnd");\n']]),
    );
    expect(rows.map((r) => r.token)).toEqual(["loadAtEnd", "busyWallSeconds"]);
  });

  it("drops a token carried by more files than a coupling would be", () => {
    const spread = Array.from({ length: 9 }, (_, i): [string, string, string] => [
      `src/spread-${i}.ts`,
      "",
      'const stage = "measuredCondition";\n',
    ]);
    expect(literalContact(side(spread), side([["src/reader.ts", "", 'of("measuredCondition");\n']]))).toEqual(
      [],
    );
  });

  it("leaves a module specifier to the import graph, which already scores that edge", () => {
    expect(
      literalContact(
        side([["src/a.ts", "", 'import x from "../meta/path.ts";\n']]),
        side([["src/b.ts", "", 'import y from "../meta/path.ts";\n']]),
      ),
    ).toEqual([]);
  });
});
