import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

/**
 * Three anti-slop rules decide whether a type still carries evidence:
 * `no-unsafe-dictionary-type` (is the value contract real?), `no-widen-then-assert`
 * (was evidence discarded and recreated?) and `no-known-value-widening` (did a known
 * value flow into a broad target?). All three ask the same engine,
 * `anti-slop/shared/dictionary-types.ts`, to resolve a written type into what it
 * actually denotes: unwrap the transparent wrappers, substitute an alias's type
 * arguments, follow the alias, stop on a cycle.
 *
 * So each rule is tested at its own boundary, where the three disagree on purpose,
 * and the shared engine once more where it must stop: on a cycle.
 *
 * Each fixture labels a declaration `// REPORT <why>` or `// ADMITTED <why>` and the
 * expectation is read back out of the fixture, so a rule that stops reporting and a
 * rule that starts reporting everything both fail.
 */

// --- no-unsafe-dictionary-type -------------------------------------------------

const DICTIONARY = `
export type Unknowns = Record<string, unknown>; // REPORT unknown value type
export type Anys = Record<string, any>; // REPORT any value type
export type Objects = Record<string, object>; // REPORT object value type
export type Empties = Record<string, {}>; // REPORT the empty object contract
export type Mixed = Record<string, string | unknown>; // REPORT a union that absorbs
export type NumberKeyed = Record<number, unknown>; // REPORT a number key is still broad
export type SymbolKeyed = Record<symbol, unknown>; // REPORT a symbol key is still broad
export type PropertyKeyed = Record<PropertyKey, unknown>; // REPORT PropertyKey is still broad
export type Signature = { [key: string]: unknown }; // REPORT index signature, same contract
export type NumberSignature = { [key: number]: any }; // REPORT numeric index signature
export type Mapped = { [K in string]: unknown }; // REPORT mapped type over a broad key
export type ReadonlyWrapped = Readonly<Record<string, unknown>>; // REPORT Readonly is transparent
export type PartialWrapped = Partial<Record<string, unknown>>; // REPORT Partial is transparent
export type RequiredWrapped = Required<Record<string, unknown>>; // REPORT Required is transparent
export type NonNullableWrapped = NonNullable<Record<string, unknown>>; // REPORT NonNullable is transparent
export type ViaAlias = Record<string, Loose>; // REPORT the alias resolves to unknown
export type Loose = unknown;
export type Nested = Record<string, Record<string, unknown>>; // REPORT the inner dictionary is unsafe
export type Generic<T> = Record<string, T>;
export type GenericApplied = Generic<unknown>; // REPORT the argument substitutes to unknown
export type IntersectionAny = Record<string, { id: string } & any>; // REPORT any wins an intersection
export type EmptyInterfaceValue = Record<string, Nothing>; // REPORT an empty interface is the empty contract
export interface Nothing {}
export type OptionalNever = Record<string, { absent?: never }>; // REPORT optional-never is still empty
export type PickedUnknown = Pick<Unknowns, string>; // REPORT Pick carries the value type through

export type Named = Record<string, Money>; // ADMITTED a real value contract
export type Money = { currency: string; minor: number };
export type Literals = Record<"eur" | "usd", number>; // ADMITTED the key set is closed
export type Enumerated = Record<string, "open" | "closed">; // ADMITTED a closed value set
export type Arrays = Record<string, string[]>; // ADMITTED arrays of a known element
export type Nullable = Record<string, Money | null>; // ADMITTED absence is a real alternative
export type Unions = Record<string, string | number>; // ADMITTED both members are concrete
export type ArrayOfUnknown = Record<string, unknown[]>; // ADMITTED the array itself is the contract
export type PromiseOfUnknown = Record<string, Promise<unknown>>; // ADMITTED the promise is the contract
export type WrappedObject = Record<string, { payload: unknown }>; // ADMITTED the object shape is the contract
export type Intersected = Record<string, { id: string } & { at: number }>; // ADMITTED an intersection of shapes
export type NonEmptyInterfaceValue = Record<string, Something>; // ADMITTED a populated interface
export interface Something { id: string }
export type Constrained<T extends Record<string, unknown>> = keyof T; // ADMITTED a type-parameter constraint
export type PlainReuse = Unknowns; // REPORT re-aliasing creates a second unsafe dictionary
export function consumes(bag: Unknowns): number { return Object.keys(bag).length; } // ADMITTED a consumer use reports at the alias, not here
export type Fn = Record<string, () => void>; // ADMITTED a callable value contract
export type Tuple = Record<string, [string, number]>; // ADMITTED a fixed tuple
export type Recursive = Record<string, Recursive>; // ADMITTED recursion terminates without a verdict
`.trimStart();

// --- no-widen-then-assert ------------------------------------------------------

