import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines, reportedMessages } from "./helpers/oxlint-rule-fixture.ts";

/**
 * Three anti-slop rules decide whether a type still carries evidence:
 * `no-unsafe-dictionary-type` (is the value contract real?), `no-widen-then-assert`
 * (was evidence discarded and recreated?) and `no-known-value-widening` (did a known
 * value flow into a broad target?). All three ask the same engine,
 * `anti-slop/shared/dictionary-types.ts`, to resolve a written type into what it
 * actually denotes: unwrap the transparent wrappers, substitute an alias's type
 * arguments, follow the alias, stop on a cycle.
 *
 * So each rule is tested twice here: once at its own boundary, where the three
 * disagree on purpose, and once over the resolution paths — a two-level hop, a
 * parameter default, a wrong-arity application, an unapplied self-reference, an alias
 * in key position — where they must agree about the type in front of them.
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
export const objectToAnonymous: { currency: string } = { currency: "eur", minor: 1 }; // REPORT an anonymous shape instead of the owner type
export const objectToOpenDictionary: Record<string, unknown> = { currency: "eur" }; // REPORT a known object annotated as an open dictionary
export const arrayToUnknown: unknown = ["eur"]; // REPORT an array literal annotated unknown
export const arrowToUnknown: unknown = () => "eur"; // REPORT a function expression annotated unknown
export const constructedToUnknown: unknown = new Map(); // REPORT a constructed value annotated unknown
export const templateToUnknown: unknown = \`eur\`; // REPORT a template literal annotated unknown
export const negatedToUnknown: unknown = -1; // REPORT a unary expression is still known
export const viaHop: unknown = literalSource; // REPORT the evidence survives a const hop
const literalSource = "eur";
export const viaMapped: { [K in "a"]: string } = { a: "eur" }; // REPORT a mapped target erases the shape

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

// --- the shared resolution engine ----------------------------------------------

/**
 * The paths every rule shares, written once per rule so the answer has to be the
 * same on both sides of the engine. `no-unsafe-dictionary-type` asks about the value
 * type it ends on; `no-known-value-widening` asks whether the resolved type is an
 * open container. A path the engine fails to follow shows up as an admitted line in
 * both fixtures at once.
 */
const RESOLUTION_DICTIONARY = `
export type Self<T> = Self<T>;
export type SelfApplied = Self<unknown>; // ADMITTED an alias that only names itself resolves to nothing
export type Cycle = CycleBack;
export type CycleBack = Cycle;
export type CycleValue = Record<string, Cycle>; // ADMITTED a cycle between two aliases terminates without a verdict
export type Pair<A, B> = Record<string, [A, B]>;
export type PairApplied = Pair<string, unknown>; // ADMITTED a tuple of a known arity is a contract
export type WrongArity = Pair<string>; // ADMITTED an application the compiler already rejects
export type Defaulted<T = unknown> = Record<string, T>;
export type DefaultUsed = Defaulted; // REPORT the parameter default substitutes to unknown
export type DefaultReplaced = Defaulted<string>; // ADMITTED the argument overrides the default
export type Hop1<T> = Hop2<T>;
export type Hop2<T> = Record<string, T>;
export type TwoLevel = Hop1<unknown>; // REPORT the substitution travels through both aliases
export type TwoLevelNamed = Hop1<Money>; // ADMITTED the same two levels carry a real contract
export type Money = { currency: string; minor: number };
export type KeyAlias = string;
export type ViaKeyAlias = Record<KeyAlias, unknown>; // REPORT an alias in key position is still the value's problem
export type NarrowKeyAlias = "a" | "b";
export type ViaNarrowKeyAlias = Record<NarrowKeyAlias, unknown>; // REPORT a closed key set does not make unknown a contract
export type NeverValue = Record<string, never>; // ADMITTED never is the narrowest value, not an escape hatch
export type MappedNever = { [K in string]: never }; // ADMITTED the same in mapped spelling
export type GenericKey<K extends string> = Record<K, unknown>; // REPORT the value is unknown whatever key the parameter takes
export type GenericKeyApplied = GenericKey<"a">; // REPORT the key argument does not repair the value
`.trimStart();

