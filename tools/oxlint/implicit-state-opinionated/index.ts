import { eslintCompatPlugin } from "@oxlint/plugins";

import { flagCountRule } from "./rules/flag-count.ts";
import { flagsAsStateRule } from "./rules/flags-as-state.ts";
import { nameEncodedStateRule } from "./rules/name-encoded-state.ts";

/**
 * The opinionated implicit-state rules: stances about where state may live, which hold in a
 * codebase that has chosen them and would be contested in one that has not. The generic rules, next
 * door in `implicit-state`, define an implicit state machine and find it from the syntax alone;
 * these go further and name a place a state must not live at all.
 *
 * - No record of more than two flags (`flag-count`). Several booleans on one record are read as one
 *   state spelled as flags, whatever the code does with them. Contested where records of
 *   independent options are the norm, as in a build tool's configuration.
 * - No flags a class's methods move apart, and no flag derived from two others of one record
 *   (`flags-as-state`): both read as a phase held as flags. Contested in large classes, whose
 *   unrelated latches (a warn-once flag, a lazy load) move in different methods too.
 * - No meaning parsed from names (`name-encoded-state`). A name labels a record; a fact read back
 *   out of it has two owners, the namer and the parser, and a rename moves it silently. Contested
 *   where a name convention is the only interface (a branch scheme a CI system enforces).
 * - Every status literal comes from a declared owner (`unowned-state-literal`, a kind of the scan
 *   `tools/oxlint/tree-implicit-state.ts`, since it needs every file at once). A literal compared in
 *   several files with no union, enum or `as const` declaring it is a state nobody owns. Contested
 *   where literals are protocol strings another program defines.
 *
 * Two further stances are not rules, since no syntax tells the cases apart, and stay review
 * questions: that state outliving a process is an append-only log rather than a file each writer
 * replaces (a rewritten report, cache or output reads the same as a rewritten state, and on four
 * repositories every such write found was the former), and that every multi-step operation moving
 * files or remote refs keeps a progress record or runs in an idempotent order.
 *
 * The false findings these rules make on foreign repositories are what keeps them here rather than
 * in the generic tier. Every rule reports and none fixes, and each starts as a report.
 */
const implicitStateOpinionatedPlugin = eslintCompatPlugin({
  meta: { name: "implicit-state-opinionated" },
  rules: {
    "flag-count": flagCountRule,
    "flags-as-state": flagsAsStateRule,
    "name-encoded-state": nameEncodedStateRule,
  },
});

// oxlint-disable-next-line import/no-default-export -- Oxlint loads a JS plugin from its module's default export (`jsPlugins` in .oxlintrc.json)
export default implicitStateOpinionatedPlugin;
