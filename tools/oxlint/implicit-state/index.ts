import { eslintCompatPlugin } from "@oxlint/plugins";

import { coAssignedFlagsRule } from "./rules/co-assigned-flags.ts";
import { filesAsPhaseRule } from "./rules/files-as-phase.ts";
import { mtimeAsLockRule } from "./rules/mtime-as-lock.ts";

/**
 * The generic implicit-state rules: ones that infer their structure from the syntax and run on any
 * TypeScript tree with few false findings.
 *
 * An implicit state machine is a state whose value has no one typed owner. It is spread instead
 * over several booleans that admit combinations nobody means, over fields whose writers keep at
 * most one of them set, over string literals each reader
 * spells by hand, over which files exist in a folder, over what a name encodes, or over how old a
 * timestamp is. Each reader then re-derives the state its own way, the readers drift apart, and a
 * transition that happens between two of them (a crash between two writes, a slow holder past a
 * threshold) lands in a state no branch expects. The remedy is always one owner: a union or a
 * discriminated union for a value, one record for a process's phase, the holder itself for a lock.
 *
 * Tiers. These rules are generic: they name no module, path or helper of any one repository, match
 * the platform's own forms (`fs`, `Bun.file`, React's `useState`) or a local wrapper whose body
 * reduces to one, and keep any list they need as an option with a generic default. Their false
 * findings on foreign repositories are the test of that tier. The stances that fit one
 * repository's philosophy and would be contested elsewhere are `implicit-state-opinionated`, next
 * door; the cross-file shapes (one literal compared by hand in many files, one external read
 * repeated on one call path) are the scan `tools/oxlint/tree-implicit-state.ts`, which runs on any
 * folder.
 *
 * Every rule reports and none fixes: naming the states is the change. A rule starts as a report and
 * joins a gating configuration only once no site stands in the tree.
 */
const implicitStatePlugin = eslintCompatPlugin({
  meta: { name: "implicit-state" },
  rules: {
    "co-assigned-flags": coAssignedFlagsRule,
    "files-as-phase": filesAsPhaseRule,
    "mtime-as-lock": mtimeAsLockRule,
  },
});

// oxlint-disable-next-line import/no-default-export -- Oxlint loads a JS plugin from its module's default export (`jsPlugins` in .oxlintrc.json)
export default implicitStatePlugin;
