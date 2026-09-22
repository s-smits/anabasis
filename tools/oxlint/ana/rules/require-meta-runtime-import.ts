import { defineRule, type ESTree, type Fix, type Fixer } from "@oxlint/plugins";

import { isTestFile, isUnder } from "../shared/file-role.ts";
import { importSpecifier } from "../shared/import-fix.ts";

/**
 * The meta module that owns each host builtin, read off `src/meta` on 2026-09-20.
 *
 * `node:util` is deliberately absent. Two modules there import it — `env-parser.ts` takes
 * `parseEnv` and `json-runtime.ts` takes `types` — so the owner depends on the name, which is the
 * one question a table cannot answer. `node:crypto` and `node:child_process` are absent because no
 * module under `src/meta` imports them: the wrapper a fix would name does not exist yet.
 */
const OWNER = new Map([
  ["node:fs", "filesystem.ts"],
  ["node:fs/promises", "filesystem.ts"],
  ["node:path", "path.ts"],
  ["node:os", "os.ts"],
  ["node:net", "network.ts"],
  ["node:module", "modules.ts"],
  ["node:assert/strict", "assert.ts"],
]);

/**
 * The four names `src/meta/filesystem.ts` takes from `node:fs/promises` while re-exporting the
 * sync surface of `node:fs` beside them, read off that file on 2026-09-20.
 *
 * `OWNER` maps both `node:fs` and `node:fs/promises` onto one module, which is true of the module
 * and not of these four names: `rm` from `node:fs` takes a callback and `rm` from the wrapper
 * returns a promise. Rewriting `import { rm } from "node:fs"` onto the wrapper therefore swaps
 * one function for another of the same name. The swap is usually a type error at the call — the
 * callback has nowhere to go — so this is a held line rather than a wrong program, and the fix
 * still steps back: a report a reader closes in one edit beats a round of the loop spent proving
 * the edit wrong.
 */
const PROMISED = new Set(["mkdir", "mkdtemp", "readdir", "rm"]);

/**
 * `src/meta` owns the runtime surface. Every host capability the product depends on — the file
 * system, temporary roots, the environment, subprocesses, the network, hashing — is re-exported
 * from one module there, so isolation, a private `TMPDIR` or a refusal can be imposed in one
 * place and reach every caller. A `node:` import elsewhere is a second door into the same
 * capability that no wall can see.
 *
 * Tests are outside this: a test asserting what the product writes to disk reads the real file
 * system on purpose, and routing that through the wrapper would test the wrapper instead.
 *
 * Operator tooling under `.claude` is outside it for a different reason. A skill script runs on the
 * operator's machine, outside every wall the controller imposes, so its `node:` import is not a
 * second door into an isolation that exists: there is none to close. Routing those sites through
 * `src/meta` would grow the owner with re-exports only tooling needs, which is the opposite of what
 * one owner buys. The exemption is worth 28 sites in 9 skill scripts, measured 2026-09-20, and it
 * used to live in `.oxlintrc.json`, where a reader of this rule could not see it and the rule's own
 * test called two exemptions the whole rule.
 *
 * It fixes the half of the repair that is a fact rather than a decision, and the rule used to
 * refuse on the grounds that neither half is. The refusal said a fixer "would produce an import
 * that does not resolve", and against a guessed module that is right. Against `OWNER` it is not:
 * seven of the builtins are wrapped by exactly one module each, `node:util` is wrapped by two and
 * is therefore not in the table, and a name absent from the table is never rewritten. So the
 * module the fix names always resolves, and what can still be missing is one *member* of it.
 *
 * That remainder is the second half of the repair the message already asks for — "add one beside
 * them" — and it arrives as a compile error on the line the fix wrote, naming the member and the
 * module. The alternative is the same work found by reading, later, somewhere else. This is the
 * same trade `require-captured-json-runtime` records: a fix that cannot be silently wrong is worth
 * more than one that covers every site.
 *
 * Four shapes keep the report and get no fix, each because the edit would decide something.
 * A **type import** would have to merge into the value import already there, or stay a second
 * declaration; `filesystem.ts` re-exports `Dirent` and `Stats` and nothing else, so the choice is
 * not even usually available. A **default or namespace import** — `import fs from "node:fs"`,
 * `import * as path from "node:path"` — asks for the whole surface, which is what the owner exists
 * to narrow. A **bare `import "node:x"`** binds nothing to move. And a **re-export**,
 * `export { x } from "node:fs"`, is this file publishing the second door rather than using it,
 * which is a different repair.
 *
 * The edit has two forms and no third. Where the file already imports from the owning module, the
 * names join that import and the `node:` line goes, which is the shape the tree is written in.
 * Where it does not, the `node:` declaration is replaced in place by one naming the owner, at the
 * depth `importSpecifier` computes from this file's own path — replaced rather than inserted
 * beside, because an insert anchored on the declaration being removed is two edits at one
 * position, and oxlint drops both.
 */
