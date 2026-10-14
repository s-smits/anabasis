import { type ComponentType, memo, useEffect, useState } from "react";
import { AnabasisMark } from "./components/brand.tsx";
import { Callout } from "./components/layout.tsx";
import { Badge, NoSignal } from "./components/primitives.tsx";
import { ProjectSidebar } from "./components/project-sidebar.tsx";
import type { Live } from "./live.ts";
import type { CampaignList, CampaignReading, CampaignRow, Issue } from "./models.ts";
import type { Navigation, Pane, PaneProps, Route } from "./route.ts";
import { CampaignPane } from "./views/campaign.tsx";
import { Inspector } from "./views/inspector.tsx";
import { LogPane } from "./views/log.tsx";
import { MovesPane } from "./views/moves.tsx";
import { TasksPane } from "./views/tasks.tsx";

/*
 * The page around the panes: the sidebar with its two pickers and the four panes, the line that
 * says which tier the server answers in and which worktree the campaign is in, the selected pane,
 * and the inspector on the right. It holds no data of its own: `App.tsx` reads the campaign list
 * and the campaign and hands their answers here, so the whole shell renders from plain values; a
 * pane's own name stands in its header, not here.
 *
 * A pane and the inspector are keyed by the campaign, so that nothing a pane held for one campaign,
 * a page of the log or its filters, is asked of the next. While the campaign's answer is the
 * previous campaign's, the previous pane stays on screen as it was drawn, inert and marked busy, so
 * that no click acts on the old campaign under the new name; past `PENDING_MS` it gives way to the
 * placeholder that says the campaign is being read. Until 14 October the placeholder replaced the
 * whole pane at once, and a switch of project or campaign painted it for about 130 ms (four frames
 * of the operator's recording) before the new campaign drew: DESIGN.md keeps the previous content
 * until its replacement is ready.
 */

/** The project and the campaign the page shows, and the choices beside them. */
interface Selection {
  /** Every project, the one with the newest campaign first. */
  readonly projects: readonly string[];
  readonly project: string | null;
  /** The project's campaigns, newest first. */
  readonly campaigns: readonly CampaignRow[];
  readonly campaign: string | null;
}

/** What a campaign's pane was last drawn from. */
interface Drawn {
  readonly reading: CampaignReading;
  readonly navigation: Navigation;
}

const PANES: Readonly<Record<Pane, ComponentType<PaneProps>>> = {
  campaign: CampaignPane,
  moves: MovesPane,
  tasks: TasksPane,
  log: LogPane,
};

const TIER_LABEL = { default: "default tier", exam: "exam side" } as const;

/** How long the previous campaign's pane stands, inert, before the placeholder replaces it: a read
 *  of a campaign usually answers well inside it, so a switch paints no placeholder at all, and one
 *  that does not is said to be reading rather than leave the old campaign up indefinitely. */
const PENDING_MS = 400;

/** The selection a route names, or the newest where it names none the list holds: the route's
 *  campaign decides the project where the route names no project. */
export function selectionOf(list: CampaignList | null, route: Route): Selection {
  const rows = list?.campaigns ?? [];
  const projects = [...new Set(rows.map((row) => row.project))];
  const named = rows.find((row) => row.key === route.campaign);
  const project = projects.find((each) => each === route.project) ?? named?.project ?? projects[0] ?? null;
  const campaigns = rows.filter((row) => row.project === project);
  const campaign = campaigns.find((row) => row.key === route.campaign)?.key ?? campaigns[0]?.key ?? null;
  return { projects, project, campaigns, campaign };
}

function Issues({ issues }: { issues: readonly Issue[] }) {
  return issues.map((issue) => (
    <Callout key={`${issue.source}:${issue.message}`} tone={issue.level === "error" ? "bad" : "warn"}>
      {issue.source}: {issue.message}
    </Callout>
  ));
}

/** The pane of one campaign's reading, with the tier and the issues above it. Memoised, so that the
 *  previous campaign's pane, kept while the next is read, is not drawn again under the new route. */
const CampaignView = memo(function CampaignView({
  reading,
  navigation,
}: {
  reading: CampaignReading;
  navigation: Navigation;
}) {
  const Selected = PANES[navigation.route.pane];
  return (
    <>
      <div className="ana-record-meta">
        <Badge tone={reading.tier === "exam" ? "warn" : "neutral"}>{TIER_LABEL[reading.tier]}</Badge>
        <span>{reading.row.tree}</span>
      </div>
      <Issues issues={reading.issues} />
      <Selected key={reading.row.key} reading={reading} navigation={navigation} />
    </>
  );
});

