/**
 * The page's shell in a browser: the sidebar's two pickers, the four panes and the collapse, and
 * the route the address carries (`route.ts`), which is the one record of what is selected. The
 * failures, the tiers, the narrow page and accessibility are `browser-shell-states.test.ts`'s; what
 * is painted during a switch is `browser-shell-switch.test.ts`'s.
 */
import { afterAll, beforeAll, describe, test } from "bun:test";
import { type Browser, expect, type Page } from "@playwright/test";
import {
  expectQuiet,
  launchBrowser,
  type Opened,
  openPage,
  routeParameters,
  type Served,
  serveFixture,
} from "./browser.ts";

/** The fixture's three campaigns' keys. */
interface Keys {
  readonly fixture: string;
  readonly early: string;
  readonly units: string;
}

let served: Served;
let browser: Browser;
let keys: Keys;

const PROJECT = /^Project/u;
const CAMPAIGN = /^Campaign/u;
const PANES = "Campaign panes";

beforeAll(async () => {
  [served, browser] = await Promise.all([serveFixture(), launchBrowser()]);
  const folder = served.fixture.key.split("/")[0] ?? "";
  keys = { fixture: served.fixture.key, early: `${folder}/early`, units: `${folder}/units` };
});
afterAll(async () => {
  await browser.close();
  await served.stop();
});

/** The page at `query`, once its campaign's title or a pane's heading shows. */
async function opened(query: string, heading: { level: 1 | 2; name: string }): Promise<Opened> {
  const page = await openPage(browser, served.url(query));
  await expect(page.page.getByRole("heading", heading)).toBeVisible();
  return page;
}

async function close(page: Opened): Promise<void> {
  expectQuiet(page);
  await page.context.close();
}

const historyLength = (page: Page) => page.evaluate(() => history.length);

/** The page's address was opened and then only replaced: one step back leaves the page. Chrome
 *  counts the blank page a new tab starts on, so `history.length` alone would not say this. */
async function expectOneEntry(page: Page): Promise<void> {
  await page.goBack();
  expect(page.url()).toBe("about:blank");
}

const nav = (page: Page) => page.getByRole("navigation", { name: PANES });

describe("the Project picker", () => {
  test("opens on the current project, marks it, and closes on Escape with focus on its button", async () => {
    const page = await opened(`campaign=${keys.fixture}`, { level: 1, name: "fixture" });
    const picker = page.page.getByRole("combobox", { name: PROJECT });
    await expect(picker).toHaveAccessibleName("Project vowel-counts");
    await expect(picker).toHaveAttribute("aria-expanded", "false");
    await picker.click();
    await expect(picker).toHaveAttribute("aria-expanded", "true");
    const list = page.page.getByRole("listbox");
    await expect(list.getByRole("option")).toHaveText(["vowel-counts", "unit-conversion"]);
    await expect(list.getByRole("option", { name: "vowel-counts" })).toHaveAttribute("aria-selected", "true");
    await expect(picker).toHaveAttribute("aria-activedescendant", /option-0$/u);
    await page.page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(picker).toBeFocused();
    await close(page);
  });

  test("walks its options with the arrows, Home and End, and picks with Enter", async () => {
    const page = await opened(`campaign=${keys.fixture}&pane=moves`, { level: 2, name: "Moves" });
    const picker = page.page.getByRole("combobox", { name: PROJECT });
    await picker.focus();
    await page.page.keyboard.press("ArrowDown");
    await expect(picker).toHaveAttribute("aria-activedescendant", /option-0$/u);
    await page.page.keyboard.press("ArrowDown");
    await expect(picker).toHaveAttribute("aria-activedescendant", /option-1$/u);
    await page.page.keyboard.press("ArrowDown");
    await expect(picker).toHaveAttribute("aria-activedescendant", /option-0$/u);
    await page.page.keyboard.press("End");
    await expect(picker).toHaveAttribute("aria-activedescendant", /option-1$/u);
    await page.page.keyboard.press("Home");
    await expect(picker).toHaveAttribute("aria-activedescendant", /option-0$/u);
    await page.page.keyboard.press("ArrowUp");
    await page.page.keyboard.press("Enter");
    await expect(page.page.getByRole("listbox")).toHaveCount(0);
    await expect(picker).toBeFocused();
    await expect(picker).toHaveAccessibleName("Project unit-conversion");
    // A new project chooses its newest campaign and keeps the pane.
    await expect.poll(() => routeParameters(page.page)).toEqual({ campaign: keys.units, pane: "moves" });
    await expect(page.page.getByRole("combobox", { name: CAMPAIGN })).toHaveAccessibleName(
      /^Campaign units/u,
    );
    await close(page);
  });

  test("opens with Enter or Space and closes on Tab or a click outside", async () => {
    const page = await opened(`campaign=${keys.fixture}`, { level: 1, name: "fixture" });
    const picker = page.page.getByRole("combobox", { name: PROJECT });
    const list = page.page.getByRole("listbox");
    await picker.focus();
    await page.page.keyboard.press("Enter");
    await expect(list).toBeVisible();
    await page.page.keyboard.press("Tab");
    await expect(list).toHaveCount(0);
    await picker.focus();
    await page.page.keyboard.press(" ");
    await expect(list).toBeVisible();
    await page.page.getByRole("heading", { level: 1, name: "fixture" }).click();
    await expect(list).toHaveCount(0);
    await picker.click();
    await picker.click();
    await expect(list).toHaveCount(0);
    expect(routeParameters(page.page)).toEqual({ campaign: keys.fixture });
    await close(page);
  });

  test("adds no history entry when the current project is picked again", async () => {
    const page = await opened(`campaign=${keys.fixture}`, { level: 1, name: "fixture" });
    const before = await historyLength(page.page);
    await page.page.getByRole("combobox", { name: PROJECT }).click();
    await page.page.getByRole("option", { name: "vowel-counts" }).click();
    expect(await historyLength(page.page)).toBe(before);
    expect(routeParameters(page.page)).toEqual({ campaign: keys.fixture });
    await close(page);
  });

  test("clears every selection inside the campaign it leaves, and back returns to them", async () => {
    const harness = served.fixture.harnesses.a;
    const query = `campaign=${keys.fixture}&harness=${harness}&file=agent/BUILT_AGENTS.md`;
    const page = await opened(query, { level: 1, name: "fixture" });
    await page.page.getByRole("combobox", { name: PROJECT }).click();
    await page.page.getByRole("option", { name: "unit-conversion" }).click();
    await expect(page.page.getByRole("heading", { level: 1, name: "units" })).toBeVisible();
    expect(routeParameters(page.page)).toEqual({ campaign: keys.units });
    await page.page.goBack();
    await expect(page.page.getByRole("heading", { level: 1, name: "fixture" })).toBeVisible();
    expect(routeParameters(page.page)).toEqual({
      campaign: keys.fixture,
      harness,
      file: "agent/BUILT_AGENTS.md",
    });
    await close(page);
  });
});

