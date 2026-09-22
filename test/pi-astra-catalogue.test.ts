import { describe, expect, it } from "bun:test";
import { createModels, getSupportedThinkingLevels, Type } from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import piAgentPackage from "@earendil-works/pi-agent-core/package.json" with { type: "json" };
import { preflightPiBuilt } from "../src/backends/pi-built.ts";
import { piModelSelection } from "../src/backends/pi-providers.ts";
import { builtSolveIsolation } from "../src/run/built-agent-runtime.ts";
import { runtimeProcess } from "../src/meta/process.ts";

describe("Astra through the installed Pi catalogue", () => {
  it.each(["low", "medium"] as const)(
    "opens the confined Codex worker at %s without a model turn",
    async (thinkingLevel) => {
      const evidence = await preflightPiBuilt({
        profile: { provider: "openai-codex", transport: "codex", model: "gpt-6-astra", thinkingLevel },
        auth: async () => ({
          type: "oauth",
          access: "header.payload.signature",
          refresh: "",
          expires: Date.now() + 3_600_000,
        }),
        policy: builtSolveIsolation(runtimeProcess.cwd()),
      });
      expect(evidence.modelSelection).toEqual({
        resolvedModel: "gpt-6-astra",
        effort: thinkingLevel,
        source: "pi-provider-catalogue",
      });
      expect(evidence.providerVersion).toBe(`pi-agent-core/${piAgentPackage.version}`);
      expect(evidence.confinedPid).not.toBe(evidence.controllerPid);
    },
    60_000,
  );

  it("refuses disabled reasoning before an Astra turn", async () => {
    await expect(
      preflightPiBuilt({
        profile: { provider: "openai-codex", transport: "codex", model: "gpt-6-astra", thinkingLevel: "off" },
        auth: async () => ({
          type: "oauth",
          access: "header.payload.signature",
          refresh: "",
          expires: Date.now() + 3_600_000,
        }),
        policy: builtSolveIsolation(runtimeProcess.cwd()),
      }),
    ).rejects.toThrow("unsupported reasoning effort: off");
  }, 60_000);

  it.each([
    { transport: "codex", provider: "openai-codex", model: "gpt-5.6-sol", level: "minimal" },
    { transport: "claude", provider: "anthropic", model: "claude-sonnet-5", level: "minimal" },
    { transport: "claude", provider: "anthropic", model: "claude-sonnet-5", level: "off" },
  ] as const)("refuses $level on $model, which its transport would serve as another level", (row) => {
    expect(() =>
      piModelSelection({
        provider: row.provider,
        transport: row.transport,
        model: row.model,
        thinkingLevel: row.level,
      }),
    ).toThrow(`unsupported reasoning effort: ${row.level}`);
  });

  it("keeps a level the transport serves under its own name", () => {
    expect(
      piModelSelection({
        provider: "openai-codex",
        transport: "codex",
        model: "gpt-5.6-sol",
        thinkingLevel: "medium",
      }),
    ).toMatchObject({ effort: "medium" });
    expect(
      piModelSelection({
        provider: "anthropic",
        transport: "claude",
        model: "claude-sonnet-5",
        thinkingLevel: "xhigh",
      }),
    ).toMatchObject({ effort: "xhigh" });
  });

  it("carries tool calls, medium effort and the new cache format through Responses", async () => {
    const models = createModels();
    models.setProvider(openaiProvider());
    const model = models.getModel("openai", "gpt-6-astra");
    if (!model) throw new Error("native catalogue is missing Astra");
    expect(model.api).toBe("openai-responses");
    expect(getSupportedThinkingLevels(model)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    let payload: unknown;
    const result = await models
      .streamSimple(
        model,
        {
          messages: [{ role: "user", content: "Inspect the draft.", timestamp: 0 }],
          tools: [{ name: "inspect", description: "Read the draft.", parameters: Type.Object({}) }],
        },
        {
          apiKey: "test-key",
          reasoning: "medium",
          cacheRetention: "long",
          onPayload: (value) => {
            payload = value;
            throw new Error("request captured before network");
          },
        },
      )
      .result();
    expect(result.errorMessage).toContain("request captured before network");
    expect(payload).toMatchObject({
      model: "gpt-6-astra",
      reasoning: { effort: "medium" },
      prompt_cache_options: { ttl: "30m" },
      tools: [expect.objectContaining({ type: "function", name: "inspect" })],
    });
    expect(JSON.stringify(payload)).not.toContain("prompt_cache_retention");
  });
});
