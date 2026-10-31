/**
 * One hook an endpoint: each asks the server for one answer of the contract (`models.ts`), with the
 * token the URL carries, and keeps what it last read on screen.
 *
 * What v1 learned stays. The previous answer stays while a refresh of the same request runs and
 * when one fails, so a server that stops leaves its last reading visible beside the error rather
 * than an empty panel. A read waits for the one before it (`poll.ts`), so a slow read cannot starve
 * its own results. And a refresh keeps every part of the last answer that it brings again unchanged
 * as the same object, so a chart whose data did not change is not drawn again on a poll that
 * changed something else (DESIGN.md: never draw a new chart on each poll).
 *
 * Only the campaign list and the selected campaign are polled: they are what changes while a
 * campaign runs. A detail is read when its selection changes, and again when the campaign's last
 * event moved (`since`), so that a detail open on a campaign that runs does not go stale. An
 * answer to another request than the one asked now, the previous selection's or the previous
 * campaign's, is no answer to it: `current` says so, and every caller shows it as pending.
 *
 * The last answer of each endpoint is also kept in the tab's session storage, and a request that
 * asks for the same path again, after a refresh or a hot reload, starts from it while the server
 * is read. Until 31 October a refresh dropped the whole page to "Reading the campaign" and then the
 * pane to "Reading the tasks" for a few hundred milliseconds, and for as long as a restarting
 * server took (operator). One answer an endpoint is kept, so a long log cannot crowd the rest out
 * of the storage, and the default tier's alone: the storage is a file on this machine, and an
 * exam-side answer holds hidden values.
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

/** What a hook holds of its endpoint. */
export interface Live<Answer> {
  /** The last answer read, kept while the next loads and when it fails; null before the first. */
  readonly data: Answer | null;
  /** The request `data` answers, as `requestPath` writes it. */
  readonly key: string | null;
  /** `data` answers the request asked now. A caller treats an answer that does not as pending: it
   *  is the previous selection's, kept only until the new one arrives. */
  readonly current: boolean;
  readonly loading: boolean;
  /** The last read's failure, cleared by the next success. */
  readonly error: string | null;
  /** Why the server refused the last read, where it did: an exam-side endpoint on a server without
   *  `--exam-side` is `exam-side`, which a pane shows as a quiet placeholder. */
  readonly refused: Refusal | null;
}

/** What a detail is read for: the campaign's key, and the time of its last event, at whose move the
 *  detail is read again (`CampaignRow.lastEventAt`). */
export interface Of {
  readonly key: string | null;
  readonly since: string | null;
}

/** What one hook asks for: a request's path, or null for none, with the token it is asked under, and
 *  whether it is polled or read once for each `since`. */
interface Asked {
  readonly path: string | null;
  readonly token: string | null;
  readonly polled: boolean;
  readonly since: string | null;
}

const POLL_MS = 5_000;
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

/** What a refused or failed request threw. */
class AnswerFailure extends Error {
  readonly refused: Refusal | null;
  constructor(message: string, refused: Refusal | null) {
    super(message);
    this.refused = refused;
  }
}

/**
 * One hook's reads across every request it is asked, as a store React subscribes to
 * (`useSyncExternalStore`). A subscription is one request: it reads, polls where asked, and ends
 * with its request, so a new request is a new subscription, which React makes after the render
 * that asked for it and before any other effect of that commit. What the store shows outlives a
 * subscription: the last answer stays on screen while the next request is read (`current` says
 * whose it is), and a refresh that brings the same text, or the same parts, keeps the same objects.
 */
class Reads<Answer> {
  #state: Omit<Live<Answer>, "current"> = NOTHING_READ;
  #text: string | null = null;
  #data: Answer | null = null;

  constructor(path: string | null) {
    this.#seed(path);
  }

  readonly snapshot = (): Omit<Live<Answer>, "current"> => this.#state;

  /** Starts `path` from the answer the tab kept for it, where the store holds no answer to it. */
  #seed(path: string | null): void {
    const text = path === null || this.#state.key === path ? null : keptText(path);
    if (path === null || text === null) return;
    this.#text = text;
    // SAFETY: `keep` stored the text of an answer to this same path.
    this.#data = JSON.parse(text) as Answer;
    this.#state = { data: this.#data, key: path, loading: true, error: null, refused: null };
  }

  /** The subscription that reads `asked`, for React to start after it renders the request. */
  subscriber({ path, token, polled }: Asked): (notify: () => void) => () => void {
    return (notify) => {
      const show = (next: Omit<Live<Answer>, "current">): void => {
        this.#state = next;
        notify();
      };
      // A selection cleared clears its answer, as v1's inspector did: nothing is asked for.
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
        } catch (caught) {
          if (!active) return;
          const refused = caught instanceof AnswerFailure ? caught.refused : null;
          // `errorMessage` lives beside the process surface in `src/meta`, which a page cannot bundle.
          const error = caught instanceof Error ? caught.message : String(caught);
          show({ ...this.#state, loading: false, error, refused });
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

/** Where an endpoint's last answer is kept, written as its path, a line break and its text. */
const keptKey = (path: string): string => `ana.answer.${path.slice(API_PREFIX.length).split("?")[0] ?? ""}`;

/** The text the tab kept for `path`, or null. Closed storage keeps nothing. */
function keptText(path: string): string | null {
  try {
    const held = window.sessionStorage.getItem(keptKey(path));
    const at = held?.indexOf("\n") ?? -1;
    return held !== null && at >= 0 && held.slice(0, at) === path ? held.slice(at + 1) : null;
  } catch {
    return null;
  }
}

/** Keeps a default-tier answer to `path` for the next page load of this tab. */
function keep(path: string, text: string, answer: unknown): void {
  if (!isRecord(answer) || answer.tier !== "default") return;
  try {
    window.sessionStorage.setItem(keptKey(path), `${path}\n${text}`);
  } catch {
    // Full or closed storage keeps nothing, and the next load reads the server as before.
  }
}

/** A list of a parsed answer, which the parse made and nothing else holds yet, so it may be written. */
function parsedArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** Whether the parsed answer `after` equals `before`. Where it does not, each part of it that equals
 *  the same part of `before` is replaced in place by that part, so that what did not change keeps
 *  its identity across a refresh. */
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

/** An endpoint's path and query, the parameters in the contract's order. */
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

/** The text of an answer, or the failure its error body names. */
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

/** One endpoint read for `query`, or nothing while `query` is null; polled, or read again whenever
 *  `since` moves. */
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

/** Every campaign in the repository's worktrees, polled. */
export function useCampaigns(): Live<AnswerOf<"campaigns">> {
  return useAnswer("campaigns", {}, "poll");
}

/** One campaign's reading, polled while it is selected. */
export function useCampaign(key: string | null): Live<AnswerOf<"campaign">> {
  return useAnswer("campaign", key === null ? null : { key }, "poll");
}

/** What a campaign's details are read for. */
export const detailsOf = ({ row }: Pick<CampaignReading, "row">): Of => ({
  key: row.key,
  since: row.lastEventAt,
});

/** One move, by its place in the log. */
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

/** The log as a timeline. */
export function useLog({ key, since }: Of): Live<AnswerOf<"log">> {
  return useAnswer("log", key === null ? null : { key }, { since });
}

/** One raw event, which the exam tier alone answers. An event never changes once written. */
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
