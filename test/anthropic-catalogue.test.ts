import { describe, expect, it } from "bun:test";
import { createModels, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { applyLongContext, claudeCodeModelId } from "../vendor/pi-claude-bridge/models.ts";

describe("the Built slot's Anthropic catalogue", () => {
  it.each(["claude-opus-5", "claude-fable-5-1"])(
    "supports %s at medium through the native catalogue and SDK bridge",
    (id) => {
      const models = createModels();
      models.setProvider(anthropicProvider());
      const model = models.getModel("anthropic", id);
      if (!model) throw new Error(`native catalogue is missing ${id}`);
      expect(model.contextWindow).toBe(1_000_000);
      expect(getSupportedThinkingLevels(model)).toContain("medium");
      expect(model.compat).toMatchObject({
        forceAdaptiveThinking: true,
        supportsMidConvoEffort: true,
        supportsStrictTools: true,
      });
      expect(Object.hasOwn(model.compat ?? {}, "allowedFallbackModels")).toBe(false);
      const settings = { plan: "max", longContextExtraUsage: false } as const;
      expect(claudeCodeModelId(model, settings)).toBe(`${id}[1m]`);
      expect(applyLongContext([model], settings)[0]?.contextWindow).toBe(model.contextWindow);
    },
  );

  it.each(["claude-opus-5", "claude-fable-5-1"])(
    "sends managed medium thinking without fallback for %s",
    async (id) => {
      const models = createModels();
      models.setProvider(anthropicProvider());
      const model = models.getModel("anthropic", id);
      if (!model) throw new Error(`native catalogue is missing ${id}`);
      let payload: unknown;
      const result = await models
        .streamSimple(
          model,
          {
            messages: [{ role: "user", content: "hello", timestamp: 0 }],
          },
          {
            apiKey: "test-key",
            reasoning: "medium",
            onPayload: (value) => {
              payload = value;
              throw new Error("request captured before network");
            },
          },
        )
        .result();
      expect(result.errorMessage).toContain("request captured before network");
      expect(payload).toMatchObject({
        model: id,
        thinking: {
          type: "adaptive",
          display: "summarized",
          block_binding: { prefix_mismatch_behavior: "drop_block" },
        },
      });
      expect(JSON.stringify(payload)).toContain('"effort":"medium"');
      expect(payload).not.toHaveProperty("fallbacks");
    },
  );
});
