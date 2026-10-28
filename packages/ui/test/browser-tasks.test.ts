import { afterAll, beforeAll, describe, test } from "bun:test";
import { type Browser, type Locator, type Page } from "@playwright/test";
import {
  accessibilityViolations,
  DESKTOP,
  expect,
  expectQuiet,
  launchBrowser,
  type Opened,
  openPage,
  PHONE,
  routeParameters,
  type Served,
  serveFixture,
  type Viewing,
} from "./browser.ts";
import { arm, expectFocusRing, framesOf, tabTo, watchFrames } from "./browser-watch.ts";
import { answersOver, MARKERS } from "./fixture-campaign.ts";

/*
 * The Tasks pane in Chrome over the fixture's 26 task versions and 8 comparisons: every cell of the
 * grid, the search and the three filters, a task's detail opened and left with its filters restored,
 * the disputed task and the one waiting for a label, the grid's own scroll at a phone's width, and
 * what the page paints while a task is read: the grid, never a placeholder in its place
 * (14 October).
 */

/** The comparisons, as their heads say them: the id, then the kind and the reading. */
const COLUMNS = [
  ["b-1", "no-step"],
  ["r-1", "repeat, step"],
  ["c-1", "control, no-step"],
  ["b-2", "no-step"],
  ["b-3", "no-step"],
  ["r-3", "repeat, no-step"],
  ["b-4", "cut"],
  ["g-9", "no-step"],
] as const;

/**
 * Every row of the grid: the id, the note under it, and each comparison's cell as its outcome, its
 * word and the valid answers over solves of each side ("." no cell, worded by the task's state).
 */
const GRID: readonly (readonly [string, string, ...string[]])[] = [
  ["word-p1", "released", ".", ".", ".", ".", ".", ".", ".", "."],
  ["word-p2", "released", ".", ".", ".", ".", ".", ".", ".", "."],
  ["word-01", "held", "won 0/2 · 2/2", "won 1/2 · 2/2", ".", "tiedEvery 2/2 · 2/2", ".", ".", ".", "."],
  ["word-02", "held", "won 0/2 · 2/2", "won 0/2 · 2/2", ".", "lost 2/2 · 1/2", ".", ".", ".", "."],
  [
    "word-03",
    "held · exhausted · retained",
    "tiedEvery 2/2 · 2/2",
    "tiedEvery 2/2 · 2/2",
    ".",
    ".",
    ".",
    ".",
    ".",
    ".",
  ],
  ["word-04", "held", "tiedSome 1/2 · 1/2", ".", ".", "won 1/2 · 2/2", ".", ".", ".", "."],
  ["word-05", "disputed", "won 0/2 · 1/2", "won 0/2 · 2/2", ".", "left-out disputed", ".", ".", ".", "."],
  [
    "word-06",
    "held · waits for a label",
    "tiedNone 0/2 · 0/2",
    "tiedNone 0/2 · 0/2",
    ".",
    ".",
    ".",
    ".",
    ".",
    ".",
  ],
  ["word-07", "held", ".", "won 0/2 · 1/2", ".", "tiedEvery 2/2 · 2/2", ".", ".", ".", "."],
  ["word-08", "held · retained", ".", ".", ".", ".", "won 1/2 · 2/2", "tiedEvery 2/2 · 2/2", ".", "."],
  ["word-09", "held · retained", ".", ".", ".", ".", "won 0/2 · 1/2", ".", ".", "."],
  ["word-10", "held · retained", ".", ".", ".", ".", "tiedEvery 2/2 · 2/2", "won 1/2 · 2/2", ".", "."],
  ["word-11", "held · retained", ".", ".", ".", ".", "lost 2/2 · 1/2", "lost 2/2 · 1/2", ".", "."],
  ["word-12", "held · retained", ".", ".", ".", ".", "won 0/2 · 1/2", "won 0/2 · 1/2", ".", "."],
  ["word-r1", "refused", ".", ".", ".", ".", ".", ".", ".", "."],
  ["word-13", "held", ".", ".", "lost 4/4 · 0/4", ".", "aside 1/2 · 2/2", ".", ".", "."],
  ["word-14", "held · retained", ".", ".", "aside 3/4 · 3/4", ".", ".", ".", ".", "."],
  [
    "word-15",
    "held · exhausted · retained",
    ".",
    ".",
    "won 3/4 · 4/4",
    ".",
    ".",
    "tiedEvery 2/2 · 2/2",
    ".",
    ".",
  ],
  ["word-16", "held · retained", ".", ".", ".", "tiedSome 1/2 · 1/2", ".", "tiedNone 0/2 · 0/2", ".", "."],
  ["word-17", "held", ".", ".", ".", ".", ".", ".", ".", "won 0/2 · 1/2"],
  ["word-18", "held · exhausted · retained", ".", ".", ".", ".", ".", ".", ".", "tiedEvery 2/2 · 2/2"],
  ["word-19", "held", ".", ".", ".", ".", ".", ".", ".", "lost 1/2 · 0/2"],
  ["word-20", "held", ".", ".", ".", ".", ".", ".", ".", "won 1/2 · 2/2"],
  ["word-21", "held", ".", ".", ".", ".", ".", ".", ".", "tiedNone 0/2 · 0/2"],
  ["word-22", "held", ".", ".", ".", ".", ".", ".", ".", "won 1/2 · 2/2"],
  ["word-23", "held", ".", ".", ".", ".", ".", ".", ".", "."],
];
/** The word a cell of each outcome says. */
const WORDS = new Map([
  ["won", "won"],
  ["lost", "lost"],
  ["tiedEvery", "tied"],
  ["tiedSome", "tied"],
  ["tiedNone", "tied"],
  ["aside", "set aside"],
  ["left-out", "left out"],
]);
const LEGEND = [
  "Won",
  "Lost",
  "Tied, reference always valid",
  "Tied, reference sometimes valid",
  "Tied, reference never valid",
  "Set aside for a label",
  "Counts: valid of solves, reference · new",
];

