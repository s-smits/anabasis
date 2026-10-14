import { Activity, ChevronLeft, ChevronRight, FileJson, ListChecks, ListOrdered } from "lucide-react";
import { useMemo } from "react";
import type { CampaignRow } from "../models.ts";
import type { Pane } from "../route.ts";
import { AnabasisMark, AnabasisWordmark } from "./brand.tsx";
import { Picker } from "./picker.tsx";

/** The four panes, in this order and with these labels (the brief of 11 October, decision 5). */
const NAV: readonly { readonly id: Pane; readonly label: string; readonly icon: typeof Activity }[] = [
  { id: "campaign", label: "Campaign", icon: Activity },
  { id: "moves", label: "Moves", icon: ListOrdered },
  { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "log", label: "Log", icon: FileJson },
];

/** v1's sidebar: the brand, the Project picker and the navigation, with a second picker under the
 *  first for the campaign within the project, newest first, each with its worktree as a small
 *  label, since a campaign's name repeats across worktrees, and a rehearsal's copy says so. */
export function ProjectSidebar({
  projects,
  project,
  onProject,
  campaigns,
  campaign,
  onCampaign,
  pane,
  onPane,
  collapsed,
  onCollapse,
}: {
  projects: readonly string[];
  project: string | null;
  onProject: (project: string) => void;
  /** The project's campaigns, newest first. */
  campaigns: readonly CampaignRow[];
  campaign: string | null;
  onCampaign: (key: string) => void;
  pane: Pane;
  onPane: (pane: Pane) => void;
  collapsed: boolean;
  onCollapse: () => void;
}) {
  // Memoised so that `Picker`'s own memo holds across a poll that changed nothing.
  const projectGroups = useMemo(
    () => [{ key: "projects", label: null, options: projects.map((item) => ({ value: item, label: item })) }],
    [projects],
  );
  const campaignGroups = useMemo(
    () => [
      {
        key: "campaigns",
        label: null,
        options: campaigns.map((row) => ({
          value: row.key,
          label: row.name,
          // A seeded copy of another campaign, made to rehearse on (`bun run runs seed`).
          detail: row.seed ? `${row.tree}, rehearsal copy` : row.tree,
        })),
      },
    ],
    [campaigns],
  );

  return (
    <aside className={`ana-sidebar ${collapsed ? "is-collapsed" : ""}`}>
      <div className="ana-sidebar-header">
        <button
          type="button"
          className="ana-brand"
          onClick={onCollapse}
          title="Toggle sidebar"
          aria-expanded={!collapsed}
        >
          <AnabasisMark className="ana-brand-mark" />
          <span className="ana-brand-word">
            <AnabasisWordmark />
          </span>
        </button>
        <Picker label="Project" value={project} groups={projectGroups} onChange={onProject} />
        <Picker
          label="Campaign"
          value={campaign}
          groups={campaignGroups}
          onChange={onCampaign}
          placeholder="No campaign"
        />
      </div>
      <nav className="ana-sidebar-nav" aria-label="Campaign panes">
        {NAV.map((item) => (
          <button
            type="button"
            key={item.id}
            className={`ana-nav-item ${pane === item.id ? "is-active" : ""}`}
            onClick={() => onPane(item.id)}
            aria-current={pane === item.id ? "page" : undefined}
            title={item.label}
          >
            <item.icon />
            <span className="ana-nav-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="ana-sidebar-footer">
        {/* Collapsed, the label is hidden and the icon alone would leave the button unnamed. */}
        <button
          type="button"
          className="ana-collapse-button"
          onClick={onCollapse}
          aria-label={collapsed ? "Open" : "Collapse"}
          aria-expanded={!collapsed}
          title={collapsed ? "Open the sidebar" : "Collapse the sidebar"}
        >
          {collapsed ? <ChevronRight /> : <ChevronLeft />}
          <span>{collapsed ? "Open" : "Collapse"}</span>
        </button>
      </div>
    </aside>
  );
}
