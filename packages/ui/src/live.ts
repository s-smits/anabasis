/**
 * One hook an endpoint: each asks the server for one answer of the contract (`models.ts`) with the
 * URL's token and keeps what it last read on screen. The previous answer stays while a refresh runs
 * and when one fails, so a stopped server leaves its last reading beside the error; a read waits
 * for the one before it (`poll.ts`); and a refresh keeps every unchanged part as the same object,
 * so an unchanged chart is not drawn again (DESIGN.md). Only the campaign list and the selected
 * campaign are polled; a detail is read when its selection changes and when the campaign's last
 * event moves (`since`). An answer to another request than the one asked now is shown as pending
 * (`current`). The last default-tier answer of each endpoint is kept in the tab's session storage,
 * so a reload starts from it while the server is read; an exam-side answer holds hidden values and
 * is never kept.
 */
import { useMemo, useState, useSyncExternalStore } from "react";
import {
  API_PREFIX,
  type AnswerOf,
  type ApiError,
  type CampaignReading,
  type Endpoint,
  PARAMETERS,
  type Query,
  type Refusal,
  TOKEN_HEADER,
} from "./models.ts";
import { poll } from "./poll.ts";
import { useRoute } from "./route.ts";
import { asRecord, isRecord, isString } from "../../../src/meta/json-shape.ts";
import { keyIfDefined } from "../../../src/meta/optional-key.ts";

export interface Live<Answer> {
  readonly data: Answer | null;
  readonly key: string | null;
  /** Whether `data` answers the request asked now; a caller treats one that does not as pending,
   *  the previous selection's. */
  readonly current: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  /** Why the server refused the last read; `exam-side` shows as a quiet placeholder. */
  readonly refused: Refusal | null;
}

export interface Of {
  readonly key: string | null;
  readonly since: string | null;
}

interface Asked {
  readonly path: string | null;
  readonly token: string | null;
  readonly polled: boolean;
  readonly since: string | null;
}

const POLL_MS = 5000;
const TIMEOUT_MS = 30_000;
const REFUSALS: readonly Refusal[] = ["token", "host", "exam-side"];
const NOTHING_READ = {
  data: null,
  key: null,
  current: false,
  loading: false,
  error: null,
  refused: null,
} as const;

class AnswerFailure extends Error {
  readonly refused: Refusal | null;
  constructor(message: string, refused: Refusal | null) {
    super(message);
    this.refused = refused;
  }
}

/**
 * One hook's reads as a store React subscribes to (`useSyncExternalStore`). A subscription is one
 * request: it reads, polls where asked and ends with its request. What the store shows outlives a
 * subscription: the last answer stays while the next request is read, and a refresh that brings the
 * same parts keeps the same objects.
 */
class Reads<Answer> {
  #state: Omit<Live<Answer>, "current"> = NOTHING_READ;
  #text: string | null = null;
  #data: Answer | null = null;

  constructor(path: string | null) {
    this.#seed(path);
  }

  readonly snapshot = (): Omit<Live<Answer>, "current"> => this.#state;

