// Copied from pi coding-agent v1.3.0 (github.com/earendil-works/pi, 71023aec, MIT, see LICENSE):
// packages/coding-agent/src/core/model-config.ts, the schema of models.json and its validator.
// Departures:
// - `ModelConfig`, which reads models.json from a path, and `deepFreeze`, which only it calls, are
//   left out, with their file, JSON-comment, path and BOM imports: the host imports its one file.
// - `validateModelsConfig` and `formatValidationPath` are exported, for the host to check that file.
/** Immutable, credential-blind models.json snapshot. */

import { ProviderCompatSchema } from "@earendil-works/pi-ai/providers/compat-schema";
import {
	ModelCostSchema,
	ModelInputLimitsSchema,
	ModelInputModalitySchema,
	ModelPromptCacheSchema,
	ThinkingLevelMapSchema,
} from "@earendil-works/pi-ai/providers/model-schema";
import { type Static, Type } from "typebox";
import { Compile } from "typebox/compile";
import type { TLocalizedValidationError } from "typebox/error";

const SamplingParamsSchema = Type.Record(Type.String(), Type.Unknown());
const SamplingParamsByThinkingLevelSchema = Type.Object({
	off: Type.Optional(SamplingParamsSchema),
	minimal: Type.Optional(SamplingParamsSchema),
	low: Type.Optional(SamplingParamsSchema),
	medium: Type.Optional(SamplingParamsSchema),
	high: Type.Optional(SamplingParamsSchema),
	xhigh: Type.Optional(SamplingParamsSchema),
	max: Type.Optional(SamplingParamsSchema),
});

const PositiveTokenCountSchema = Type.Number({ exclusiveMinimum: 0 });

const ModelDefinitionSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	name: Type.Optional(Type.String({ minLength: 1 })),
	api: Type.Optional(Type.String({ minLength: 1 })),
	baseUrl: Type.Optional(Type.String({ minLength: 1 })),
	reasoning: Type.Optional(Type.Boolean()),
	thinkingLevelMap: Type.Optional(ThinkingLevelMapSchema),
	input: Type.Optional(Type.Array(ModelInputModalitySchema)),
	inputLimits: Type.Optional(ModelInputLimitsSchema),
	cost: Type.Optional(ModelCostSchema),
	promptCache: Type.Optional(ModelPromptCacheSchema),
	contextWindow: Type.Optional(PositiveTokenCountSchema),
	maxTokens: Type.Optional(PositiveTokenCountSchema),
	samplingParams: Type.Optional(SamplingParamsSchema),
	samplingParamsByThinkingLevel: Type.Optional(SamplingParamsByThinkingLevelSchema),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	compat: Type.Optional(ProviderCompatSchema),
});

const ModelOverrideSchema = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1 })),
	reasoning: Type.Optional(Type.Boolean()),
	thinkingLevelMap: Type.Optional(ThinkingLevelMapSchema),
	input: Type.Optional(Type.Array(ModelInputModalitySchema)),
	inputLimits: Type.Optional(ModelInputLimitsSchema),
	cost: Type.Optional(Type.Partial(ModelCostSchema)),
	promptCache: Type.Optional(ModelPromptCacheSchema),
	contextWindow: Type.Optional(PositiveTokenCountSchema),
	maxTokens: Type.Optional(PositiveTokenCountSchema),
	samplingParams: Type.Optional(SamplingParamsSchema),
	samplingParamsByThinkingLevel: Type.Optional(SamplingParamsByThinkingLevelSchema),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	compat: Type.Optional(ProviderCompatSchema),
});

const ProviderConfigSchema = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1 })),
	baseUrl: Type.Optional(Type.String({ minLength: 1 })),
	apiKey: Type.Optional(Type.String({ minLength: 1 })),
	api: Type.Optional(Type.String({ minLength: 1 })),
	oauth: Type.Optional(Type.Literal("radius")),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	compat: Type.Optional(ProviderCompatSchema),
	authHeader: Type.Optional(Type.Boolean()),
	models: Type.Optional(Type.Array(ModelDefinitionSchema)),
	modelOverrides: Type.Optional(Type.Record(Type.String(), ModelOverrideSchema)),
});

const ModelsConfigProperties = {
	providers: Type.Record(Type.String(), ProviderConfigSchema),
};

export const ModelsConfigSchema = Type.Object({
	$schema: Type.Optional(Type.String()),
	...ModelsConfigProperties,
});

export const validateModelsConfig = Compile(ModelsConfigSchema);

export type ModelsJsonModel = Static<typeof ModelDefinitionSchema>;
export type ModelsJsonModelOverride = Static<typeof ModelOverrideSchema>;
export type ModelsJsonProvider = Static<typeof ProviderConfigSchema>;

export function formatValidationPath(error: TLocalizedValidationError): string {
	if (error.keyword === "required") {
		const requiredProperties = (error.params as { requiredProperties?: string[] }).requiredProperties;
		const requiredProperty = requiredProperties?.[0];
		if (requiredProperty) {
			const basePath = error.instancePath.replace(/^\//, "").replace(/\//g, ".");
			return basePath ? `${basePath}.${requiredProperty}` : requiredProperty;
		}
	}
	const path = error.instancePath.replace(/^\//, "").replace(/\//g, ".");
	return path || "root";
}
