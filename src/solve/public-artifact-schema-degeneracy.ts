/** Detect compiled submission nodes that no populated artifact can use. */
import type { PublicArtifactSchemaNode } from "./public-artifact-schema.ts";
import { childPath } from "./public-artifact-validate.ts";

/**
 * Paths of compiled nodes that can never accept populated content. An accept corpus whose example
 * at a path is an empty object compiles to an object node with no properties and no additional
 * properties, which rejects every non-empty object there.
 */
export function publicArtifactSchemaDegeneracies(root: PublicArtifactSchemaNode, path = "$"): string[] {
  if (root.kind === "object") {
    if (Object.keys(root.properties).length === 0) return [path];
    return Object.entries(root.properties).flatMap(([key, child]) =>
      publicArtifactSchemaDegeneracies(child, childPath(path, key)),
    );
  }
  if (root.kind === "array") return publicArtifactSchemaDegeneracies(root.items, `${path}[]`);
  if (root.kind === "map") return publicArtifactSchemaDegeneracies(root.values, `${path}.*`);
  if (root.kind === "union") {
    // One populated alternative keeps the path expressible; a varied corpus is not degenerate.
    const alternatives = root.anyOf.map((alternative) => publicArtifactSchemaDegeneracies(alternative, path));
    return alternatives.every((entries) => entries.length > 0) ? [path] : [];
  }
  return [];
}