export const requireMetaRuntimeImportRule = defineRule({
  meta: {
    type: "problem",
    fixable: "code",
    docs: { description: "Import host runtime capabilities from src/meta, which owns that surface." },
    messages: {
      directBuiltin:
        'Import "{{builtin}}" through src/meta, which owns the runtime surface: re-export what this file needs from the module there that already wraps it, or add one beside them. A direct import is a second door isolation cannot close.',
    },
  },
  createOnce(context) {
    /** Value imports this file already makes from a `src/meta` module, by that module's filename. */
    const metaImports = new Map<string, ESTree.ImportDeclaration>();

    /** Whether every specifier is a plain named value binding, so the names can move as written. */
    function movable(node: ESTree.ImportDeclaration): boolean {
      if (node.importKind === "type" || node.specifiers.length === 0) return false;
      return node.specifiers.every(
        (specifier) => specifier.type === "ImportSpecifier" && specifier.importKind !== "type",
      );
    }

    /** The names as this file spells them, `readFile` or `readFile as read`, in source order. */
    function spelled(node: ESTree.ImportDeclaration): string[] {
      return node.specifiers.map((specifier) => context.sourceCode.getText(specifier));
    }

    /** The declaration and the line break after it, so removing it leaves no blank line behind. */
    function throughLineEnd(node: ESTree.ImportDeclaration): [number, number] {
      const after = context.sourceCode.getText().charAt(node.end);
      return [node.start, after === "\n" ? node.end + 1 : node.end];
    }

    /** The name the module is asked for, which is what `PROMISED` is about, not the local one. */
    function askedFor(specifier: ESTree.ImportDeclarationSpecifier): string {
      if (specifier.type !== "ImportSpecifier") return "";
      const { imported } = specifier;
      return "name" in imported ? imported.name : imported.value;
    }

    /** The edit that moves this import onto its owner, or null where the shape decides something. */
    function move(fixer: Fixer, node: ESTree.ImportDeclaration, owner: string): Fix | Fix[] | null {
      if (!movable(node)) return null;
      if (node.source.value === "node:fs" && node.specifiers.some((one) => PROMISED.has(askedFor(one)))) {
        return null;
      }
      const names = spelled(node);
      const existing = metaImports.get(owner);
      if (existing === undefined) {
        const from = importSpecifier(context.filename, `src/meta/${owner}`);
        return fixer.replaceText(node, `import { ${names.join(", ")} } from "${from}";`);
      }
      const last = existing.specifiers.at(-1);
      if (last === undefined) return null;
      return [
        fixer.insertTextAfter(last, `, ${names.join(", ")}`),
        fixer.replaceTextRange(throughLineEnd(node), ""),
      ];
    }

    return {
      before: () => {
        metaImports.clear();
        return (
          !isUnder(context.filename, "src/meta") &&
          !isTestFile(context.filename) &&
          !isUnder(context.filename, ".claude")
        );
      },

      Program(node) {
        for (const statement of node.body) {
          if (statement.type !== "ImportDeclaration" || !movable(statement)) continue;
          const [, module] = /\/meta\/([\w-]+\.ts)$/u.exec(statement.source.value) ?? [];
          if (module !== undefined) metaImports.set(module, statement);
        }
      },

      ImportDeclaration(node) {
        const source = node.source.value;
        if (!source.startsWith("node:")) return;
        const owner = OWNER.get(source);
        context.report({
          node: node.source,
          messageId: "directBuiltin",
          data: { builtin: source },
          fix: (fixer) => (owner === undefined ? null : move(fixer, node, owner)),
        });
      },

      ExportNamedDeclaration(node) {
        const source = node.source === null ? "" : node.source.value;
        if (source.startsWith("node:") && node.source !== null) {
          context.report({ node: node.source, messageId: "directBuiltin", data: { builtin: source } });
        }
      },
    };
  },
});
