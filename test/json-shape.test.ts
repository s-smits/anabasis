/**
 * What `src/meta/json-shape.ts` promises about the shape it names, where the other side of the
 * promise is owned outside this repository.
 *
 * The predicates there are shape tests with no interesting runtime of their own. What needs a
 * case is the relationship between `JsonValue` and the identically named type that
 * `@earendil-works/pi-ai` exports, because pi ships those two types and no guard: a tool call's
 * arguments reach the bridge as the Anthropic SDK's `unknown`, and `asRecord` is the only thing
 * that can narrow them before pi takes them back. Neither file says the two shapes agree.
 *
 * When pi 0.86 made its arrays readonly they stopped agreeing, and it surfaced as two calls in
 * `provider.ts` reporting that `JsonObject` was not assignable to `JsonObject` — the same name
 * on both sides of the sentence, which is not a diagnosis. The repair was to say `readonly`
 * here too. Both directions get a case because only one of them is ever at risk at a time: a
 * mutable array satisfies a readonly one, so the break is always on the side that reads.
 *
 * The assignments are the test. `expect` keeps each value live and checks it arrived intact; the
 * gate's typecheck step covers `test/`, so a divergence fails there, under a file named for it.
 */

import { describe, expect, it } from "bun:test";
import type { JsonObject as PiJsonObject, JsonValue as PiJsonValue } from "@earendil-works/pi-ai";
import { type JsonValue, asRecord, jsonKind } from "../src/meta/json-shape.ts";

/** What the bridge reads a tool call's arguments off. The Anthropic SDK declares `input` as
 *  `unknown`, which is why a guard has to stand at this seam at all. */
interface SdkToolUseBlock {
  input: unknown;
}

describe("the JSON shape this repository names and the one pi names", () => {
  it("lets a value narrowed here cross into pi's own type", () => {
    const block: SdkToolUseBlock = { input: { path: "a/b", lines: [1, 2] } };
    const narrowed: PiJsonObject = asRecord(block.input) ?? {};
    expect(narrowed).toEqual({ path: "a/b", lines: [1, 2] });
  });

  it("lets a value pi produced be read as one of ours", () => {
    const fromPi: PiJsonValue = { list: [1, "two", null], flag: false };
    const ours: JsonValue = fromPi;
    expect(jsonKind(ours)).toBe("object");
  });
});
