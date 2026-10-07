import type { ESTree } from "@oxlint/plugins";
import { isRecord, isString, type OpenRecord } from "#src/meta/json-shape.ts";

/**
 * The plugins' one node test and their one keyed view of a node, for the walks that follow
 * `visitorKeys` rather than the ESTree union.
 *
 * Three files held their own copy of both until 2026-09-22: `lexical-type-parameters.ts` and
 * `type-alias-resolution.ts` each a `typeof` guard and an `as unknown as` cast, and
 * `ana/unproven-unknown-parameter` a third of each. Every copy answered the same two lint findings
 * the same way. Both read through json-shape.ts now, the owner of the primitive tests, so neither
 * needs an answer.
 */

/** A node that can also be read by key: `node.type` narrows as ESTree's does, `node[key]` is unknown. */
export type KeyedNode = ESTree.Node & OpenRecord;

/** Whether a child a walk reached by key is a node, so the walk can read it without asking again. */
export function isNode(value: unknown): value is KeyedNode {
  return isRecord(value) && isString(value["type"]);
}

/**
 * The node a visitor was handed, readable by key. ESTree nodes are interfaces, which declare no
 * index signature, so no single assertion reaches `OpenRecord`; the record test is true of every
 * node and hands the same object back. The copy in the other branch is unreachable.
 */
export function nodeFields(node: ESTree.Node): KeyedNode {
  return isRecord(node) ? node : { ...node };
}
