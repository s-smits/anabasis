// The truth-side §5 cuts removed a second deciding authority, a set of producers and a repair
// lifecycle, and a removal only stays removed while something fails when it comes back. Each
// dropped record row's `refusal` resolves here, and the two standing guards are check 4, the
// refused vocabulary, and check 5, the dropped-producer census, over the same tree — so restoring a
// removed producer fails both of them, once by name and once by census.
import { readFileSync, readdirSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { describe, expect, it } from "bun:test";
import { OWNER_LAYERS } from "../src/meta/owner.ts";
import { validateBrief } from "../src/truth/brief-validator.ts";
import { MATCHING_BRIEF } from "./helpers/matching-fixture.ts";
import { scanTokens } from "../tools/loc/token-facts.ts";

const DROPPED_OP_KINDS = [
  "collectionMemberEvery",
  "collectionBrokerPathEvery",
  "collectionAllowedValuesByDiscriminatorEvery",
  "collectionUniqueByKey",
  "groupedIntervalGap",
  "groupedSumAtMost",
] as const;

function srcSpans(): Array<{ path: string; facts: ReturnType<typeof scanTokens> }> {
  return readdirSync("src", { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => {
      const path = join(e.parentPath, e.name);
      return { path, facts: scanTokens(readFileSync(path, "utf8")) };
    });
}

describe("the truth-side §5 removals remain enforced", () => {
  it("legacy predicate fields cannot supply a second deciding authority", () => {
    expect(validateBrief(MATCHING_BRIEF).ok).toBe(true);
    for (const kind of DROPPED_OP_KINDS) {
      const brief = {
        ...MATCHING_BRIEF,
        truthChecks: MATCHING_BRIEF.truthChecks.map((check) => ({
          ...check,
          predicate: { operation: { kind } },
        })),
      };
      expect(
        validateBrief(brief).findings.some((finding) => finding.code === "unsupported-correctness-contract"),
        kind,
      ).toBe(true);
    }
  });

  it("controls authoring section: producers are called only by their re-admitted owner family", () => {
    // cut-controls-authoring-variant's expiresWhen fired (deviation author-build-agent-boundary): the
    // trio re-entered under src/author/ as its own owner. The census this refusal keeps is the
    // original restriction: evaluation code still never calls the authoring producers; the only
    // allowed call sites are in the author family that replaced the earlier arrangement.
    for (const { path, facts } of srcSpans()) {
      if (path.startsWith("src/author/")) continue;
      expect(facts.calls.has("applyRejectPatch"), path).toBe(false);
      expect(facts.calls.has("adoptBestCorpus"), path).toBe(false);
      expect(facts.calls.has("scoreControlCorpus"), path).toBe(false);
    }
  });

  it("keeps the removed repair lifecycle's distinct status literals absent", () => {
    expect(OWNER_LAYERS).toHaveLength(8);
    // The terminal values `held`/`refuted` cannot identify this lifecycle: prediction outcomes
    // also use those words. The three non-terminal RepairStatus members belonged to the removed
    // lifecycle. Checking for them catches a restoration with its original status names;
    // it does not detect an equivalent lifecycle introduced under different names.
    for (const { path, facts } of srcSpans()) {
      for (const literal of ["proposed", "applied", "tested"]) {
        expect(facts.literals.has(literal), `${path} reintroduces "${literal}"`).toBe(false);
      }
    }
  });
});
