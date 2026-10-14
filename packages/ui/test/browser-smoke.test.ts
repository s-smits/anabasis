import { afterAll, beforeAll, describe, test } from "bun:test";
import { type Browser, expect } from "@playwright/test";
import { expectQuiet, launchBrowser, openPage, type Served, serveFixture } from "./browser.ts";

let served: Served;
let browser: Browser;

beforeAll(async () => {
  [served, browser] = await Promise.all([serveFixture(), launchBrowser()]);
});
afterAll(async () => {
  await browser.close();
  await served.stop();
});

describe("the page in a browser", () => {
  test("opens on the newest campaign's Campaign pane with nothing reported wrong", async () => {
    const opened = await openPage(browser, served.url());
    const { page } = opened;
    await expect(page.getByRole("heading", { level: 1, name: "fixture" })).toBeVisible();
    await expect(page).toHaveURL(/campaign=/u);
    expectQuiet(opened);
    await opened.context.close();
  });
});
