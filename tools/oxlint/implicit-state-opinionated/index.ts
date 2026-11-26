import { eslintCompatPlugin } from "@oxlint/plugins";

import { maxBooleanFieldsRule } from "./rules/max-boolean-fields.ts";
import { preferStateUnionRule } from "./rules/prefer-state-union.ts";

/**
 * The opinionated implicit-state rules: stances about where state may live, which hold in a
 * codebase that has chosen them. The generic rules in `implicit-state` find an implicit state
 * machine from the syntax alone; these name a place a state must not live at all.
 */
const implicitStateOpinionatedPlugin = eslintCompatPlugin({
  meta: { name: "implicit-state-opinionated" },
  rules: {
    "max-boolean-fields": maxBooleanFieldsRule,
    "prefer-state-union": preferStateUnionRule,
  },
});

// oxlint-disable-next-line import/no-default-export -- Oxlint loads a JS plugin from its module's default export (`jsPlugins` in .oxlintrc.json)
export default implicitStateOpinionatedPlugin;
