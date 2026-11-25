import { type ComponentType, memo, useState } from "react";
import { AnabasisMark } from "./components/brand.tsx";
import { Callout, IssueCallout } from "./components/layout.tsx";
import { Badge, NoSignal } from "./components/primitives.tsx";
import { ProjectSidebar } from "./components/project-sidebar.tsx";
import type { Live } from "./live.ts";
import type { CampaignList, CampaignReading, Issue } from "./models.ts";
import { kept, type Navigation, type Pane, type PaneProps, type Route, useKept } from "./route.ts";
import { respelled, SpelledAddress } from "./spelling.ts";
import { CampaignPane } from "./views/campaign.tsx";
import { Inspector } from "./views/inspector.tsx";
import { LogPane } from "./views/log.tsx";
import { MovesPane } from "./views/moves.tsx";
import { TasksPane } from "./views/tasks.tsx";
import { useWaited } from "./waited.ts";

// The page around the panes: the sidebar with its picker and panes, the tier and worktree line, the
// selected pane and the inspector. It holds no data of its own: `App` in `main.tsx` reads the list and
// the campaign and hands their answers here. A pane and the inspector are keyed by the campaign, so
// nothing held for one campaign is asked of the next. While the campaign's answer is the previous
// one's, the previous pane stays as drawn, inert and marked busy, until the page's patience runs out
// (`waited.ts`): DESIGN.md keeps content until its replacement is ready.

interface Selection {
  readonly project: string | null;
  readonly campaign: string | null;
}

interface Drawn {
  readonly reading: CampaignReading;
  readonly navigation: Navigation;
}

/** The issues this browser dismissed, one `source: message` a line, so the warning that the server
 *  runs in another checkout does not stand over every pane; another worktree's issue names another
 *  source, so it shows. */
const DISMISSED = "ana.dismissed";

const PANES: Readonly<Record<Pane, ComponentType<PaneProps>>> = {
  campaign: CampaignPane,
  moves: MovesPane,
  tasks: TasksPane,
  log: LogPane,
};

const TIER_LABEL = { default: "default tier", exam: "exam side" } as const;

/** The selection a route names, or the newest the list holds where it names none; a route naming a
 *  project alone selects its newest campaign. Before the list is read the route's campaign stands
 *  as it is, so a linked campaign is read at once. */
export function selectionOf(list: CampaignList | null, route: Route): Selection {
  if (list === null) return { project: route.project, campaign: route.campaign };
  const rows = list.campaigns;
  const named = rows.find((row) => row.key === route.campaign);
  const chosen = named ?? rows.find((row) => row.project === route.project) ?? rows[0];
  return { project: chosen?.project ?? null, campaign: chosen?.key ?? null };
}

function Issues({ issues }: { issues: readonly Issue[] }) {
  const [dismissed, setDismissed] = useState(() => new Set((kept(DISMISSED, null) ?? "").split("\n")));
  return issues.flatMap((issue) => {
    const said = `${issue.source}: ${issue.message}`;
    if (dismissed.has(said)) return [];
    const dismiss = () => {
      const next = new Set(dismissed).add(said);
      kept(DISMISSED, [...next].filter(Boolean).join("\n"));
      setDismissed(next);
    };
    return [<IssueCallout key={said} issue={issue} onDismiss={dismiss} />];
  });
}

/** The pane of one campaign's reading, with the tier and the issues above it. Memoised, so the
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
  // The last campaign drawn, kept in render as each fresh one arrives, so a switch has it to hold.
  if (fresh !== null && (drawn?.reading !== fresh || drawn.navigation !== navigation)) {
    setDrawn({ reading: fresh, navigation });
  }
  const pending = fresh === null && reading.error === null;
  const keeping = pending && drawn !== null;
  const waited = useWaited(keeping ? "campaign" : null);
  if (campaigns.refused === "token" || campaigns.refused === "host") {
    return (
      <NoSignal title="The server refused this page" tone="bad">
        Open the address the server printed at its start: it carries the token every request needs.
      </NoSignal>
    );
  }
  if (fresh !== null) return <CampaignView reading={fresh} navigation={navigation} />;
  if (campaigns.data === null && (navigation.route.campaign === null || campaigns.error !== null)) {
    return (
      <NoSignal title={campaigns.error === null ? "Reading the campaigns" : "No campaigns read"}>
        {campaigns.error ?? "The list of campaigns is loading"}
      </NoSignal>
    );
  }
  if (keeping && !waited) {
    return (
      <div className="ana-pending" inert aria-busy="true">
        <CampaignView reading={drawn.reading} navigation={drawn.navigation} />
      </div>
    );
  }
  return (
    <NoSignal title={reading.error === null ? "Reading the campaign" : "The campaign could not be read"}>
      {reading.error ?? "The selected campaign is loading"}
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
  const [collapsed, setCollapsed] = useKept("sidebar.collapsed", false, "every-view");
  const { route, push } = navigation;
  const selection = selectionOf(campaigns.data, route);
  const spelled = { project: selection.project, campaign: selection.campaign, navigation };
  const respelling = campaigns.data === null ? null : respelled(spelled);
  const spell = respelling === null ? null : <SpelledAddress key={respelling} {...spelled} />;

  if (campaigns.data?.campaigns.length === 0) {
    return (
      <main className="ana-empty-workspace">
        {spell}
        <AnabasisMark className="ana-brand-mark" />
        <h1>No campaigns found</h1>
        <p>No worktree of this repository holds a campaign log under .ana/d2.</p>
        <Issues issues={campaigns.data.issues} />
      </main>
    );
  }
  const error = reading.error ?? campaigns.error;
  const shown = reading.current ? reading.data : null;
  const inspecting = (route.harness !== null && (route.file ?? route.diff) !== null) || route.event !== null;
  return (
    <div className={`ana-shell ${collapsed ? "is-collapsed" : ""} ${inspecting ? "has-inspector" : ""}`}>
      {spell}
      <a className="ana-skip-link" href="#main">
        Skip to the campaign
      </a>
      <ProjectSidebar
        campaigns={campaigns.data?.campaigns ?? (campaigns.error === null ? null : [])}
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
              <strong>Refresh failed</strong>
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
