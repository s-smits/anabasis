/**
 * The page in a real browser for the smoke tests (`browser-smoke.test.ts`): the fixture written
 * once a file, `serve.ts` started on it as the operator starts it, and Chrome driven by Playwright.
 * They run Chrome as installed (`channel: "chrome"`), or `ANA_UI_CHROME`, and a host without either
 * fails the launch rather than skipping. Assertions are Playwright's web-first ones, which retry,
 * so no test sleeps; its `expect` works under `bun:test` as it is. Every page records console
 * errors and warnings, uncaught exceptions and failed API answers, and a test ends by asserting
 * that list empty (`expectQuiet`).
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

export interface Served {
  readonly url: (query?: string) => string;
  readonly stop: () => Promise<void>;
  readonly fixture: Fixture;
}

export interface Opened {
  readonly page: Page;
  readonly context: BrowserContext;
  /** Console errors and warnings, uncaught exceptions and failed API answers, in order. */
  readonly problems: string[];
}

const PACKAGE = join(import.meta.dir, "..");
const STARTED = /anabasis at (http:\/\/127\.0\.0\.1:\d+)\/\?token=([0-9a-f]+)/u;
const START_MS = 20_000;
const LAUNCHED = /<launched> pid=(\d+)/u;
/** How long one load, click or other action may wait: at Playwright's own 30 s, two waits fill the
 *  test's 60 s and the stuck step names nothing; at 15 s it fails with its own message. */
const ACTION_MS = 15_000;
/** Playwright's web-first assertions, retried as long as an action may wait: its own `expect` gives
 *  up at 5 s, which `setDefaultTimeout` does not reach, and fails a loaded host's gate. */
export const expect = web.configure({ timeout: ACTION_MS });
const DESKTOP = { width: 1440, height: 1000 } as const;
export const PHONE = { width: 390, height: 844 } as const;

export async function serveFixture(): Promise<Served> {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-ui-browser-")));
  const fixture = writeFixtureCampaign(join(scratch, "repo"));
  const child = Bun.spawn(["bun", "serve.ts", "--repo", fixture.root], {
    cwd: PACKAGE,
    env: { ...Bun.env, PORT: "0" },
    stdin: "pipe",
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

/** The origin and the token of the line `serve.ts` prints at its start, within `START_MS`. Each
 *  read races that bound, so a server that prints nothing fails before Bun's 60 s hook timeout. */
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

/** Chrome, headless unless `ANA_UI_HEADED=1` (with `ANA_UI_SLOW_MS` per action) asks for its window
 *  to watch one test; to see a run, record it headless (`ANA_UI_VIDEO`). A launch and its first
 *  context are bounded together at `within`, so two starts fit in Bun's 60 s hook. A stall is the
 *  browser's and no test's, and the test wrapper runs no failed file again
 *  (`tools/runtime/test-suite.ts`), so a stalled start is tried once more here, saying so. */
export async function launchBrowser(within = START_MS, executable = Bun.env.ANA_UI_CHROME): Promise<Browser> {
  const browser = (await startChrome(within, executable)) ?? (await startChrome(within, executable));
  if (browser !== null) return browser;
  throw new Error(`Chrome stalled at its start twice, ${String(within)} ms each`);
}

/** Chrome once it has opened a context, or `null` where its start has not answered `within` ms of
 *  the launch. A stalled launch is ended with its process group, and a stalled first context closed
 *  without waiting on it. */
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

export function expectQuiet(opened: Opened): void {
  expect(opened.problems).toEqual([]);
}

/** Every answer the page reads from the API, its body kept as it passes, since a read the page
 *  cancels for a newer one keeps none to ask for later. A read still in flight when its page
 *  closes, or left between its arrival and its body, is no answer: under load its `socket hang up`
 *  would print outside any test and fail `bun run land`. */
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

export async function accessibilityViolations(page: Page, within?: string): Promise<string[]> {
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  const results = await (within === undefined ? builder : builder.include(within)).analyze();
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(" ")).join(", ")})`,
  );
}
