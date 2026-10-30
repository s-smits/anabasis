/**
 * The page's shell in a browser: the sidebar's campaign picker, the four panes and the collapse, and
 * the route the address carries (`route.ts`), which is the one record of what is selected. The
 * failures, the tiers, the narrow page and accessibility are `browser-shell-states.test.ts`'s; what
 * is painted during a switch is `browser-shell-switch.test.ts`'s.
 */
import { afterAll, beforeAll, describe, test } from "bun:test";
import type { Browser, Page } from "@playwright/test";
import {
  expect,
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

/** The page's address was opened and then only replaced: one step back leaves the page. Chrome
 *  counts the blank page a new tab starts on, so `history.length` alone would not say this. */
async function expectOneEntry(page: Page): Promise<void> {
  await page.goBack();
  expect(page.url()).toBe("about:blank");
}

const nav = (page: Page) => page.getByRole("navigation", { name: PANES });

describe("the Campaign picker", () => {
  test("marks the current campaign, opens and closes by pointer or keyboard, and adds no history for reselecting it", async () => {
    const page = await opened(`campaign=${keys.fixture}`, { level: 1, name: "fixture" });
    const picker = page.page.getByRole("combobox", { name: CAMPAIGN });
    await expect(picker).toHaveAccessibleName("Campaign fixture vowel-counts");
    await expect(picker).toHaveAttribute("aria-expanded", "false");
    await picker.click();
    await expect(picker).toHaveAttribute("aria-expanded", "true");
    const list = page.page.getByRole("listbox");
    await expect(list.getByRole("option")).toHaveCount(3);
    await expect(list.getByRole("option", { name: /^fixture/u })).toHaveAttribute("aria-selected", "true");
    await expect(picker).toHaveAttribute("aria-activedescendant", /option-0$/u);
    await page.page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(picker).toBeFocused();
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
    await picker.click();
    await page.page.getByRole("option", { name: /^fixture/u }).click();
    expect(routeParameters(page.page)).toEqual({ campaign: keys.fixture });
    await expectOneEntry(page.page);
    await close(page);
  });

  test("groups every campaign under its project, each with its state", async () => {
    const page = await opened(`campaign=${keys.fixture}&pane=tasks`, { level: 2, name: "Tasks" });
    await page.page.getByRole("combobox", { name: CAMPAIGN }).click();
    const list = page.page.getByRole("listbox");
    await expect(list.locator(".ana-picker-group-label")).toHaveText(["vowel-counts", "unit-conversion"]);
    await expect(list.getByRole("option", { name: /^units/u })).toContainText("ended: budget");
    await expect(list.getByRole("option", { name: /^early/u })).toContainText(/open, wrote .* ago/u);
    await close(page);
  });

  test("walks its options with the arrows, Home and End, and picks with Enter", async () => {
    const page = await opened(`campaign=${keys.fixture}&pane=moves`, { level: 2, name: "Moves" });
    const picker = page.page.getByRole("combobox", { name: CAMPAIGN });
    await picker.focus();
    for (const [key, at] of [
      ["ArrowDown", 0],
      ["ArrowDown", 1],
      ["ArrowDown", 2],
      ["ArrowDown", 0],
      ["End", 2],
      ["Home", 0],
    ] as const) {
      await page.page.keyboard.press(key);
      await expect(picker).toHaveAttribute("aria-activedescendant", new RegExp(`option-${String(at)}$`, "u"));
    }
    await page.page.keyboard.press("ArrowUp");
    await page.page.keyboard.press("Enter");
    await expect(page.page.getByRole("listbox")).toHaveCount(0);
    await expect(picker).toBeFocused();
    // A campaign in another project keeps the pane.
    await expect(picker).toHaveAccessibleName("Campaign units unit-conversion");
    await expect.poll(() => routeParameters(page.page)).toEqual({ campaign: keys.units, pane: "moves" });
    await close(page);
  });

  test("narrows its list as it is typed into, clears the filter on Escape, and picks the match", async () => {
    const page = await opened(`campaign=${keys.fixture}`, { level: 1, name: "fixture" });
    const picker = page.page.getByRole("combobox", { name: CAMPAIGN });
    await picker.focus();
    await page.page.keyboard.type("ear");
    const list = page.page.getByRole("listbox");
    await expect(list.getByRole("option")).toHaveCount(1);
    await expect(list.getByRole("option")).toContainText("early");
    await page.page.keyboard.type("zzz");
    await expect(list.getByRole("option")).toHaveCount(0);
    await expect(list).toContainText("nothing matches");
    await page.page.keyboard.press("Escape");
    await expect(list.getByRole("option")).toHaveCount(3);
    await page.page.keyboard.type("unit");
    await expect(list.getByRole("option")).toHaveCount(1);
    await page.page.keyboard.press("Backspace");
    await expect(list.getByRole("option")).toHaveCount(1);
    await page.page.keyboard.press("Enter");
    await expect(page.page.getByRole("heading", { level: 1, name: "units" })).toBeVisible();
    expect(routeParameters(page.page)).toEqual({ campaign: keys.units });
    await close(page);
  });

  test("clears every selection inside the campaign it leaves, and back returns to them", async () => {
    const harness = served.fixture.harnesses.a;
    const query = `campaign=${keys.fixture}&harness=${harness}&file=agent/BUILT_AGENTS.md`;
    const page = await opened(query, { level: 1, name: "fixture" });
    await page.page.getByRole("combobox", { name: CAMPAIGN }).click();
    await page.page.getByRole("option", { name: /^units/u }).click();
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
    await expect(page.page.getByRole("combobox", { name: CAMPAIGN })).toBeHidden();
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
    await expect(page.page.getByRole("combobox", { name: CAMPAIGN })).toBeVisible();
    await page.page.getByRole("button", { name: "Toggle sidebar" }).click();
    await expect(sidebar).toHaveClass(/is-collapsed/u);
    await close(page);
  });
});

describe("the address", () => {
  test("normalises an empty address or a project into its newest campaign without adding history", async () => {
    for (const [query, name, key] of [
      ["", "fixture", keys.fixture],
      ["project=unit-conversion", "units", keys.units],
    ] as const) {
      const page = await opened(query, { level: 1, name });
      await expect.poll(() => routeParameters(page.page)).toEqual({ campaign: key });
      await expectOneEntry(page.page);
      await close(page);
    }
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
