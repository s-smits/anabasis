import { eslintCompatPlugin } from "@oxlint/plugins";

import { noArrayFilterMapRule } from "./rules/no-array-filter-map.ts";
import { noReduceAccumulatorCopyRule } from "./rules/no-reduce-accumulator-copy.ts";
import { noChainedTypeAssertionsRule } from "./rules/no-chained-type-assertions.ts";
import { noConditionalEmptyObjectSpreadRule } from "./rules/no-conditional-empty-object-spread.ts";
import { noKnownValueWideningRule } from "./rules/no-known-value-widening.ts";
import { noModuleMockingRule } from "./rules/no-module-mocking.ts";
import { noObjectParametersRule } from "./rules/no-object-parameters.ts";
import { noReflectApplyRule } from "./rules/no-reflect-apply.ts";
import { noReflectGetRule } from "./rules/no-reflect-get.ts";
import { noRuntimeTypeofRule } from "./rules/no-runtime-typeof.ts";
import { noForbiddenTermInSymbolNamesRule } from "./rules/no-shape-in-symbol-names.ts";
import { noUnknownReturnsRule } from "./rules/no-unknown-returns.ts";
import { noUnknownTypeAliasesRule } from "./rules/no-unknown-type-aliases.ts";
import { noUnsafeDictionaryTypeRule } from "./rules/no-unsafe-dictionary-type.ts";
import { noWidenThenAssertRule } from "./rules/no-widen-then-assert.ts";
import { preferSubpathImportRule } from "./rules/prefer-subpath-import.ts";
import { requireSafetyCommentForTypeAssertionRule } from "./rules/require-safety-comment-for-type-assertion.ts";

/** The seventeen generic rules, about evidence rather than about this repository: a value whose
 *  type nobody established, an assertion with no stated reason, a dictionary whose contents are
 *  anyone's guess, a call routed through reflection so that nothing checks it.
 *
 *  The tree is copied from dmmulroy/anti-slop, first at commit 9b80d9a and since updated to
 *  c44ef22, with the differences recorded in `THIRD_PARTY_NOTICES.md`: the plugin registers
 *  through `eslintCompatPlugin`, upstream's `no-unknown-parameters`, `require-readable-spacing`
 *  and Effect rules are left out, and `rules/prefer-subpath-import.ts` and three of the shared
 *  modules are this repository's own. `ana/unproven-unknown-parameter` is what stands in for the
 *  omitted one, and says there why an exemption list of files was the wrong answer.
 *
 *  Being a copy is what decides where a change goes. A rule whose reason is a fact about
 *  Anabasis — an owner module, a campaign path, a contract this repository declares — belongs in
 *  `ana/` next door, because a change here is paid for again at the next copy from upstream. */
const antiSlopPlugin = eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "no-array-filter-map": noArrayFilterMapRule,
    "no-reduce-accumulator-copy": noReduceAccumulatorCopyRule,
    "no-chained-type-assertions": noChainedTypeAssertionsRule,
    "no-conditional-empty-object-spread": noConditionalEmptyObjectSpreadRule,
    "no-known-value-widening": noKnownValueWideningRule,
    "no-module-mocking": noModuleMockingRule,
    "no-object-parameters": noObjectParametersRule,
    "no-reflect-apply": noReflectApplyRule,
    "no-reflect-get": noReflectGetRule,
    "no-runtime-typeof": noRuntimeTypeofRule,
    "no-unsafe-dictionary-type": noUnsafeDictionaryTypeRule,
    "no-shape-in-symbol-names": noForbiddenTermInSymbolNamesRule,
    "no-unknown-returns": noUnknownReturnsRule,
    "no-unknown-type-aliases": noUnknownTypeAliasesRule,
    "no-widen-then-assert": noWidenThenAssertRule,
    "prefer-subpath-import": preferSubpathImportRule,
    "require-safety-comment-for-type-assertion": requireSafetyCommentForTypeAssertionRule,
  },
});

export default antiSlopPlugin;
