/**
 * What F2 hands each check: only the operands it declared, and every hidden operand it requires.
 * A check reading an undeclared root must fail rather than credit a verdict to another check's
 * inputs, and a missing required hidden operand refuses rather than quietly making the check
 * inapplicable.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { cleanupScratch } from "./helpers/scratch.ts";
import { createVerifierHost } from "../src/verify/host.ts";
import { failure, statuses, testLifetime, witness } from "./helpers/solvability-specimen.ts";
import {
  externalFamilyFixture,
  familyFixture,
  misattributingToolInventory,
} from "./helpers/solvability-families.ts";

afterAll(cleanupScratch);

describe("F2 operand scope", () => {
  it.concurrent("withholds an operand the check did not declare", async () => {
    const result = await witness(externalFamilyFixture(), {
      createVerifier: () =>
        createVerifierHost({
          inventory: misattributingToolInventory(),
          requireOsSandbox: false,
          lifetime: testLifetime(),
        }),
    });

    expect(statuses(result)).toEqual(["failed", "failed", "failed"]);
    expect(failure(result)).toContain("unrelated answer operand withheld");
  });

  it.concurrent("refuses a missing required hidden operand instead of silently changing applicability", async () => {
    const result = await witness(familyFixture({ answers: ["A", "B"], dropSiblingHidden: true }));

    expect(result.evidence).toBeNull();
    expect(result.findings).toMatchObject([
      {
        code: "solvability-bundleSnapshot-contract-invalid",
        detail: 'applicable check "answer" requires one hidden operand; absence cannot skip the check',
      },
    ]);
  });
});
