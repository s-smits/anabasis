/**
 * What `@ana/agent-bundle` means when generated solve-side code imports it. A candidate may import
 * only the bare package names on `DEFAULT_ALLOW` in `src/claim/bundle-validation.ts`, so the
 * allowlist and this barrel are two halves of one decision: the list says the name is admissible
 * and this file says what the name resolves to, which is a re-export of the tool and submit
 * vocabulary that `src/` owns. A name is exported from here once a generated consumer imports it
 * and not before, because an export nothing imports is still a promise the controller has to keep.
 */
export type {
  DomainHarness,
  DomainHarnessFactory,
} from "../../src/solve/built-starter.ts";
export type { Evidence } from "../../src/solve/define-tool.ts";
export { defineDraftTool } from "../../src/solve/draft-tool.ts";
export type { DraftTool } from "../../src/solve/draft-tool.ts";
export { DraftStore } from "../../src/solve/draft-store.ts";
