import { defineRule, type ESTree, type Fix, type Fixer } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { isTestFile } from "../shared/file-role.ts";
import { ownedElsewhere } from "../shared/literal-owner.ts";

/**
 * Flags a string literal not checked by the compiler (file paths, wire identifiers, grep targets)
 * spelled four or more times in a source file (ten or more in a test file, excluding whitespace
 * prose). Bare hyphenated union tags (`BARE_TAG`), strings declared as a literal type in the same
 * file, external flags/paths (`ownedElsewhere`), import sources, and property keys are exempt.
 * Auto-fixes test files only; in source files there is no fix because the constant's owner must be
 * chosen deliberately.
 */

/** Spellings of one string in a file below which repetition is ordinary, by the file's job. */
const REPEAT_FLOOR = { source: 4, test: 10 };

/** String length below which a repeat is a word (`"id"`, `"json"`) rather than a value. */
const LENGTH_FLOOR = 6;

/** Whitespace, which in a test file makes a string prose rather than a fixture's name. */
const PROSE = /\s/u;

/** One word of letters, digits and hyphens: how this tree spells a union member. */
const BARE_TAG = /^[A-Za-z0-9][A-Za-z0-9-]*$/u;

/** Characters above which a derived constant name is worse to read than the string it replaces. */
const NAME_CEILING = 44;

/** A plain screaming-snake identifier, which is what a derived name has to be to compile. */
const PLAIN_NAME = /^[A-Z][A-Z0-9_]*$/u;

/** One value's nodes and lines in source order, with the spelling a declaration would carry. */
interface Spelling {
  nodes: ESTree.Node[];
  lines: number[];
  raw: string;
}

/**
 * The constant a repeated value would be named, or null when naming it would not be an improvement.
 */
function constantName(value: string, text: string): string | null {
  if (value.includes("\\")) return null;
  const name = value
    .replaceAll(/[^A-Za-z0-9]+/gu, "_")
    .replaceAll(/^_+|_+$/gu, "")
    .toUpperCase();
  if (!PLAIN_NAME.test(name) || name.length > NAME_CEILING) return null;
  return new RegExp(String.raw`\b${name}\b`, "u").test(text) ? null : name;
}

/** Declare the value once after the imports, then read every copy of it back from that name. */
function nameItOnce(fixer: Fixer, name: string, seen: Spelling, anchor: ESTree.Node): Fix[] {
  return [
    fixer.insertTextAfter(anchor, `\nconst ${name} = ${seen.raw};`),
    ...seen.nodes.map((node) => {
      // `"x" as const` becomes the name alone: the constant already has the literal type, and
      // `NAME as const` is not a spelling the compiler accepts.
      const { parent } = node;
      const asConst =
        parent?.type === "TSAsExpression" &&
        parent.typeAnnotation.type === "TSTypeReference" &&
        parent.typeAnnotation.typeName.type === "Identifier" &&
        parent.typeAnnotation.typeName.name === "const";
      const replaced = asConst ? parent : node;
      return fixer.replaceTextRange([replaced.start, replaced.end], name);
    }),
  ];
}

