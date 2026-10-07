import { defineRule, type ESTree } from "@oxlint/plugins";
import { methodCall } from "../shared/statements.ts";

/**
 * A loop over `Object.keys(o)` whose body then looks each key back up in `o`:
 *
 *     for (const id of Object.keys(rows)) {
 *       if (rows[id].verified) …
 *     }
 *
 *     for (const [id, row] of Object.entries(rows)) {
 *       if (row.verified) …
 *     }
 *
 * The lookup is the finding. `Object.entries` already carries the value the loop is about to
 * fetch, so the indexed read is work the platform has done and thrown away. It also costs a
 * type: under `noUncheckedIndexedAccess` the lookup is `T | undefined` and needs either a
 * non-null assertion or a guard for a key that came out of the same object, while the entry's
 * value is plainly `T`.
 *
 * `Object.keys` on its own is not a finding. A loop that only needs the names — deleting them,
 * counting them, comparing two key sets — is asking exactly the right question, and rewriting
 * it to `entries` would fetch values nothing reads.
 *
 * The body is read as text: the loop binds a single identifier, and somewhere below it the
 * object is indexed by that identifier for something other than a `delete`. Text is enough here
 * because both halves are short and both names are in the loop header, and a false match needs a
 * second `o[k]` that means something else, which is the same rewrite anyway.
 *
 * The `delete` half was the rule's only census site (2026-09-20): `test/env-baseline.ts` walks
 * `Bun.env`'s keys and deletes the ones that would alter isolation. It never reads a value, so
 * `entries` would fetch every value in the environment to throw them all away.
 *
 * There is no fix. The entry's value needs a name, and only the body says what it
 * is called.
 */
export const preferEntriesOverKeysLookupRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "A keys loop that indexes the object back is an entries loop." },
    messages: {
      lookedBackUp:
        "This loop walks `{{object}}`'s keys and then reads `{{object}}[{{key}}]` back out. `Object.entries({{object}})` hands the value over with the key, which saves the lookup and the `| undefined` that comes with it.",
    },
  },
  createOnce(context) {
    /** The object `Object.keys(o)` is called on, as source text, or null for anything else. */
    function keysOf(node: ESTree.Expression): string | null {
      const call = methodCall(node, "keys");
      if (call?.receiver.type !== "Identifier" || call.receiver.name !== "Object") return null;
      return context.sourceCode.getText(call.argument);
    }

    return {
      ForOfStatement(node) {
        const declaration: ESTree.Node = node.left;
        if (declaration.type !== "VariableDeclaration") return;
        const [declared] = declaration.declarations;
        if (declared?.id.type !== "Identifier") return;

        const object = keysOf(node.right);
        if (object === null) return;

        const key = declared.id.name;
        const lookup = new RegExp(`(delete\\s+)?${escape(object)}\\s*\\[\\s*${escape(key)}\\s*\\]`, "gu");
        const indexed = [...context.sourceCode.getText(node.body).matchAll(lookup)];
        if (!indexed.some((match) => match[1] === undefined)) return;
        context.report({ node: node.right, messageId: "lookedBackUp", data: { object, key } });
      },
    };
  },
});

/** Source text becomes a pattern, so a dotted or bracketed object name matches itself alone. */
function escape(text: string): string {
  return text.replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`);
}
