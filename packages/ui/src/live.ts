import bakedWorkspace from "virtual:ana-workspace";
import { useCallback, useEffect, useRef, useState } from "react";
import { poll } from "./poll.js";
import {
  PROJECT_BACKEND_ROUTE,
  type FilePayload,
  type ProjectBackendSelection,
  type ProjectBackendSlot,
  type WorkspaceSnapshot,
} from "./models.js";

export function useLiveWorkspace(intervalMs = 5_000) {
  const [workspace, setWorkspace] = useState<{ snapshot: WorkspaceSnapshot; search: string }>(() => ({
    snapshot: bakedWorkspace,
    search: window.location.search,
  }));
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const requestId = useRef(0);
  const pending = useRef<{ abort: AbortController; search: string } | null>(null);
  const reportError = useCallback((caught: unknown): void => {
    setError(caught instanceof Error ? caught.message : String(caught));
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const { search } = window.location;
    if (pending.current?.search === search) return;
    const id = ++requestId.current;
    pending.current?.abort.abort();
    const abort = new AbortController();
    pending.current = { abort, search };
    try {
      const response = await fetch(`/api/workspace${search}`, {
        cache: "no-store",
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]),
      });
      if (!response.ok) throw new Error(`workspace refresh returned HTTP ${response.status}`);
      const next =
        /* SAFETY: the workspace route serialises this contract; a shape mismatch reads as a missing panel field, never as a claim about a run. */ (await response.json()) as WorkspaceSnapshot;
      if (!mounted.current || requestId.current !== id) return;
      setWorkspace({ snapshot: next, search });
      setError(null);
    } catch (caught) {
      if (!mounted.current || requestId.current !== id) return;
      reportError(caught);
    } finally {
      if (requestId.current === id) {
        pending.current = null;
      }
    }
  }, [reportError]);

  useEffect(() => {
    mounted.current = true;
    const stop = poll(refresh, intervalMs);
    return () => {
      mounted.current = false;
      stop();
      pending.current?.abort.abort();
      pending.current = null;
    };
  }, [intervalMs, refresh]);

  return { ...workspace, error, refresh, reportError };
}

async function fetchFile(path: string, reveal = false, signal?: AbortSignal): Promise<FilePayload> {
  const query = new URLSearchParams({ path });
  if (reveal) query.set("reveal", "1");
  const response = await fetch(`/api/file?${query.toString()}`, {
    cache: "no-store",
    signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
  });
  return routeBody<FilePayload>(response, "file read");
}

/**
 * The JSON body of a route's response. A failed response throws the error its body names, or
 * `<action> returned HTTP <status>` when it names none.
 */
async function routeBody<Payload>(response: Response, action: string): Promise<Payload> {
  const value =
    /* SAFETY: every route read here returns either its payload or an error object, and the next branch reads the error form before the payload is used. */ (await response.json()) as
      | Payload
      | { error?: string };
  if (!response.ok) {
    const failure =
      /* SAFETY: a failed route answers with its error object, whose message is optional and tested before use. */ value as {
        error?: string;
      };
    throw new Error(
      "error" in failure && failure.error ? failure.error : `${action} returned HTTP ${response.status}`,
    );
  }
  return /* SAFETY: the error branch above threw, so the response carried the payload form. */ value as Payload;
}

export async function updateProjectBackend(
  projectId: string,
  slot: ProjectBackendSlot,
  selection: ProjectBackendSelection,
): Promise<void> {
  const response = await fetch(PROJECT_BACKEND_ROUTE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ana-operator-action": "set-project-backend",
    },
    body: JSON.stringify({ projectId, slot, selection }),
  });
  await routeBody<{ ok?: boolean }>(response, "project backend update");
}

export function useEvidenceFile(filePath: string | null, protectedFiles: "reveal" | "withhold") {
  const [filePayload, setFilePayload] = useState<FilePayload | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setFileError(null);
    if (filePath === null) {
      setFilePayload(null);
      setFileLoading(false);
      return;
    }
    const abort = new AbortController();
    const stop = poll(async () => {
      setFileLoading(true);
      await fetchFile(filePath, protectedFiles === "reveal", abort.signal)
        .then(
          (payload) => {
            if (active) {
              setFilePayload(payload);
              setFileError(null);
            }
          },
          (error: unknown) => {
            if (active) {
              setFileError(
                `Could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          },
        )
        .finally(() => {
          if (active) setFileLoading(false);
        });
    }, 5_000);
    return () => {
      active = false;
      stop();
      abort.abort();
    };
  }, [filePath, protectedFiles]);

  return {
    path: filePath === null ? null : (filePayload?.path ?? (fileError === null ? null : filePath)),
    payload: filePayload,
    loading: fileLoading,
    error: fileError,
  };
}
