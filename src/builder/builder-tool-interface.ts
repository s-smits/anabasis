/** Controller-owned equality check for the complete production Builder tool contract. */
import type { BackendKind } from "../backends/resolve.ts";
import { compareCodeUnits, hashJsonValue, sameJsonValue } from "../meta/stable-json.ts";

/** Every Builder tool, on every backend: filesystem authority stays with the host. Sorted,
 *  because the entry gate compares this list against the sorted registered roster. */
export const BUILDER_TOOLS = [
  "bash",
  "context",
  "correctness_check",
  "edit",
  "find",
  "grep",
  "harness_inspect",
  "harness_reset",
  "harness_trial",
  "ls",
  "public_source",
  "read",
  "submit",
  "verifier_workshop",
  "write",
] as const;

export interface BuilderSessionInterfaceEvidence {
  backend: BackendKind;
  catalogued: string[];
  registered: string[];
  backendExposed: string[];
  registeredSchemaDigest: string;
  backendExposedSchemaDigest: string;
  digest: string;
}

export interface BuilderToolInterfaceInput {
  name: string;
  description: string;
  parameters: unknown;
}

function rowsOf(tools: readonly BuilderToolInterfaceInput[]) {
  return tools
    .map(({ name, description, parameters }) => ({ name, description, inputSchema: parameters }))
    .sort((a, b) => compareCodeUnits(a.name, b.name));
}

/** The roster the session registers against the declarations the provider receives: both must be
 *  the whole catalogue, once each, with the same descriptions and schemas. */
export function reconcileBuilderInterface(input: {
  backend: BackendKind;
  registered: readonly BuilderToolInterfaceInput[];
  backendExposed: readonly BuilderToolInterfaceInput[];
}): BuilderSessionInterfaceEvidence {
  const registeredRows = rowsOf(input.registered);
  const backendRows = rowsOf(input.backendExposed);
  const registeredSchemaDigest = hashJsonValue(registeredRows);
  const backendExposedSchemaDigest = hashJsonValue(backendRows);
  const contract = {
    backend: input.backend,
    catalogued: [...BUILDER_TOOLS],
    registered: registeredRows.map(({ name }) => name),
    backendExposed: backendRows.map(({ name }) => name),
    registeredSchemaDigest,
    backendExposedSchemaDigest,
    digest: hashJsonValue({ backend: input.backend, tools: backendRows }),
  };
  if (
    [contract.registered, contract.backendExposed].some((row) => !sameJsonValue(row, contract.catalogued))
  ) {
    throw new Error(
      `Builder entry gate: catalogued=${contract.catalogued.join(",")} registered=${contract.registered.join(",")} backend-exposed=${contract.backendExposed.join(",")}`,
    );
  }
  if (registeredSchemaDigest !== backendExposedSchemaDigest) {
    throw new Error(
      `Builder entry gate: registered tool descriptions or schemas differ from the ${input.backend} backend contract`,
    );
  }
  return contract;
}
