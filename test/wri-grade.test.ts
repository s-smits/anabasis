// `grade --set` changes one existing field of an answer to a value of its own JSON type, and says
// what it changed; a naive replacement adds a field a typo names or retypes one unseen.
import { describe, expect, it } from "bun:test";
import { withSet } from "../tools/wri/grade.ts";

const answer = {
  reagents: [
    { id: "a", mM: 1.5 },
    { id: "b", mM: 2 },
  ],
  note: "x",
  flag: null,
};

describe("withSet", () => {
  it("replaces each named field, leaves the original whole and prints each change", () => {
    const { answer: changed, said } = withSet(answer, ["$.reagents[1].mM=3.25", '$.note="y"']);
    expect(changed).toEqual({
      reagents: [
        { id: "a", mM: 1.5 },
        { id: "b", mM: 3.25 },
      ],
      note: "y",
      flag: null,
    });
    expect(answer.reagents[1]?.mM).toBe(2);
    expect(said).toEqual(["set $.reagents[1].mM: 2 -> 3.25", 'set $.note: "x" -> "y"']);
  });

  it("refuses a path the answer does not hold, so a typo adds no field", () => {
    expect(() => withSet(answer, ["$.reagents[1].mm=3"])).toThrow("no field of the answer");
    // A path without its root names the same field, and a wrong one is refused as before.
    expect(withSet(answer, ["reagents[1].mM=3.25"]).answer).toEqual(
      withSet(answer, ["$.reagents[1].mM=3.25"]).answer,
    );
    expect(() => withSet(answer, ["reagents[1].mm=3"])).toThrow("$.reagents[1].mm is no field of the answer");
    expect(() => withSet(answer, ["$.reagents[2].mM=3"])).toThrow("no field of the answer");
    // A lane wrote an index with a dot (12 November); the refusal names the form that is read.
    expect(() => withSet(answer, ["reagents.1.mM=3"])).toThrow("an index goes in brackets");
    expect(() => withSet(answer, ["$.note"])).toThrow("no field of the answer");
  });

  it("prints a long value cut, with its length, and replaces it whole", () => {
    // A replaced field can be an answer's whole text, which a lane's report then carried.
    const { answer: changed, said } = withSet({ text: "a".repeat(200) }, [`$.text="${"b".repeat(78)}"`]);
    expect(changed).toEqual({ text: "b".repeat(78) });
    expect(said).toEqual([`set $.text: "${"a".repeat(79)}... (202 characters) -> "${"b".repeat(78)}"`]);
  });

  it("refuses a value of another JSON type, and one that is not JSON", () => {
    expect(() => withSet(answer, ['$.reagents[0].mM="1.5"'])).toThrow(
      "holds a number and the value is a string",
    );
    expect(() => withSet(answer, ["$.flag=0"])).toThrow("holds a null");
    expect(() => withSet(answer, ["$.note=y"])).toThrow("not JSON");
  });

  it("replaces a scalar root and refuses an object root", () => {
    expect(withSet(4, ["$=5"]).answer).toBe(5);
    expect(() => withSet(answer, ['$={"note":"z"}'])).toThrow("only a scalar root");
  });
});