const RESOLUTION_WIDENING = `
export type Money = { currency: string; minor: number };
export type Cycle = CycleBack;
export type CycleBack = Cycle;
export const toCycle: Cycle = { currency: "eur", minor: 1 }; // ADMITTED a cycle between two aliases terminates without a verdict
export type Pair<A, B> = Record<string, [A, B]>;
export type WrongArity = Pair<string>;
export const toWrongArity: WrongArity = { a: ["eur", 1] }; // ADMITTED an application the compiler already rejects
export type Defaulted<T = unknown> = Record<string, T>;
export const toDefaultUsed: Defaulted = { a: 1 }; // REPORT the parameter default still opens the container
export type Hop1<T> = Hop2<T>;
export type Hop2<T> = Record<string, T>;
export const toTwoLevel: Hop1<Money> = { a: { currency: "eur", minor: 1 } }; // REPORT the container travels through both aliases
export type KeyAlias = string;
export type ViaKeyAlias = Record<KeyAlias, Money>;
export const toViaKeyAlias: ViaKeyAlias = { a: { currency: "eur", minor: 1 } }; // REPORT an alias in key position leaves the key open
export type NarrowKeyAlias = "a" | "b";
export type ViaNarrowKeyAlias = Record<NarrowKeyAlias, Money>;
export const toNarrowKeyAlias: ViaNarrowKeyAlias = { a: { currency: "eur", minor: 1 }, b: { currency: "usd", minor: 2 } }; // ADMITTED a closed key set pins the shape
export type MappedOverAlias = { [K in KeyAlias]: Money };
export const toMappedOverAlias: MappedOverAlias = { a: { currency: "eur", minor: 1 } }; // REPORT a mapped type over an open key is the same container
export type MappedOverNarrow = { [K in "a"]: Money };
export const toMappedOverNarrow: MappedOverNarrow = { a: { currency: "eur", minor: 1 } }; // ADMITTED naming the closed mapped shape gives it an owner
export type ObjectAlias = object;
export const toObjectAlias: ObjectAlias = { currency: "eur" }; // REPORT an alias for the object keyword
export type AnyAlias = any;
export const toAnyAlias: AnyAlias = { currency: "eur" }; // REPORT an alias for any
`.trimStart();

/**
 * A built-in name is only built in where nothing else binds it. Every rule reaches
 * `Record`, `Readonly` and `PropertyKey` through the same lexical check, so a file
 * that declares its own must be read as that declaration says.
 */
const SHADOWED = `
type Record<K extends string, V> = { key: K; value: V };
export type NotADictionary = Record<string, unknown>; // ADMITTED the local Record has no index signature
export type StillUnsafe = { [k: string]: unknown }; // REPORT the written index signature owes nothing to a name
`.trimStart();

const SHADOWED_WRAPPER = `
type Readonly<T> = { frozen: T };
type Signature = { [k: string]: unknown };
export const toShadowedReadonly: Readonly<Signature> = { frozen: {} }; // ADMITTED the local Readonly wraps rather than passing through
export const toOpenDictionary: Signature = { a: 1 }; // REPORT the alias behind it is still an open dictionary
`.trimStart();

const SHADOWED_KEY = `
type PropertyKey = "id";
export type Money = { currency: string };
export const toShadowedKey: Record<PropertyKey, Money> = { id: { currency: "eur" } }; // ADMITTED the local PropertyKey is one literal, so the key set is closed
export const toRealKey: Record<string, Money> = { id: { currency: "eur" } }; // REPORT a string key is open whatever else is in scope
`.trimStart();

/**
 * A mapped type's key decides what it denotes: `{ [K in "id"]: unknown }` is the shape
 * `{ id: unknown }`, and `{ [K in string]: unknown }` is a dictionary. Three places in
 * the engine answer that question and only one of them reads the key, so the two rules
 * below disagree with themselves depending on how the same type was spelled.
 */
const MAPPED_KEYS = `
export type Money = { currency: string };
export type OpenMapped = { [K in string]: unknown }; // REPORT a mapped type over a broad key is a dictionary
export type ClosedMapped = { [K in "id"]: unknown }; // ADMITTED one named property is a shape, as { id: unknown } is
export type ClosedLiteral = { id: unknown }; // ADMITTED the same shape written directly
export type ClosedUnionMapped = { [K in "id" | "at"]: unknown }; // ADMITTED a closed key union is still a shape
export type KeyOfMapped = { [K in keyof Money]: unknown }; // ADMITTED keyof a named type is a closed key set
`.trimStart();

describe("anti-slop/no-unsafe-dictionary-type", () => {
  it("reports dictionaries whose value type is an escape hatch and admits real contracts", () => {
    const expected = expectedLines(DICTIONARY);
    expect(expected).toHaveLength(23);
    expect(reportedLines("anti-slop", "no-unsafe-dictionary-type", DICTIONARY)).toStrictEqual(expected);
  });

  it("names the escape hatch it found, so the message says what to replace", () => {
    const messages = reportedMessages(
      "anti-slop",
      "no-unsafe-dictionary-type",
      [
        "export type A = Record<string, unknown>;",
        "export type B = Record<string, any>;",
        "export type C = Record<string, object>;",
        "export type D = Record<string, {}>;",
        "export type E = Record<string, string | unknown>;",
      ].join("\n"),
    );
    expect(messages).toHaveLength(5);
    expect(messages.join("\n")).toContain("unknown");
    expect(messages.join("\n")).toContain("any");
  });
});

