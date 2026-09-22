/** V4 boundary: provider-attested model identity from the Claude SDK result. */
import type { SDKResultMessage } from "claude-agent-sdk-bridge";

/** The two registry fields this attestation compares. Naming them keeps pi-ai's `Model<TApi>`
 *  parameter, which the comparison never reads, off the boundary. */
type RegisteredModel = { id: string; contextWindow: number };

export function inspectServedModel(message: SDKResultMessage, model: RegisteredModel): string | undefined {
  const servedModels = Object.keys(message.modelUsage);
  if (servedModels.length !== 1) return undefined;
  const served = servedModels[0];
  // modelUsage keys are CLI ids, while message_start reports the API id — two spellings of one
  // catalogue entry (models.ts maps id to cliModelId, `<id>[1m]` for a long-context invocation).
  // Run 68 refused a claim because one case's turns attested "claude-opus-5[1m]" against the pin
  // "claude-opus-5". Fold the CLI spelling back to the registered id; a genuinely different
  // served model still crosses unchanged.
  return served === model.id || served === `${model.id}[1m]` ? model.id : served;
}
