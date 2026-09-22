import { defineRule } from "@oxlint/plugins";
import { containsUnknownType } from "../shared/unknown-type.ts";

/**
 * Use `unknown` at validation boundaries; adding union members does not narrow it.
 *
 * There is no fix: the repair is the type the `unknown` was standing in for, which is the work
 * the union avoided.
 */
export const noUnknownUnionRule = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow explicit unknown union members that erase the other alternatives." },
    messages: {
      unknownUnion:
        "`unknown` absorbs the other union members. Use the producer's parsed or SDK type when known; otherwise use plain `unknown` at the validation boundary. Preserve runtime absence checks.",
    },
  },
  createOnce(context) {
    return {
      TSUnionType(node) {
        if (containsUnknownType(node)) context.report({ node, messageId: "unknownUnion" });
      },
    };
  },
});