describe("anti-slop/no-widen-then-assert", () => {
  it("reports evidence discarded and asserted back, and admits what never had it", () => {
    const expected = expectedLines(WIDEN_THEN_ASSERT);
    expect(expected).toHaveLength(13);
    expect(reportedLines("anti-slop", "no-widen-then-assert", WIDEN_THEN_ASSERT)).toStrictEqual(expected);
  });
});

describe("anti-slop/no-known-value-widening", () => {
  it("reports known values flowing into broad targets and admits genuine unknowns", () => {
    const expected = expectedLines(KNOWN_VALUE_WIDENING);
    expect(expected).toHaveLength(17);
    expect(reportedLines("anti-slop", "no-known-value-widening", KNOWN_VALUE_WIDENING)).toStrictEqual(
      expected,
    );
  });
});

describe("the type resolution the three rules share", () => {
  it("follows substitutions, defaults and hops to the value type a dictionary ends on", () => {
    const expected = expectedLines(RESOLUTION_DICTIONARY);
    expect(expected).toHaveLength(6);
    expect(reportedLines("anti-slop", "no-unsafe-dictionary-type", RESOLUTION_DICTIONARY)).toStrictEqual(
      expected,
    );
  });

  it("follows the same paths to decide whether the resolved type is an open container", () => {
    const expected = expectedLines(RESOLUTION_WIDENING);
    expect(expected).toHaveLength(6);
    expect(reportedLines("anti-slop", "no-known-value-widening", RESOLUTION_WIDENING)).toStrictEqual(
      expected,
    );
  });

  it("stops at a cycle rather than resolving forever", () => {
    const cyclic = [
      "export type A = B;",
      "export type B = A;",
      "export type Direct = Direct;",
      "export type Generic<T> = Generic<T>;",
      "export type Used = Record<string, A>;",
      "export type AlsoUsed = Record<string, Generic<unknown>>;",
    ].join("\n");
    expect(reportedLines("anti-slop", "no-unsafe-dictionary-type", cyclic)).toStrictEqual([]);
  });

  it("reads a shadowed built-in as the declaration in scope, not as the built-in", () => {
    const expected = expectedLines(SHADOWED);
    expect(expected).toHaveLength(1);
    expect(reportedLines("anti-slop", "no-unsafe-dictionary-type", SHADOWED)).toStrictEqual(expected);
  });

  it("stops treating a wrapper name as transparent once something else binds it", () => {
    const expected = expectedLines(SHADOWED_WRAPPER);
    expect(expected).toHaveLength(1);
    expect(reportedLines("anti-slop", "no-known-value-widening", SHADOWED_WRAPPER)).toStrictEqual(expected);
  });

  it("reads a shadowed key name the same way, so the key set closes", () => {
    const expected = expectedLines(SHADOWED_KEY);
    expect(expected).toHaveLength(1);
    expect(reportedLines("anti-slop", "no-known-value-widening", SHADOWED_KEY)).toStrictEqual(expected);
  });

  it("reads a mapped type's key before calling it a dictionary", () => {
    const expected = expectedLines(MAPPED_KEYS);
    expect(expected).toHaveLength(1);
    expect(reportedLines("anti-slop", "no-unsafe-dictionary-type", MAPPED_KEYS)).toStrictEqual(expected);
  });

  it("calls a closed mapped target an anonymous object, not an open dictionary", () => {
    const messages = reportedMessages(
      "anti-slop",
      "no-known-value-widening",
      [
        'export const closed: { [K in "a"]: string } = { a: "eur" };',
        'export const open: { [K in string]: string } = { a: "eur" };',
      ].join("\n"),
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("anonymous object");
    expect(messages[1]).toContain("open dictionary");
  });

  it("keeps the transparent wrappers transparent in either order", () => {
    const wrapped = [
      "export type A = Readonly<Partial<Record<string, unknown>>>;",
      "export type B = Partial<Readonly<Record<string, unknown>>>;",
      "export type C = Required<NonNullable<Record<string, unknown>>>;",
      "export type D = Readonly<Readonly<Record<string, Money>>>;",
      "export type Money = { currency: string };",
    ].join("\n");
    expect(reportedLines("anti-slop", "no-unsafe-dictionary-type", wrapped)).toStrictEqual([1, 2, 3]);
  });

  it("treats an unapplied type parameter as the open contract it is", () => {
    const parameters = [
      "export type Open<T> = Record<string, T>;",
      "export type Closed = Open<{ id: string }>;",
      "export type Opened = Open<unknown>;",
    ].join("\n");
    expect(reportedLines("anti-slop", "no-unsafe-dictionary-type", parameters)).toStrictEqual([3]);
  });
});
