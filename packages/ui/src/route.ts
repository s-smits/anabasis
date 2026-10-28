/**
 * Where the page is, as its URL says: the project, the campaign, the pane, the selected move,
 * solve, task and harness, what the inspector shows, and the token.
 *
 * v1 kept the pane in component state, so the back button left the page and no view could be
 * linked (the brief of 11 October, decision 5). Here the URL is the one record of the selection:
 * a change is pushed onto the history or replaces its entry, and `popstate` restores it. Every
 * reader of the route shares one store, so a change one component makes is the route every other
 * component renders next.
 *
 * A campaign names its project, so the URL carries the project only while no campaign is chosen: a
 * project is the opening's prompt, and written beside the campaign it made every link several
 * hundred characters long. A move, a solve and a task belong to the pane they were opened in, and
 * a change of pane clears them and closes the inspector unless it names them itself: kept, a solve
 * opened in Moves came back as the Tasks pane's open detail with its grid hidden (seen live,
 * 11 October).
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { CampaignReading } from "./models.ts";
import { TOKEN_PARAMETER } from "./models.ts";
import { keysIf } from "../../../src/meta/optional-key.ts";

/** The four panes, in the sidebar's order. */
export type Pane = "campaign" | "moves" | "tasks" | "log";

export interface Route {
  readonly project: string | null;
  /** A campaign's key (`CampaignRow.key`). */
  readonly campaign: string | null;
  readonly pane: Pane;
  /** A move's place in the log (`Move.index`): a round's Builder session and comparison share an
   *  id, and the place names one of them. */
  readonly move: number | null;
  readonly solve: string | null;
  /** A task version. */
  readonly task: string | null;
  /** A harness digest: the card selected in the lineage strip. */
  readonly harness: string | null;
  /** The inspector shows one of three: a file of `harness`, the diff of `harness`
   *  against `diff`, or the raw event at `event`. None set, it is closed. */
  readonly file: string | null;
  readonly diff: string | null;
  readonly event: number | null;
  readonly token: string | null;
}

/** A change to the route: each key given replaces its value, and `null` clears it. */
export type RouteChange = Partial<Route>;

/** What a pane is handed besides its campaign: the route and the two ways to move it. */
export interface Navigation {
  readonly route: Route;
  /** A new history entry, for a selection the back button should undo. */
  readonly push: (change: RouteChange) => void;
  /** The same entry, for a correction the back button should skip. */
  readonly replace: (change: RouteChange) => void;
}

/** The props of every pane. */
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

/** What a change of pane clears: the selections the pane held, and the inspector. */
const INSIDE_PANE = {
  move: null,
  solve: null,
  task: null,
  file: null,
  diff: null,
  event: null,
} as const satisfies RouteChange;

/** What a change of the campaign clears: every selection inside it, and the inspector. */
const INSIDE_CAMPAIGN = {
  move: null,
  solve: null,
  task: null,
  harness: null,
  file: null,
  diff: null,
  event: null,
} as const satisfies RouteChange;

const listeners = new Set<() => void>();

/** The route a query string names. An unknown pane reads as the Campaign pane, and a move or an
 *  event that is not a whole number from zero as none. */
function routeOf(search: string): Route {
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
    campaign: named("campaign"),
    pane,
    move: place("move"),
    solve: named("solve"),
    task: named("task"),
    harness: named("harness"),
    file: named("file"),
    diff: named("diff"),
    event: place("event"),
    token: named(TOKEN_PARAMETER),
  };
}

/** The query string of a route, `?` included, or "" for the bare page. The Campaign pane is the
 *  default and is not written, and the project is written only where no campaign names it. */
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
 *  inside it, and a new pane the selections of the pane it leaves, unless the change names them
 *  itself. A change that names the project and keeps the route's campaign moves nothing inside it:
 *  that is the shell writing back the project of a link that named a campaign alone. */
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

/** The route, and the two ways to change it. A page rendered without a window reads the bare
 *  route. */
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
