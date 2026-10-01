// Written for Anabasis in place of pi agent v0.99.2's packages/agent/src/harness/context.ts
// (github.com/earendil-works/pi, 005af57, MIT, see LICENSE), which re-exports chord's context and
// pi-telemetry's. The copied compaction reads one member of a context, its abort signal, so this is
// that member and the two constructors the session uses, under the same names.

export interface Context {
	readonly abortSignal: AbortSignal | undefined;
}

export const BACKGROUND_CONTEXT: Context = { abortSignal: undefined };

export function withAbortSignal(signal: AbortSignal, _parent: Context): Context {
	return { abortSignal: signal };
}
