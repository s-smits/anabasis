import { afterAll, beforeAll, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { reported } from "../../../src/builder/comparison.ts";
import { read as readLog } from "../../../src/kernel/log.ts";
import { mkdtempSync, realpathSync, rmSync } from "../../../src/meta/filesystem.ts";
import { tmpdir } from "../../../src/meta/os.ts";
import { join } from "../../../src/meta/path.ts";
import type { Live } from "../src/live.ts";
import type { ComparisonDetail, SessionDetail, Tier } from "../src/models.ts";
import { type Navigation, routeOf } from "../src/route.ts";
import { Shell, selectionOf } from "../src/shell.tsx";
import { FileInspector } from "../src/views/file-inspector.tsx";
import { DiffView, Inspector } from "../src/views/inspector.tsx";
import { LogList } from "../src/views/log-list.tsx";
import { ComparisonDetailView } from "../src/views/moves-comparison.tsx";
import { SessionDetailView } from "../src/views/moves-session.tsx";
import { SolveDetailView } from "../src/views/solve.tsx";
import { TaskDetailView } from "../src/views/tasks-detail.tsx";
import { answersOver, type Fixture, writeFixtureCampaign } from "./fixture-campaign.ts";

/*
 * The Moves, Tasks and Log panes and their details, rendered in both tiers from the answers the
 * server's handlers give of the fixture's main campaign. A detail is read by a hook the static
 * render cannot run, so each detail view is rendered from the handler's own answer, as the hook
 * would hand it over.
 *
 * Exam-side content is only ever tested for with `includes`, never with `toContain`: a failing
 * `toContain` prints the page it searched, and in the default tier that page must hold none of it.
 */

const EXAM_LINE = "The exam side holds";
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-ui-panes-")));
let fixture: Fixture;

beforeAll(() => {
  fixture = writeFixtureCampaign(join(scratch, "main"));
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A hook's state once its answer has arrived. */
function arrived<Answer>(data: Answer): Live<Answer> {
  return { data, key: "sample", current: true, loading: false, error: null, refused: null };
}

function navigationAt(search: string): Navigation {
  return { route: routeOf(search), push: () => {}, replace: () => {} };
}

const answers = (tier: Tier) => answersOver(fixture.root, tier);
const readingIn = (tier: Tier) => answers(tier).campaign(fixture.key);

/** The shell over the handlers' answers at `search`. */
function shellAt(search: string, tier: Tier = "default"): string {
  const campaigns = answers(tier).campaigns();
  const navigation = navigationAt(search);
  const { campaign } = selectionOf(campaigns, navigation.route);
  const reading = answers(tier).campaign(campaign ?? "");
  return renderToStaticMarkup(
    <Shell navigation={navigation} campaigns={arrived(campaigns)} reading={arrived(reading)} />,
  );
}

/** A move of the main campaign by its step and id, as its place in the log names it. */
function placeOf(step: "examiner" | "builder" | "comparison", id: string): number {
  const move = readingIn("default").moves.find((each) => each.step === step && each.id === id);
  if (move === undefined) throw new Error(`no ${step} ${id} in the fixture`);
  return move.index;
}

function sessionIn(step: "examiner" | "builder", id: string, tier: Tier): SessionDetail {
  const detail = answers(tier).move(fixture.key, String(placeOf(step, id)));
  if (detail.kind !== "session") throw new Error(`${id} is no session in the fixture`);
  return detail;
}

function comparisonIn(id: string, tier: Tier): ComparisonDetail {
  const detail = answers(tier).move(fixture.key, String(placeOf("comparison", id)));
  if (detail.kind !== "comparison") throw new Error(`${id} is no comparison in the fixture`);
  return detail;
}

function solveHtml(id: string, tier: Tier): string {
  return renderToStaticMarkup(
    <SolveDetailView
      detail={answers(tier).solve(fixture.key, id)}
      reading={readingIn(tier)}
      navigation={navigationAt(`?pane=moves&solve=${id}`)}
      back={{ solve: null }}
      backLabel="Back to moves"
    />,
  );
}

test("the shell names the worktree and the tier above a pane, and leaves the campaign's name to the pane", () => {
  const html = shellAt("?pane=moves");
  const meta = /<div class="ana-record-meta">(.*?)<\/div>/.exec(html)?.[1] ?? "";
  expect(meta).toContain("default tier");
  expect(meta).toContain("<span>main</span>");
  expect(meta.includes(fixture.name)).toBe(false);
});

test("the Log pane holds the reader collapsed above a page of events, and says in one quiet line what the tier withholds", () => {
  const reading = readingIn("default");
  const shell = shellAt("?pane=log");
  expect(shell).toContain(
    `The reader: ${String(reading.reader.rows.length)} rows, ${String(reading.reader.triggers.length)} triggers`,
  );
  expect(shell).not.toContain('<details class="ana-disclosure" open');
  expect(reading.reader.withheld).toBeGreaterThan(0);
  expect(shell).toContain(`${EXAM_LINE} ${String(reading.reader.withheld)} triggers of its lanes 1 to 12`);
  // An expected absence is no issue, and no callout stands above the pane for it.
  expect(reading.issues).toEqual([]);
  expect(shell.includes("ana-callout--warn")).toBe(false);
  const exam = shellAt("?pane=log", "exam");
  expect(readingIn("exam").reader.withheld).toBe(0);
  expect(exam.includes(`${EXAM_LINE} `)).toBe(false);
  const page = answers("default").log({ key: fixture.key });
  const html = renderToStaticMarkup(
    <LogList
      page={page}
      offset={0}
      reading={false}
      filters={{ kind: "all", session: "all" }}
      onFilters={() => {}}
      onOffset={() => {}}
      selected={3}
      onOpen={() => {}}
    />,
  );
  expect(html.match(/data-row="/g)?.length).toBe(100);
  expect(html).toContain(`1–100 of ${String(page.matching)} events`);
  expect(html).toContain('class="is-selected"');
  expect(html).toContain("campaign.opened");
});

test("an Examiner session's turns are on the exam side: a quiet line in the default tier, the turns in the exam tier", () => {
  const exam = sessionIn("examiner", "x-1", "exam");
  const shown = renderToStaticMarkup(
    <SessionDetailView detail={exam} reading={readingIn("exam")} navigation={navigationAt("?pane=moves")} />,
  );
  const hidden = renderToStaticMarkup(
    <SessionDetailView
      detail={sessionIn("examiner", "x-1", "default")}
      reading={readingIn("default")}
      navigation={navigationAt("?pane=moves")}
    />,
  );
  expect(hidden).toContain(`${EXAM_LINE} an Examiner session&#x27;s turns and calls`);
  expect(hidden.includes("Turn 1")).toBe(false);
  const said = (exam.turns ?? []).map((turn) => turn.text);
  expect(said.length).toBeGreaterThan(0);
  expect(said.some((text) => hidden.includes(text))).toBe(false);
  expect(said.every((text) => shown.includes(text))).toBe(true);
  expect(shown.includes(EXAM_LINE)).toBe(false);
});

test("a comparison shows its split, one row a scored task with each side's solves, and its rulings as the tier allows", () => {
  const tier = "default";
  const detail = comparisonIn("c-1", tier);
  const html = renderToStaticMarkup(
    <ComparisonDetailView
      detail={detail}
      reading={readingIn(tier)}
      navigation={navigationAt("?pane=moves")}
    />,
  );
  expect(html).toContain(`Scored tasks (${String(detail.tasks.length)})`);
  for (const task of detail.tasks) expect(html).toContain(`>${task.taskId ?? ""}</button>`);
  const solves = detail.tasks.flatMap((task) => [...task.old, ...task.fresh]);
  for (const row of solves) expect(html).toContain(`data-row="${row.id}"`);
  expect(html).toContain("Set aside for a label");
  expect(html).toContain("ruled on the exam side");
  expect(detail.tasks.some((task) => task.withheld === "label")).toBe(true);
  expect(html).toContain("withheld while its rejection waits for a person");
  expect(html).toContain(`The reader&#x27;s triggers (${String(detail.triggers.length)})`);
  expect(html).toContain("Terms fixed before the first solve");
  // The setting is named by its short hash in running text; the whole id is one click away.
  const setting = detail.terms.setting ?? "";
  expect(setting).toHaveLength(64);
  expect(html.replaceAll(/<[^>]*>/g, " ").includes(setting)).toBe(false);
  expect(html).toContain(`title="${setting}"`);
  const exam = renderToStaticMarkup(
    <ComparisonDetailView
      detail={comparisonIn("c-1", "exam")}
      reading={readingIn("exam")}
      navigation={navigationAt("?pane=moves")}
    />,
  );
  expect(exam.includes("ruled on the exam side")).toBe(false);
  expect(exam).toContain("ana-badge--bad");
});

test("a held-out solve's trace, verdict and ruling are on the exam side, each in its place, and open in the exam tier", () => {
  const id = fixture.ruledSolve;
  const exam = answers("exam").solve(fixture.key, id);
  const hidden = solveHtml(id, "default");
  expect(hidden).toContain(`${EXAM_LINE} the trace of a held-out task&#x27;s solve`);
  expect(hidden).toContain(`${EXAM_LINE} the verdict`);
  expect(hidden).toContain(`${EXAM_LINE} the Referee&#x27;s ruling`);
  const reason = exam.ruling?.reason ?? "";
  expect(reason).not.toBe("");
  expect(hidden.includes(reason)).toBe(false);
  expect(hidden.includes("Refused by")).toBe(false);
  expect(hidden.includes("Turn 1")).toBe(false);
  const shown = solveHtml(id, "exam");
  expect(shown.includes(EXAM_LINE)).toBe(false);
  expect(shown.includes(reason)).toBe(true);
  expect(shown).toContain("Refused by");
  expect(shown).toContain("Turn 1");
});

test("a held-out task's text and hidden values are on the exam side; a practice task's text is shown in either tier", () => {
  const grid = answers("default").tasks(fixture.key);
  const versionOf = (id: string) => grid.rows.find((row) => row.id === id)?.version ?? "";
  const taskHtml = (id: string, tier: Tier) =>
    renderToStaticMarkup(
      <TaskDetailView
        detail={answers(tier).task(fixture.key, versionOf(id))}
        grid={grid}
        reading={readingIn(tier)}
        navigation={navigationAt(`?pane=tasks&task=${versionOf(id)}`)}
      />,
    );
  const exam = answers("exam").task(fixture.key, versionOf("word-01"));
  // The task's text is its string leaves: each one is long enough not to occur in the page by chance.
  const secrets = [...JSON.stringify(exam.input ?? null).matchAll(/:"([^"]{6,})"/g)].map(
    (match) => match[1] ?? "",
  );
  expect(secrets.length).toBeGreaterThan(0);
  const hidden = taskHtml("word-01", "default");
  expect(hidden).toContain(`${EXAM_LINE} a held-out task&#x27;s text`);
  expect(hidden.includes("Family and hidden values")).toBe(false);
  expect(secrets.some((word) => hidden.includes(word))).toBe(false);
  const scored = grid.rows.find((row) => row.id === "word-01")?.cells.filter((cell) => cell !== null).length;
  expect(hidden).toContain(`In ${String(scored)} of ${String(grid.columns.length)} comparisons`);
  expect(hidden).toContain(`Solves (${String(exam.solves.length)})`);
  const shown = taskHtml("word-01", "exam");
  expect(shown).toContain("Family and hidden values");
  expect(shown.includes(EXAM_LINE)).toBe(false);
  expect(secrets.every((text) => shown.includes(text))).toBe(true);
  expect(taskHtml("word-p1", "default").includes(EXAM_LINE)).toBe(false);
});

test("the inspector renders a diff per file with each line signed, a file under its harness's name, and an event's place", () => {
  const reading = readingIn("default");
  const { a, b } = fixture.harnesses;
  const diff = answers("default").harnessDiff(fixture.key, a, b);
  const html = renderToStaticMarkup(<DiffView diff={diff} />);
  expect(html.match(/class="ana-diff-file"/g)?.length).toBe(diff.files.length);
  expect(html).toContain('aria-label="add">+</td>');
  expect(html).toContain('aria-label="remove">−</td>');
  expect(html).toContain(">changed</span>");
  const cut = { ...diff, files: [{ path: "agent/lines.txt", change: "changed", diff: null } as const] };
  expect(renderToStaticMarkup(<DiffView diff={cut} />)).toContain('<span class="ana-num">not diffed</span>');
  const event = renderToStaticMarkup(
    <Inspector navigation={navigationAt("?pane=log&event=3")} reading={reading} />,
  );
  expect(event).toContain(`${EXAM_LINE} a raw event&#x27;s payload`);
  expect(event.includes("ana-callout--bad")).toBe(false);
  const file = renderToStaticMarkup(
    <Inspector
      navigation={navigationAt(`?pane=campaign&harness=${b}&file=agent%2FBUILT_AGENTS.md`)}
      reading={reading}
    />,
  );
  expect(file).toContain("Harness file");
  expect(file).toContain("/ agent/BUILT_AGENTS.md");
  const read = answers("default").harnessFile(fixture.key, b, "agent/BUILT_AGENTS.md");
  const shown = renderToStaticMarkup(
    <FileInspector
      label="Harness file"
      path="agent/BUILT_AGENTS.md"
      payload={{ content: read.content, value: read.value, truncated: read.truncated, bytes: read.bytes }}
      loading={false}
      error={null}
      onClose={() => {}}
    />,
  );
  expect(shown).toContain("# Guide");
});

test("a comparison names the tasks its report left out under the split, and one with no report lists its fixed tasks with no outcome", () => {
  const render = (id: string, tier: Tier) =>
    renderToStaticMarkup(
      <ComparisonDetailView
        detail={comparisonIn(id, tier)}
        reading={readingIn(tier)}
        navigation={navigationAt("?pane=moves")}
      />,
    );
  expect(render("b-2", "default")).toContain("5 tasks scored of 6 the comparison fixed; 1 disputed.");
  const settled = render("b-2", "exam");
  expect(settled).toContain("1 earned · 1 check defect · 1 unclear");
  for (const tier of ["default", "exam"] as const) {
    const open = render("b-4", tier);
    expect(open).toContain("Tasks fixed (3)");
    expect(open.match(/>no report yet</g)?.length).toBe(3);
    expect(open).toContain("1 rejection ruled; the kinds stay hidden while any ruling is withheld");
    expect(open).toContain("1 rejection, withheld until its comparison reports");
    expect(open.includes(">earned<")).toBe(false);
  }
});

test("a comparison says beside its test what the test could see, read off its report, and one with no report says nothing of it", () => {
  const events = readLog(fixture.log);
  const render = (id: string) =>
    renderToStaticMarkup(
      <ComparisonDetailView
        detail={comparisonIn(id, "default")}
        reading={readingIn("default")}
        navigation={navigationAt("?pane=moves")}
      />,
    );
  // A repeat: its frontier, the tasks it shares with its first stage, and each side's cost a solve.
  const repeat = comparisonIn("r-1", "default").sensitivity;
  const report = reported(events, "r-1");
  expect(repeat?.frontier).toEqual({
    untied: (report?.frontier?.wins ?? 0) + (report?.frontier?.losses ?? 0),
    detectable: report?.frontier?.detectable ?? null,
    falseRate: report?.frontier?.falseRate ?? 0,
  });
  expect(repeat?.overlap).toEqual({ with: "b-1", tasks: report?.overlap?.tasks.length ?? 0 });
  expect(repeat?.informative).toEqual(report?.valid?.informative ?? null);
  const html = render("r-1");
  expect(html).toContain("What the test could see");
  expect(html).toContain(
    `<dt>Shared with b-1</dt><dd>${String(repeat?.overlap?.tasks)} tasks both scored</dd>`,
  );
  expect(html).toContain("<dd>the new harness wins 95% of them</dd>");
  // A control: the reference against itself, how often its solves disagree.
  const control = comparisonIn("c-1", "default").sensitivity;
  expect(control?.noise).toEqual({ flips: reported(events, "c-1")?.noise?.flips ?? null, detectable: null });
  expect(render("c-1")).toContain("<dt>Reference flips between its solves</dt><dd>25%</dd>");
  expect(render("b-1")).toContain("<dd>none: too few untied tasks</dd>");
  expect(comparisonIn("b-4", "default").sensitivity).toBeNull();
  expect(render("b-4").includes("What the test could see")).toBe(false);
});
