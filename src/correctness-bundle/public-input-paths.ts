/** The public-input paths each task family offers, shared by author preview and conformance. */
import { isObject, type JsonValue } from "../meta/json-shape.ts";
import type { BuildTask } from "./tasks.ts";

function collectPaths(value: JsonValue, path: string, paths: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      const itemPath = `${path}[]`;
      paths.add(itemPath);
      collectPaths(item, itemPath, paths);
    }
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    paths.add(childPath);
    collectPaths(child, childPath, paths);
  }
}

/** Generated tools declare input paths per family. Combining paths within a family permits
 *  optional sibling fields; combining families would hide reads outside a tool's declared inputs. */
export function publicInputPathsByFamily(tasks: readonly BuildTask[]): Map<string, Set<string>> {
  const byFamily = new Map<string, Set<string>>();
  for (const task of tasks) {
    let paths = byFamily.get(task.family);
    if (paths === undefined) {
      paths = new Set<string>();
      byFamily.set(task.family, paths);
    }
    collectPaths(task.publicInput, "$", paths);
  }
  return byFamily;
}
