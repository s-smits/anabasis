import { eslintCompatPlugin } from "@oxlint/plugins";

import { nameEncodedStateRule } from "./rules/name-encoded-state.ts";
import { stateFileOverwriteRule } from "./rules/state-file-overwrite.ts";

/**
 * The opinionated implicit-state rules: stances about where state may live, which hold in a
 * codebase that has chosen them and would be contested in one that has not. The generic rules, next
 * door in `implicit-state`, define an implicit state machine and find it from the syntax alone;
 * these go further and name a place a state must not live at all.
 *
 * - No meaning parsed from names (`name-encoded-state`). A name labels a record; a fact read back
 *   out of it has two owners, the namer and the parser, and a rename moves it silently. Contested
 *   where a name convention is the only interface (a branch scheme a CI system enforces).
 * - No state in a file each writer replaces (`state-file-overwrite`). State that outlives a process
 *   is an append-only log read as a fold. Contested where settings, caches and exported reports are
 *   rewritten whole on purpose.
 * - Every status literal comes from a declared owner (`unowned-state-literal`, a kind of the scan
 *   `tools/oxlint/tree-implicit-state.ts`, since it needs every file at once). A literal compared in
 *   several files with no union, enum or `as const` declaring it is a state nobody owns. Contested
 *   where literals are protocol strings another program defines.
 *
 * A fourth stance, that every multi-step operation moving files or remote refs keeps a progress
 * record or runs in an idempotent order, is not a rule: no syntax tells a step that can be repeated
 * from one that cannot, so it stays a review question.
 *
 * The false findings these rules make on foreign repositories are what keeps them here rather than
 * in the generic tier. Every rule reports and none fixes, and each starts as a report.
 */
const implicitStateOpinionatedPlugin = eslintCompatPlugin({
  meta: { name: "implicit-state-opinionated" },
  rules: {
    "name-encoded-state": nameEncodedStateRule,
    "state-file-overwrite": stateFileOverwriteRule,
  },
});

// oxlint-disable-next-line import/no-default-export -- Oxlint loads a JS plugin from its module's default export (`jsPlugins` in .oxlintrc.json)
export default implicitStateOpinionatedPlugin;
