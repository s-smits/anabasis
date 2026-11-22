import { eslintCompatPlugin } from "@oxlint/plugins";

import { noCoupledFlagsRule } from "./rules/no-coupled-flags.ts";
import { noMarkerFileStateRule } from "./rules/no-marker-file-state.ts";
import { noAgeBasedLockRule } from "./rules/no-age-based-lock.ts";

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
 */
const implicitStatePlugin = eslintCompatPlugin({
  meta: { name: "implicit-state" },
  rules: {
    "no-coupled-flags": noCoupledFlagsRule,
    "no-marker-file-state": noMarkerFileStateRule,
    "no-age-based-lock": noAgeBasedLockRule,
  },
});

// oxlint-disable-next-line import/no-default-export -- Oxlint loads a JS plugin from its module's default export (`jsPlugins` in .oxlintrc.json)
export default implicitStatePlugin;
