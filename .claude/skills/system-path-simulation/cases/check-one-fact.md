# Check one fact

**Use this case when:** the question is one fact — which branch, which value, which identity, which version a wrapper will actually run — and a named export or read-only CLI can answer it without a model.

State the exact command, expected opening move, uncertain fact, and why it matters, then use the
smallest real check that can answer it: an existing read-only CLI or preflight; one exported
parser, resolver or decision function from the exact run tree; or a small throwaway script when
neither exists. Read exports and side effects first — if a resolver writes, copy the state into
scratch. Put a throwaway script inside the run tree so it uses the same package rules, then delete
it. Never read `.env` directly or write outside scratch, and do not rerun unrelated gates.

"No provider" is three tiers, not one. Credential and catalogue resolution, zero-turn isolated
worker and wall setup, and a paid turn are separate costs: `preflightCampaignModels` resolves the
host slots with no provider call, starts the Built worker and validates its wall without spending a
paid turn. Say which
tier you used; treating them as one blocks free checks.

**Check the wrapper that will actually run `fullrun`, not a policy, a test or your own shell.** Run
31 is the cost: a compact runtime check concluded no simulation was needed, the controller child
ran Node 24.15 under a frozen 24.13 condition, and the run was held out of comparison, claim and
promotion. Read the version from the exact command wrapper or the startup receipt.

## Finish

Return `blocking`, `cleared` or `accepted-risk` with the command and the fact it printed. A cleared fact about a wrapper is evidence for that wrapper only; re-check when the launcher changes.
