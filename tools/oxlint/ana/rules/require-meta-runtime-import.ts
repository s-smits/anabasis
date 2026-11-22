import { defineRule, type ESTree, type Fix, type Fixer } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";

import { isTestFile, isUnder } from "../shared/file-role.ts";
import { importSpecifier } from "../shared/import-fix.ts";

/** The `src/meta` module that owns each host builtin. */
const OWNER = new Map([
  ["node:fs", "filesystem.ts"],
  ["node:fs/promises", "filesystem.ts"],
  ["node:path", "path.ts"],
  ["node:os", "os.ts"],
  ["node:net", "network.ts"],
  ["node:module", "modules.ts"],
  ["node:assert/strict", "assert.ts"],
]);

/** Names `src/meta/filesystem.ts` re-exports from `node:fs/promises` (not auto-fixed from `node:fs` because callback vs promise signatures differ). */
const PROMISED = new Set(["mkdir", "mkdtemp", "readdir", "rm"]);

/**
 * Requires production and tool modules (outside `src/meta`, `.claude`, and tests) to import host
 * runtime capabilities (`node:fs`, `node:path`, `node:os`, `node:net`, `node:module`,
 * `node:assert/strict`) through `src/meta`. Auto-fixes named value imports (except `PROMISED`
 * names imported from `node:fs`); type, default/namespace, bare, and re-export declarations are
 * reported without a fix.
 */
export const requireMetaRuntimeImportRule = defineRule({
  meta: {
    type: "problem",
    fixable: "code",
    docs: {
      description: "Import host runtime capabilities from src/meta, which owns that surface.",
      examples: [
        {
          before: 'import { readFileSync } from "node:fs";\nconst text = readFileSync(logPath, "utf8");',
          after:
            'import { readFileSync } from "./meta/filesystem.ts";\nconst text = readFileSync(logPath, "utf8");',
        },
        {
          before:
            'import { dirname } from "./meta/path.ts";\nimport { join } from "node:path";\nconst logPath = join(dirname(root), "journal.jsonl");',
          after:
            'import { dirname, join } from "./meta/path.ts";\nconst logPath = join(dirname(root), "journal.jsonl");',
        },
      ] satisfies RuleExample[],
    },
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