let served: Served;
let exam: Served;
let browser: Browser;

beforeAll(async () => {
  [served, exam, browser] = await Promise.all([serveFixture(), serveFixture("exam"), launchBrowser()]);
});
afterAll(async () => {
  await browser.close();
  await Promise.all([served.stop(), exam.stop()]);
});

/** The Tasks pane of the fixture's campaign on `server`, with `extra` added to the query. */
function tasksAt(server: Served, extra = ""): string {
  return server.url(`campaign=${encodeURIComponent(server.fixture.key)}&pane=tasks${extra}`);
}

const grid = (page: Page): Locator => page.getByRole("region", { name: "Tasks by comparison" });
// The detail's container is named and focused, with no role of its own to find it by.
const detail = (page: Page): Locator => page.locator("[aria-label='Selected task']");
/** The head of the detail of task `id`. */
const titled = (page: Page, id: string): Locator =>
  detail(page).getByRole("heading", { level: 2, name: `${id} Task`, exact: true });
const corner = (page: Page): Locator => grid(page).locator("thead th").first();
const taskRow = (page: Page, id: string): Locator =>
  grid(page).getByRole("button", { name: id, exact: true });
const search = (page: Page): Locator =>
  page.getByRole("searchbox", { name: "Search tasks by id or version" });
const back = (page: Page): Locator => page.getByRole("button", { name: "Back to tasks" });

