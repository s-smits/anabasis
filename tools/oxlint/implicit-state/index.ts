import { eslintCompatPlugin } from "@oxlint/plugins";

import { noCoupledFlagsRule } from "./rules/no-coupled-flags.ts";
import { noMarkerFileStateRule } from "./rules/no-marker-file-state.ts";
import { noAgeBasedLockRule } from "./rules/no-age-based-lock.ts";

/**
 * The generic implicit-state rules, which infer their structure from the syntax with few false
 * findings. An implicit state machine is a state with no one typed owner, spread over booleans that
 * admit combinations nobody means, fields whose writers keep at most one set, hand-spelled string
 * literals, files in a folder, or a timestamp's age; each reader re-derives it its own way, and a
 * transition between two of them lands in a state no branch expects. The remedy is one owner: a
 * (discriminated) union for a value, one record for a process's phase, the holder itself for a
 * lock.
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
