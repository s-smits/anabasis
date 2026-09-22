import { expect, it } from "bun:test";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { processResponsesStream } from "@earendil-works/pi-ai/api/openai-responses-shared";
import { keysIf } from "../src/meta/optional-key.ts";
import { double } from "./helpers/doubles.ts";

it("keeps the unpatched Responses parser's served-model limitation explicit", async () => {
  for (const supplied of ["distinct-served-model", undefined, ""]) {
    for (const suppliedAt of ["created", "completed"]) {
      const output: AssistantMessage = double({
        role: "assistant",
        content: [],
        model: "requested-model",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      });
      async function* events() {
        for (const phase of ["created", "completed"]) {
          yield {
            type: `response.${phase}`,
            response: {
              id: "response-1",
              status: phase === "completed" ? "completed" : "in_progress",
              output: [],
              ...keysIf(phase === suppliedAt, () => ({ model: supplied })),
            },
          };
        }
      }
      await processResponsesStream(
        double(events()),
        output,
        double({ push() {} }),
        double<Model<"openai-codex-responses">>({
          id: "requested-model",
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        }),
      );
      expect(output.responseId).toBe("response-1");
      expect(output.model).toBe("requested-model");
      // Pi 0.87.0 discards this provider field. The requested model is not attestation.
      expect(output.responseModel).toBeUndefined();
    }
  }
});
