/**
 * The page in a real browser, for the smoke tests (`browser-smoke.test.ts`): the fixture's three
 * campaigns written once a file, `serve.ts` started on them as the operator starts it, and Chrome
 * driven by Playwright over that server.
 *
 * What the page computes before it draws is read without a browser (`view-model.test.ts`), which
 * proves nothing of what a drawn page shows: no effect runs and no layout is measured. These tests
 * drive the page the operator opens. They run Chrome as installed (`channel: "chrome"`), as CI's
 * macOS runner and the operator's Mac have it, so the suite downloads no browser; `ANA_UI_CHROME`
 * names another executable. A host without either fails the launch with Playwright's own message
 * rather than skipping, since a browser test that skips says nothing.
 *
 * Assertions are Playwright's own web-first ones (`expect` of `@playwright/test`), which retry until
 * their timeout, so no test sleeps: Playwright's runner needs Node, which this repository does not
 * run, and its `expect` works under `bun:test` as it is.
 *
 * Every page records what the browser reported as wrong: a console error or warning, an uncaught
 * exception, and an HTTP failure of the API. A test ends by asserting that list empty
 * (`expectQuiet`), so a page that renders and throws behind it fails.
 */
import { AxeBuilder } from "@axe-core/playwright";
import {
  type Browser,
  type BrowserContext,
  chromium,
  errors,
  type Page,
  expect as web,
} from "@playwright/test";
import { mkdtempSync, realpathSync, rmSync } from "../../../src/meta/filesystem.ts";
import { tmpdir } from "../../../src/meta/os.ts";
import { join } from "../../../src/meta/path.ts";
import {
  interruptAndReapProcessGroup,
  terminateAndReapProcessGroupId,
} from "../../../src/meta/subprocess.ts";
import { type Fixture, writeFixtureCampaign } from "./fixture-campaign.ts";

/** One server over the fixture, which it writes and removes, and how to stop it. */
export interface Served {
  /** The page's address for a query string without the token, `?` excluded; the token is added. */
  readonly url: (query?: string) => string;
  readonly stop: () => Promise<void>;
  readonly fixture: Fixture;
}

/** A page and what the browser reported against it. */
export interface Opened {
  readonly page: Page;
  readonly context: BrowserContext;
  /** Console errors and warnings, uncaught exceptions and failed API answers, in order. */
  readonly problems: string[];
}

const PACKAGE = join(import.meta.dir, "..");
const STARTED = /anabasis at (http:\/\/127\.0\.0\.1:\d+)\/\?token=([0-9a-f]+)/u;
const START_MS = 20_000;
/** The process of a launch, as Playwright's call log names it in the launch's timeout. */
const LAUNCHED = /<launched> pid=(\d+)/u;
/** How long one load, click or other action may wait. Playwright's own 30 s twice over is the test's
 *  whole 60 s, so a page that never loaded under ten parallel files would time the test out
 *  and name no step; at 15 s the stuck step fails with its own message first. */
const ACTION_MS = 15_000;
/** Playwright's web-first assertions, each retried for as long as an action may wait. Its own `expect`
 *  gives up at 5 s, which `setDefaultTimeout` does not reach, and with campaigns solving on a
 *  loaded host browser cases would fail a pre-push gate at 5 s each. */
export const expect = web.configure({ timeout: ACTION_MS });
/** A desktop window, the width the operator reads the page at. */
const DESKTOP = { width: 1440, height: 1000 } as const;
/** A phone held upright. */
export const PHONE = { width: 390, height: 844 } as const;

