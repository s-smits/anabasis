// The whole-run investigation catalogue keeps its thirty-three lanes numbered in order.
import { describe, expect, it } from "bun:test";
import { catalogueText, type Lane, lanesOf } from "../tools/wri/catalogue.ts";

const catalogue = catalogueText();
const lanes = lanesOf(catalogue);
const numbers = (some: readonly Lane[]) => some.map((each) => each.number);

describe("the lane catalogue", () => {
  it("holds thirty-three lanes, numbered in order", () => {
    expect(numbers(lanes)).toEqual(Array.from({ length: 33 }, (_, index) => index + 1));
  });
});
