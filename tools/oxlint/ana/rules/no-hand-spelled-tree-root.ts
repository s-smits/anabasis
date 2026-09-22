import { defineRule } from "@oxlint/plugins";

import { isOneOf, isUnder } from "../shared/file-role.ts";
import { importTracker } from "../shared/import-fix.ts";

/**
 * The two generated trees, and the single function that is allowed to say where each one lives.
 *
 * `arity` is how many arguments the owner takes: the root, and for a per-project directory the
 * slug that follows the segment. A call that joins anything after those is a path *inside* the
 * tree, which the owner cannot spell, so only the leading part is replaced and the rest stays.
 */
const OWNED_TREES = new Map([
  ["campaigns", { root: "campaignRoot", dir: "campaignDir" }],
  ["domains", { root: null, dir: "defaultProductDir" }],
]);

const MODULE = "src/meta/campaign-root.ts";
const OWNERS = [MODULE, "src/run/product-versions.ts"];

/**
 * The campaign and product trees each have one owner, and a path spelled beside that owner is a
 * second one. `campaign-root.ts` records that the campaign path used to be spelled at about forty
 * sites; the owner removed thirty-eight of them and nothing stopped the next two arriving.
 *
 * Only a segment joined onto a root counts. `join("campaigns", slug, "case-record.jsonl")`, with
 * the literal first, builds a repository-relative string for a report to print, which names no
 * location on disk and follows no ledger row.
 *
 * The fix moves the existing argument text into the owner's call, so it is a rearrangement rather
 * than a rewrite. It stops at the default product tree: `defaultProductDir` and
 * `selectedProductDir` differ by whether the ledger's selection row is followed, and which one a
 * caller means is the judgement the message asks for. The fix supplies the default, which is what
 * the joined literal already did; a caller that wanted the selected tree changes one name.
 */
export const noHandSpelledTreeRootRule = defineRule({
  meta: {
    type: "problem",
    fixable: "code",
    docs: {
      description: "Resolve the campaign and product trees through their owner, not a joined path literal.",
    },
    messages: {
      spelledRoot:
        'Ask {{owner}}() in src/meta/campaign-root.ts for this path instead of joining "{{segment}}" onto a root{{alternative}}. The owner follows the layout decision; a path spelled here cannot.',
    },
  },
  createOnce(context) {
    const imports = importTracker("campaign-root.ts", MODULE);
    return {
      // A test builds its own fixture tree and has to name it; a reporter under tools/ reads a
      // path it was handed. Only the controller resolves a live tree, and only it has an owner.
      before: () => isUnder(context.filename, "src") && !isOneOf(context.filename, OWNERS),
      Program: (node) => imports.read(node),
      CallExpression(node) {
        const { callee } = node;
        const called =
          callee.type === "Identifier"
            ? callee.name
            : callee.type === "MemberExpression" && callee.property.type === "Identifier"
              ? callee.property.name
              : "";
        if (called !== "join" && called !== "resolve") return;
        const args = node.arguments;
        // Index 0 is a relative path's own first segment, not a segment joined onto a root.
        for (const [offset, argument] of args.slice(1).entries()) {
          if (argument.type !== "Literal") continue;
          const segment = String(argument.value);
          const tree = OWNED_TREES.get(segment);
          if (tree === undefined) continue;
          const at = offset + 1;
          const root = args[at - 1];
          const slug = args[at + 1];
          // The owner replaces the root and the segment, and the slug too when one follows.
          const takesSlug = slug !== undefined && slug.type !== "SpreadElement";
          const owner = takesSlug ? tree.dir : tree.root;
          const rest = args.slice(takesSlug ? at + 2 : at + 1);
          context.report({
            node: argument,
            messageId: "spelledRoot",
            data: {
              owner: owner ?? tree.dir,
              segment,
              alternative:
                segment === "domains"
                  ? ", or selectedProductDir() in src/run/product-versions.ts when the caller wants the tree the ledger selected"
                  : "",
            },
            fix: (fixer) => {
              // A root-only owner the tree does not have, a spread, or further segments the owner
              // cannot carry: report and let the author place the call.
              if (
                owner === null ||
                at !== 1 ||
                root === undefined ||
                root.type === "SpreadElement" ||
                rest.length > 0
              ) {
                return [];
              }
              const inside = takesSlug
                ? `${context.sourceCode.getText(root)}, ${context.sourceCode.getText(slug)}`
                : context.sourceCode.getText(root);
              return [
                fixer.replaceText(node, `${owner}(${inside})`),
                imports.fix(fixer, owner, context.filename),
              ];
            },
          });
        }
      },
    };
  },
});
