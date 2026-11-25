import { eslintCompatPlugin } from "@oxlint/plugins";

import { noUnprovenUnknownParameterRule } from "./rules/no-unproven-unknown-parameter.ts";
import { requireCapturedJsonRuntimeRule } from "./rules/require-captured-json-runtime.ts";
import { noHandReadArgvRule } from "./rules/no-hand-read-argv.ts";
import { noHandSpelledGitRule } from "./rules/no-hand-spelled-git.ts";
import { requireMetaRuntimeImportRule } from "./rules/require-meta-runtime-import.ts";
import { noSingleUseConstChainRule } from "./rules/no-single-use-const-chain.ts";
import { noPositionalBooleanParameterRule } from "./rules/no-positional-boolean-parameter.ts";
import { preferKeyIfDefinedRule } from "./rules/prefer-key-if-defined.ts";
import { noHandRolledErrorRenderRule } from "./rules/no-hand-rolled-error-render.ts";
import { noInlineSlopAnswerRule } from "./rules/no-inline-slop-answer.ts";

import { noAliasRestatingReturnRule } from "./rules/no-alias-restating-return.ts";
import { noArmsDifferingInOneTermRule } from "./rules/no-arms-differing-in-one-term.ts";
import { noCommentsRule } from "./rules/no-comments.ts";
import { noDeepNestingRule } from "./rules/no-deep-nesting.ts";
import { noHandRolledSleepRule } from "./rules/no-hand-rolled-sleep.ts";
import { noInlineBlockReducerRule } from "./rules/no-inline-block-reducer.ts";
import { noInlineSchemaLiteralRule } from "./rules/no-inline-schema-literal.ts";
import { noReactEffectRule } from "./rules/no-react-effect.ts";
import { noLifetimeOutsideOwnerRule } from "./rules/no-lifetime-outside-owner.ts";
import { noPassThroughWrapperRule } from "./rules/no-pass-through-wrapper.ts";
import { noRenamingTemporaryRule } from "./rules/no-renaming-temporary.ts";
import { noRepeatedStringLiteralRule } from "./rules/no-repeated-string-literal.ts";
import { noSideEffectInPredicateRule } from "./rules/no-side-effect-in-predicate.ts";
import { noTangledTernaryRule } from "./rules/no-tangled-ternary.ts";
import { noThriceSpelledObjectRule } from "./rules/no-thrice-spelled-object.ts";
import { noTransposedArgumentRule } from "./rules/no-transposed-argument.ts";
import { preferConstConditionalRule } from "./rules/prefer-const-conditional.ts";
import { preferFindOverLoopRule } from "./rules/prefer-find-over-loop.ts";

/**
 * Repository-owned custom lint rules (`ana/*`), registered at `error` in `.oxlintrc.json` and
 * enforced under `bun run lint -- --strict` or `ANA_LINT_STRICT=1`; `vendor` is ignored there.
 * Cross-file structural scans run in `bun run simplify` (`tools/oxlint/simplify-census.ts`).
 */
const anaPlugin = eslintCompatPlugin({
  meta: { name: "ana" },
  rules: {
    "no-unproven-unknown-parameter": noUnprovenUnknownParameterRule,
    "require-captured-json-runtime": requireCapturedJsonRuntimeRule,
    "no-hand-read-argv": noHandReadArgvRule,
    "no-hand-spelled-git": noHandSpelledGitRule,
    "require-meta-runtime-import": requireMetaRuntimeImportRule,
    "no-positional-boolean-parameter": noPositionalBooleanParameterRule,
    "prefer-key-if-defined": preferKeyIfDefinedRule,
    "no-hand-rolled-error-render": noHandRolledErrorRenderRule,
    "no-alias-restating-return": noAliasRestatingReturnRule,
    "no-inline-block-reducer": noInlineBlockReducerRule,
    "no-inline-schema-literal": noInlineSchemaLiteralRule,
    "prefer-find-over-loop": preferFindOverLoopRule,
    "no-side-effect-in-predicate": noSideEffectInPredicateRule,
    "prefer-const-conditional": preferConstConditionalRule,
    "no-inline-slop-answer": noInlineSlopAnswerRule,

    "no-arms-differing-in-one-term": noArmsDifferingInOneTermRule,
    "no-comments": noCommentsRule,
    "no-deep-nesting": noDeepNestingRule,
    "no-hand-rolled-sleep": noHandRolledSleepRule,
    "no-react-effect": noReactEffectRule,
    "no-lifetime-outside-owner": noLifetimeOutsideOwnerRule,
    "no-pass-through-wrapper": noPassThroughWrapperRule,
    "no-renaming-temporary": noRenamingTemporaryRule,
    "no-single-use-const-chain": noSingleUseConstChainRule,
    "no-repeated-string-literal": noRepeatedStringLiteralRule,
    "no-thrice-spelled-object": noThriceSpelledObjectRule,
    "no-transposed-argument": noTransposedArgumentRule,
    "no-tangled-ternary": noTangledTernaryRule,
  },
});

// oxlint-disable-next-line import/no-default-export -- Oxlint loads a JS plugin from its module's default export (`jsPlugins` in .oxlintrc.json)
export default anaPlugin;
