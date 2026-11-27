/**
 * Where the page is, as its URL says: project, campaign, pane, selected move, solve, task and
 * harness, the inspector and the token. The URL is the one record of the selection: a change is
 * pushed onto the history or replaces its entry, `popstate` restores it, and every reader shares
 * one store. The URL carries the project only while no campaign is chosen, since a campaign names
 * its project. A move, solve and task belong to the pane they were opened in, and a change of pane
 * clears them and closes the inspector unless it names them itself. The browser keeps the token and
 * the campaign a URL last named: a bare URL reads with the kept token and opens the kept campaign
 * at once, beside the list rather than after it.
 */
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { type CampaignReading, TOKEN_PARAMETER } from "./models.ts";
import { keysIf } from "../../../src/meta/optional-key.ts";

export type Pane = "campaign" | "moves" | "tasks" | "log";

export interface Route {
  readonly project: string | null;
  readonly campaign: string | null;
  readonly pane: Pane;
  /** A move's place in the log (`Move.index`): a round's Builder session and comparison share an
   *  id, and the place names one of them. */
  readonly move: number | null;
  readonly solve: string | null;
  readonly task: string | null;
  readonly harness: string | null;
  /** The inspector shows a file of `harness`, the diff of `harness` against `diff`, or the raw
   *  event at `event`; none set, it is closed. */
  readonly file: string | null;
  readonly diff: string | null;
  readonly event: number | null;
  readonly token: string | null;
}

/** A change to the route: each key given replaces its value, and `null` clears it. */
export type RouteChange = Partial<Route>;

export interface Navigation {
  readonly route: Route;
  /** A new history entry, for a selection the back button should undo. */
  readonly push: (change: RouteChange) => void;
  /** The same entry, for a correction the back button should skip. */
  readonly replace: (change: RouteChange) => void;
}

export interface PaneProps {
  readonly reading: CampaignReading;
  readonly navigation: Navigation;
}

export const PANES: readonly Pane[] = ["campaign", "moves", "tasks", "log"];

/** The URL parameters in the order they are written, so a route has one spelling. */
const KEYS = [
  "project",
  "campaign",
  "pane",
  "move",
  "solve",
  "task",
  "harness",
  "file",
  "diff",
  "event",
  TOKEN_PARAMETER,
] as const;

const INSIDE_PANE = {
  move: null,
  solve: null,
  task: null,
  file: null,
  diff: null,
  event: null,
} as const satisfies RouteChange;

const INSIDE_CAMPAIGN = {
  move: null,
  solve: null,
  task: null,
  harness: null,
  file: null,
  diff: null,
  event: null,
} as const satisfies RouteChange;

/** What a view's own state is kept under: the campaign and the pane, without the token, the
 *  selection or the inspector. Keyed by the move as well, the way back from a reloaded detail would
 *  show its list unfiltered. */
const OVER_VIEW: readonly string[] = [
  TOKEN_PARAMETER,
  "move",
  "solve",
  "task",
  "harness",
  "file",
  "diff",
  "event",
];

const listeners = new Set<() => void>();

/** `value` where the URL names it, kept in this browser's storage under `key`; where it names none,
 *  the kept value. Closed storage keeps nothing. */
export function kept(key: string, value: string | null): string | null {
  try {
    if (value === null) return window.localStorage.getItem(key);
    window.localStorage.setItem(key, value);
  } catch {
    // A page rendered without a window, or a browser that keeps no storage, reads the URL alone.
  }
  return value;
}

/** `useState` that a reload keeps, in this tab's session storage under `key` and the campaign and
 *  pane named as the component mounted, so another pane or campaign starts afresh; `"every-view"`
 *  keeps one value for every view. */
export function useKept<T>(key: string, initial: T, scope: "view" | "every-view" = "view") {
  const [stored] = useState(() => {
    try {
      const query = new URLSearchParams(window.location.search);
      for (const each of OVER_VIEW) query.delete(each);
      return `ana.view.${scope === "every-view" ? "" : query.toString()}.${key}`;
    } catch {
      return null;
    }
  });
  const [value, setValue] = useState<T>(() => {
    try {
      const held = stored === null ? null : window.sessionStorage.getItem(stored);
      // SAFETY: only this hook writes under `stored`, from a value of the same `T`.
      return held === null ? initial : (JSON.parse(held) as T);
    } catch {
      return initial;
    }
  });
  try {
    if (stored !== null) window.sessionStorage.setItem(stored, JSON.stringify(value));
  } catch {
    // Closed or full storage keeps nothing, and the view still works.
  }
  return [value, setValue] as const;
}

/** The route a query string names. An unknown pane reads as the Campaign pane, and a move or an
 *  event that is not a whole number from zero as none. */
export function routeOf(search: string): Route {
  const query = new URLSearchParams(search);
  const named = (key: (typeof KEYS)[number]) => {
    const value = query.get(key);
    return value === null || value === "" ? null : value;
  };
  const place = (key: "move" | "event") => {
    const value = Number(named(key) ?? Number.NaN);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  const pane = PANES.find((each) => each === query.get("pane")) ?? "campaign";
  return {
    project: named("project"),
    campaign: named("project") === null ? kept("ana.campaign", named("campaign")) : named("campaign"),
    pane,
    move: place("move"),
    solve: named("solve"),
    task: named("task"),
    harness: named("harness"),
    file: named("file"),
    diff: named("diff"),
    event: place("event"),
    token: kept("ana.token", named(TOKEN_PARAMETER)),
  };
}

/** The query string of a route, `?` included, or "" for the bare page; the Campaign pane is not
 *  written, nor the project where a campaign names it. */
export function searchOf(route: Route): string {
  const query = new URLSearchParams();
  const shown: Route = { ...route, project: route.campaign === null ? route.project : null };
  for (const key of KEYS) {
    const pane = shown.pane === "campaign" ? null : shown.pane;
    const value = key === "pane" ? pane : shown[key];
    if (value !== null) query.set(key, String(value));
  }
  const written = query.toString();
  return written === "" ? "" : `?${written}`;
}

/** The route after `change`: a new project clears the campaign, a new campaign every selection
 *  inside it, and a new pane the selections of the pane it leaves, unless the change names them. A
 *  change naming the project that keeps the campaign moves nothing: that is the shell writing back
 *  a link's project. */
export function changedRoute(route: Route, change: RouteChange): Route {
  const projectMoved = change.project !== undefined && change.project !== route.project;
  const campaignMoved = change.campaign === undefined ? projectMoved : change.campaign !== route.campaign;
  const paneMoved = change.pane !== undefined && change.pane !== route.pane;
  return {
    ...route,
    ...keysIf(projectMoved, () => ({ campaign: null })),
    ...keysIf(campaignMoved, () => INSIDE_CAMPAIGN),
    ...keysIf(paneMoved, () => INSIDE_PANE),
    ...change,
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

function navigate(change: RouteChange, entry: "push" | "replace"): void {
  const next = searchOf(changedRoute(routeOf(window.location.search), change));
  if (next === window.location.search) return;
  const url = `${window.location.pathname}${next}${window.location.hash}`;
  if (entry === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
  for (const listener of listeners) listener();
}

export function useRoute(): Navigation {
  const search = useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => "",
  );
  const route = useMemo(() => routeOf(search), [search]);
  const push = useCallback((change: RouteChange) => navigate(change, "push"), []);
  const replace = useCallback((change: RouteChange) => navigate(change, "replace"), []);
  return useMemo(() => ({ route, push, replace }), [route, push, replace]);
}