  #seed(path: string | null): void {
    const text = path === null || this.#state.key === path ? null : keptText(path);
    if (path === null || text === null) return;
    this.#text = text;
    // SAFETY: `keep` stored the text of an answer to this same path.
    this.#data = JSON.parse(text) as Answer;
    this.#state = { data: this.#data, key: path, loading: true, error: null, refused: null };
  }

  subscriber({ path, token, polled }: Asked): (notify: () => void) => () => void {
    return (notify) => {
      const show = (next: Omit<Live<Answer>, "current">): void => {
        this.#state = next;
        notify();
      };
      if (path === null) {
        this.#text = null;
        this.#data = null;
        if (this.#state !== NOTHING_READ) show(NOTHING_READ);
        return () => undefined;
      }
      this.#seed(path);
      let active = true;
      const abort = new AbortController();
      const read = async (): Promise<void> => {
        show({ ...this.#state, loading: true });
        try {
          const text = await answerText(path, token, abort.signal);
          if (!active) return;
          if (text === this.#text) {
            show({ ...this.#state, key: path, loading: false, error: null, refused: null });
            return;
          }
          this.#text = text;
          // SAFETY: the server answers this endpoint with `Answer` (`server/api.ts` routes each
          // endpoint to the handler typed by the same map), and a failed answer threw above.
          const parsed = JSON.parse(text) as Answer;
          keep(path, text, parsed);
          const before = this.#data;
          this.#data = before !== null && keptParts(before, parsed) ? before : parsed;
          show({ data: this.#data, key: path, loading: false, error: null, refused: null });
        } catch (error) {
          if (!active) return;
          const refused = error instanceof AnswerFailure ? error.refused : null;
          // `errorMessage` lives beside the process surface in `src/meta`, which a page cannot bundle.
          const message = error instanceof Error ? error.message : String(error);
          show({ ...this.#state, loading: false, error: message, refused });
        }
      };
      const stop = polled ? poll(read, POLL_MS) : null;
      // `read` settles every failure itself; the catch is for a fault in this store.
      if (stop === null) {
        read().catch((error: unknown) =>
          console.error("Read failed.", error instanceof Error ? error : String(error)),
        );
      }
      return () => {
        active = false;
        stop?.();
        abort.abort();
      };
    };
  }
}

const keptKey = (path: string): string => `ana.answer.${path.slice(API_PREFIX.length).split("?")[0] ?? ""}`;

function keptText(path: string): string | null {
  try {
    const held = window.sessionStorage.getItem(keptKey(path));
    const at = held?.indexOf("\n") ?? -1;
    return held !== null && at >= 0 && held.slice(0, at) === path ? held.slice(at + 1) : null;
  } catch {
    return null;
  }
}

function keep(path: string, text: string, answer: unknown): void {
  if (!isRecord(answer) || answer.tier !== "default") return;
  try {
    window.sessionStorage.setItem(keptKey(path), `${path}\n${text}`);
  } catch {
    // Full or closed storage keeps nothing, and the next load reads the server as before.
  }
}

function parsedArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** Whether the parsed answer `after` equals `before`; where it does not, each part equal to the
 *  same part of `before` is replaced by it, so what did not change keeps its identity. */
function keptParts(before: unknown, after: unknown): boolean {
  if (Object.is(before, after)) return true;
  if (Array.isArray(before) && parsedArray(after)) {
    let same = before.length === after.length;
    for (const [at, part] of after.entries()) {
      if (at < before.length && keptParts(before[at], part)) after[at] = before[at];
      else same = false;
    }
    return same;
  }
  if (!isRecord(before) || !isRecord(after)) return false;
  let same = Object.keys(before).length === Object.keys(after).length;
  for (const [key, part] of Object.entries(after)) {
    const kept = before[key];
    if (kept !== undefined && keptParts(kept, part)) after[key] = kept;
    else same = false;
  }
  return same;
}

function requestPath<Name extends Endpoint>(endpoint: Name, query: Query<Name>): string {
  const { required, optional } = PARAMETERS[endpoint];
  const values: Readonly<Record<string, string | undefined>> = query;
  const search = new URLSearchParams();
  for (const name of [...required, ...optional]) {
    const value = values[name];
    if (value !== undefined) search.set(name, value);
  }
  const written = search.toString();
  return `${API_PREFIX}${endpoint}${written === "" ? "" : `?${written}`}`;
}

async function answerText(path: string, token: string | null, signal: AbortSignal): Promise<string> {
  const response = await fetch(path, {
    cache: "no-store",
    headers: token === null ? {} : { [TOKEN_HEADER]: token },
    signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
  });
  const text = await response.text();
  if (response.ok) return text;
  let failure: ApiError | null = null;
  try {
    const body = asRecord(JSON.parse(text));
    const refused = REFUSALS.find((each) => each === body?.refused);
    failure = isString(body?.error) ? { error: body.error, ...keyIfDefined("refused", refused) } : null;
  } catch {
    // A body that is not JSON says nothing more than its status.
  }
  throw new AnswerFailure(
    failure?.error ?? `${path} returned HTTP ${String(response.status)}`,
    failure?.refused ?? null,
  );
}

function useAnswer<Name extends Endpoint>(
  endpoint: Name,
  query: Query<Name> | null,
  refresh: "poll" | { readonly since: string | null },
): Live<AnswerOf<Name>> {
  const { token } = useRoute().route;
  const path = query === null ? null : requestPath(endpoint, query);
  const [reads] = useState(() => new Reads<AnswerOf<Name>>(path));
  const polled = refresh === "poll";
  const since = polled ? null : refresh.since;
  const subscribe = useMemo(
    () => reads.subscriber({ path, token, polled, since }),
    [reads, path, token, polled, since],
  );
  // A page rendered to a string reads what the store holds, which is nothing read.
  const live = useSyncExternalStore(subscribe, reads.snapshot, reads.snapshot);
  return { ...live, current: path !== null && live.key === path };
}

export function useCampaigns(): Live<AnswerOf<"campaigns">> {
  return useAnswer("campaigns", {}, "poll");
}

export function useCampaign(key: string | null): Live<AnswerOf<"campaign">> {
  return useAnswer("campaign", key === null ? null : { key }, "poll");
}

export const detailsOf = ({ row }: Pick<CampaignReading, "row">): Of => ({
  key: row.key,
  since: row.lastEventAt,
});

export function useMove({ key, since }: Of, move: number | null): Live<AnswerOf<"move">> {
  return useAnswer("move", key === null || move === null ? null : { key, move: String(move) }, { since });
}

export function useSolve({ key, since }: Of, id: string | null): Live<AnswerOf<"solve">> {
  return useAnswer("solve", key === null || id === null ? null : { key, id }, { since });
}

export function useTasks({ key, since }: Of): Live<AnswerOf<"tasks">> {
  return useAnswer("tasks", key === null ? null : { key }, { since });
}

export function useTask({ key, since }: Of, id: string | null): Live<AnswerOf<"task">> {
  return useAnswer("task", key === null || id === null ? null : { key, id }, { since });
}

export function useLog({ key, since }: Of): Live<AnswerOf<"log">> {
  return useAnswer("log", key === null ? null : { key }, { since });
}

/** One raw event, which the exam tier alone answers; an event never changes once written. */
export function useEvent(key: string | null, index: number | null): Live<AnswerOf<"event">> {
  return useAnswer("event", key === null || index === null ? null : { key, index: String(index) }, {
    since: null,
  });
}

export function useHarness({ key, since }: Of, digest: string | null): Live<AnswerOf<"harness">> {
  return useAnswer("harness", key === null || digest === null ? null : { key, digest }, { since });
}

export function useHarnessFile(
  { key, since }: Of,
  digest: string | null,
  path: string | null,
): Live<AnswerOf<"harness-file">> {
  return useAnswer(
    "harness-file",
    key === null || digest === null || path === null ? null : { key, digest, path },
    { since },
  );
}

export function useHarnessDiff(
  { key, since }: Of,
  a: string | null,
  b: string | null,
): Live<AnswerOf<"harness-diff">> {
  return useAnswer("harness-diff", key === null || a === null || b === null ? null : { key, a, b }, {
    since,
  });
}
