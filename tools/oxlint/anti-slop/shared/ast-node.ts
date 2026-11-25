import type { ESTree } from "@oxlint/plugins";
import { isRecord, isString, type OpenRecord } from "#src/meta/json-shape.ts";

/**
 * The plugins' one node test and their one keyed view of a node, for the walks that follow
 * `visitorKeys` rather than the ESTree union, so `lexical-type-parameters.ts`,
 * `type-alias-resolution.ts` and `ana/no-unproven-unknown-parameter` need no `typeof` guard or `as
 * unknown as` cast of their own.
 */

/** A node that can also be read by key: `node.type` narrows as ESTree's does, `node[key]` is unknown. */
export type KeyedNode = ESTree.Node & OpenRecord;

export function isNode(value: unknown): value is KeyedNode {
  return isRecord(value) && isString(value.type);
}

/**
 * ESTree nodes are interfaces, which declare no index signature, so no single assertion reaches
 * `OpenRecord`; the record test is true of every node, and the copy in the other branch is
 * unreachable.
 */
export function nodeFields(node: ESTree.Node): KeyedNode {
  return isRecord(node) ? node : { ...node };
}