/** The pane, or what stands in its place while the campaign has not been read. */
function Page({
  navigation,
  campaigns,
  reading,
}: {
  navigation: Navigation;
  campaigns: Live<CampaignList>;
  reading: Live<CampaignReading>;
}) {
  const fresh = reading.current ? reading.data : null;
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  useEffect(() => {
    if (fresh !== null) setDrawn({ reading: fresh, navigation });
  }, [fresh, navigation]);
  const pending = fresh === null && reading.error === null;
  const keeping = pending && drawn !== null;
  // Whether the previous campaign has stood for `PENDING_MS` while the next is read.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    setWaited(false);
    if (!keeping) return;
    const timer = setTimeout(() => setWaited(true), PENDING_MS);
    return () => clearTimeout(timer);
  }, [keeping]);
  if (campaigns.refused === "token" || campaigns.refused === "host") {
    return (
      <NoSignal title="The server refused this page" tone="bad">
        Open the address the server printed at its start: it carries the token every request needs.
      </NoSignal>
    );
  }
  if (campaigns.data === null) {
    return (
      <NoSignal title={campaigns.error === null ? "Reading the campaigns" : "No campaigns read"}>
        {campaigns.error ?? "The list of campaigns is loading."}
      </NoSignal>
    );
  }
  if (fresh !== null) return <CampaignView reading={fresh} navigation={navigation} />;
  if (keeping && !waited) {
    return (
      <div className="ana-pending" inert aria-busy="true">
        <CampaignView reading={drawn.reading} navigation={drawn.navigation} />
      </div>
    );
  }
  return (
    <NoSignal title={reading.error === null ? "Reading the campaign" : "The campaign could not be read"}>
      {reading.error ?? "The selected campaign is loading."}
    </NoSignal>
  );
}

export function Shell({
  navigation,
  campaigns,
  reading,
}: {
  navigation: Navigation;
  campaigns: Live<CampaignList>;
  reading: Live<CampaignReading>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { route, push, replace } = navigation;
  const selection = selectionOf(campaigns.data, route);
  // The URL names what is shown: a selection it left out, or one the list no longer holds, is
  // written back without a new history entry. A project read off the route's own campaign keeps
  // that campaign, so a link to a move, a solve or a task in it keeps them (`changedRoute`).
  // The project is written only while no campaign names it (`searchOf`).
  useEffect(() => {
    if (campaigns.data === null) return;
    const unnamed = selection.campaign === null && selection.project !== route.project;
    if (selection.campaign !== route.campaign || unnamed) {
      replace({ project: selection.project, campaign: selection.campaign });
    }
  }, [campaigns.data, selection.project, selection.campaign, route.project, route.campaign, replace]);

  if (campaigns.data?.campaigns.length === 0) {
    return (
      <main className="ana-empty-workspace">
        <AnabasisMark className="ana-brand-mark" />
        <h1>No campaigns found</h1>
        <p>No worktree of this repository holds a campaign log under .ana/d2.</p>
        <Issues issues={campaigns.data.issues} />
      </main>
    );
  }
  const error = reading.error ?? campaigns.error;
  const shown = reading.current ? reading.data : null;
  // The inspector stands open on what it can show: a harness's file or diff, or an event.
  const inspecting = (route.harness !== null && (route.file ?? route.diff) !== null) || route.event !== null;
  return (
    <div className={`ana-shell ${collapsed ? "is-collapsed" : ""} ${inspecting ? "has-inspector" : ""}`}>
      <a className="ana-skip-link" href="#main">
        Skip to the campaign
      </a>
      <ProjectSidebar
        projects={selection.projects}
        project={selection.project}
        onProject={(project) => {
          if (project !== selection.project) push({ project });
        }}
        campaigns={selection.campaigns}
        campaign={selection.campaign}
        onCampaign={(campaign) => push({ campaign })}
        pane={route.pane}
        onPane={(pane) => push({ pane })}
        collapsed={collapsed}
        onCollapse={() => setCollapsed((value) => !value)}
      />
      <main className="ana-main" id="main">
        <div className="ana-page">
          {error === null || shown === null ? null : (
            <Callout tone="bad">
              <strong>Refresh failed.</strong>
              <p>{error}</p>
            </Callout>
          )}
          {campaigns.data === null ? null : <Issues issues={campaigns.data.issues} />}
          <Page navigation={navigation} campaigns={campaigns} reading={reading} />
        </div>
      </main>
      {/* Keyed by the campaign the route names, so that a switch remounts it once, not twice. */}
      <Inspector key={selection.campaign ?? ""} navigation={navigation} reading={shown} />
    </div>
  );
}
