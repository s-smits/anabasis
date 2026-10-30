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

/** A harness's parts as `HARNESS.md` names them, each by its paths; a file of none is `Other`. A
 *  Builder gives the solver its tools as programs under `.toolchain/` or as tools in
 *  `agent/tools.ts`; on 19 October 0 of 193 kept harnesses declared one in `tools.ts`, so a flat
 *  list of paths read as a guide and an empty tool file. The lineage strip's file list and the
 *  inspector's list and diff all read a harness in this order, the guide first. */
const PARTS: readonly (readonly [string, (path: string) => boolean])[] = [
  ["Guide", (path) => path === `${AGENT_DIR}${GUIDE_FILE}`],
  ["Tools", (path) => path === TOOLS_SPEC_FILE || path === GENERATED_TOOLS_FILE],
  ["Programs", (path) => path.startsWith(`${TOOL_TREE_DIR}/`)],
];
export const PART_NAMES: readonly string[] = [...PARTS.map(([part]) => part), "Other"];

export function partOf(path: string): string {
  return PARTS.find(([, holds]) => holds(path))?.[0] ?? "Other";
}

/** Files in part order, and by path within a part. */
function inPartOrder<File extends { readonly path: string }>(files: readonly File[]): File[] {
  const rank = (path: string) => PART_NAMES.indexOf(partOf(path));
  return files.toSorted((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
}

/**
 * A harness's files with Python's bytecode caches folded behind one counted toggle. A cache holds
 * nothing its source does not and the digest leaves it out (`BYTECODE`), yet running a harness's
 * programs leaves them in the kept state (26 of 54 states of buffer-fresh-opus-v065-b), where they
 * stood among the guide and the programs. They are hidden in the views only (30 October): the
 * server still lists them, and the toggle shows them in place.
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

/** A kept harness's files as the lineage strip and the inspector list them: the previous
 *  harness's held while the next is read (`held.ts`), bytecode caches folded behind the toggle. */
export function useHarnessFiles(of: Of, digest: string) {
  const files = useHarness(of, digest);
  const held = useHeld(digest, files.current ? files.data : null);
  return { files, ...held, ...useBuildFiles(held.view?.files ?? []) };
}
