/**
 * The gate decisions in `src/truth/decisions/`, read against what the Builder is told. A decision
 * that refuses is named under Gates in STARTER.md, so a refusal never reaches the author as a code
 * it was never told about.
 */
import { describe, expect, it } from "bun:test";

import { readFileSync } from "../src/meta/filesystem.ts";
import { EXTERNAL_VERDICT_UNGROUNDED } from "../src/truth/tool-runs.ts";

const STARTER = readFileSync(new URL("../starters/pi-built-harness/STARTER.md", import.meta.url), "utf8");

describe("gate decisions", () => {
  it.each([{ code: EXTERNAL_VERDICT_UNGROUNDED }])("tells the Builder $code under Gates", (decision) => {
    const gates = STARTER.slice(STARTER.indexOf("## Gates"));
    expect(gates).toContain(`\`${decision.code}\``);
  });
});