/** The fixture written under a fresh directory, and `serve.ts` started on it in the default tier. */
export async function serveFixture(): Promise<Served> {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-ui-browser-")));
  const fixture = writeFixtureCampaign(join(scratch, "repo"));
  const child = Bun.spawn(["bun", "serve.ts", "--repo", fixture.root], {
    cwd: PACKAGE,
    env: { ...Bun.env, PORT: "0" },
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });
  const stop = async () => {
    await interruptAndReapProcessGroup(child, 2000);
    rmSync(scratch, { recursive: true, force: true });
  };
  try {
    const [origin, token] = await startLine(child.stdout);
    const url = (query = "") => `${origin}/?${query === "" ? "" : `${query}&`}token=${token}`;
    return { url, stop, fixture };
  } catch (error) {
    const said = await new Response(child.stderr).text();
    await stop();
    throw new Error(`serve.ts did not start: ${said}`, { cause: error });
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

/** Chrome, headless unless `ANA_UI_HEADED=1` asks for its window, to watch a test click; then
 *  `ANA_UI_SLOW_MS` slows each action by that many milliseconds. Headless is the same Chrome, its
 *  engine, layout and frames, with no window drawn. A shown window takes the screen's focus on
 *  macOS each time a test opens a page, so it is for watching one test; to see what a run did,
 *  record it headless (`ANA_UI_VIDEO`, `openPage`).
 *
 *  One start is the launch and the first context, bounded together at `within`, so that two starts
 *  fit inside Bun's 60 s for the hook. On a loaded host Chrome can stall at its start on commits
 *  that change nothing of the page. A stall is the browser's and no test's, and the test wrapper
 *  runs no failed file again (`tools/runtime/test-suite.ts`), so a stalled start is tried once more
 *  here, saying so; a second stall fails the file's `beforeAll`, and a launch that fails outright
 *  fails it at once. */
export async function launchBrowser(within = START_MS, executable = Bun.env.ANA_UI_CHROME): Promise<Browser> {
  const browser = (await startChrome(within, executable)) ?? (await startChrome(within, executable));
  if (browser !== null) return browser;
  throw new Error(`Chrome stalled at its start twice, ${String(within)} ms each`);
}

/** Chrome once it has opened a context, or `null` where its start has not answered `within` ms of
 *  the launch. A Chrome whose launch stalled is ended with its process group, and one whose first
 *  context stalled is closed without waiting on it. */
async function startChrome(within: number, executable: string | undefined): Promise<Browser | null> {
  const options = {
    headless: Bun.env.ANA_UI_HEADED !== "1",
    slowMo: Number(Bun.env.ANA_UI_SLOW_MS ?? "0"),
    timeout: within,
  };
  const late = Bun.sleep(within).then(() => false);
  const browser = await chromium
    .launch(
      executable === undefined
        ? { channel: "chrome", ...options }
        : { executablePath: executable, ...options },
    )
    .catch(async (error: unknown) => {
      if (!(error instanceof errors.TimeoutError)) throw error;
      // Under Bun, Playwright leaves the process of a launch it timed out running.
      await terminateAndReapProcessGroupId(Number(LAUNCHED.exec(error.message)?.[1]));
      return null;
    });
  if (browser !== null) {
    const answered = browser.newContext().then(async (context) => {
      await context.close();
      return true;
    });
    if (await Promise.race([answered, late])) return browser;
    answered.catch(() => false);
    browser.close().catch(() => false);
  }
  console.error(`browser: Chrome's start did not answer within ${String(within)} ms`);
  return null;
}

/** A fresh context and page at `url` in a `viewport`, recording what goes wrong. The page has loaded
 *  its first campaign reading, or its refusal, when this returns. */
export async function openPage(
  browser: Browser,
  url: string,
  viewport: { readonly width: number; readonly height: number } = DESKTOP,
): Promise<Opened> {
  const context = await browser.newContext({ viewport, colorScheme: "dark" });
  context.setDefaultTimeout(ACTION_MS);
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

/** What the page shows two frames from now: "settled", or why not. */
export function drawn(page: Page): Promise<string> {
  return page.evaluate(async () => {
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    const main = document.querySelector("main");
    if (main === null) return "no main";
    if (document.querySelector("[aria-busy='true']") !== null) return "busy";
    if (main.querySelector("h1, h2, table") === null) return `blank: ${main.innerText.slice(0, 80)}`;
    if (document.body.innerText.includes("is loading")) return "loading";
    return "settled";
  });
}

/** The page reported nothing wrong. */
export function expectQuiet(opened: Opened): void {
  expect(opened.problems).toEqual([]);
}

/** Every answer the page reads from the API, its body kept as it passes: a read the page cancels
 *  for a newer one keeps none to ask for once it has ended, which would fail a test on CI.
 *  A read still in flight when its page closes ends there and is no answer, since under load a test
 *  that timed out could leave one whose `socket hang up` is printed outside any test and fails
 *  `bun run land` on a commit that changed no test. One the page leaves between its arrival and the
 *  reading of its body is disposed, and is no answer either. */
export async function keepAnswers(page: Page): Promise<string[]> {
  const answers: string[] = [];
  await page.route("**/api/**", async (route) => {
    const response = await route.fetch().catch(() => null);
    if (response === null) return;
    const body = await response.text().catch(() => null);
    if (body === null) return;
    answers.push(body);
    await route.fulfill({ response }).catch(() => undefined);
  });
  return answers;
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
