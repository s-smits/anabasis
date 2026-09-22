import type { ProjectView, RunView } from "./models.js";
import { hasText } from "../../../src/meta/text.ts";

export const PROJECT_QUERY = "project";
export const PROJECT_CACHE_KEY = "ana:last-project";

function latestStarted(project: ProjectView): number {
  return Math.max(
    -Infinity,
    ...project.runs.map((run) => Date.parse(run.startedAt ?? "")).filter(Number.isFinite),
  );
}

export function orderedProjects(projects: readonly ProjectView[]): ProjectView[] {
  return [...projects].sort(
    (left, right) => latestStarted(right) - latestStarted(left) || left.id.localeCompare(right.id),
  );
}

function liveProject(projects: readonly ProjectView[], candidate: string | null): ProjectView | null {
  if (candidate === null) return null;
  return projects.find((project) => project.id === candidate) ?? null;
}

export function resolveProject(
  projects: readonly ProjectView[],
  routeProject: string | null,
  cachedProject: string | null,
): ProjectView | null {
  const ordered = orderedProjects(projects);
  return liveProject(ordered, routeProject) ?? liveProject(ordered, cachedProject) ?? ordered[0] ?? null;
}

/** The evidence the dashboard reads: an active run first, otherwise the most recent one. Runs
 *  stopped being a selection (operator direction, 2026-07-28) — the page is about the current
 *  project, and the overview header names which run's evidence it is reading. */
export function latestRun(project: ProjectView): RunView | null {
  return (
    [...project.runs].sort((left, right) => {
      if (left.status === "active" && right.status !== "active") return -1;
      if (right.status === "active" && left.status !== "active") return 1;
      return (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
    })[0] ?? null
  );
}

export function selectionUrl(projectId: string, runId?: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set(PROJECT_QUERY, projectId);
  if (hasText(runId)) url.searchParams.set("run", runId);
  else url.searchParams.delete("run");
  return `${url.pathname}${url.search}${url.hash}`;
}
