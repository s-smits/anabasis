/**
 * The page in a real browser, for the browser tests (`browser-*.test.ts`): the fixture's three
 * campaigns written once a file, `serve.ts` started on them as the operator starts it, and Chrome
 * driven by Playwright over that server.
 *
 * The other page tests render the panes to a string (`panes.test.tsx`), which proves what a pane
 * says and nothing of what a person can do with it: no effect runs, no click lands, no history
 * entry is pushed and no layout is measured. These tests drive the page the operator opens. They
 * run Chrome as installed (`channel: "chrome"`), as CI's macOS runner and the operator's Mac have
 * it, so the suite downloads no browser; `ANA_UI_CHROME` names another executable. A host without
 * either fails the launch with Playwright's own message rather than skipping, since a browser test
 * that skips says nothing.
 *
 * Assertions are Playwright's own web-first ones (`expect` of `@playwright/test`), which retry until
 * their timeout, so no test sleeps: Playwright's runner needs Node, which this repository does not
 * run, and its `expect` works under `bun:test` as it is. A test reads the page as a person does,
 * by role and accessible name, and reaches for a class only where the page has no role to offer.
 *
 * Every page records what the browser reported as wrong: a console error or warning, an uncaught
 * exception, and an HTTP failure of the API. A test ends by asserting that list empty
 * (`expectQuiet`), so a page that renders and throws behind it fails.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { type Browser, type BrowserContext, chromium, expect, type Page } from "@playwright/test";
import { mkdtempSync, realpathSync, rmSync } from "../../../src/meta/filesystem.ts";
import { tmpdir } from "../../../src/meta/os.ts";
import { interruptAndReapProcessGroup } from "../../../src/meta/subprocess.ts";
import { join } from "../../../src/meta/path.ts";
import { type Fixture, writeFixtureCampaign } from "./fixture-campaign.ts";

/** One server over the fixture: its origin and token, and how to stop it. */
export interface Served {
  readonly origin: string;
  readonly token: string;
  readonly fixture: Fixture;
  /** The page's address for a query string without the token, `?` excluded; the token is added. */
  readonly url: (query?: string) => string;
  readonly stop: () => Promise<void>;
}

/** A page and what the browser reported against it. */
export interface Opened {
  readonly page: Page;
  readonly context: BrowserContext;
  /** Console errors and warnings, uncaught exceptions and failed API answers, in order. */
  readonly problems: string[];
}

/** Where a page is opened: the viewport, and the colour scheme and motion the browser reports. */
export interface Viewing {
  readonly width?: number;
  readonly height?: number;
  readonly reducedMotion?: "reduce" | "no-preference";
}

const PACKAGE = join(import.meta.dir, "..");
const STARTED = /anabasis at (http:\/\/127\.0\.0\.1:\d+)\/\?token=([0-9a-f]+)/u;
const START_MS = 20_000;
/** A desktop window, the width the operator reads the page at. */
export const DESKTOP = { width: 1440, height: 1000 } as const;
/** A phone held upright. */
export const PHONE = { width: 390, height: 844 } as const;

/** The fixture written under a fresh directory, and `serve.ts` started on it. */
export async function serveFixture(tier: "default" | "exam" = "default"): Promise<Served> {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-ui-browser-")));
  const fixture = writeFixtureCampaign(join(scratch, "repo"));
  const child = Bun.spawn(
    ["bun", "serve.ts", "--repo", fixture.root, ...(tier === "exam" ? ["--exam-side"] : [])],
    { cwd: PACKAGE, env: { ...Bun.env, PORT: "0" }, stdout: "pipe", stderr: "pipe", detached: true },
  );
  const stop = async () => {
    await interruptAndReapProcessGroup(child, 2_000);
    rmSync(scratch, { recursive: true, force: true });
  };
  try {
    const [origin, token] = await startLine(child.stdout);
    return {
      origin,
      token,
      fixture,
      url: (query = "") => `${origin}/?${query === "" ? "" : `${query}&`}token=${token}`,
      stop,
    };
  } catch (error) {
    await stop();
    throw new Error(`serve.ts did not start: ${await new Response(child.stderr).text()}`, { cause: error });
  }
}

/** The origin and the token of the line `serve.ts` prints at its start, within `START_MS`. Each read
 *  races that bound: checked only between reads, it held a server that printed nothing until Bun
 *  timed the hook out at 60 s. */
async function startLine(stdout: ReadableStream<Uint8Array>): Promise<[string, string]> {
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  const late = Bun.sleep(START_MS).then(() => ({ done: true, value: undefined }) as const);
  let text = "";
  for (;;) {
    const { done, value } = await Promise.race([reader.read(), late]);
    if (done) break;
    text += decoder.decode(value, { stream: true });
    const match = STARTED.exec(text);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      reader.releaseLock();
      return [match[1], match[2]];
    }
  }
  throw new Error(`no start line within ${String(START_MS)} ms: ${text}`);
}

/** Chrome, headless.
 *
 *  The launch and the first context are each bounded at `START_MS`, inside Bun's 60 s for the hook.
 *  On 14 October, at loads of 15 to 54 on 12 cores, Chrome stalled at its start in 4 of the first
 *  15 commits the pre-push gate ran: the launch, or the first context after it, did not answer for
 *  60 s. Bun timed the test out and killed Chrome, and the awaited call rejected after its test had
 *  ended, outside any test, where the test wrapper runs no file again. Bounded here, the stall fails
 *  the file's `beforeAll`, which the wrapper runs again on a crowded host. */
export async function launchBrowser(): Promise<Browser> {
  const executable = Bun.env.ANA_UI_CHROME;
  const options = { headless: true, timeout: START_MS };
  const browser = await chromium.launch(
    executable === undefined ? { channel: "chrome", ...options } : { executablePath: executable, ...options },
  );
  const answered = browser.newContext().then(async (context) => {
    await context.close();
    return true;
  });
  if (await Promise.race([answered, Bun.sleep(START_MS).then(() => false)])) return browser;
  throw new Error(`Chrome opened no context within ${String(START_MS)} ms of its launch`);
}

/** A fresh context and page at `url`, recording what goes wrong. The page has loaded its first
 *  campaign reading, or its refusal, when this returns. */
export async function openPage(browser: Browser, url: string, viewing: Viewing = {}): Promise<Opened> {
  const context = await browser.newContext({
    viewport: { width: viewing.width ?? DESKTOP.width, height: viewing.height ?? DESKTOP.height },
    reducedMotion: viewing.reducedMotion ?? "no-preference",
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      problems.push(`console ${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`uncaught: ${error.message}`));
  page.on("response", (response) => {
    if (response.url().includes("/api/") && response.status() >= 500) {
      problems.push(`HTTP ${String(response.status())} ${response.url()}`);
    }
  });
  await page.goto(url);
  return { page, context, problems };
}

/** The page reported nothing wrong, less what a test expected (`allowed`, matched by substring). */
export function expectQuiet(opened: Opened, allowed: readonly string[] = []): void {
  const unexpected = opened.problems.filter((problem) => !allowed.some((each) => problem.includes(each)));
  expect(unexpected).toEqual([]);
}

/** The search parameters of the page's address now, the token left out. */
export function routeParameters(page: Page): Record<string, string> {
  const query = new URL(page.url()).searchParams;
  query.delete("token");
  return Object.fromEntries(query.entries());
}

/** The axe-core rules the page breaks at WCAG 2.2 AA, each with the nodes it names. */
export async function accessibilityViolations(page: Page, within?: string): Promise<string[]> {
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  const results = await (within === undefined ? builder : builder.include(within)).analyze();
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(" ")).join(", ")})`,
  );
}