const WIDEN_THEN_ASSERT = `
type Money = { currency: string; minor: number };

export function literalThroughUnknown(): string {
	const raw: unknown = "eur";
	return raw as string; // REPORT a literal widened to unknown and asserted back
}

export function objectThroughUnknown(): Money {
	const raw: unknown = { currency: "eur", minor: 1 };
	return raw as Money; // REPORT an object literal widened to unknown
}

export function objectThroughAny(): Money {
	const raw: any = { currency: "eur", minor: 1 };
	return raw as Money; // REPORT any erases exactly as much as unknown
}

export function throughObjectKeyword(): Money {
	const raw: object = { currency: "eur", minor: 1 };
	return raw as Money; // REPORT object widened to a definite object type
}

export function throughBroadRecord(): Money {
	const raw: Record<string, unknown> = { currency: "eur", minor: 1 };
	return raw as Money; // REPORT a broad record narrowed back to a real shape
}

export function throughReadonlyRecord(): Money {
	const raw: Readonly<Record<string, unknown>> = { currency: "eur", minor: 1 };
	return raw as Money; // REPORT Readonly does not change the erasure
}

export function throughIndexSignature(): Money {
	const raw: { [key: string]: unknown } = { currency: "eur", minor: 1 };
	return raw as Money; // REPORT the index-signature spelling of the same erasure
}

export function assertedInitializer(): Money {
	const raw = { currency: "eur", minor: 1 } as unknown;
	return raw as Money; // REPORT widened by the initializer assertion instead
}

export function throughOneHop(): string {
	const first = "eur";
	const raw: unknown = first;
	return raw as string; // REPORT the evidence survives one const hop
}

export function arrayThroughUnknown(): string[] {
	const raw: unknown = ["eur"];
	return raw as string[]; // REPORT an array literal is known
}

export function callThroughUnknown(): Money {
	const raw: unknown = new Map<string, number>();
	return raw as Money; // REPORT a constructed value is known
}

export function parenthesized(): string {
	const raw: (unknown) = ("eur");
	return (raw) as string; // REPORT parentheses carry no erasure
}

export function narrowValueRecord(): Money {
	const raw: Record<string, string | number> = { currency: "eur", minor: 1 };
	return raw as Money; // REPORT an open dictionary erases the shape whatever its values are
}

export function parseOnce(input: string): Money {
	return JSON.parse(input) as Money; // ADMITTED one parse at the boundary
}

export function fromParameter(raw: unknown): Money {
	return raw as Money; // ADMITTED the caller owns the widening, not this function
}

export function noEvidence(): Money {
	const raw: unknown = JSON.parse("{}");
	return raw as Money; // ADMITTED the initializer proves nothing either
}

export function notNarrower(): unknown {
	const raw: unknown = "eur";
	return raw as any; // ADMITTED asserting one top type to another narrows nothing
}

export function assertedBeforeDeclaration(previous: unknown): string {
	const earlier = previous as string; // ADMITTED the assertion precedes the widening
	const raw: unknown = "eur";
	return earlier + String(raw);
}

export function reassigned(flag: boolean): string {
	let raw: unknown = "eur";
	if (flag) raw = 1;
	return raw as string; // ADMITTED a mutable binding has no single known value
}

export function acrossBoundaries(): () => string {
	const raw: unknown = "eur";
	return () => raw as string; // ADMITTED the assertion sits in a different function
}

export function recordToBroaderRecord(): Record<string, unknown> {
	const raw: Record<string, unknown> = { currency: "eur" };
	return raw as Record<string, unknown>; // ADMITTED asserting a broad type to itself
}

export function objectToNonObject(): string {
	const raw: object = { currency: "eur" };
	return raw as string; // ADMITTED a string is not a narrowing of object
}
`.trimStart();

// --- no-known-value-widening ---------------------------------------------------