export const noRepeatedStringLiteralRule = defineRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: {
      description: "A string no type checks, spelled four times in one file, is four copies.",
      examples: [
        {
          before:
            'const opened = existsSync(join(dir, "opening.json"));\nconst text = readFileSync(join(dir, "opening.json"), "utf8");\nwriteFileSync(join(dir, "opening.json"), next);\nrmSync(join(dir, "opening.json"));',
          after:
            'const openingPath = join(dir, OPENING_FILE);\nconst opened = existsSync(openingPath);\nconst text = readFileSync(openingPath, "utf8");\nwriteFileSync(openingPath, next);\nrmSync(openingPath);',
        },
        {
          before:
            'if (log === null) throw new Error("campaign has no opening");\nif (log.length === 0) throw new Error("campaign has no opening");\nif (opening === undefined) throw new Error("campaign has no opening");\nif (opening.project === "") throw new Error("campaign has no opening");',
          after:
            'const NO_OPENING = "campaign has no opening";\nif (log === null) throw new Error(NO_OPENING);\nif (log.length === 0) throw new Error(NO_OPENING);\nif (opening === undefined) throw new Error(NO_OPENING);\nif (opening.project === "") throw new Error(NO_OPENING);',
        },
      ] satisfies RuleExample[],
    },
    messages: {
      repeated:
        '"{{value}}" is spelled {{count}} times in this file, on lines {{lines}}. Nothing checks these against each other, so each copy can be edited or mistyped alone. Name it once, where the thing it refers to is owned.',
    },
  },
  createOnce(context) {
    /** Every node and line each repeated value appears on, in source order, by value. */
    const spellings = new Map<string, Spelling>();

    /** The spellings this file writes as a literal type, whose copies the compiler checks. */
    const typed = new Set<string>();

    /** The last top-level import, which is where a fixed file's new constant goes. */
    let afterImports: ESTree.Node | null = null;

    /** The repeat count this file is held to, set once per file from its job. */
    let floor = REPEAT_FLOOR.source;

    /** Whether this file is a test, whose prose is not counted (`REPEAT_FLOOR`). */
    let suite = false;

    /** Whether a literal's position means the module system or a shape owns it, not the code. */
    function positional(node: ESTree.Node): boolean {
      const { parent } = node;
      if (parent === null) return true;
      if (parent.type === "ImportDeclaration" || parent.type === "ExportNamedDeclaration") return true;
      if (parent.type === "ExportAllDeclaration" || parent.type === "ImportAttribute") return true;
      if (parent.type === "Property" && parent.key === node) return true;
      return parent.type === "TSLiteralType";
    }

    return {
      before: () => {
        spellings.clear();
        typed.clear();
        suite = isTestFile(context.filename);
        floor = suite ? REPEAT_FLOOR.test : REPEAT_FLOOR.source;
        return true;
      },

      Literal(node) {
        // Keyed on the source spelling rather than the value. Every literal node carries
        // `type: "Literal"`, so the quotes are what separate a string from a number, and the
        // copies this rule is about are copies of the characters someone typed.
        const { raw } = node;
        if (raw === null || !raw.startsWith('"')) return;
        const value = raw.slice(1, -1);
        if (node.parent.type === "TSLiteralType") typed.add(value);
        if (value.length < LENGTH_FLOOR || BARE_TAG.test(value) || positional(node)) return;
        if (suite && PROSE.test(value)) return;
        // A flag, a media type or a system path is another owner's spelling, not this file's.
        if (ownedElsewhere(value)) return;
        const seen = spellings.get(value) ?? { nodes: [], lines: [], raw };
        seen.nodes.push(node);
        seen.lines.push(context.sourceCode.getLoc(node).start.line);
        spellings.set(value, seen);
      },

      Program(node) {
        // The last import of the leading block, not the last import in the file: `outcome-query`
        // imports a helper below its first statement, and a constant inserted after *that* is a
        // module constant declared after the first line of code, which is another rule's finding.
        afterImports = null;
        for (const statement of node.body) {
          if (statement.type !== "ImportDeclaration") break;
          afterImports = statement;
        }
      },

      "Program:exit": () => {
        for (const [value, seen] of spellings) {
          if (seen.lines.length < floor || typed.has(value)) continue;
          const first = seen.nodes[0];
          if (first === undefined) continue;
          const name = suite ? constantName(value, context.sourceCode.text) : null;
          const anchor = afterImports;
          context.report({
            node: first,
            messageId: "repeated",
            data: { value, count: String(seen.lines.length), lines: seen.lines.join(", ") },
            fix: (fixer) => (name === null || anchor === null ? null : nameItOnce(fixer, name, seen, anchor)),
          });
        }
      },
    };
  },
});
