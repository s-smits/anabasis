import { defineRule, type ESTree, type Fix, type Fixer } from "@oxlint/plugins";
import { isTestFile } from "../shared/file-role.ts";
import { ownedElsewhere } from "../shared/literal-owner.ts";

/**
 * One string the compiler does not own, spelled four times in a file, is four places to edit and
 * four chances to disagree.
 *
 *     spawn(["bwrap", "--ro-bind", from, to]);  // and three more, spelled out
 *     readFileSync(join(dir, "opening.json"));  // and three more
 *
 * The first version of this rule reported every repeat that carried meaning, and it was wrong
 * about most of them. Measured over the whole tree on 2026-09-20: 158 sites, of which 138 across
 * 98 distinct values were bare tags — `"non-result"`, `"completed"`, `"blocking"`, `"Identifier"`.
 * Those are union members. A typo in one is a build failure rather than a branch that quietly
 * never runs, so the risk this rule exists to remove is already removed there, by a mechanism
 * stronger than a local `const`. The repair the old message asked for did not exist either: the
 * union is a type, so there is no member to import and the `const` beside the four uses would
 * only move the characters.
 *
 * The 20 that remain are the strings nothing checks — a file this repository writes and reads
 * (`opening.json`, `battery.json`, `agent/tools.ts`), a flag handed to a sandbox (`--ro-bind`,
 * `--tmpfs`), an identifier crossing a process boundary (`verifier_workshop`), a sentence a
 * reader will grep for. `generated-tool-worker-child.ts` spells its wire form `non_result` while
 * the whole rest of the tree spells the case kind `non-result`; nothing but a reader catches
 * that, and that is the finding.
 *
 * A bare tag is one word of letters, digits and hyphens. The test is a proxy for "the type checker
 * has no opinion here" and a blunt one, but it is decidable from the characters, and it selects the
 * class where a named constant is the repair rather than a second copy. It is wrong about
 * underscores, and knowingly: `materialization_result`, `apply_files_result` and
 * `turn_permit_request` are declared members of the worker protocol union in
 * `src/solve/generated-tool-worker-protocol.ts`, so the rule reports a repeat the compiler already
 * owns. Widening the tag to admit `_` would also admit the wire identifiers the same file crosses a
 * process boundary with, which is the one class this rule exists to catch — `non_result` against
 * `non-result` is the recorded instance. The mismatch is left in the narrower direction on purpose. It admits a leading digit, which it did not until 2026-09-20: `"2-digit"` is a
 * member of `Intl.DateTimeFormatOptions`, spelled six times in one formatter and five in
 * another, and the five `introduced: "2026-09-15"` rows of the safeguard inventory are a
 * hyphenated word by the same reading — naming either is not a repair.
 *
 * Some spellings are somebody else's, and `ownedElsewhere` answers which: a flag, a media type,
 * a registry name, a system path. `args.push("--ro-bind", path, path)` reads against `man bwrap`,
 * while `args.push(RO_BIND, path, path)` reads against nothing, and the `const` would have been
 * typed from the same memory as the six copies. Three sites of 19 on 2026-09-20; the identity
 * scan asked the same question with a longer list, which is why the list is now shared.
 *
 * In a source file there is no fix, because where the constant belongs is the question and a
 * fixer would answer it with a local one every time. In a test file a local one is the answer: the
 * fixture belongs to the suite that spells it, and importing the producer's constant instead would
 * cost the test the rename it exists to catch. So the fixer runs there and nowhere else. It
 * declines a value it cannot turn into a plain identifier — a leading digit, an escape, a name the
 * file already uses — and a file with no import to insert after, because inserting before the
 * first declaration lands between a doc comment and the declaration it documents.
 *
 * Import sources and re-export names are skipped because the module system owns them, and object
 * property keys because they are the shape rather than a value. A test file is held to a higher
 * floor rather than skipped, for the reason `REPEAT_FLOOR` records. The report lands once per
 * literal, at its first spelling, and names the other lines: four reports of one string are four
 * readings of one finding.
 */

/**
 * Spellings of one string in a file below which repetition is ordinary, by the file's job.
 *
 * A suite naming one fixture in twenty cases is doing its job, which is why this rule skipped
 * test files entirely until 2026-09-20. Skipping them also skipped the case the floor exists for:
 * `test/run-triage.test.ts` spells one campaign directory 23 times, and when the fixture moved,
 * 23 lines had to move with it. Measured over the whole test corpus at a floor of 12, the rule
 * finds the files where the repetition is a fixture nobody named and nothing else.
 */
const REPEAT_FLOOR = { source: 4, test: 10 };

/** String length below which a repeat is a word — `"id"`, `"json"` — rather than a value. */
const LENGTH_FLOOR = 6;

/** One word of letters, digits and hyphens: how this tree spells a union member. */
const BARE_TAG = /^[A-Za-z0-9][A-Za-z0-9-]*$/u;

/** Characters above which a derived constant name is worse to read than the string it replaces. */
const NAME_CEILING = 44;

/** A plain screaming-snake identifier, which is what a derived name has to be to compile. */
const PLAIN_NAME = /^[A-Z][A-Z0-9_]*$/u;

/** One value's nodes and lines in source order, with the spelling a declaration would carry. */
type Spelling = { nodes: ESTree.Node[]; lines: number[]; raw: string };

/**
 * The constant a repeated value would be named, or null when naming it would not be an improvement.
 *
 * The file's whole text is the collision test, not its scope tree: a word already spelled anywhere
 * here may be an import, a local or a property, and any of the three makes the new declaration a
 * second meaning for one name. It over-refuses, and the cost of over-refusing is a report the
 * author fixes by hand.
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
    docs: { description: "A string no type checks, spelled four times in one file, is four copies." },
    messages: {
      repeated:
        '"{{value}}" is spelled {{count}} times in this file, on lines {{lines}}. Nothing checks these against each other, so each copy can be edited or mistyped alone. Name it once, where the thing it refers to is owned.',
    },
  },
  createOnce(context) {
    /** Every node and line each repeated value appears on, in source order, by value. */
    const spellings = new Map<string, Spelling>();

    /** The last top-level import, which is where a fixed file's new constant goes. */
    let afterImports: ESTree.Node | null = null;

    /** The repeat count this file is held to, set once per file from its job. */
    let floor = REPEAT_FLOOR.source;

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
        floor = isTestFile(context.filename) ? REPEAT_FLOOR.test : REPEAT_FLOOR.source;
        return true;
      },

      Literal(node) {
        // Keyed on the source spelling rather than the value. Every literal node carries
        // `type: "Literal"`, so the quotes are what separate a string from a number, and the
        // copies this rule is about are copies of the characters someone typed.
        const { raw } = node;
        if (raw === null || !raw.startsWith('"')) return;
        const value = raw.slice(1, -1);
        if (value.length < LENGTH_FLOOR || BARE_TAG.test(value) || positional(node)) return;
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
          if (seen.lines.length < floor) continue;
          const first = seen.nodes[0];
          if (first === undefined) continue;
          const name = isTestFile(context.filename) ? constantName(value, context.sourceCode.text) : null;
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
