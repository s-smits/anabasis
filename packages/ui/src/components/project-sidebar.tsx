import {
  Activity,
  ChevronLeft,
  ChevronRight,
  FileJson,
  FolderSearch,
  ListChecks,
  ListOrdered,
} from "lucide-react";
import { useMemo } from "react";
import { keyIfDefined } from "../../../../src/meta/optional-key.ts";
import { countBy } from "../../../../src/meta/tally.ts";
import type { CampaignRow } from "../models.ts";
import type { Pane } from "../route.ts";
import { tallyText } from "../views/campaign-data.ts";
import { standing } from "../views/format.ts";
import { AnabasisMark, AnabasisWordmark } from "./brand.tsx";
import { Picker } from "./picker.tsx";

const NAV: readonly { readonly id: Pane; readonly label: string; readonly icon: typeof Activity }[] = [
  { id: "campaign", label: "Campaign", icon: Activity },
  { id: "moves", label: "Moves", icon: ListOrdered },
  { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "log", label: "Log", icon: FileJson },
];

function shortName(row: CampaignRow): string {
  const prefix = `${row.project}-`;
  return row.name.startsWith(prefix) && row.name.length > prefix.length
    ? row.name.slice(prefix.length)
    : row.name;
}

/** The campaigns grouped by project, in the list's order of projects, running ones first; each
 *  option says its state, last reading and, where its name repeats, its worktree. */
function groupsOf(campaigns: readonly CampaignRow[], now: number) {
  const repeated = countBy(campaigns, (row) => row.name);
  const projects = [...new Set(campaigns.map((row) => row.project))];
  return projects.map((project) => {
    const rows = campaigns.filter((row) => row.project === project);
    const ordered = [
      ...rows.filter((row) => row.status === "running"),
      ...rows.filter((row) => row.status !== "running"),
    ];
    return {
      key: project,
      label: project,
      options: ordered.map((row) => {
        const last = row.lastReading;
        const reading = last === null ? null : `${last.id} ${last.reading} ${tallyText(last.tally)}`;
        const notes = [reading, (repeated[row.name] ?? 0) > 1 ? row.tree : null].filter(
          (note) => note !== null,
        );
        return {
          value: row.key,
          label: shortName(row),
          detail: standing(row, now),
          ...keyIfDefined("note", notes.length > 0 ? notes.join(" · ") : undefined),
        };
      }),
    };
  });
}

export function ProjectSidebar({
  campaigns,
  campaign,
  onCampaign,
  pane,
  onPane,
  collapsed,
  onCollapse,
}: {
  campaigns: readonly CampaignRow[] | null;
  campaign: string | null;
  onCampaign: (key: string) => void;
  pane: Pane;
  onPane: (pane: Pane) => void;
  collapsed: boolean;
  onCollapse: () => void;
}) {
  // Memoised so that `Picker`'s own memo holds across a poll that changed nothing; the ages it says
  // move with the list's poll.
  const groups = useMemo(() => groupsOf(campaigns ?? [], Date.now()), [campaigns]);
  const current = campaigns?.find((row) => row.key === campaign);
  const shown = useMemo(
    () => (current === undefined ? undefined : { label: current.name, detail: current.project }),
    [current],
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
        <Picker
          label="Campaign"
          value={campaign}
          groups={groups}
          onChange={onCampaign}
          placeholder={campaigns === null ? "Reading campaigns" : "No campaigns"}
          filtered
          icon={FolderSearch}
          {...keyIfDefined("shown", shown)}
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
