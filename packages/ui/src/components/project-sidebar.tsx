import {
  Activity,
  ChevronLeft,
  ChevronRight,
  FileJson,
  ListChecks,
  Hammer,
  SlidersHorizontal,
} from "lucide-react";
import { useMemo } from "react";
import type { ProjectView } from "../models.js";
import { AnabasisMark, AnabasisWordmark } from "./brand.js";
import { Picker } from "./picker.js";

export type ObservatoryView = "story" | "overview" | "cases" | "evidence" | "project";

const NAV: Array<{ id: ObservatoryView; label: string; icon: typeof Activity }> = [
  { id: "story", label: "Forge", icon: Hammer },
  { id: "overview", label: "Evals", icon: Activity },
  { id: "cases", label: "Tasks", icon: ListChecks },
  { id: "evidence", label: "Evidence", icon: FileJson },
  { id: "project", label: "Settings", icon: SlidersHorizontal },
];

export function ProjectSidebar({
  projects,
  project,
  onProject,
  view,
  onView,
  collapsed,
  onCollapse,
}: {
  projects: readonly ProjectView[];
  project: ProjectView;
  onProject: (id: string) => void;
  view: ObservatoryView;
  onView: (view: ObservatoryView) => void;
  collapsed: boolean;
  onCollapse: () => void;
}) {
  // Memoised so `Picker`'s own memo holds across the workspace poll.
  const projectGroups = useMemo(
    () => [
      { key: "projects", label: null, options: projects.map((item) => ({ value: item.id, label: item.id })) },
    ],
    [projects],
  );

  return (
    <aside className={`ana-sidebar ${collapsed ? "is-collapsed" : ""}`}>
      <div className="ana-sidebar-header">
        <button type="button" className="ana-brand" onClick={onCollapse} title="Toggle sidebar">
          <AnabasisMark className="ana-brand-mark" />
          <span className="ana-brand-word">
            <AnabasisWordmark />
          </span>
        </button>
        <Picker label="Project" value={project.id} groups={projectGroups} onChange={onProject} />
      </div>
      <nav className="ana-sidebar-nav" aria-label="Run evidence views">
        {NAV.map((item) => {
          return (
            <button
              type="button"
              key={item.id}
              className={`ana-nav-item ${view === item.id ? "is-active" : ""}`}
              onClick={() => onView(item.id)}
              aria-current={view === item.id ? "page" : undefined}
              title={item.label}
            >
              <item.icon />
              <span className="ana-nav-label">{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="ana-sidebar-footer">
        <button type="button" className="ana-collapse-button" onClick={onCollapse}>
          {collapsed ? <ChevronRight /> : <ChevronLeft />}
          <span>{collapsed ? "Open" : "Collapse"}</span>
        </button>
      </div>
    </aside>
  );
}
