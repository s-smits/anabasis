// The catalogue keeps its thirty-four lanes numbered in order.
import { describe, expect, it } from "bun:test";
import { catalogueText, lanesOf } from "../tools/wri/catalogue.ts";

describe("the lane catalogue", () => {
  it("holds thirty-four lanes, numbered in order", () => {
    expect(lanesOf(catalogueText()).map(({ number }) => number)).toEqual(
      Array.from({ length: 34 }, (_, index) => index + 1),
    );
  });
});
