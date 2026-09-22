/** The Builder slot: its served condition, the host session it opens, its shell wall evidence and
 *  its session cap. The Builder is one pi harness among the three slots; its tools, framing and
 *  turn loop are its own, and its provider layer is the one every slot shares. */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { sha256 } from "../meta/digest.ts";
import type { OpenSession } from "../author/builder-conversation.ts";
import type { BackendKind } from "../backends/backend-kinds.ts";
import {
  type PiSlotChoice,
  type PiSlotDefaults,
  type PiSlotRuntime,
  resolvePiSlot,
} from "../backends/pi-providers.ts";
import { openHostSession } from "../backends/pi-session.ts";
import { builderHostAccess } from "../builder/builder-agent-access.ts";
import type { ProjectedReadGrant } from "../builder/candidate-isolation.ts";

/** The Builder searches the public web wherever its transport can: Claude through the CLI's
 *  WebSearch builtin, Codex through the Responses search tool. The condition always pins its own
 *  effort, so the default level only names what an unpinned slot would open at. */
const BUILDER_DEFAULTS: PiSlotDefaults = { effort: "high", webSearch: true };

/** The host tool policy projection retained under the existing shellWall evidence key. Run
 * truss-opus-20260907T160200000Z-bdd329 recorded git EPERM without the rule that caused it.
 * The model receives no workspace grant: CandidateAccessPolicy enforces every host-dispatched
 * filesystem call. hostAccess and readGrant explain that policy; session isolation digests bind
 * its complete allow/deny rules. */
export interface BuilderShellWall {
  backend: BackendKind;
  execution: "host-tools";
  /** Host paths and their read, write or deny policy, sorted by path. */
  hostAccess: Record<string, "read" | "write" | "deny">;
  /** Paths authoring may read within the otherwise denied checkout. */
  readGrant: string[];
  digest: string;
}

/** The Builder slot's served condition and credential. */
export function builderSlot(condition: PiSlotChoice, repoRoot: string): PiSlotRuntime {
  return resolvePiSlot("builder", condition, BUILDER_DEFAULTS, repoRoot);
}

/** Open the Builder's host session in the round's workspace. A continued conversation keeps the
 *  session it opened, so the Claude CLI keeps working in the first round's directory; every
 *  workspace path the Builder uses is absolute, and search is the only CLI builtin it has. */
export function builderSessionOpener(slot: PiSlotRuntime, workspace: string): OpenSession {
  return (tools, systemPrompt) => openHostSession({ slot, tools, systemPrompt, cwd: workspace });
}

/** Limit one complete Builder session, not each turn. An explicit option wins, then
 * `HARNESS_BUILDER_SESSION_CAP_MS`; unset leaves no session time cap. The former six-hour
 * default was removed 2026-09-01: runs 44-46 each spent one silent six-hour turn against it and
 * produced nothing, while the no-progress rule (`builder-turn-loop.ts`), the no-submit notice
 * (`sessionClock`) and the campaign's 40-minute review interval (`builder-campaign.ts`) provide
 * progress checks during the session.
 * The review becomes due at a completed host tool call; it cannot interrupt a silent call. */
export function builderSessionCapMs(
  explicit: number | undefined,
  env: Record<string, string>,
): number | undefined {
  if (explicit !== undefined) return explicit;
  const raw = env.HARNESS_BUILDER_SESSION_CAP_MS;
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `HARNESS_BUILDER_SESSION_CAP_MS must be a positive integer of milliseconds, got "${raw}"`,
    );
  }
  return parsed;
}

export function builderShellWall(
  backend: BackendKind,
  workspace: string,
  policyRead: ProjectedReadGrant = { allow: [] },
): BuilderShellWall {
  const hostAccess = Object.fromEntries(
    Object.entries(builderHostAccess(workspace)).sort(([a], [b]) => a.localeCompare(b)),
  );
  const readGrant = [...policyRead.allow].sort();
  const execution = "host-tools";
  return {
    backend,
    execution,
    hostAccess,
    readGrant,
    digest: sha256(capturedJsonStringify({ backend, execution, hostAccess, readGrant })),
  };
}