/** The pane with its grid read. */
async function openTasks(server: Served, extra = "", viewing: Viewing = DESKTOP): Promise<Opened> {
  const opened = await openPage(browser, tasksAt(server, extra), viewing);
  await expect(page(opened).getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  return opened;
}

const page = (opened: Opened): Page => opened.page;

/** The ids of the rows the grid shows, in order. */
function shownIds(on: Page): Promise<string[]> {
  return grid(on).locator("tbody th .ana-row-select").allTextContents();
}

/** Each row as `GRID` writes it, read from the page. */
function gridRows(on: Page): Promise<string[][]> {
  return grid(on).evaluate((node) =>
    [...node.querySelectorAll("tbody tr")].map((tr) => {
      const head = tr.querySelector("th");
      const cells = [...tr.querySelectorAll("td")].map((td) => {
        if (!(td instanceof HTMLElement)) return "?";
        const outcome = td.dataset.outcome ?? "?";
        if (outcome === "none") return `. ${td.textContent}`;
        const word = td.querySelector("span")?.textContent ?? "";
        return `${outcome} ${td.dataset.counts ?? td.dataset.leftOut ?? ""} ${word}`;
      });
      return [
        head?.querySelector("button")?.textContent ?? "",
        head?.querySelector("small")?.textContent ?? "",
        ...cells,
      ];
    }),
  );
}

/** `GRID` as `gridRows` reads it. */
function expectedRows(): string[][] {
  const unscored = new Map([
    ["released", ". practice"],
    ["refused", ". not in the exam"],
  ]);
  return GRID.map(([id, note, ...cells]) => [
    id,
    note,
    ...cells.map((cell) => {
      if (cell === ".") return unscored.get(note) ?? ". not scored";
      const outcome = cell.split(" ")[0] ?? "";
      return `${cell} ${WORDS.get(outcome) ?? ""}`;
    }),
  ]);
}

/** The version a task id names, as the server's handler answers the grid. */
function versionOf(id: string): string {
  const { rows } = answersOver(served.fixture.root, "default").tasks(served.fixture.key);
  const version = rows.find((row) => row.id === id)?.version;
  if (version === undefined) throw new Error(`no task ${id}`);
  return version;
}

describe("the Tasks pane's grid", () => {
  test("draws every task against every comparison, each cell with its word and its counts", async () => {
    const opened = await openTasks(served);
    const on = page(opened);
    await expect(corner(on)).toHaveText("Tasks (26)");
    const heads = await grid(on)
      .locator("thead th.ana-grid-col")
      .evaluateAll((nodes) =>
        nodes.map((node) => [
          node.querySelector("span")?.textContent ?? "",
          node.querySelector("small")?.textContent ?? "",
        ]),
      );
    expect(heads).toEqual(COLUMNS.map((column) => [...column]));
    expect(await on.getByRole("list", { name: "Outcomes" }).getByRole("listitem").allTextContents()).toEqual(
      LEGEND,
    );
    expect(await gridRows(on)).toEqual(expectedRows());
    // Each tinted cell says in its title what its counts are, for a reader who hovers.
    await expect(grid(on).locator("tbody tr").nth(2).locator("td").first()).toHaveAttribute(
      "title",
      "Won: reference 0/2, new 2/2 valid",
    );
    expectQuiet(opened);
    await opened.context.close();
  });

  test("finds a task by its id or by its version", async () => {
    const opened = await openTasks(served);
    const on = page(opened);
    await search(on).fill("word-05");
    await expect(corner(on)).toHaveText("Tasks (1)");
    expect(await shownIds(on)).toEqual(["word-05"]);
    const version = versionOf("word-12");
    await search(on).fill(version.slice(0, 10));
    expect(await shownIds(on)).toEqual(["word-12"]);
    await search(on).fill(version);
    expect(await shownIds(on)).toEqual(["word-12"]);
    await search(on).fill("word-1");
    await expect(corner(on)).toHaveText("Tasks (10)");
    await search(on).fill("no such task");
    await expect(on.getByText("No matching task")).toBeVisible();
    await expect(grid(on)).toHaveCount(0);
    await on.getByRole("button", { name: "Clear filters" }).click();
    await expect(search(on)).toHaveValue("");
    await expect(corner(on)).toHaveText("Tasks (26)");
    expectQuiet(opened);
    await opened.context.close();
  });

  test("filters by state, by label and by exhaustion, alone and together", async () => {
    const opened = await openTasks(served);
    const on = page(opened);
    const state = on.getByLabel("State");
    const label = on.getByLabel("Label");
    const exhausted = on.getByLabel("Exhausted");
    expect(await state.locator("option").allTextContents()).toEqual([
      "Every state",
      "held",
      "released",
      "refused",
      "disputed",
    ]);
    const counts = { held: 22, released: 2, refused: 1, disputed: 1 } as const;
    for (const [value, count] of Object.entries(counts)) {
      await state.selectOption(value);
      await expect(corner(on)).toHaveText(`Tasks (${String(count)})`);
      const notes = await grid(on).locator("tbody th small").allTextContents();
      expect(notes.every((note) => note.startsWith(value))).toBe(true);
    }
    await state.selectOption("all");
    await expect(corner(on)).toHaveText("Tasks (26)");

    await label.selectOption("yes");
    expect(await shownIds(on)).toEqual(["word-06"]);
    await label.selectOption("no");
    await expect(corner(on)).toHaveText("Tasks (25)");
    await label.selectOption("all");

    // Three tasks of the fixture are exhausted: the reference closed each in its last comparison.
    await exhausted.selectOption("yes");
    expect(await shownIds(on)).toEqual(["word-03", "word-15", "word-18"]);
    await exhausted.selectOption("no");
    await expect(corner(on)).toHaveText("Tasks (23)");

    await state.selectOption("held");
    await label.selectOption("yes");
    expect(await shownIds(on)).toEqual(["word-06"]);
    await state.selectOption("released");
    await expect(on.getByText("No matching task")).toBeVisible();
    await label.selectOption("all");
    await search(on).fill("p2");
    expect(await shownIds(on)).toEqual(["word-p2"]);
    await state.selectOption("held");
    await search(on).fill("word-0");
    expect(await shownIds(on)).toEqual([
      "word-01",
      "word-02",
      "word-04",
      "word-06",
      "word-07",
      "word-08",
      "word-09",
    ]);
    await on.getByRole("button", { name: "Clear filters" }).click();
    await expect(state).toHaveValue("all");
    await expect(exhausted).toHaveValue("all");
    await expect(corner(on)).toHaveText("Tasks (26)");
    expectQuiet(opened);
    await opened.context.close();
  });

  test("keeps its first column and its head in place while it scrolls inside its card on a phone", async () => {
    const opened = await openTasks(served, "", PHONE);
    const on = page(opened);
    const wrap = grid(on);
    await expect(wrap).toBeVisible();
    const overflow = await on.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const sizes = await wrap.evaluate((node) => ({
      wide: node.scrollWidth - node.clientWidth,
      tall: node.scrollHeight - node.clientHeight,
    }));
    expect(sizes.wide).toBeGreaterThan(0);
    expect(sizes.tall).toBeGreaterThan(0);
    const stuck = await wrap.evaluate((node) => {
      node.scrollTo({ left: node.scrollWidth, top: node.scrollHeight, behavior: "instant" });
      const frame = node.getBoundingClientRect();
      const first = node.querySelector("tbody tr:last-child th")?.getBoundingClientRect();
      const head = node.querySelector("thead th:nth-child(4)")?.getBoundingClientRect();
      return {
        scrolled: node.scrollLeft > 0 && node.scrollTop > 0,
        left: (first?.left ?? Number.NaN) - frame.left,
        top: (head?.top ?? Number.NaN) - frame.top,
      };
    });
    expect(stuck.scrolled).toBe(true);
    // Within the card's border of a pixel.
    expect(Math.abs(stuck.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(stuck.top)).toBeLessThanOrEqual(1);
    expect(
      await on.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("reaches the search, the filters, the grid and its rows by keyboard, each with a visible ring", async () => {
    const opened = await openTasks(served);
    const on = page(opened);
    await tabTo(on, search(on));
    await expectFocusRing(search(on));
    for (const name of ["State", "Label", "Exhausted"]) {
      await on.keyboard.press("Tab");
      await expectFocusRing(on.getByLabel(name));
    }
    await tabTo(on, grid(on));
    await expectFocusRing(grid(on));
    await on.keyboard.press("Tab");
    await expectFocusRing(taskRow(on, "word-p1"));
    await on.keyboard.press("Tab");
    await expectFocusRing(taskRow(on, "word-p2"));
    await on.keyboard.press("Enter");
    await expect(detail(on)).toBeVisible();
    await expect(detail(on)).toBeFocused();
    await tabTo(on, back(on));
    await expectFocusRing(back(on));
    await on.keyboard.press("Enter");
    await expect(taskRow(on, "word-p2")).toBeFocused();
    expectQuiet(opened);
    await opened.context.close();
  });
});

describe("a task's detail", () => {
  test("opens in place with the grid hidden, and Back restores the filters and the focus", async () => {
    const opened = await openTasks(served);
    const on = page(opened);
    await on.getByLabel("State").selectOption("disputed");
    await search(on).fill("word");
    await taskRow(on, "word-05").click();
    await expect(detail(on)).toBeVisible();
    await expect(titled(on, "word-05")).toBeVisible();
    await expect(grid(on)).toBeHidden();
    const version = versionOf("word-05");
    expect(routeParameters(on)).toMatchObject({ pane: "tasks", task: version });
    await back(on).click();
    await expect(grid(on)).toBeVisible();
    await expect(detail(on)).toHaveCount(0);
    expect(routeParameters(on).task).toBeUndefined();
    await expect(on.getByLabel("State")).toHaveValue("disputed");
    await expect(search(on)).toHaveValue("word");
    await expect(taskRow(on, "word-05")).toBeFocused();
    expectQuiet(opened);
    await opened.context.close();
  });

  test("of the disputed task says the comparison that left it out, beside its solves", async () => {
    const opened = await openTasks(served, `&task=${served.fixture.disputed}`);
    const on = page(opened);
    const shown = detail(on);
    await expect(titled(on, "word-05")).toBeVisible();
    await expect(shown.getByText("disputed", { exact: true })).toBeVisible();
    await expect(shown.getByRole("heading", { name: "In 3 of 8 comparisons" })).toBeVisible();
    const results = shown.locator(".ana-task-results li");
    expect(await results.allInnerTexts()).toEqual([
      expect.stringMatching(/^b-1\s+Won\s+0\/2 · 1\/2$/u),
      expect.stringMatching(/^r-1\s+Won\s+0\/2 · 2\/2$/u),
      expect.stringMatching(/^b-2\s+left out, disputed$/u),
    ]);
    await expect(shown.getByRole("heading", { name: "Solves (12)" })).toBeVisible();
    await expect(shown.getByText("The exam side holds a held-out task's text")).toBeVisible();
    expectQuiet(opened);
    await opened.context.close();
  });

  test("of the task waiting for a label says so in its row and its head", async () => {
    const opened = await openTasks(served);
    const on = page(opened);
    await expect(
      grid(on)
        .locator("tbody tr", { has: on.getByRole("button", { name: "word-06", exact: true }) })
        .locator("small")
        .first(),
    ).toHaveText("held · waits for a label");
    await taskRow(on, "word-06").click();
    expect(routeParameters(on)).toMatchObject({ task: served.fixture.awaiting });
    await expect(detail(on).locator(".ana-detail-badges")).toHaveText(/held\s*waits for a label/u);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("on the exam side shows the task's text and its hidden values", async () => {
    const opened = await openTasks(exam, `&task=${exam.fixture.disputed}`);
    const on = page(opened);
    await expect(titled(on, "word-05")).toBeVisible();
    await expect(detail(on).getByText("Family and hidden values")).toBeVisible();
    await expect(detail(on).getByText("The exam side holds")).toHaveCount(0);
    expectQuiet(opened);
    await opened.context.close();
  });
});

describe("the Tasks pane as a whole", () => {
  test("breaks no accessibility rule in its grid or its details, on either tier", async () => {
    for (const server of [served, exam]) {
      const opened = await openTasks(server);
      const on = page(opened);
      await expect(grid(on)).toBeVisible();
      expect(await accessibilityViolations(on, "main")).toEqual([]);
      for (const id of ["word-05", "word-06", "word-p1"]) {
        await taskRow(on, id).click();
        await expect(titled(on, id)).toBeVisible();
        expect(await accessibilityViolations(on, "main")).toEqual([]);
        await back(on).click();
        await expect(grid(on)).toBeVisible();
      }
      expectQuiet(opened);
      await opened.context.close();
    }
  });

  test("in the default tier shows and receives no exam-side value", async () => {
    const opened = await openPage(browser, "about:blank");
    const on = page(opened);
    // Every answer read through the route, so that its body is kept: a read the page cancels for a
    // newer one keeps none to ask for once it has ended, which failed this test on CI on 14 October.
    const answers: string[] = [];
    await on.route("**/api/**", async (route) => {
      const response = await route.fetch();
      answers.push(await response.text());
      await route.fulfill({ response });
    });
    await on.goto(tasksAt(served));
    const texts: string[] = [];
    for (const id of ["word-05", "word-06", "word-13", "word-p1"]) {
      await taskRow(on, id).click();
      await expect(titled(on, id)).toBeVisible();
      texts.push(await on.locator("body").innerText());
      await back(on).click();
    }
    texts.push(await on.locator("body").innerText());
    expect(answers.length).toBeGreaterThan(4);
    for (const marker of Object.values(MARKERS)) {
      for (const text of texts) expect(text).not.toContain(marker);
      for (const answer of answers) expect(answer).not.toContain(marker);
    }
    expectQuiet(opened);
    await opened.context.close();
  });
});

describe("the Tasks pane between two readings", () => {
  const REGIONS = ["[aria-label='Tasks by comparison']", "[aria-label='Selected task']"];

  /** The pane with its frames watched from the first. */
  async function openWatched(busy: string): Promise<Opened> {
    const opened = await openPage(browser, "about:blank");
    await watchFrames(opened.context, REGIONS, busy);
    await opened.page.goto(tasksAt(served));
    await expect(grid(opened.page)).toBeVisible();
    return opened;
  }

  test("paints the grid through every filter and the search", async () => {
    const opened = await openWatched("[aria-busy=true]");
    const on = page(opened);
    await arm(on);
    await on.getByLabel("State").selectOption("held");
    await expect(corner(on)).toHaveText("Tasks (22)");
    await on.getByLabel("Label").selectOption("no");
    await expect(corner(on)).toHaveText("Tasks (21)");
    await on.getByLabel("Exhausted").selectOption("no");
    await search(on).fill("word-1");
    await expect(corner(on)).toHaveText("Tasks (8)");
    await on.getByRole("button", { name: "Clear filters" }).click();
    await expect(corner(on)).toHaveText("Tasks (26)");
    const frames = await framesOf(on);
    expect(frames.frames).toBeGreaterThan(3);
    expect(frames.seen).toEqual([]);
    expect(frames.bad).toBe(0);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("paints the grid or the detail in every frame of opening a task and going back", async () => {
    const opened = await openWatched("[aria-busy=true]");
    const on = page(opened);
    await arm(on);
    for (const id of ["word-05", "word-13", "word-22"]) {
      await taskRow(on, id).click();
      await expect(titled(on, id)).toBeVisible();
      await back(on).click();
      await expect(taskRow(on, id)).toBeFocused();
      await expect(taskRow(on, id)).toBeInViewport();
    }
    await taskRow(on, "word-06").click();
    await expect(detail(on)).toBeVisible();
    await on.goBack();
    await expect(taskRow(on, "word-06")).toBeFocused();
    const frames = await framesOf(on);
    expect(frames.seen).toEqual([]);
    expect(frames.bad).toBe(0);
    // A fast read is never said.
    expect(frames.busyAfter).toBeLessThan(0);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("keeps the grid through a slow read of a task, and says it reads only once the read is late", async () => {
    const opened = await openWatched("[aria-busy=true]");
    const on = page(opened);
    const held = Promise.withResolvers<void>();
    // A server that takes a second and a half, or until the test has seen what it waits for.
    await on.route(/\/api\/tasks?\?/u, async (route) => {
      await Promise.race([held.promise, Bun.sleep(1_500)]);
      await route.continue();
    });
    await arm(on);
    await taskRow(on, "word-05").click();
    expect(routeParameters(on)).toMatchObject({ task: served.fixture.disputed });
    await expect(grid(on).locator("xpath=..")).toHaveAttribute("aria-busy", "true");
    await expect(grid(on)).toBeVisible();
    await expect(on.getByRole("status").filter({ hasText: "Reading the task." })).toBeAttached();
    held.resolve();
    await expect(titled(on, "word-05")).toBeVisible();
    await expect(grid(on)).toBeHidden();
    const frames = await framesOf(on);
    expect(frames.seen).toEqual([]);
    expect(frames.bad).toBe(0);
    expect(frames.busyAfter).toBeGreaterThanOrEqual(250);
    expectQuiet(opened);
    await opened.context.close();
  });
});
