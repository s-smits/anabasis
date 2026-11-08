/**
 * `tree/crossed-argument` (`tools/oxlint/tree-crossed-argument.ts`): a call into another file whose
 * arguments are named for one another's parameters. Each shape it reads (a named, aliased or
 * namespace import, `new` of an imported class, a method of an imported object literal, three
 * arguments rotated) sits beside its nearest case that is not a crossing.
 */
import { describe, expect, it } from "bun:test";
import { crossedArguments } from "../tools/oxlint/tree-crossed-argument.ts";

const ROUNDS = `export function roundDir(campaign: string, round: string): string {
  return campaign + round;
}
export const place = (row: string, column: string, layer: string): string => row + column + layer;
export class Route {
  constructor(readonly from: string, readonly to: string) {}
}
export const paths = {
  relative(base: string, target: string): string {
    return target.slice(base.length);
  },
};
export function pick(first: string, second: string): string;
export function pick(first: number, second: number): number;
export function pick(first: unknown, second: unknown): unknown {
  return first ?? second;
}
export const local = roundDir(round, campaign);
`;

const reported = (caller: string): number[] =>
  crossedArguments(
    new Map([
      ["src/rounds.ts", ROUNDS],
      ["tools/d2/caller.ts", caller],
    ]),
  ).map((row) => (row.path === "tools/d2/caller.ts" ? row.line : -row.line));

describe("a crossed argument across files", () => {
  it("is reported through a named, an aliased and a namespace import, and not in the declared order", () => {
    const caller = `import { roundDir, roundDir as dirOf } from "../../src/rounds.ts";
import * as rounds from "#src/rounds.ts";
roundDir(round, campaign);
dirOf(edge.round, edge.campaign);
rounds.roundDir(round, campaign);
roundDir(campaign, round);
roundDir(round, round);
roundDir(...pair);
`;
    expect(reported(caller)).toEqual([3, 4, 5]);
  });

  it("is reported for a constructor and an object literal's method, and not in their order", () => {
    const caller = `import { Route, paths } from "../../src/rounds.ts";
new Route(to, from);
new Route(from, to);
paths.relative(target, base);
paths.relative(base, target);
`;
    expect(reported(caller)).toEqual([2, 4]);
  });

  it("is reported for three arguments rotated, and not for a chain that never closes", () => {
    const caller = `import { place } from "../../src/rounds.ts";
place(column, layer, row);
place(column, layer, depth);
`;
    expect(reported(caller)).toEqual([2]);
  });

  it("leaves a call within one file to the lint rule, and an overloaded name unread", () => {
    const caller = `import { pick } from "../../src/rounds.ts";
pick(second, first);
`;
    expect(reported(caller)).toEqual([]);
  });
});
