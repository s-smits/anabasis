import { DATA_READER_TOOL } from "./data-session.ts";

/** Closed Built Harness add-on catalogue. Pi composes selected controller tools directly with
 * generated domain tools; generated code never owns their implementation. */
export const BUILT_PRESET_IDS = ["public-data", "files", "shell"] as const;
export type BuiltPresetId = (typeof BUILT_PRESET_IDS)[number];

const PRESET_TOOL_NAMES = {
  "public-data": [DATA_READER_TOOL],
  files: ["read", "write", "edit", "materialize_files", "bash"],
  // The same shell without the draft-file answer: a structured answer keeps its artifact-writer,
  // and the solver still computes, searches and tests in a real directory (operator decision
  // 2026-09-14; the files preset needs a file-shaped root, so 62 truss epochs declined it).
  shell: ["bash"],
} satisfies Record<BuiltPresetId, readonly string[]>;

/** Controller tools that change the draft rather than only reading it. The registration states
 *  what each tool may do, and a shell that hands a new file map back is a writer. Under `shell` it
 *  hands nothing back, and stays a writer: the authority only makes it run sequentially. */
const CONTROLLER_WRITER_TOOLS: ReadonlySet<string> = new Set(["bash"]);

export function controllerToolAuthority(name: string): "reader" | "writer" {
  return CONTROLLER_WRITER_TOOLS.has(name) ? "writer" : "reader";
}

export function isBuiltPresetId(value: string): value is BuiltPresetId {
  return BUILT_PRESET_IDS.some((known) => known === value);
}

export function presetToolNames(presets: readonly BuiltPresetId[]): string[] {
  return presets.flatMap((preset) => PRESET_TOOL_NAMES[preset]);
}

export function presetOwningTool(
  presets: readonly BuiltPresetId[],
  toolName: string,
): BuiltPresetId | undefined {
  return presets.find((preset) => PRESET_TOOL_NAMES[preset].includes(toolName) === true);
}
