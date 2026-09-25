import { eslintCompatPlugin } from "@oxlint/plugins";

import { unprovenUnknownParameterRule } from "./rules/unproven-unknown-parameter.ts";
import { noUnknownUnionRule } from "./rules/no-unknown-union.ts";
import { requireCapturedJsonRuntimeRule } from "./rules/require-captured-json-runtime.ts";
import { noHandSpelledTreeRootRule } from "./rules/no-hand-spelled-tree-root.ts";
import { noHandReadArgvRule } from "./rules/no-hand-read-argv.ts";
import { noHandSpelledGitRule } from "./rules/no-hand-spelled-git.ts";
import { noHandReadControllerEvidenceRule } from "./rules/no-hand-read-controller-evidence.ts";
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

/** The rules this repository owns. The anti-slop plugin beside it is copied from dmmulroy/anti-slop
 *  at a pinned commit, as its README asks, so a rule that has to answer an Anabasis question lives
 *  here instead.
 *
 *  The second group below are the simplify catchers. They exist because `/simplify` is a reading
 *  pass: it finds real removals, and it finds them once, in whichever files a reviewer happened
 *  to open. The shapes it kept finding again and again are decidable from the syntax alone, so a
 *  catcher now finds every site of one in a second.
 *
 *  A catcher moves up into the first group once every site it reports has been taken, because a
 *  rule that finds nothing cannot break a strict lint, costs nothing to enforce, and keeps the
 *  shape from arriving again. The evidence for that move is a clean `bun run lint -- --strict`
 *  rather than an emptied census group: a group can empty while a site still stands in a vendored
 *  copy `simplify-census.ts` does not read. Both groups have taken rules since the split was made,
 *  so read it as the order things arrived in and nothing more.
 *
 *  Every one of them is registered at `error` in `.oxlintrc.json`, so all of them run
 *  in `bun run lint` and fail it under `--strict` or `ANA_LINT_STRICT=1`, and
 *  `tools/oxlint/simplify.json` declares no rules of its own at all. Each was promoted by passing
 *  the admission test — at every site it reports, does a spelling exist that satisfies every
 *  other rule — and a catcher that could not pass it was retuned until it could, or taken out;
 *  none was baselined per file.
 *
 *  Taste is for code this repository authors, and the config draws that line one tree at a time:
 *  most of these are off over `vendor/pi-claude-bridge/**`, where a taste edit would pay
 *  a merge cost at the next copy from upstream and buy nothing. `tools/oxlint/anti-slop/**` is
 *  the other copied tree and `simplify-census.ts` leaves both unread, but the config exempts it
 *  from one rule only, `ana/no-inline-slop-answer`, so every catcher here does report on the
 *  vendored anti-slop source.
 *
 *  What `bun run simplify` still reads is the whole-tree scans, which relate two files and which
 *  no per-file rule can express. */
const anaPlugin = eslintCompatPlugin({
  meta: { name: "ana" },
  rules: {
    "unproven-unknown-parameter": unprovenUnknownParameterRule,
    "no-unknown-union": noUnknownUnionRule,
    "require-captured-json-runtime": requireCapturedJsonRuntimeRule,
    "no-hand-spelled-tree-root": noHandSpelledTreeRootRule,
    "no-hand-read-argv": noHandReadArgvRule,
    "no-hand-spelled-git": noHandSpelledGitRule,
    "no-hand-read-controller-evidence": noHandReadControllerEvidenceRule,
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
