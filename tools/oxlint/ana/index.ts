import { eslintCompatPlugin } from "@oxlint/plugins";

import { unprovenUnknownParameterRule } from "./rules/unproven-unknown-parameter.ts";
import { noUnknownUnionRule } from "./rules/no-unknown-union.ts";
import { requireCapturedJsonRuntimeRule } from "./rules/require-captured-json-runtime.ts";
import { noHandSpelledTreeRootRule } from "./rules/no-hand-spelled-tree-root.ts";
import { requireMetaRuntimeImportRule } from "./rules/require-meta-runtime-import.ts";
import { noSingleCallerHelperRule } from "./rules/no-single-caller-helper.ts";
import { noSingleUseConstChainRule } from "./rules/no-single-use-const-chain.ts";
import { noPositionalBooleanParameterRule } from "./rules/no-positional-boolean-parameter.ts";
import { preferIncludesOverSomeEqualsRule } from "./rules/prefer-includes-over-some-equals.ts";
import { preferKeyIfDefinedRule } from "./rules/prefer-key-if-defined.ts";
import { noHandRolledErrorRenderRule } from "./rules/no-hand-rolled-error-render.ts";
import { requireTypeForNullDefaultRule } from "./rules/require-type-for-null-default.ts";
import { preferSomeOverFilterLengthRule } from "./rules/prefer-some-over-filter-length.ts";
import { noInlineSlopAnswerRule } from "./rules/no-inline-slop-answer.ts";

import { noAliasRestatingReturnRule } from "./rules/no-alias-restating-return.ts";
import { noArgumentAlreadyCarriedRule } from "./rules/no-argument-already-carried.ts";
import { noArmsDifferingInOneTermRule } from "./rules/no-arms-differing-in-one-term.ts";
import { noDeepNestingRule } from "./rules/no-deep-nesting.ts";
import { noHandRolledSleepRule } from "./rules/no-hand-rolled-sleep.ts";
import { noInlineBlockReducerRule } from "./rules/no-inline-block-reducer.ts";
import { noInlineSchemaLiteralRule } from "./rules/no-inline-schema-literal.ts";
import { noLifetimeOutsideOwnerRule } from "./rules/no-lifetime-outside-owner.ts";
import { noPassThroughWrapperRule } from "./rules/no-pass-through-wrapper.ts";
import { noPropertyReadOnFunctionRule } from "./rules/no-property-read-on-function.ts";
import { noRenamingTemporaryRule } from "./rules/no-renaming-temporary.ts";
import { noRepeatedStringLiteralRule } from "./rules/no-repeated-string-literal.ts";
import { noSideEffectInPredicateRule } from "./rules/no-side-effect-in-predicate.ts";
import { noTangledTernaryRule } from "./rules/no-tangled-ternary.ts";
import { noThriceSpelledObjectRule } from "./rules/no-thrice-spelled-object.ts";
import { noTransposedArgumentRule } from "./rules/no-transposed-argument.ts";
import { preferConditionOverBooleanReturnsRule } from "./rules/prefer-condition-over-boolean-returns.ts";
import { preferConstConditionalRule } from "./rules/prefer-const-conditional.ts";
import { preferEntriesOverKeysLookupRule } from "./rules/prefer-entries-over-keys-lookup.ts";
import { preferFindOverLoopRule } from "./rules/prefer-find-over-loop.ts";
import { preferFlatmapOverMapFilterRule } from "./rules/prefer-flatmap-over-map-filter.ts";
import { preferLookupOverEqualityChainRule } from "./rules/prefer-lookup-over-equality-chain.ts";
import { declarationsBeforeTheFirstFunctionRule } from "./rules/declarations-before-the-first-function.ts";

