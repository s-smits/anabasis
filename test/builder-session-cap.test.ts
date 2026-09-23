/**
 * A Builder authoring session has no default time limit, so the wall exists only when something
 * sets it: `HARNESS_BUILDER_SESSION_CAP_MS` in the environment, or an explicit option, which wins
 * over the environment. The fourth case is the one that earns the file. A malformed environment
 * value is refused rather than read as no limit, because a typo that quietly meant no wall would
 * only show itself in a session that had already run too long.
 */
import { describe, expect, it } from "bun:test";
import { builderSessionCapMs } from "../src/run/builder-backend.ts";

describe("builderSessionCapMs", () => {
  it("leaves the session without a time limit when nothing is set", () => {
    expect(builderSessionCapMs(undefined, {})).toBeUndefined();
  });

  it("an explicit option wins over the environment", () => {
    expect(builderSessionCapMs(120_000, { HARNESS_BUILDER_SESSION_CAP_MS: "7200000" })).toBe(120_000);
  });

  it("HARNESS_BUILDER_SESSION_CAP_MS sets the wall when present", () => {
    expect(builderSessionCapMs(undefined, { HARNESS_BUILDER_SESSION_CAP_MS: "7200000" })).toBe(7_200_000);
  });

  it("refuses a malformed environment value", () => {
    for (const raw of ["0", "-1", "1.5", "soon", ""]) {
      expect(() => builderSessionCapMs(undefined, { HARNESS_BUILDER_SESSION_CAP_MS: raw })).toThrow(
        /HARNESS_BUILDER_SESSION_CAP_MS must be a positive integer/,
      );
    }
  });
});
