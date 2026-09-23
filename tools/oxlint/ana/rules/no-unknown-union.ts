import { defineRule } from "@oxlint/plugins";
import { containsUnknownType } from "../shared/unknown-type.ts";

/**
 * A union with `unknown` among its members: `Row | unknown`, `string | unknown | undefined`.
 *
 * The other members are decoration. `unknown` absorbs them, so the union denotes exactly
 * `unknown` and would denote the same thing with the `Row` deleted — but the `Row` is what a
 * reader takes the annotation to mean, and what the next author writes their narrowing against.
 * The shape usually appears while a real type is being worked out and stays when it is not, which
 * is why the message asks for the producer's parsed or SDK type where one exists and plain
 * `unknown` where none does. Plain is not the lesser answer: at a validation boundary `unknown` is
 * the honest annotation, and written on its own it is visible as one.
 *
 * The rule body is a single condition, `containsUnknownType(node)` over every `TSUnionType` in the
 * file, with nothing beside it — no exemption, because a union that denotes `unknown` denotes
 * `unknown` wherever it is written. What bounds the rule is how far that helper looks: into a
 * union and through parentheses and no further, so an `unknown` inside a container or an
 * intersection belongs to another rule. `shared/unknown-type.ts` says which, and why.
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
