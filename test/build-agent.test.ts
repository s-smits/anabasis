import { describe, expect, it } from "bun:test";
import { BuildAgentTurnNonResult, runModelAttempt } from "../src/author/build-agent.ts";
import { rejectionOf } from "./helpers/doubles.ts";

describe("a thrown transport failure inside one model attempt", () => {
  // A transport can throw a failure it should have settled as a failed turn, which would bypass
  // every classifier and record a bare abort with no owner, so the attempt boundary applies
  // openBuildSession's rule to throws as well.
  it("becomes the typed turn non-result when the canonical matcher recognises it", async () => {
    const error = await rejectionOf(
      runModelAttempt(undefined, "builder", async () => {
        throw new Error(
          "error creating thread: Fatal error: Session data under /x/sessions looks corrupt or unreadable.",
        );
      }),
    );
    if (!(error instanceof BuildAgentTurnNonResult)) throw new Error("expected the typed turn non-result");
    expect(error.role).toBe("builder");
  });

  it("leaves a code or configuration error unchanged", async () => {
    const raw = new Error("codex builder requested profile a, but thread/start returned b");
    const error = await rejectionOf(
      runModelAttempt(undefined, "builder", async () => {
        throw raw;
      }),
    );
    expect(error).toBe(raw);
  });
});
