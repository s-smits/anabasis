import { useState } from "react";
import { type Of, useHarness } from "../live.ts";
import {
  AGENT_DIR,
  BYTECODE,
  GENERATED_TOOLS_FILE,
  GUIDE_FILE,
  TOOL_TREE_DIR,
  TOOLS_SPEC_FILE,
} from "../../../../src/meta/bundle-layout.ts";
import { plural } from "../../../../src/meta/text.ts";
import { useHeld } from "./held.ts";

/** A harness's parts as `HARNESS.md` names them, each by its paths, the guide first; a file of none
 *  is `Other`. An older harness's `agent/tools.ts`, which no solve serves any more, is listed
 *  beside the spec. */
const PARTS: readonly (readonly [string, (path: string) => boolean])[] = [
  ["Guide", (path) => path === `${AGENT_DIR}${GUIDE_FILE}`],
  ["Tools", (path) => path === TOOLS_SPEC_FILE || path === GENERATED_TOOLS_FILE],
  ["Programs", (path) => path.startsWith(`${TOOL_TREE_DIR}/`)],
];
export const PART_NAMES: readonly string[] = [...PARTS.map(([part]) => part), "Other"];

export function partOf(path: string): string {
  return PARTS.find(([, holds]) => holds(path))?.[0] ?? "Other";
}

function inPartOrder<File extends { readonly path: string }>(files: readonly File[]): File[] {
  const rank = (path: string) => PART_NAMES.indexOf(partOf(path));
  return files.toSorted((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
}

/**
 * A harness's files with Python's bytecode caches folded behind one counted toggle: the digest
 * leaves them out (`BYTECODE`), yet running a harness's programs leaves many. Hidden in the views
 * only; the server still lists them.
 */
export function useBuildFiles<File extends { readonly path: string }>(files: readonly File[]) {
  const [shown, setShown] = useState(false);
  const built = files.filter(({ path }) => BYTECODE.test(path)).length;
  const listed = inPartOrder(shown ? files : files.filter(({ path }) => !BYTECODE.test(path)));
  const toggle =
    built === 0 ? null : (
      <button type="button" className="ana-evidence-link ana-build-toggle" onClick={() => setShown(!shown)}>
        {shown
          ? `Hide ${plural(built, "bytecode cache file")}`
          : `${plural(built, "bytecode cache file")} hidden`}
      </button>
    );
  return { listed, toggle };
}

export function useHarnessFiles(of: Of, digest: string) {
  const files = useHarness(of, digest);
  const held = useHeld(digest, files.current ? files.data : null);
  return { files, ...held, ...useBuildFiles(held.view?.files ?? []) };
}
