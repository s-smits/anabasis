/**
 * The repository's lint plugins: the one record every other list of rules reads (HABITS 12.13).
 *
 * Each folder's `index.ts` stays a static, type-checked map, since Oxlint loads it through
 * `jsPlugins`; `test/rule-names.test.ts` holds the rule files, the configs, the ledger and the
 * documents to the names registered here.
 */
import type { Plugin } from "@oxlint/plugins";
import anaPlugin from "./ana/index.ts";
import antiSlopPlugin from "./anti-slop/index.ts";
import implicitStatePlugin from "./implicit-state/index.ts";
import implicitStateOpinionatedPlugin from "./implicit-state-opinionated/index.ts";

/** Each plugin under the name its findings carry (`ana/no-deep-nesting`), which is also its folder. */
export const PLUGINS: ReadonlyMap<string, Plugin> = new Map(
  [anaPlugin, antiSlopPlugin, implicitStatePlugin, implicitStateOpinionatedPlugin].map((plugin) => [
    plugin.meta?.name ?? "",
    plugin,
  ]),
);
