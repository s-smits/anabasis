/**
 * What `src/meta/json-shape.ts` promises where the other side is owned outside this repository:
 * that `JsonValue` agrees with the same-named type `@earendil-works/pi-ai` exports. Pi ships the
 * types and no guard, and a tool call's arguments reach the bridge as the Anthropic SDK's
 * `unknown`, so `asRecord` alone narrows them. Both directions get a case, since a mutable array
 * satisfies a readonly one and the break is always on the reading side. The assignments are the
 * test: the gate's typecheck covers `test/`, so a divergence fails here.
 */

import { describe, expect, it } from "bun:test";
import type { JsonObject as PiJsonObject, JsonValue as PiJsonValue } from "@earendil-works/pi-ai";
import { type JsonValue, asRecord, typeName } from "../src/meta/json-shape.ts";

/** The Anthropic SDK declares `input` as `unknown`, which is why a guard stands at this seam. */
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
    expect(typeName(ours)).toBe("object");
  });
});
