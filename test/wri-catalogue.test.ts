// The whole-run investigation's catalogue is one Markdown file, and three things read it: a person,
// the lane prompts and the reader's triggers. These tests hold the file to the reader, so a trigger
// renamed in one place and not the other is refused here and not found in a campaign.
import { describe, expect, it } from "bun:test";
import { catalogueText, type Lane, lanesOf, ownersOf } from "../tools/wri/catalogue.ts";
import { TRIGGERS } from "../tools/wri/folds.ts";

const catalogue = catalogueText();
const lanes = lanesOf(catalogue);
const owners = ownersOf(catalogue);
/** A lane's body on one line: the catalogue wraps at a hundred columns, mid-phrase. */
const flat = (body: string) => body.replaceAll(/\s+/g, " ");
const numbers = (some: readonly Lane[]) => some.map((each) => each.number);

describe("the lane catalogue", () => {
  it("holds thirty lanes, numbered in order, each with its three sentences", () => {
    expect(numbers(lanes)).toEqual(Array.from({ length: 31 }, (_, index) => index + 1));
    for (const { number, body } of lanes) {
      for (const phrase of ["The question is", "The decision it changes is", "it routes to"]) {
        expect(`${String(number)}: ${String(flat(body).includes(phrase))}`).toBe(`${String(number)}: true`);
      }
    }
  });

  it("names every trigger the reader can print in the lane that trigger starts", () => {
    const named = lanes.flatMap((each) => each.triggers.map((name) => `${name} > ${String(each.number)}`));
    const printed = Object.entries(TRIGGERS).map(([name, number]) => `${name} > ${String(number)}`);
    expect(named.toSorted()).toEqual(printed.toSorted());
  });

  it("says in each lane's own paragraph whether it is standing or runs alone", () => {
    expect(numbers(lanes.filter((each) => each.standing))).toEqual([1, 15, 18, 22]);
    expect(numbers(lanes.filter((each) => each.isolated))).toEqual([5, 19]);
  });

  it("routes every lane to an owner of its own table", () => {
    expect(owners).toContain("pack/evaluator");
    expect(owners).toContain("operator");
    for (const { number, body } of lanes) {
      const tail = flat(body);
      const routed = new Set(
        [...tail.slice(tail.lastIndexOf("it routes to")).matchAll(/`([^`]+)`/g)].map(([, name]) => name),
      );
      expect(`${String(number)}: ${String(owners.some((owner) => routed.has(owner)))}`).toBe(
        `${String(number)}: true`,
      );
    }
  });
});