describe("the Campaign picker", () => {
  test("lists the project's campaigns newest first, each with its worktree, and opens the one picked", async () => {
    const page = await opened(`campaign=${keys.fixture}&pane=tasks`, { level: 2, name: "Tasks" });
    const picker = page.page.getByRole("combobox", { name: CAMPAIGN });
    await expect(picker).toHaveAccessibleName("Campaign fixture repo");
    await picker.click();
    const options = page.page.getByRole("listbox").getByRole("option");
    await expect(options).toHaveText(["fixture repo", "early repo"]);
    await options.filter({ hasText: "early" }).click();
    await expect(picker).toHaveAccessibleName("Campaign early repo");
    expect(routeParameters(page.page)).toEqual({ campaign: keys.early, pane: "tasks" });
    await page.page.goBack();
    await expect(picker).toHaveAccessibleName("Campaign fixture repo");
    expect(routeParameters(page.page)).toEqual({ campaign: keys.fixture, pane: "tasks" });
    await close(page);
  });

  test("shows its full names inside the viewport", async () => {
    const page = await opened(`campaign=${keys.fixture}`, { level: 1, name: "fixture" });
    await page.page.getByRole("combobox", { name: CAMPAIGN }).click();
    const box = await page.page.getByRole("listbox").boundingBox();
    const width = page.page.viewportSize()?.width ?? 0;
    expect(box).not.toBeNull();
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= width).toBe(true);
    for (const option of await page.page.getByRole("option").all()) {
      expect(await option.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await close(page);
  });
});

describe("the four panes", () => {
  test("open from the sidebar in order, each marked current, and the back button walks them", async () => {
    const page = await opened(`campaign=${keys.fixture}`, { level: 1, name: "fixture" });
    const panes = nav(page.page).getByRole("button");
    await expect(panes).toHaveText(["Campaign", "Moves", "Tasks", "Log"]);
    for (const [name, pane] of [
      ["Moves", "moves"],
      ["Tasks", "tasks"],
      ["Log", "log"],
    ] as const) {
      await nav(page.page).getByRole("button", { name }).click();
      await expect(page.page.getByRole("heading", { level: 2, name })).toBeVisible();
      await expect(nav(page.page).getByRole("button", { name })).toHaveAttribute("aria-current", "page");
      expect(routeParameters(page.page)).toEqual({ campaign: keys.fixture, pane });
    }
    await expect(nav(page.page).locator("[aria-current]")).toHaveCount(1);
    await page.page.goBack();
    await expect(page.page.getByRole("heading", { level: 2, name: "Tasks" })).toBeVisible();
    await page.page.goBack();
    await page.page.goBack();
    await expect(page.page.getByRole("heading", { level: 1, name: "fixture" })).toBeVisible();
    expect(routeParameters(page.page)).toEqual({ campaign: keys.fixture });
    await page.page.goForward();
    await expect(page.page.getByRole("heading", { level: 2, name: "Moves" })).toBeVisible();
    await close(page);
  });

  test("leave a pane's own selections and the inspector behind, and keep the harness", async () => {
    const harness = served.fixture.harnesses.a;
    const query = `campaign=${keys.fixture}&harness=${harness}&file=agent/BUILT_AGENTS.md`;
    const page = await opened(query, { level: 1, name: "fixture" });
    await expect(page.page.locator(".ana-shell")).toHaveClass(/has-inspector/u);
    await nav(page.page).getByRole("button", { name: "Moves" }).click();
    await expect(page.page.getByRole("heading", { level: 2, name: "Moves" })).toBeVisible();
    expect(routeParameters(page.page)).toEqual({ campaign: keys.fixture, pane: "moves", harness });
    await expect(page.page.locator(".ana-shell")).not.toHaveClass(/has-inspector/u);
    await close(page);
  });

  test("open the same pane again without a new history entry", async () => {
    const page = await opened(`campaign=${keys.fixture}&pane=log`, { level: 2, name: "Log" });
    const before = await historyLength(page.page);
    await nav(page.page).getByRole("button", { name: "Log" }).click();
    expect(await historyLength(page.page)).toBe(before);
    await close(page);
  });
});

describe("the collapse", () => {
  test("narrows the sidebar to its icons, which keep their names and work, and opens it again", async () => {
    const page = await opened(`campaign=${keys.fixture}`, { level: 1, name: "fixture" });
    const sidebar = page.page.locator(".ana-sidebar");
    const collapse = page.page.getByRole("button", { name: "Collapse" });
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    const wide = (await sidebar.boundingBox())?.width ?? 0;
    await collapse.click();
    await expect(sidebar).toHaveClass(/is-collapsed/u);
    await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThan(wide);
    const open = page.page.getByRole("button", { name: "Open", exact: true });
    await expect(open).toHaveAttribute("aria-expanded", "false");
    await expect(page.page.getByRole("combobox", { name: PROJECT })).toBeHidden();
    const moves = nav(page.page).getByRole("button", { name: "Moves" });
    await expect(moves).toBeVisible();
    await moves.click();
    await expect(page.page.getByRole("heading", { level: 2, name: "Moves" })).toBeVisible();
    // The main column follows the sidebar's width, so nothing of the page sits under it.
    const sidebarRight = await sidebar.evaluate((element) => element.getBoundingClientRect().right);
    const mainLeft = await page.page
      .locator("main")
      .evaluate((element) => element.getBoundingClientRect().left);
    expect(mainLeft).toBeGreaterThanOrEqual(sidebarRight - 1);
    await open.click();
    await expect(sidebar).not.toHaveClass(/is-collapsed/u);
    await expect(page.page.getByRole("combobox", { name: PROJECT })).toBeVisible();
    await page.page.getByRole("button", { name: "Toggle sidebar" }).click();
    await expect(sidebar).toHaveClass(/is-collapsed/u);
    await close(page);
  });
});

describe("the address", () => {
  test("names the newest campaign when it names none, without a new history entry", async () => {
    const page = await opened("", { level: 1, name: "fixture" });
    await expect.poll(() => routeParameters(page.page)).toEqual({ campaign: keys.fixture });
    await expectOneEntry(page.page);
    await close(page);
  });

  test("opens each pane it names", async () => {
    for (const [pane, name] of [
      ["moves", "Moves"],
      ["tasks", "Tasks"],
      ["log", "Log"],
    ] as const) {
      const page = await opened(`campaign=${keys.fixture}&pane=${pane}`, { level: 2, name });
      await expect(nav(page.page).getByRole("button", { name })).toHaveAttribute("aria-current", "page");
      await close(page);
    }
  });

  test("chooses a project's newest campaign from a project alone, and writes the campaign instead", async () => {
    const page = await opened("project=unit-conversion", { level: 1, name: "units" });
    await expect.poll(() => routeParameters(page.page)).toEqual({ campaign: keys.units });
    await expectOneEntry(page.page);
    await close(page);
  });

  test("replaces a campaign the list does not hold with the newest", async () => {
    const page = await opened("campaign=nowhere%2Fnothing&pane=moves", { level: 2, name: "Moves" });
    await expect.poll(() => routeParameters(page.page)).toEqual({ campaign: keys.fixture, pane: "moves" });
    await expectOneEntry(page.page);
    await close(page);
  });

  test("drops a pane, a move, an event or a parameter it does not read, without a new history entry", async () => {
    for (const query of ["pane=nowhere", "move=-1", "move=2.5", "event=x", "colour=blue"]) {
      const page = await opened(`campaign=${keys.fixture}&${query}`, { level: 1, name: "fixture" });
      await expect.poll(() => routeParameters(page.page)).toEqual({ campaign: keys.fixture });
      await expectOneEntry(page.page);
      await close(page);
    }
  });

  test("keeps the hash and the token through every change", async () => {
    const page = await openPage(browser, `${served.url(`campaign=${keys.fixture}`)}#main`);
    await expect(page.page.getByRole("heading", { level: 1, name: "fixture" })).toBeVisible();
    await nav(page.page).getByRole("button", { name: "Tasks" }).click();
    await expect(page.page.getByRole("heading", { level: 2, name: "Tasks" })).toBeVisible();
    const url = new URL(page.page.url());
    expect(url.hash).toBe("#main");
    expect(url.searchParams.get("token")).toBe(served.token);
    await close(page);
  });
});