/** Rules this repository owns. The anti-slop plugin beside it is copied from dmmulroy/anti-slop at
 *  a pinned commit, as its README asks, so a rule that needs to answer an Anabasis question lives
 *  here instead.
 *
 *  The second group are the simplify catchers. They exist because `/simplify` is a reading pass:
 *  it finds real removals and finds them once, in whichever files a reviewer happened to open.
 *  Nineteen of the shapes it kept finding — measured over 628 commits and 20 recorded passes —
 *  are decidable from the syntax alone, and a twentieth came off the backlog that measurement
 *  left; a catcher finds every site of one in a second.
 *  Ten of them are here. The other ten are in the first group, because each one's sites have
 *  all been taken: a catcher reporting nothing cannot break a strict lint, costs nothing to enforce
 *  and keeps the shape from arriving. The evidence for promotion is a clean `bun run lint -- --strict`, not
 *  an emptied census group; twice a group emptied and a site was still standing in a vendored
 *  copy the census does not read. Taste is for code this repository authors, so `.oxlintrc.json`
 *  turns the promoted catchers off over `anti-slop` and `pi-claude-bridge` — the same two trees
 *  `simplify-census.ts` leaves unread, for the same reason: a taste edit to a file we re-copy
 *  from upstream pays a merge cost at the next copy and buys nothing.
 *
 *  All thirty are in `.oxlintrc.json` as of 2026-09-20, so every one runs in `bun run lint`
 *  and fails it under `--strict` or `ANA_LINT_STRICT=1`, and `tools/oxlint/simplify.json` holds no rules at all. The two groups below
 *  are the order they were promoted in and nothing more. Each was promoted by passing the
 *  admission test — at every site it reports, does a spelling exist that satisfies every other
 *  rule — and a catcher that could not pass it was retuned until it could, or taken out; none
 *  was baselined per file. What `bun run simplify` still reads is the whole-tree scans, which
 *  relate two files and which no per-file rule can express. */
const anaPlugin = eslintCompatPlugin({
  meta: { name: "ana" },
  rules: {
    "unproven-unknown-parameter": unprovenUnknownParameterRule,
    "no-unknown-union": noUnknownUnionRule,
    "require-captured-json-runtime": requireCapturedJsonRuntimeRule,
    "no-hand-spelled-tree-root": noHandSpelledTreeRootRule,
    "require-meta-runtime-import": requireMetaRuntimeImportRule,
    "no-single-caller-helper": noSingleCallerHelperRule,
    "no-positional-boolean-parameter": noPositionalBooleanParameterRule,
    "prefer-includes-over-some-equals": preferIncludesOverSomeEqualsRule,
    "prefer-key-if-defined": preferKeyIfDefinedRule,
    "no-hand-rolled-error-render": noHandRolledErrorRenderRule,
    "require-type-for-null-default": requireTypeForNullDefaultRule,
    "no-property-read-on-function": noPropertyReadOnFunctionRule,
    "prefer-some-over-filter-length": preferSomeOverFilterLengthRule,
    "no-alias-restating-return": noAliasRestatingReturnRule,
    "no-inline-block-reducer": noInlineBlockReducerRule,
    "no-inline-schema-literal": noInlineSchemaLiteralRule,
    "prefer-find-over-loop": preferFindOverLoopRule,
    "no-side-effect-in-predicate": noSideEffectInPredicateRule,
    "prefer-flatmap-over-map-filter": preferFlatmapOverMapFilterRule,
    "prefer-entries-over-keys-lookup": preferEntriesOverKeysLookupRule,
    "prefer-condition-over-boolean-returns": preferConditionOverBooleanReturnsRule,
    "prefer-const-conditional": preferConstConditionalRule,
    "no-inline-slop-answer": noInlineSlopAnswerRule,

    "no-argument-already-carried": noArgumentAlreadyCarriedRule,
    "no-arms-differing-in-one-term": noArmsDifferingInOneTermRule,
    "no-deep-nesting": noDeepNestingRule,
    "no-hand-rolled-sleep": noHandRolledSleepRule,
    "no-lifetime-outside-owner": noLifetimeOutsideOwnerRule,
    "no-pass-through-wrapper": noPassThroughWrapperRule,
    "no-renaming-temporary": noRenamingTemporaryRule,
    "no-single-use-const-chain": noSingleUseConstChainRule,
    "no-repeated-string-literal": noRepeatedStringLiteralRule,
    "no-thrice-spelled-object": noThriceSpelledObjectRule,
    "no-tangled-ternary": noTangledTernaryRule,
    "no-transposed-argument": noTransposedArgumentRule,
    "prefer-lookup-over-equality-chain": preferLookupOverEqualityChainRule,
    "declarations-before-the-first-function": declarationsBeforeTheFirstFunctionRule,
  },
});

export default anaPlugin;
