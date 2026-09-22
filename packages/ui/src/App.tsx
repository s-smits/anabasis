import { useEffect, useMemo, useState } from "react";
import { AnabasisMark } from "./components/brand.js";
import { Callout } from "./components/layout.js";
import { NoSignal } from "./components/primitives.js";
import { ProjectBackends } from "./components/project-backends.js";
import { type ObservatoryView, ProjectSidebar } from "./components/project-sidebar.js";
import { useEvidenceFile, updateProjectBackend, useLiveWorkspace } from "./live.js";
import type { ProjectBackendSelection, ProjectBackendSlot } from "./models.js";
import {
  PROJECT_CACHE_KEY,
  PROJECT_QUERY,
  latestRun,
  orderedProjects,
  resolveProject,
  selectionUrl,
} from "./project-selection.js";
import { CasesView } from "./views/cases.js";
import { EvidenceView } from "./views/evidence.js";
import { FileInspector } from "./views/file-inspector.js";
import { ForgeView } from "./views/forge.js";
import { CurrentRunView } from "./views/current-run.js";
import { hasText } from "../../../src/meta/text.ts";

function cachedProject(): string | null {
  try {
    return window.localStorage.getItem(PROJECT_CACHE_KEY);
  } catch {
    return null;
  }
}

function rememberProject(projectId: string): void {
  try {
    window.localStorage.setItem(PROJECT_CACHE_KEY, projectId);
  } catch {
    // The URL still owns the visible selection when local storage is unavailable.
  }
}

export default function App() {
  const live = useLiveWorkspace();
  const projects = useMemo(() => orderedProjects(live.snapshot.projects), [live.snapshot.projects]);
  const selection = useMemo(() => new URLSearchParams(live.search), [live.search]);
  const [view, setView] = useState<ObservatoryView>("story");
  const [collapsed, setCollapsed] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [expandFile, setExpandFile] = useState(false);
  const [filePath, setFilePath] = useState<string | null>(null);
  const file = useEvidenceFile(view === "evidence" ? filePath : null, reveal ? "reveal" : "withhold");
  const [backendSaving, setBackendSaving] = useState<ProjectBackendSlot | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);

  useEffect(() => {
    const onHistory = (): void => {
      live.refresh().catch(live.reportError);
    };
    window.addEventListener("popstate", onHistory);
    return () => window.removeEventListener("popstate", onHistory);
  }, [live.refresh, live.reportError]);

  const project = useMemo(
    () => resolveProject(projects, selection.get(PROJECT_QUERY), cachedProject()),
    [projects, selection],
  );
  const run = useMemo(
    () =>
      project === null
        ? null
        : (project.runs.find((item) => item.id === selection.get("run")) ?? latestRun(project)),
    [project, selection],
  );

  useEffect(() => {
    if (project === null) return;
    rememberProject(project.id);
    const normalized = selectionUrl(project.id, run?.id);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (normalized !== current) window.history.replaceState(null, "", normalized);
  }, [project, run]);

  useEffect(() => {
    setBackendError(null);
    setFilePath(null);
  }, [project?.id, run?.id]);

  const chooseProject = (projectId: string): void => {
    const nextProject = projects.find((item) => item.id === projectId);
    if (nextProject === undefined) return;
    rememberProject(nextProject.id);
    window.history.pushState(null, "", selectionUrl(nextProject.id));
    live.refresh().catch(live.reportError);
  };

  const saveBackend = async (slot: ProjectBackendSlot, backend: ProjectBackendSelection): Promise<void> => {
    if (project === null) return;
    setBackendSaving(slot);
    setBackendError(null);
    try {
      await updateProjectBackend(project.id, slot, backend);
      await live.refresh();
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : String(error));
    } finally {
      setBackendSaving(null);
    }
  };

  const openFile = (path: string, expanded = false): void => {
    setExpandFile(expanded);
    setView("evidence");
    setReveal(false);
    setFilePath(path);
  };

  if (project === null) {
    return (
      <main className="ana-empty-workspace">
        <AnabasisMark className="ana-brand-mark" />
        <h1>No projects found</h1>
        <p>The observatory found no campaign or adopted harness that can identify a project.</p>
        {live.snapshot.issues.map((issue) => (
          <Callout key={`${issue.source}:${issue.message}`} tone="bad">
            {issue.source}: {issue.message}
          </Callout>
        ))}
      </main>
    );
  }

  // Seven views behind two guards. As one tail, reaching the last of them meant reading through
  // six conditions; as returns, each view states the one condition it is the answer to.
  const chooseView = () => {
    if (view === "project") {
      return (
        <ProjectBackends
          project={project}
          saving={backendSaving}
          error={backendError}
          onChange={(slot, backend) => void saveBackend(slot, backend)}
        />
      );
    }
    if (run === null) {
      return (
        <NoSignal title="No run evidence yet">
          This project has produced no campaign or full-run evidence. Start Anabasis with this project id; the
          newest run then appears here.
        </NoSignal>
      );
    }
    if (run.id.startsWith("controller:") && run.outcome === undefined) {
      return (
        <NoSignal title={run.issues.length > 0 ? "Evidence could not be read" : "Reading run evidence"}>
          {run.issues.map((issue) => issue.message).join(" · ") || "The selected run is loading."}
        </NoSignal>
      );
    }
    if (view === "story") return <ForgeView run={run} onOpen={openFile} />;
    if (view === "overview") {
      return <CurrentRunView key={run.id} run={run} view={view} onOpen={(path) => openFile(path, true)} />;
    }
    if (view === "cases") return <CasesView key={run.id} run={run} onOpen={openFile} />;
    return (
      <>
        <CurrentRunView run={run} view="decision" onOpen={(path) => openFile(path, true)} />
        <EvidenceView key={run.id} run={run} selectedPath={filePath} onOpen={openFile} />
      </>
    );
  };
  const viewNode = chooseView();

  return (
    <div
      className={`ana-shell ${collapsed ? "is-collapsed" : ""} ${hasText(file.path) ? "has-inspector" : ""}`}
    >
      <a className="ana-skip-link" href="#main">
        Skip to evidence
      </a>
      <ProjectSidebar
        projects={projects}
        project={project}
        onProject={chooseProject}
        view={view}
        onView={(nextView) => {
          setFilePath(null);
          setReveal(false);
          setView(nextView);
        }}
        collapsed={collapsed}
        onCollapse={() => setCollapsed((value) => !value)}
      />
      <main className="ana-main" id="main">
        <div className="ana-page">
          {live.error === null ? null : (
            <Callout tone="bad">
              <strong>Refresh failed.</strong>
              <p>{live.error}</p>
            </Callout>
          )}
          {viewNode}
        </div>
      </main>
      <FileInspector
        expandAll={expandFile}
        path={file.path}
        payload={file.payload}
        loading={file.loading}
        error={file.error}
        onClose={() => setFilePath(null)}
        onReveal={() => setReveal(true)}
      />
    </div>
  );
}
