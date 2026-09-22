/**
 * Shared process-global access for operations without an equivalent Bun 1.4 API:
 * cwd, pid, platform, signals, process groups, lifecycle events, exit and synchronous stdio.
 */
export const runtimeProcess = globalThis.process;

/** Argument parsing for the repository's own command entrypoints; Bun 1.4 has no equivalent. */
export { parseArgs } from "node:util";
