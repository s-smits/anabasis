import { expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { controllerDenominator } from "../src/run/controller-denominator.ts";

const RUN = "truss-sol-stable-20260905T1000Z";

it("records zero cases for a battery refused before any case ran, and invalid only for an unparsable record", () => {
  const dir = mkdtempSync(join(tmpdir(), "controller-denominator-"));
  expect(controllerDenominator(dir, [])).toEqual({ state: "absent" });
  expect(controllerDenominator(dir, [RUN])).toEqual({
    state: "recorded",
    total: 0,
    verified: 0,
    unaccepted: 0,
    nonResults: 0,
  });
  writeFileSync(join(dir, "case-record.jsonl"), "{not-json\n");
  expect(controllerDenominator(dir, [RUN])).toEqual({ state: "invalid", error: "case-record unreadable" });
});
