# Runtime boundaries

Use the repository's `.oxlintrc.json` in both the editor and `bun run lint`; the gate calls that
same script. `lint:anti-slop` is a compatibility alias. Biome owns formatting only. Type-aware
lint requires the pinned `oxlint-tsgolint` dependency; a missing binary is a failed check.

## Async work has an error owner

`no-floating-promises` (with `ignoreVoid: false`) and `no-misused-promises` require an awaited,
returned or handled promise. `void work()` does not handle a rejection. A callback declared
`() => void` must not conceal async work from its caller.

Trace the actual contract before adding `await`: a protocol reader may need to keep receiving
responses while a tool request runs. Keep synchronous notifications synchronous and explicitly
handle the async request at its dispatcher. Do not serialise the entire reader to satisfy lint.

Drain stdout and stderr concurrently with stdin writes. Set the deadline before awaiting input,
clear it in `finally`, and terminate/reap the owned child on failure. A timeout race alone does
not cancel its losing operation. Reuse the process-group and stream owners in `src/meta/`.

An existing function that catches errors and settles its consumer may have a local lint exception
naming that owner. Hostile tests may deliberately abandon work. Do not add empty catches, broad
file exemptions or branded promise types to silence findings. Test failed writes, rejected
callbacks and shutdown at the smallest real process layer that can decide them.

## Closed decisions stay exhaustive

`switch-exhaustiveness-check` requires explicit cases for a closed union, even with a default.
Group known alternatives that share a result. Adding a variant must force its decision owners
to review it. A raw JSON discriminator or an intentionally open SDK telemetry filter has a
different contract: its default refuses or ignores unknown values. Keep that reason beside a
local exception. The upstream anti-slop AST classifier permits a default for unrecognised syntax.

## Parsed bytes are not a validated interface

`capturedJsonParse` returns `JsonValue`. Validate the object and the fields consumed by the
boundary before returning a domain contract. `parseJsonAs<T>` asserts a writer contract; it
cannot verify external responses. OAuth imports of that helper, including renamed imports,
and direct `JSON.parse` calls are refused by the ordinary lint configuration.

The OAuth restriction is deliberately scoped to the two audited provider flows. It does not
prove every JSON reader safe, trace dynamic imports, or prove a predicate's implementation.
Expand it only after tracing another boundary's producer and consumer and adding a valid plus
malformed-input check. Keep controller-owned replay contracts distinct from external input.

## Scope of this lint pass

The three type-aware async/exhaustiveness rules supplement existing syntax rules. Other
type-aware defaults are explicitly unselected until separately audited; enabling the engine
must not silently introduce hundreds of unrelated style findings. The runtime lint regression
uses the real configuration and checks both rejected and admitted forms.
