# TypeScript types and structure

Use these rules when the bounded edit changes how TypeScript represents or
admits a fact. They refine the edit discipline; they do not choose product
policy.

## Make useful invalid states impossible

| Problem | Shape |
|---|---|
| claim without evidence | private constructor and private brand |
| two writers for one record | private constructor, registry, and `O_EXCL` lock |
| unhandled backend kind | closed union and exhaustive default |
| crash counted as failure | `boolean \| null` |
| disabled choice confused with absence | distinct source or disabled marker |

A TypeScript class without a private member is structural and may be satisfied
by an object literal. Use a private brand only when construction history
matters. Do not force every runtime refusal into another type layer.

## Narrow boundaries once

JSON, YAML, environment values, and model replies enter as `unknown`, then pass
through one named predicate, parser, or requirement function. Use `any` only
when an external API has no typed alternative and narrow it immediately.

With `exactOptionalPropertyTypes`, omit an absent optional field. Do not write
`field: undefined` when absence has a different evidence meaning.

## Declare and derive facts once

Write the value list first and derive its type:

```ts
export const BACKEND_KINDS = ["codex", "openrouter", "claude"] as const;
export type BackendKind = (typeof BACKEND_KINDS)[number];
```

- Key records and exhaustive loops from the derived type or declared list.
- Derive defaults from the policy owner instead of repeating literals.
- Merge equal values only when changing one should always change the other.
- Derive a current fact at the reader instead of adding another flag.

When several call sites repeat one fallback order, put that order in one model
accessor. Callers ask for the result instead of rebuilding precedence.

## Use classes only for construction rules

Default to an interface plus functions. Use a class with a private constructor
and factory only when construction proves an invariant, such as evidence-backed
claim creation, one writer per case record, or resolution from declared
operator inputs. Grouping related fields is not enough.

## Represent absence and errors honestly

- Use `boolean | null` when truth may be unknown.
- Use an explicit disabled marker for off. A missing key may restore a default.
- Reject untrusted input during resolution, before the first paid use.
- Every refusal names the source, value found, and legal values or next action.

Keep the reason for a closed union, private constructor, or layer beside the
code. A well-typed wrong decision is still wrong; evidence and frozen policy
take precedence over these preferences.

## Review

- Can an object literal create a value that should require a factory?
- Does external input reach a decision without one named check?
- Is a union, record, default, or fallback order declared twice?
- Does a loop inspect only present keys when every declared key matters?
- Does a class protect a real invariant?
- Would one refusal clause be clearer than a new type?
- Does every error name source, found value, and the next legal step?
- Does a new field duplicate an existing `null`, marker, or derived fact?
