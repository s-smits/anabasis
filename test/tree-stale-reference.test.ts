/**
 * `tree/stale-reference` (`tools/oxlint/tree-stale-reference.ts`): a backticked repository path in
 * prose that names nothing in this tree, and a documented `ANA_*` setting that no code reads.
 * Each fixture is one file in a map, read against this checkout, where the kernel's log module
 * exists and no module named gone.ts does.
 */
import { describe, expect, it } from "bun:test";
import { staleReferences } from "../tools/oxlint/tree-stale-reference.ts";

const reported = (files: Record<string, string>): string[] =>
  staleReferences(new Map(Object.entries(files))).map((row) => `${row.path}:${row.line} ${row.detail}`);

describe("a stale path", () => {
  it("is reported where prose or a comment names a file the tree does not hold", () => {
    expect(reported({ "docs/note.md": "Read `src/kernel/gone.ts` first." })).toEqual([
      "docs/note.md:1 `src/kernel/gone.ts` names nothing in this tree",
    ]);
    expect(reported({ "src/a.ts": "// as `src/kernel/gone.ts` did\nconst x = 1;" })).toEqual([
      "src/a.ts:1 `src/kernel/gone.ts` names nothing in this tree",
    ]);
  });

  it("is not reported where the path exists, is qualified by a commit, or is a placeholder", () => {
    const prose = [
      "`src/kernel/log.ts` and `src/kernel/` exist.",
      "`5bc9988:src/kernel/gone.ts` is cited at a commit.",
      "`tools/d2/<name>.ts`, `src/kernel/*.ts`, `src/x.ts` and `src/kernel/...` are not paths.",
    ].join("\n");
    expect(reported({ "docs/note.md": prose })).toEqual([]);
  });

  it("is not read in code, in a document of v1's record or in a vendored tree", () => {
    const gone = "`src/kernel/gone.ts`";
    expect(reported({ "src/a.ts": `const text = "${gone}";` })).toEqual([]);
    expect(reported({ "docs/v1.md": gone, "vendor/pi/README.md": gone, "studies/a.md": gone })).toEqual([]);
  });
});

describe("an unread setting", () => {
  it("is reported where an example documents a name no code file spells", () => {
    const files = {
      ".env.runs.example": "# ANA_HOSTS='[]'\n# ANA_NOBODY_READS=here",
      "tools/runs/hosts.ts": 'const hosts = Bun.env.ANA_HOSTS ?? "[]";',
    };
    expect(reported(files)).toEqual([
      ".env.runs.example:2 `ANA_NOBODY_READS` documented, and no code reads it",
    ]);
  });

  it("is read where any script spells it, a comment included", () => {
    const files = {
      "AGENTS.md": "Set `ANA_RUN_CAP` in `.env.runs`.",
      ".githooks/pre-push": "# ANA_RUN_CAP decides how many run at once",
    };
    expect(reported(files)).toEqual([]);
  });
});
