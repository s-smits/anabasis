import { existsSync } from "../../../../src/meta/filesystem.ts";
import { basename, join, resolve } from "../../../../src/meta/path.ts";
import { type RepoEnv, loadRepoEnv } from "../../../../src/backends/env.ts";
import {
  operatorBackendsPath,
  projectBackendChoices,
  resolveSlots,
} from "../../../../src/backends/resolve.ts";
import type {
  ProjectBackendSlotView,
  ProjectBackendsView,
  ProjectView,
  RunView,
  WorkspaceSnapshot,
} from "../models.js";
import { controllerRuns, hydrateControllerRun, type RunSelection } from "./current.js";

const SLOT_LABELS = {
  builder: "Harness Builder",
  built: "Built Harness",
  review: "Reviewers",
} as const;

function projectBackends(repoRoot: string, projectId: string, repoEnv: RepoEnv): ProjectBackendsView {
  const absolutePath = operatorBackendsPath(repoRoot, projectId);
  const path = absolutePath.slice(repoRoot.length + 1);
  try {
    const resolved = resolveSlots(repoRoot, projectId, repoEnv);
    const slots: ProjectBackendSlotView[] = [
      {
        slot: "builder",
        label: SLOT_LABELS.builder,
        enabled: true,
        selection: resolved.builder.kind,
        kind: resolved.builder.kind,
        model: resolved.builder.model ?? null,
        reasoningEffort: resolved.builder.reasoningEffort ?? null,
        source: resolved.builder.source,
        choices: projectBackendChoices("builder"),
      },
      {
        slot: "built",
        label: SLOT_LABELS.built,
        enabled: true,
        selection: resolved.built.kind,
        kind: resolved.built.kind,
        model: resolved.built.model ?? null,
        reasoningEffort: resolved.built.reasoningEffort ?? null,
        source: resolved.built.source,
        choices: projectBackendChoices("built"),
      },
      resolved.review.enabled
        ? {
            slot: "review",
            label: SLOT_LABELS.review,
            enabled: true,
            selection: resolved.review.source === "inherited-explicit" ? "inherit" : resolved.review.kind,
            kind: resolved.review.kind,
            model: resolved.review.model ?? null,
            reasoningEffort: resolved.review.reasoningEffort ?? null,
            source: resolved.review.source,
            choices: projectBackendChoices("review"),
          }
        : {
            slot: "review",
            label: SLOT_LABELS.review,
            enabled: false,
            selection: "disabled",
            kind: null,
            model: null,
            reasoningEffort: null,
            source: "unconfigured",
            choices: projectBackendChoices("review"),
          },
    ];
    return { path, slots, error: null };
  } catch (error) {
    return {
      path,
      slots: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function currentWorkspace(
  repoRoot: string,
  runs: RunView[],
  selection: RunSelection,
  repoEnv: RepoEnv,
): WorkspaceSnapshot {
  const selected =
    runs.find((run) => run.projectId === selection.project && run.id === selection.run) ??
    runs.find((run) => run.projectId === selection.project) ??
    runs[0];
  if (selected !== undefined) hydrateControllerRun(repoRoot, selected);
  const projects: ProjectView[] = [...new Set(runs.map((run) => run.projectId))].map((id) => ({
    id,
    adopted: existsSync(join(repoRoot, "domains", id, "agent")),
    backends: projectBackends(repoRoot, id, repoEnv),
    runs: runs.filter((run) => run.projectId === id),
    issues: runs.filter((run) => run.projectId === id).flatMap((run) => run.issues),
  }));
  const issues = projects.flatMap((project) => project.issues);
  return {
    schema: "ana-observatory/v2",
    generatedAt: new Date().toISOString(),
    repository: basename(repoRoot),
    repositoryPath: repoRoot,
    state: issues.some((issue) => issue.level === "error")
      ? "invalid"
      : projects.length === 0
        ? "empty"
        : "ready",
    projects,
    issues,
  };
}

export function readWorkspace(
  repoRootInput: string,
  selection: RunSelection = { project: null, run: null },
): WorkspaceSnapshot {
  const repoRoot = resolve(repoRootInput);
  return currentWorkspace(repoRoot, controllerRuns(repoRoot), selection, loadRepoEnv(repoRoot));
}
