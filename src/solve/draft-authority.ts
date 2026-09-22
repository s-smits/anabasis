/** One revocable DraftStore view for one registered generated-tool call. */
import type { ToolKind } from "../truth/tools-spec.ts";
import { DraftStore } from "./draft-store.ts";
import { isFunction, isString } from "../meta/json-shape.ts";

const nativeApply = Reflect.apply;
const descriptors = Object.getOwnPropertyDescriptors(DraftStore.prototype);
const WRITES = new Set(["setValue", "deleteValue", "setFile", "deleteFile", "replaceFiles"]);
const READS = new Set([
  "getValue",
  "hasValue",
  "stateSnapshot",
  "getFile",
  "hasFile",
  "fileSnapshot",
  "snapshot",
  "checkpoint",
  "fieldProblems",
  "artifactMaterialization",
]);
const GETTERS = new Set(["seq"]);

type Lease = { active: boolean; callId: string; kind: ToolKind; toolName: string };

/** Message prefixes used to recognise DraftContractError after it crosses the worker boundary. */
const CONTRACT_TEXTS = [
  "the DraftStore tool-call lease has ended",
  "DraftStore public member ",
  "draft mutation is allowed only while",
  "draft.setArtifact is allowed only while",
];

Object.freeze(DraftStore.prototype);

/** A generated tool broke the draft contract itself — kind misuse, a lease escape, or an
 *  unknown member — as opposed to a domain error its own code chose to throw. Conformance
 *  distinguishes the two: only this class is a core contract finding. */
class DraftContractError extends Error {}

/** The worker boundary serialises only an error's message text; this restores the class on the
 *  parent side so `instanceof DraftContractError` holds across the process boundary. */
export function rehydrateDraftContractError(text: string): Error {
  const contract = CONTRACT_TEXTS.some((opening) => text.startsWith(opening));
  return contract ? new DraftContractError(text) : new Error(text);
}

function assertActive(lease: Lease): void {
  if (!lease.active) throw new DraftContractError("the DraftStore tool-call lease has ended");
}

/** Which kind of access a proxied property is, or `undefined` when the store does not own it.
 *  The order is the answer: `setArtifact` is a write the artifact-writer lease alone may make. */
function accessKind(property: string): "materialize" | "write" | "read" | "get" | undefined {
  if (property === "setArtifact") return "materialize";
  if (WRITES.has(property)) return "write";
  if (READS.has(property)) return "read";
  if (GETTERS.has(property)) return "get";
  return undefined;
}

function draftView(raw: DraftStore, lease: Lease): DraftStore {
  // Keep the target empty and non-extensible. The handler exposes only approved DraftStore
  // members and checks the lease each time, including when a tool retains a method reference.
  return new Proxy(
    /* SAFETY: the empty target stands for the DraftStore the trap serves; every read is answered by the handler below, never by the target. */ Object.preventExtensions(
      Object.create(null),
    ) as DraftStore,
    {
      get: (_target, property) => {
        if (!isString(property)) return undefined;
        const access = accessKind(property);
        if (access === undefined) return undefined;
        assertActive(lease);
        // oxlint-disable-next-line typescript/unbound-method -- the member is never called as a method; `nativeApply` below supplies `raw` as its receiver.
        const member: unknown = access === "get" ? descriptors[property]?.get : descriptors[property]?.value;
        if (!isFunction(member)) {
          throw new DraftContractError(`DraftStore public member ${property} is unavailable`);
        }
        // Reflect.apply returns `any`; the trap hands the value on without reading it.
        if (access === "get") {
          const read: unknown = nativeApply(member, raw, []);
          return read;
        }
        return (...args: unknown[]) => {
          assertActive(lease);
          if (access === "write" && lease.kind !== "writer" && lease.kind !== "artifact-writer") {
            throw new DraftContractError(
              "draft mutation is allowed only while a registered writer tool is executing",
            );
          }
          if (access === "materialize" && lease.kind !== "artifact-writer") {
            throw new DraftContractError(
              "draft.setArtifact is allowed only while a registered artifact-writer is executing",
            );
          }
          const result: unknown = nativeApply(
            member,
            raw,
            access === "materialize" ? [args[0], lease.toolName, lease.callId] : args,
          );
          return result;
        };
      },
    },
  );
}

export async function withDraftLease<T>(
  raw: DraftStore,
  kind: ToolKind,
  toolName: string,
  callId: string,
  action: (draft: DraftStore) => T | Promise<T>,
): Promise<T> {
  const lease: Lease = { active: true, callId, kind, toolName };
  try {
    return await action(draftView(raw, lease));
  } finally {
    lease.active = false;
  }
}
