/**
 * A verifier host over a throwaway candidate workspace, for the files that exercise it with real
 * child processes.
 *
 * Tools are small shell scripts written into a temporary `.toolchain/bin`, where
 * `resolveToolInventory` finds them as it would a Builder-installed compiler. Four files share
 * this: the one that asks what an id resolves to, the one that runs through a cell, the one that
 * bounds a run, and the one that reads the rows afterwards. Each pairs it with one
 * `afterAll(cleanupScratch)`.
 */
import { chmodSync, mkdirSync, writeFileSync } from "../../src/meta/filesystem.ts";
import type { JsonValue } from "../../src/meta/json-shape.ts";
import { join } from "../../src/meta/path.ts";
import { type VerifierHostOptions, createVerifierHost } from "../../src/verify/host.ts";
import { resolveToolInventory } from "../../src/verify/tool-inventory.ts";
import { createVerifierLifetime } from "../../src/verify/verifier-lifetime.ts";
import type {
  ToolRunRequest,
  ToolRunResult,
  VerifierHostHandle,
  VerifierSubject,
} from "../../src/verify/verifier-port.ts";
import { required } from "./doubles.ts";
import { scratchDir } from "./scratch.ts";

/** A search path the scripts below can actually reach `sleep`, `cat` and `chmod` on. */
export const TOOL_PATH = "/usr/bin:/bin";

/** A fresh candidate workspace: a `.toolchain` tree for tools and a private root for cells. */
export function workspace() {
  const dir = scratchDir("ana-host-ws-");
  const toolTree = join(dir, ".toolchain");
  const cells = join(dir, "cells");
  mkdirSync(join(toolTree, "bin"), { recursive: true });
  mkdirSync(cells, { recursive: true });
  return { dir, toolTree, cells };
}

/** Write one executable shell script from its body lines and return its path. */
export function script(dir: string, name: string, lines: readonly string[]): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${lines.join("\n")}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** A host over a workspace whose `.toolchain/bin` holds exactly the named scripts. */
export function hostFixture(
  tools: Record<string, readonly string[]>,
  options: Partial<VerifierHostOptions> = {},
) {
  const ws = workspace();
  for (const [id, lines] of Object.entries(tools)) script(join(ws.toolTree, "bin"), id, lines);
  const resolved = resolveToolInventory({ toolIds: Object.keys(tools), toolTree: ws.toolTree, pathDirs: [] });
  const host = createVerifierHost({
    inventory: resolved.inventory,
    toolTree: ws.toolTree,
    baseDir: ws.cells,
    parentEnv: { PATH: TOOL_PATH },
    requireOsSandbox: false,
    lifetime: createVerifierLifetime({ root: join(ws.dir, "lifetime") }),
    ...options,
  });
  return { ...ws, ...resolved, host };
}

export function toolPath(fx: { inventory: Record<string, { path: string }> }, id: string): string {
  return required(fx.inventory[id], `tool "${id}"`).path;
}

let subjectSeq = 0;
export function subject(artifact: JsonValue, overrides: Partial<VerifierSubject> = {}): VerifierSubject {
  subjectSeq += 1;
  return {
    checks: null,
    runId: "run-test",
    phase: "battery",
    subjectId: `case-${String(subjectSeq)}`,
    attempt: 1,
    artifact,
    publicTask: null,
    ...overrides,
  };
}

/** One evaluation call: open its scope, run through that scope's port and close in `finally`.
 *  This follows the runner's sequence, so evidence is recorded before the caller reads it. */
export async function runOnce(
  host: VerifierHostHandle,
  subj: VerifierSubject,
  request: ToolRunRequest,
): Promise<ToolRunResult> {
  const scope = host.openSubject(subj);
  try {
    return await scope.port.run(request);
  } finally {
    await scope.close();
  }
}
