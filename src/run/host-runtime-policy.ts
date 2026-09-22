import { sha256OfFile } from "../meta/digest.ts";
import { runtimeProcess } from "../meta/process.ts";

export const PINNED_BUN_VERSION = "1.4.2";
export const PINNED_BUN_REVISION = "744846f844374847c902b5e7fd59b4342a51ef99";
export const HOST_RUNTIME_IDENTITY_SCHEMA = "host-runtime-identity/v1" as const;

export type HostRuntimeIdentity = {
  schema: typeof HOST_RUNTIME_IDENTITY_SCHEMA;
  name: "bun";
  version: string;
  platform: string;
  arch: string;
  executableSha256: string;
};

function runningBunVersion(): string | undefined {
  return globalThis.Bun?.version;
}

export function assertSupportedHostRuntime(): void {
  const version = runningBunVersion();
  const revision = globalThis.Bun?.revision;
  if (version === PINNED_BUN_VERSION && revision === PINNED_BUN_REVISION) return;
  throw new Error(
    `Anabasis requires stable Bun ${PINNED_BUN_VERSION} (${PINNED_BUN_REVISION}), got ${version ?? "a non-Bun runtime"} (${revision ?? "no revision"})`,
  );
}

export function hostRuntimeIdentity(): HostRuntimeIdentity {
  assertSupportedHostRuntime();
  const version = runningBunVersion();
  if (version === undefined) throw new Error("Bun runtime identity disappeared after admission");
  return {
    schema: HOST_RUNTIME_IDENTITY_SCHEMA,
    name: "bun",
    version,
    platform: runtimeProcess.platform,
    arch: runtimeProcess.arch,
    executableSha256: sha256OfFile(runtimeProcess.execPath),
  };
}
