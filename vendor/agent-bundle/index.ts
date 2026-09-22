/**
 * The `@ana/agent-bundle` runtime contract for generated solve-side bundles. Candidate validation
 * admits only bare allowlisted packages (`bundle-validation.ts` `DEFAULT_ALLOW`), so this shim is what that
 * allowlist name resolves to: a re-export of the controller-owned tool/submit vocabulary from
 * `src/`. Exports are added when a generated consumer exists, never speculatively.
 */
export type {
  DomainHarness,
  DomainHarnessFactory,
} from "../../src/solve/built-starter.ts";
export type { Evidence } from "../../src/solve/define-tool.ts";
export { defineDraftTool } from "../../src/solve/draft-tool.ts";
export type { DraftTool } from "../../src/solve/draft-tool.ts";
export { DraftStore } from "../../src/solve/draft-store.ts";
