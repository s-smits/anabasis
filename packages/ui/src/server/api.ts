import { readEvidencePage } from "./evidence.js";
import {
  type ProjectBackendSelection,
  type ProjectBackendSlot,
  setProjectBackendSelection,
} from "../../../../src/backends/project-backends.ts";
import {
  PROJECT_BACKEND_ROUTE,
  type EvidencePage,
  type FilePayload,
  type WorkspaceSnapshot,
} from "../models.js";
import { readFilePayload } from "./files.js";
import { readWorkspace } from "./readers.js";
import { asRecord, isString, type JsonValue } from "../../../../src/meta/json-shape.ts";

/** Every payload this API returns: one reader snapshot, or a one-field status object. */
type ResponsePayload = WorkspaceSnapshot | EvidencePage | FilePayload | { error: string } | { ok: true };

const BODY_LIMIT = 8_192;

/** The one write this API accepts, after the body has been checked field by field. */
type BackendSelectionRequest = {
  projectId: string;
  slot: ProjectBackendSlot;
  selection: ProjectBackendSelection;
};

function json(status: number, value: ResponsePayload, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function loopbackHost(host: string | null): boolean {
  if (host === null) return true;
  const normalized = host.trim().toLowerCase();
  const name = normalized.startsWith("[")
    ? normalized.slice(1, normalized.indexOf("]"))
    : normalized === "::1"
      ? normalized
      : normalized.split(":")[0];
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

/**
 * Evidence remains read-only. The one mutation is an explicit operator action over the runtime's
 * existing `.harness/backends/<project>.json` owner; it cannot alter generated domains or
 * historical run evidence. Every `/api/*` request ends here with a JSON answer.
 */
export async function handleApiRequest(repoRoot: string, request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!loopbackHost(request.headers.get("host"))) {
    return json(403, { error: "the observatory API is loopback-only" });
  }
  try {
    if (request.method === "GET" && url.pathname === "/api/workspace") {
      return json(
        200,
        readWorkspace(repoRoot, {
          project: url.searchParams.get("project"),
          run: url.searchParams.get("run"),
        }),
      );
    }
    if (request.method === "GET" && url.pathname === "/api/evidence") {
      return json(
        200,
        readEvidencePage(repoRoot, {
          project: url.searchParams.get("project") ?? "",
          runId: url.searchParams.get("run") ?? "",
          offset: Number(url.searchParams.get("offset") ?? "0"),
          query: url.searchParams.get("q") ?? "",
          category: url.searchParams.get("category") ?? "all",
        }),
      );
    }
    if (request.method === "GET" && url.pathname === "/api/file") {
      const path = url.searchParams.get("path");
      if (path === null) return json(400, { error: "path is required" });
      return json(
        200,
        readFilePayload(repoRoot, path, url.searchParams.get("reveal") === "1" ? "reveal" : "withhold"),
      );
    }
    if (request.method === "POST" && url.pathname === PROJECT_BACKEND_ROUTE) {
      return await updateProjectBackend(repoRoot, request);
    }
    if (request.method !== "GET") {
      return json(
        405,
        { error: "only the explicit project-backend operator action may write" },
        { allow: "GET, POST" },
      );
    }
    return json(404, { error: "unknown observatory endpoint" });
  } catch (error) {
    return json(400, { error: error instanceof Error ? error.message : String(error) });
  }
}

/** JSON.parse of a well-formed body yields JsonValue by construction; a malformed one throws. */
async function requestBody(request: Request): Promise<JsonValue> {
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > BODY_LIMIT) throw new Error(`request body exceeds ${BODY_LIMIT} bytes`);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function backendRequest(value: JsonValue): BackendSelectionRequest {
  const row = asRecord(value);
  if (row === null) {
    throw new Error("backend selection body must be an object");
  }
  const keys = Object.keys(row).sort();
  if (keys.join(",") !== "projectId,selection,slot") {
    throw new Error("backend selection body accepts exactly projectId, slot and selection");
  }
  if (!isString(row.projectId)) throw new Error("projectId must be a string");
  if (row.slot !== "builder" && row.slot !== "built" && row.slot !== "review") {
    throw new Error("slot must be builder, built or review");
  }
  if (
    row.selection !== "codex" &&
    row.selection !== "openrouter" &&
    row.selection !== "claude" &&
    row.selection !== "disabled" &&
    row.selection !== "inherit"
  ) {
    throw new Error("selection is not a known backend choice");
  }
  return { projectId: row.projectId, slot: row.slot, selection: row.selection };
}

async function updateProjectBackend(repoRoot: string, request: Request): Promise<Response> {
  try {
    if (request.headers.get("x-ana-operator-action") !== "set-project-backend") {
      return json(403, { error: "missing explicit local operator action" });
    }
    if (request.headers.get("content-type")?.startsWith("application/json") !== true) {
      return json(415, { error: "content-type must be application/json" });
    }
    const body = backendRequest(await requestBody(request));
    setProjectBackendSelection(repoRoot, body.projectId, body.slot, body.selection);
    return json(200, { ok: true });
  } catch (error) {
    return json(400, { error: error instanceof Error ? error.message : String(error) });
  }
}