const KNOWN_VALUE_WIDENING = `
type Money = { currency: string; minor: number };
function isMoney(value: unknown): value is Money { return value !== null; }

export const literalToUnknown: unknown = "eur"; // REPORT a literal annotated unknown
export const objectToUnknown: unknown = { currency: "eur" }; // REPORT an object literal annotated unknown
export const objectToObjectKeyword: object = { currency: "eur" }; // REPORT the object keyword erases the shape
export const objectToAnonymous: { payload: unknown } = { payload: "eur" }; // REPORT an anonymous shape whose member throws the value's type away
export const anonymousStatesTheMembers: { currency: string } = { currency: "eur" }; // ADMITTED each member states the value's own type
export const objectToOpenDictionary: Record<string, unknown> = { currency: "eur" }; // REPORT a known object annotated as an open dictionary
export const arrayToUnknown: unknown = ["eur"]; // REPORT an array literal annotated unknown
export const arrowToUnknown: unknown = () => "eur"; // REPORT a function expression annotated unknown
export const constructedToUnknown: unknown = new Map(); // REPORT a constructed value annotated unknown
export const templateToUnknown: unknown = \`eur\`; // REPORT a template literal annotated unknown
export const negatedToUnknown: unknown = -1; // REPORT a unary expression is still known
export const viaHop: unknown = literalSource; // REPORT the evidence survives a const hop
const literalSource = "eur";
export const viaMapped: { [K in "a"]: unknown } = { a: "eur" }; // REPORT a mapped target whose value is unknown
export const viaClosedMapped: { [K in "a"]: string } = { a: "eur" }; // ADMITTED a closed mapped target stating the value's type

export function returnsUnknown(): unknown {
	return "eur"; // REPORT a known return value annotated unknown
}

export const arrowReturnsUnknown = (): unknown => "eur"; // REPORT the concise-body form

export class Holder {
	field: unknown = "eur"; // REPORT a property annotated unknown
}

export function passesKnownToPredicate(): boolean {
	return isMoney({ currency: "eur", minor: 1 }); // REPORT a known value handed to an unknown predicate
}

export const inferred = "eur"; // ADMITTED inference keeps the evidence
export const annotatedConcrete: string = "eur"; // ADMITTED a concrete annotation
export const namedOwner: Money = { currency: "eur", minor: 1 }; // ADMITTED the owner contract
export const validated = { currency: "eur", minor: 1 } satisfies Money; // ADMITTED satisfies keeps inference
export const fromCall: unknown = JSON.parse("{}"); // ADMITTED the call result is genuinely unknown
export const emptyAccumulator: Record<string, Money> = {}; // ADMITTED an empty dictionary accumulator
export const emptyOpenAccumulator: Record<string, unknown> = {}; // ADMITTED the accumulator exemption covers open ones
export const nullableConcrete: string | null = null; // ADMITTED absence is a real alternative

export function declaresItsReturn(log: string, from: number): { readonly log: string; readonly from: number } {
	return { log, from }; // ADMITTED a declared return that states each member the literal holds
}

export function returnsConcrete(): string {
	return "eur"; // ADMITTED the return contract is concrete
}

export function forwardsUnknown(raw: unknown): unknown {
	return raw; // ADMITTED nothing known entered
}

export function passesUnknownToPredicate(raw: unknown): boolean {
	return isMoney(raw); // ADMITTED the argument was already unknown
}

export function spreadOpensTheKeys(extra: Record<string, string>): Record<string, string> {
	return { currency: "eur", ...extra }; // ADMITTED a spread of a call or parameter opens the key set
}

export function computedKeyOpensTheKeys(key: string): Record<string, string> {
	return { [key]: "eur" }; // ADMITTED a computed key is not a known key
}

export function spreadOfLiteralStaysKnown(): Record<string, string> {
	return { currency: "eur", ...{ minor: "1" } }; // REPORT spreading another known literal keeps the shape
}
`.trimStart();

describe("anti-slop/no-unsafe-dictionary-type", () => {
  it("reports dictionaries whose value type is an escape hatch and admits real contracts", async () => {
    const expected = expectedLines(DICTIONARY);
    expect(expected).toHaveLength(23);
    expect(await reportedLines("anti-slop", "no-unsafe-dictionary-type", DICTIONARY)).toStrictEqual(expected);
  });
});

describe("anti-slop/no-widen-then-assert", () => {
  it("reports evidence discarded and asserted back, and admits what never had it", async () => {
    const expected = expectedLines(WIDEN_THEN_ASSERT);
    expect(expected).toHaveLength(13);
    expect(await reportedLines("anti-slop", "no-widen-then-assert", WIDEN_THEN_ASSERT)).toStrictEqual(
      expected,
    );
  });
});

describe("anti-slop/no-known-value-widening", () => {
  it("reports known values flowing into broad targets and admits genuine unknowns", async () => {
    const expected = expectedLines(KNOWN_VALUE_WIDENING);
    expect(expected).toHaveLength(17);
    expect(await reportedLines("anti-slop", "no-known-value-widening", KNOWN_VALUE_WIDENING)).toStrictEqual(
      expected,
    );
  });
});

describe("the type resolution the three rules share", () => {
  it("stops at a cycle rather than resolving forever", async () => {
    const cyclic = [
      "export type A = B;",
      "export type B = A;",
      "export type Direct = Direct;",
      "export type Generic<T> = Generic<T>;",
      "export type Used = Record<string, A>;",
      "export type AlsoUsed = Record<string, Generic<unknown>>;",
    ].join("\n");
    expect(await reportedLines("anti-slop", "no-unsafe-dictionary-type", cyclic)).toStrictEqual([]);
  });
});
