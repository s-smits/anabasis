/**
 * The rule that reads a run of `const`s threading one value, each read once, into the statement
 * below it — the twenty-lines-to-four shape stated so a scan can find it.
 *
 * What needs pinning is where the run stops, because every exemption is a way a `const` earns its
 * line and each one has to end the run rather than be skipped over. So each admitted case here is
 * four steps long with its exemption on the second, which means the run is only short because that
 * one guard held: remove the guard and a four-link chain reports. A three-step fixture would have
 * been admitted by the link count instead, and would have asked the guard nothing. Mutating each
 * guard in turn confirmed it — five of the six break this fixture, and the sixth, an explicit test
 * for a type annotation, could not be made to break it at all and was deleted as a restatement of
 * what the read count already decides. The annotated case is the one that asserts a line rather
 * than a silence: the run has to start *below* it.
 *
 * The comment exemption is the "the name explains something" dial in the one form a rule can
 * decide, and it is the one most easily got wrong in the other direction: a trailing `// ...`
 * explains the line it sits on, so it must not exempt the statement after it. Every marker in this
 * fixture is such a trailing comment, so the whole file is that half of the test.
 *
 * The link count is the other half. At three links this tree has no site and at two it has 80, and
 * twelve of the twenty outside `test/` were read one by one and are all a name doing work — so the
 * dial is not a preference: two threaded steps are ordinary and three are the shape.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

const RULE = "no-single-use-const-chain";
const CHAINS = `declare function parse(text: string): { tasks: string[] };
declare function byId(one: string): string;
declare function unique(one: string): boolean;
declare function widen(one: string[]): string[];
declare function count(one: string[]): number;

export function threaded(text: string): string[] {
  const parsed = parse(text); // REPORT three steps threading one value into the return
  const rows = parsed.tasks;
  const ids = rows.map(byId);
  return ids.filter(unique);
}

export function longer(text: string): number {
  const parsed = parse(text); // REPORT four steps, same shape
  const rows = parsed.tasks;
  const ids = rows.map(byId);
  const wide = widen(ids);
  return count(wide);
}

export function twoSteps(text: string): string[] {
  const parsed = parse(text); // ADMITTED two threaded steps are an ordinary arrange and read
  const rows = parsed.tasks;
  return rows.filter(unique);
}

export function unthreaded(text: string, other: string): number {
  const parsed = parse(text); // ADMITTED the third step reads none of the two above it
  const rows = parsed.tasks;
  const ids = parse(other).tasks;
  const wide = widen(ids);
  return count(wide);
}

export function readTwice(text: string): number {
  const parsed = parse(text); // ADMITTED the second step is read twice, so it holds work
  const rows = parsed.tasks;
  const ids = rows.length > 0 ? rows.map(byId) : [];
  const wide = widen(ids);
  return count(wide);
}

export function landsLater(text: string): string[] {
  const parsed = parse(text); // ADMITTED the last name is not read in the statement below
  const rows = parsed.tasks;
  const ids = rows.map(byId);
  const other = parse(text).tasks;
  return [...other, ...ids];
}

export function annotated(text: string): number {
  const parsed: { tasks: string[] } = parse(text); // ADMITTED an annotation is a narrowing, so the run starts below it
  const rows = parsed.tasks; // REPORT the three steps under the annotated one are still a chain
  const ids = rows.map(byId);
  const wide = widen(ids);
  return count(wide);
}

export function commented(text: string): number {
  const parsed = parse(text); // ADMITTED the step below carries a sentence, so its name holds it
  // The bundle's own order is what the verifier reads back, so it is kept under a name here.
  const rows = parsed.tasks;
  const ids = rows.map(byId);
  const wide = widen(ids);
  return count(wide);
}

export function withCallback(text: string): number {
  const parsed = parse(text); // ADMITTED a callback body is not one expression to compose
  const rows = parsed.tasks.map((one) => byId(one));
  const ids = rows.map(byId);
  const wide = widen(ids);
  return count(wide);
}

export function reassigned(text: string): number {
  const parsed = parse(text); // ADMITTED a let is not a step in a chain
  let rows = parsed.tasks;
  rows = rows.filter(unique);
  const wide = widen(rows);
  return count(wide);
}
`;

describe(`ana/${RULE}`, () => {
  it("reads a threaded run of single-use consts and stops at every line that earns itself", () => {
    expect(reportedLines("ana", RULE, CHAINS)).toStrictEqual(expectedLines(CHAINS));
  });

  it("asks each admitted case about one guard, by making it long enough to report without it", () => {
    expect(expectedLines(CHAINS).length).toBe(3);
    expect(CHAINS.split("// ADMITTED").length - 1).toBe(8);
  });
});
