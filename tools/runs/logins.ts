/**
 * How much of each login's 5-hour and weekly window is used, when each runs out at its pace so far,
 * and, read over every login, when the pool runs out: what a move to another login asks before it
 * chooses one (`room`, `keep.ts`).
 *
 *   bun --env-file=<file> run runs usage [N ...] [--json]
 *
 * A login is `CLAUDE_CODE_OAUTH_TOKEN<N>` in this process's environment, which Bun's own
 * `--env-file` loads: the verb opens no file of credentials, and prints no token. With no number it
 * reads every login the environment holds.
 *
 * Two routes, the first taken from steipete/CodexBar@afeb28146cec
 * (Sources/CodexBarCore/Providers/Claude/ClaudeOAuth/ClaudeOAuthUsageFetcher.swift): GET
 * /api/oauth/usage with its headers, window keys, `limits` entries and `extra_usage`. That endpoint
 * needs the `user:profile` scope, and a `claude setup-token` token carries only `user:inference`
 * (403 oauth_scope_insufficient), so for those the verb reads the `anthropic-ratelimit-unified-*`
 * headers off a one-token Haiku call instead: the numbers the CLI shows, for one output token.
 *
 * The pool: a run moves to another login when one is spent, so demand is one rate, in % of one
 * login's week an hour, summed over the logins; the forecast spends it in five-minute steps for
 * the next 4 weeks from the login whose week resets soonest, each refilling to 100% at its reset.
 * Two paces: the week's, each login's share over its window so far (floored at 12 hours, so a
 * window minutes old does not extrapolate), and the recent one, from the readings kept in the main
 * main worktree's `.ana/logins-history.jsonl` (8 days): a login still in the window of a reading 2 to 24
 * hours old gives its rise since, any other its week's pace. The 5-hour windows are left out: they
 * cap how fast one login spends, not what a week holds.
 *
 * `bun run runs active` names the runs a process writes, by the login each run's last launch named,
 * and the live seats of `system-path-simulation`, by the login each seat names (`liveHere`),
 * on this machine and every host `ANA_HOSTS` lists (`liveEverywhere`), and asks no
 * provider, and `usage` puts each login's count on its head line, out of the most `ANA_LOGIN_RUNS`
 * lets that login carry (`capOf`). Until 22 October that count took `status` on every host and a
 * tally by hand before each launch, a continue or a move.
 *
 * Each reading keeps that count beside each login's week, and the rises between readings over the
 * runs counted give the share of a week a run spends an hour (`perRunRate`). The most a login
 * carries is then the lower of its cap and the runs its week left fits until its reset, each run
 * active 16 of 24 hours (`fitOf`), and a login with more live runs than that reads oversubscribed
 * (`carried`): a cap of two read 0/2 on a login at 92% of its week with 11 hours of it left.
 * Until that rate is measured, a login with live runs reads its own week's pace shared over them
 * (`perRunHour`).
 *
 * `ANA_LOGINS` in the environment, such as `2,3,4`, names the logins a run may take (`allowedLogins`),
 * every login the environment holds where it is unset. Until 15 October this was a script of the
 * operator's, which read the checkout's `.env` itself, and a shell loop applied the room rule.
 */
import { openingOf, SEATS } from "#src/campaign/opening.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { mainTree } from "#src/meta/git.ts";
import { capturedJsonParse, capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { keysIf } from "#src/meta/optional-key.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { looseFlagsOf } from "../d2/campaign-terms.ts";
import { recordedSetting } from "../d2/setting.ts";
import { asked } from "./hosts.ts";
import { hostsOf } from "./host-config.ts";
import { type Live, liveHere, liveOf } from "./live.ts";

interface Window {
  readonly pct: number | null;
  readonly resetsAt: string | null;
  readonly status?: string;
}

interface Read {
  readonly via: "oauth-usage" | "ratelimit-headers";
  readonly fiveHour: Window;
  readonly sevenDay: Window;
  readonly notes: readonly string[];
}

/** One login's reading, or why there is none. */
export type Reading = { readonly login: string; readonly plain: boolean } & (Read | Failed);

interface Failed {
  readonly error: string;
}
interface Week {
  readonly login: string;
  readonly pct: number;
  readonly reset: number;
}
interface Snapshot {
  readonly at: number;
  readonly weeks: Record<string, { pct: number; reset: number }>;
  /** Each login's live runs when the reading was taken; readings before 22 October hold none. */
  readonly runs?: Record<string, number>;
}

const TOKEN = "CLAUDE_CODE_OAUTH_TOKEN";
const BASE = "https://api.anthropic.com";
const BETA = "oauth-2025-04-20";
const TIMEOUT_MS = 30_000;
const HOUR = 3_600_000;
const WEEK = 168 * HOUR;
const AHEAD = 4 * WEEK;
const STEP = HOUR / 12;
const KEPT_MS = 8 * 24 * HOUR;
/** The share of a day a run is taken to be active when a week is read for how many runs it fits:
 *  16 of 24 hours (operator, 22 October). */
const ACTIVE_SHARE = 16 / 24;
/** Fewer run-hours than this on record measure no rate a run spends (`perRunRate`). */
const LEAST_RUN_HOURS = 6;
const NOTED = [
  ["seven_day_opus", "opus"],
  ["seven_day_sonnet", "sonnet"],
  ["seven_day_oauth_apps", "oauth apps"],
  ["seven_day_routines", "routines"],
] as const;

/** Every login `env` holds, by its number. */
function loginsIn(env: Readonly<Record<string, string | undefined>>): string[] {
  return Object.keys(env)
    .flatMap((key) => new RegExp(`^${TOKEN}(\\d+)$`).exec(key)?.[1] ?? [])
    .toSorted((one, other) => Number(one) - Number(other));
}

/** The logins a run may take: those `ANA_LOGINS` names, or every login `env` holds. */
export function allowedLogins(env: Readonly<Record<string, string | undefined>>): string[] {
  const named = env.ANA_LOGINS?.split(",")
    .map((login) => login.trim())
    .filter((login) => login !== "");
  return named === undefined || named.length === 0 ? loginsIn(env) : named;
}

/** Whether a run bills a Claude login: whether an effective seat is a `claude/` model. The last
 *  flag for each seat overrides its opening, with the setting as the solver's fallback. The pickers
 *  that choose a login (`fresh`, `keep`) ask it; the launcher names only the login it is given. */
export function billsLogin(events: readonly LogEvent[], flags: readonly string[]): boolean {
  const values = looseFlagsOf(flags);
  const opening = openingOf(events);
  return [
    ...SEATS.map((seat) => values[seat] ?? opening?.seats[seat]?.model),
    values.solver ?? opening?.solver?.model ?? recordedSetting(events)?.solver?.model,
  ].some((model) => isString(model) && model.startsWith("claude/"));
}

/** The most live runs `login` may carry, from `ANA_LOGIN_RUNS` such as `2,1:4`: a bare number for
 *  every login, `N:most` for login N. `null` where it names neither. */
export function capOf(env: Readonly<Record<string, string | undefined>>, login: string): string | null {
  const entries = (env.ANA_LOGIN_RUNS ?? "").split(",").map((entry) => entry.trim().split(":"));
  return (
    entries.find(([who, most]) => who === login && most !== undefined)?.[1] ??
    entries.find(([most, rest]) => most !== "" && rest === undefined)?.[0] ??
    null
  );
}

/** The usage endpoint's window `value`: its share used and its reset. */
function windowOf(value: JsonValue | undefined): Window {
  const window = asRecord(value);
  const used = window?.utilization;
  const reset = window?.resets_at;
  return { pct: isNumber(used) ? used : null, resetsAt: isString(reset) ? reset : null };
}

async function viaOAuthUsage(token: string, agent: string): Promise<Read | Failed> {
  const res = await fetch(`${BASE}/api/oauth/usage`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "content-type": "application/json",
      "anthropic-beta": BETA,
      "user-agent": agent,
    },
  });
  if (res.status === 401) return { error: "OAuth request unauthorized: the token needs a new login" };
  if (res.status === 429) {
    return {
      error: `the usage endpoint is rate limited (Retry-After ${res.headers.get("retry-after") ?? "?"})`,
    };
  }
  if (!res.ok) {
    const code = /"error_code":"([^"]+)"/.exec(await res.text())?.[1];
    return { error: `OAuth error: HTTP ${String(res.status)}${code === undefined ? "" : ` – ${code}`}` };
  }
  const body = asRecord(capturedJsonParse(await res.text())) ?? {};
  const notes = NOTED.flatMap(([key, label]) => {
    const { pct } = windowOf(body[key]);
    return pct === null ? [] : [`${label} week ${String(Math.round(pct))}%`];
  });
  for (const entry of Array.isArray(body.limits) ? body.limits : []) {
    const limit = asRecord(entry);
    const model = asRecord(asRecord(limit?.scope)?.model)?.display_name;
    const percent = limit?.percent;
    if (isString(model) && isNumber(percent)) {
      const group = [limit?.group, limit?.kind].find(isString) ?? "";
      notes.push(`${model} ${group} ${String(Math.round(percent))}%`.replace(/\s+/g, " "));
    }
  }
  const extra = asRecord(body.extra_usage);
  if (extra?.is_enabled === true) {
    const currency = isString(extra.currency) ? extra.currency : "";
    const used = isNumber(extra.used_credits) ? extra.used_credits : 0;
    const limit = isNumber(extra.monthly_limit) ? String(extra.monthly_limit) : "?";
    notes.push(`extra usage ${String(used)}/${limit} ${currency}`.trim());
  }
  return {
    via: "oauth-usage",
    fiveHour: windowOf(body.five_hour),
    sevenDay: windowOf(body.seven_day),
    notes,
  };
}

async function viaRateLimitHeaders(token: string, agent: string): Promise<Read | Failed> {
  const res = await fetch(`${BASE}/v1/messages`, {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${token}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": BETA,
      "content-type": "application/json",
      "user-agent": agent,
    },
    body: capturedJsonStringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1,
      system: "You are Claude Code, Anthropic's official CLI for Claude.",
      messages: [{ role: "user", content: "." }],
    }),
  });
  const header = (key: string) => res.headers.get(`anthropic-ratelimit-unified-${key}`);
  if (header("5h-utilization") === null && header("7d-utilization") === null) {
    const revoked = res.status === 401 ? " (token revoked or expired)" : "";
    return { error: `messages HTTP ${String(res.status)}, no rate-limit headers${revoked}` };
  }
  const win = (key: string): Window => {
    const used = header(`${key}-utilization`);
    const reset = header(`${key}-reset`);
    const window: Window = {
      pct: used === null ? null : Number(used) * 100,
      resetsAt:
        reset === null ? null : /^\d+$/.test(reset) ? new Date(Number(reset) * 1000).toISOString() : reset,
    };
    const status = header(`${key}-status`);
    return status === null ? window : { ...window, status };
  };
  const overage = header("overage-status");
  const why = header("overage-disabled-reason");
  const claim = header("representative-claim");
  const notes = [
    ...(overage === null ? [] : [`overage ${overage}${why === null ? "" : ` (${why})`}`]),
    ...(claim === null ? [] : [`binding ${claim}`]),
  ];
  return { via: "ratelimit-headers", fiveHour: win("5h"), sevenDay: win("7d"), notes };
}

/** Each of `wanted` read from `env`, by the first route that answers. */
export async function readLogins(
  wanted: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<Reading[]> {
  const said = runSync(["claude", "--version"]);
  const version = said.exitCode === 0 ? decodeOutput(said.stdout).trim().split(/\s+/)[0] : undefined;
  // CodexBar's fallbackClaudeCodeVersion where no CLI answers.
  const agent = `claude-code/${version === undefined || version === "" ? "2.1.0" : version}`;
  return Promise.all(
    wanted.map(async (login): Promise<Reading> => {
      const token = env[`${TOKEN}${login}`];
      if (token === undefined || token === "") {
        return { login, plain: false, error: `no ${TOKEN}${login} in the environment` };
      }
      const plain = env[TOKEN] === token;
      try {
        const first = await viaOAuthUsage(token, agent);
        if (!("error" in first)) return { login, plain, ...first };
        const second = await viaRateLimitHeaders(token, agent);
        if (!("error" in second)) return { login, plain, ...second };
        return { login, plain, error: `${first.error}; ${second.error}` };
      } catch (error) {
        return { login, plain, error: errorMessage(error) };
      }
    }),
  );
}

const resetOf = (iso: string | null): number | null => {
  const at = iso === null ? Number.NaN : new Date(iso).getTime();
  return Number.isNaN(at) ? null : at;
};

/** The logins of `readings` a run may move to, the week that resets soonest first: in `allowed`,
 *  not in `spent`, neither window used up or refused. A nearly spent week is taken first where it
 *  resets first, so each login's week is used before it resets, and a run that meets the limit
 *  waits it out or moves on (operator, 25 October; until then a week past 90% was left). */
export function room(
  readings: readonly Reading[],
  allowed: readonly string[],
  spent: ReadonlySet<string>,
): string[] {
  const open = (window: Window) =>
    (window.status ?? "allowed").startsWith("allowed") && (window.pct ?? 0) < 100;
  return readings
    .flatMap((reading) =>
      "error" in reading ||
      !allowed.includes(reading.login) ||
      spent.has(reading.login) ||
      !open(reading.sevenDay) ||
      !open(reading.fiveHour)
        ? []
        : [{ login: reading.login, reset: resetOf(reading.sevenDay.resetsAt) ?? Number.POSITIVE_INFINITY }],
    )
    .toSorted((one, other) => one.reset - other.reset)
    .map(({ login }) => login);
}

const spanOf = (mins: number): string =>
  mins >= 1440
    ? `${String(Math.floor(mins / 1440))}d${String(Math.floor((mins % 1440) / 60))}h`
    : `${String(Math.floor(mins / 60))}h${String(mins % 60).padStart(2, "0")}m`;
const clock = (at: number): string =>
  new Date(at).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
const stamp = (at: number): string =>
  new Date(at)
    .toLocaleString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(" at ", " ");

/** When `window` of `length` minutes runs out at the pace it was used so far: it opened `length`
 *  minutes before its reset, so 40% in the first 2 of 7 days runs out 3 days on. */
function pace(window: Window, length: number, now: number): string {
  const reset = resetOf(window.resetsAt);
  if (reset === null || window.pct === null) return "";
  if (window.pct >= 100) return "spent";
  const left = (reset - now) / 60_000;
  const used = length - left;
  if (window.pct <= 0 || used <= 0) return "lasts";
  const mins = Math.round(((100 - window.pct) * used) / window.pct);
  return mins >= left
    ? `lasts, ~${String(Math.round((window.pct * length) / used))}% at reset`
    : `ends in ${spanOf(mins)} (${clock(now + mins * 60_000)})`;
}

function shown(window: Window, length: number, now: number): string {
  const filled = window.pct === null ? null : Math.min(20, Math.round(window.pct / 5));
  const bar = filled === null ? "?".repeat(20) : "#".repeat(filled) + ".".repeat(20 - filled);
  const pct = window.pct === null ? "  ?" : `${String(Math.round(window.pct)).padStart(3)}%`;
  const reset = resetOf(window.resetsAt);
  const until =
    reset === null
      ? ""
      : `resets in ${spanOf(Math.max(0, Math.round((reset - now) / 60_000))).padEnd(6)} (${clock(reset)})`;
  const status = window.status !== undefined && window.status !== "allowed";
  const tail = status
    ? `  ${pace(window, length, now).padEnd(26)}  [${String(window.status)}]`
    : `  ${pace(window, length, now)}`;
  return `[${bar}] ${pct}  ${until}${tail.trimEnd()}`;
}

/** When the pool of `weeks` runs dry at `rate`, in % of one login's week an hour. */
function forecast(weeks: readonly Week[], rate: number, now: number): string {
  const pool = weeks.map((week) => ({
    login: week.login,
    left: Math.max(0, 100 - week.pct),
    reset: week.reset,
  }));
  const gaps: { from: number; to: number | null; by: string }[] = [];
  let lowest = { left: Number.POSITIVE_INFINITY, at: now };
  for (let at = now; at < now + AHEAD; at += STEP) {
    const refilled = pool.filter((login) => at >= login.reset);
    for (const login of refilled) Object.assign(login, { left: 100, reset: login.reset + WEEK });
    let need = (rate * STEP) / HOUR;
    for (const login of pool.toSorted((one, other) => one.reset - other.reset)) {
      const take = Math.min(login.left, need);
      login.left -= take;
      need -= take;
    }
    const open = gaps.at(-1)?.to === null ? gaps.at(-1) : undefined;
    if (need > 1e-9) {
      if (open === undefined) gaps.push({ from: at, to: null, by: "" });
    } else if (open !== undefined) {
      Object.assign(open, { to: at, by: refilled.map(({ login }) => `login ${login}`).join(", ") });
    }
    const left = pool.reduce((sum, login) => sum + login.left, 0);
    if (at < now + WEEK && left < lowest.left) lowest = { left, at };
  }
  const lasting = (gap: (typeof gaps)[number]) => (gap.to ?? now + AHEAD) - gap.from;
  const said = (gap: (typeof gaps)[number]) =>
    `${gap.from - now < STEP ? "now" : `in ${spanOf(Math.round((gap.from - now) / 60_000))} (${stamp(gap.from)})`} for ${spanOf(Math.round(lasting(gap) / 60_000))}` +
    (gap.to === null ? "+" : gap.by === "" ? "" : `, till ${gap.by} resets`);
  const [first] = gaps;
  if (first === undefined || first.from >= now + WEEK) {
    const week = `makes the next 7d, lowest ~${String(Math.round(lowest.left))}% of one login left (${stamp(lowest.at)})`;
    return `${week}; ${first === undefined ? "lasts the 4 weeks looked ahead" : `then all out ${said(first)}`}`;
  }
  const inWeek = gaps.filter((gap) => gap.from < now + WEEK);
  const out = inWeek.reduce(
    (sum, gap) => sum + Math.min(gap.to ?? Number.POSITIVE_INFINITY, now + WEEK) - gap.from,
    0,
  );
  const longest = inWeek.reduce((one, other) => (lasting(other) > lasting(one) ? other : one));
  return `all out ${said(first)} · ${String(Math.round(out / HOUR))}h out over the next 7d${longest === first ? "" : `, longest ${said(longest)}`}`;
}

/** The pool's lines over `weeks`, each login's recent pace read from `history`. */
function poolLines(
  weeks: readonly Week[],
  history: readonly Snapshot[],
  unread: number,
  now: number,
): string[] {
  const perDay = (rate: number) => `~${String(Math.round(rate * 24))}%/day`;
  const weekRate = (week: Week) => paceOf(week, now);
  // The oldest reading 2 to 24 hours back in the same window (resets agree within an hour).
  const recents = weeks.map((week) => {
    const then = history.find(({ at, weeks: read }) => {
      const was = read[week.login];
      return (
        was !== undefined &&
        now - at >= 2 * HOUR &&
        now - at <= 24 * HOUR &&
        Math.abs(was.reset - week.reset) < HOUR
      );
    });
    const hours = then === undefined ? 0 : (now - then.at) / HOUR;
    const was = then?.weeks[week.login]?.pct ?? 0;
    return then === undefined ? null : { rate: Math.max(0, week.pct - was) / hours, hours };
  });
  const weekPace = weeks.reduce((sum, week) => sum + weekRate(week), 0);
  const lines = [
    `pool  ${perDay(weekPace)} of one login's week at the week's pace; ${String(weeks.length)} login${weeks.length > 1 ? "s" : ""} refill ~${String(Math.round((weeks.length * 100) / 7))}%/day` +
      (unread > 0 ? ` (${String(unread)} unread, left out)` : ""),
    `  week pace    ${forecast(weeks, weekPace, now)}`,
  ];
  if (recents.every((recent) => recent === null)) {
    return [...lines, "  last hours   no reading 2 to 24h old yet; run again later for the recent pace"];
  }
  const recent = weeks.reduce((sum, week, at) => sum + (recents[at]?.rate ?? weekRate(week)), 0);
  const hours = Math.round(Math.max(...recents.map((one) => one?.hours ?? 0)));
  return [
    ...lines,
    `  last ${`${String(hours)}h`.padEnd(7)} ${perDay(recent)}: ${forecast(weeks, recent, now)}`,
  ];
}

/** The share of one login's week a live run spends an hour, over `history`: each login's rise
 *  between two readings a quarter of an hour to 3 hours apart in one window, over the runs the
 *  earlier reading counted on it. A person's own session on a login is charged to its runs, so the
 *  rate errs high. Null below `LEAST_RUN_HOURS`. */
export function perRunRate(history: readonly Snapshot[]): number | null {
  const sorted = history.toSorted((one, other) => one.at - other.at);
  const spans = sorted.flatMap((then, at) => {
    const next = sorted[at + 1];
    const hours = next === undefined ? 0 : (next.at - then.at) / HOUR;
    if (next === undefined || hours < 0.25 || hours > 3) return [];
    return Object.entries(then.runs ?? {}).flatMap(([login, runs]) => {
      const [was, now] = [then.weeks[login], next.weeks[login]];
      return runs === 0 || was === undefined || now === undefined || Math.abs(was.reset - now.reset) >= HOUR
        ? []
        : [{ used: Math.max(0, now.pct - was.pct), runHours: runs * hours }];
    });
  });
  const runHours = spans.reduce((sum, span) => sum + span.runHours, 0);
  return runHours < LEAST_RUN_HOURS ? null : spans.reduce((sum, span) => sum + span.used, 0) / runHours;
}

/** The share of its week `week` has spent an hour since it opened, floored at 12 hours so a window
 *  minutes old does not extrapolate. */
const paceOf = (week: Week, now: number) => week.pct / Math.max(12, (now - (week.reset - WEEK)) / HOUR);

/** What one of `on` live runs on `week` spends an hour of the clock: the measured rate, active
 *  `ACTIVE_SHARE` of the time, or before there is one the week's own pace shared over its runs, so
 *  70% in 4 days with two runs left on it reads about 0.36% a run an hour. Null with neither. */
export function perRunHour(week: Week, on: number, rate: number | null, now: number): number | null {
  if (rate !== null) return rate * ACTIVE_SHARE;
  return on > 0 ? paceOf(week, now) / on : null;
}

/** How many runs `week` carries to its reset, each spending `perHour` of it an hour; null without
 *  a rate. */
export function fitOf(week: Week, perHour: number | null, now: number): number | null {
  if (perHour === null) return null;
  const need = perHour * Math.max(0, (week.reset - now) / HOUR);
  return need <= 0 ? Number.POSITIVE_INFINITY : Math.floor(Math.max(0, 100 - week.pct) / need);
}

/** A login's live runs out of the most it carries, the lower of its cap (`capOf`) and what its
 *  week fits (`fitOf`), and whether more run on it than its week fits. Until 22 October the most
 *  was the cap alone, and a login at 92% of its week read 0/2 with 11 hours of it left. */
export function carried(on: number, cap: string | null, fit: number | null): string {
  const fits = fit !== null && Number.isFinite(fit) ? fit : null;
  const most = [cap === null ? null : Number(cap), fits].filter((one): one is number => one !== null);
  const of = most.length === 0 ? "" : `/${String(Math.min(...most))}`;
  return `${String(on)}${of} active${fits !== null && on > fits ? " · oversubscribed" : ""}`;
}

/** The runs a process writes on this machine and on every host that answered, and the hosts that
 *  did not. Each host answers `active --here` with one JSON list; any other answer leaves it
 *  uncounted, since on 22 October a tree that predates the verb answered with nothing and exit 0,
 *  which as lines would have read as no run live. */
export async function liveEverywhere(
  mode: "prepared" | "configured" = "prepared",
): Promise<{ live: Live[]; unasked: string[] }> {
  const answers = (await asked(["active", "--here"], hostsOf(), mode)).map(({ host, lines }) => ({
    host: host.name,
    live: liveOf(host.name, lines),
  }));
  return {
    live: [...liveHere(), ...answers.flatMap(({ live }) => live ?? [])],
    unasked: answers.flatMap(({ host, live }) => (live === null ? [host] : [])),
  };
}

const uncounted = (hosts: readonly string[]) => `not counted on ${hosts.join(", ")}: no answer to \`active\``;

/** One line a login of the runs in `live`, each login `allowed` names first, then any other a run
 *  names and the runs that name none, and the hosts in `unasked` that went uncounted. */
export function activeLines(
  live: readonly Live[],
  allowed: readonly string[],
  unasked: readonly string[],
): string[] {
  const named = [...new Set([...allowed, ...live.flatMap(({ login }) => login ?? [])])];
  const lines = [...named, null].flatMap((login) => {
    const on = live.filter((run) => run.login === login).map(({ name, host }) => `${name} (${host})`);
    if (login === null && on.length === 0) return [];
    const head = login === null ? "no login" : `login ${login}`;
    return [
      `${head.padEnd(10)}${on.length === 0 ? "none live" : `${String(on.length)} live: ${on.join(", ")}`}`,
    ];
  });
  return unasked.length === 0
    ? lines
    : [...lines, `not counted on ${unasked.join(", ")}: no answer to \`active\``];
}

/** `bun run runs active [--here]`: the live runs on each login, on every host; with `--here` this
 *  machine's alone, as one JSON list, which is what each host is asked. */
export async function active(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      here: { type: "boolean", default: false },
      login: { type: "string" },
    },
  });
  if (values.here) {
    console.log(
      capturedJsonStringify(
        values.login === undefined ? liveHere() : loginsIn(runtimeProcess.env).includes(values.login),
      ),
    );
    return;
  }
  const { live, unasked } = await liveEverywhere();
  console.log(activeLines(live, allowedLogins(runtimeProcess.env), unasked).join("\n"));
}

/** `bun run runs usage`. */
export async function logins(args: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { json: { type: "boolean", default: false } },
  });
  const held = loginsIn(runtimeProcess.env);
  if (held.length === 0) {
    throw new Error(`no ${TOKEN}<N> is set: run the verb under bun --env-file=<the file that holds them>`);
  }
  // Every host is asked for its live runs while the logins are read.
  const [readings, counted] = await Promise.all([
    readLogins(positionals.length > 0 ? positionals : held, runtimeProcess.env),
    values.json ? null : liveEverywhere(),
  ]);
  const now = Date.now();
  const weeks = readings.flatMap((reading): Week[] => {
    const reset = "error" in reading ? null : resetOf(reading.sevenDay.resetsAt);
    return "error" in reading || reading.sevenDay.pct === null || reset === null
      ? []
      : [{ login: reading.login, pct: reading.sevenDay.pct, reset }];
  });
  const history = join(mainTree(runtimeProcess.cwd()), ".ana", "logins-history.jsonl");
  const kept = existsSync(history)
    ? readFileSync(history, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => parseJsonAs<Snapshot>(line))
    : [];
  const rate = perRunRate(kept);
  const onEach = (login: string) => counted?.live.filter((run) => run.login === login).length ?? 0;
  if (values.json) console.log(capturedJsonStringify(readings, null, 2));
  for (const reading of values.json ? [] : readings) {
    const week = weeks.find(({ login }) => login === reading.login);
    const fit =
      week === undefined ? null : fitOf(week, perRunHour(week, onEach(reading.login), rate, now), now);
    const runsOn =
      counted === null
        ? ""
        : ` · ${carried(onEach(reading.login), capOf(runtimeProcess.env, reading.login), fit)}`;
    const head = `login ${reading.login}${runsOn}${reading.plain ? `  (= plain ${TOKEN})` : ""}`;
    console.log(
      "error" in reading
        ? `${head}\n  ${reading.error}`
        : `${head}\n  5h    ${shown(reading.fiveHour, 5 * 60, now)}\n  week  ${shown(reading.sevenDay, 7 * 1440, now)}${reading.notes.length > 0 ? `\n  ${reading.notes.join(" · ")}` : ""}`,
    );
  }
  if ((counted?.unasked.length ?? 0) > 0) console.log(uncounted(counted?.unasked ?? []));
  if (!values.json && positionals.length === 0 && weeks.length > 0) {
    console.log(poolLines(weeks, kept, held.length - weeks.length, now).join("\n"));
    console.log(
      rate === null
        ? `  a run       no measured rate yet (under ${String(LEAST_RUN_HOURS)} run-hours): each login's week pace over its live runs`
        : `  a run       ~${rate.toFixed(2)}% of a login's week an hour, active ${String(Math.round(ACTIVE_SHARE * 24))} of 24h: the most each login carries to its reset`,
    );
  }
  if (weeks.length === 0) return;
  mkdirSync(dirname(history), { recursive: true });
  const snapshot: Snapshot = {
    at: now,
    weeks: Object.fromEntries(weeks.map(({ login, pct, reset }) => [login, { pct, reset }])),
    ...keysIf(counted !== null, () => ({
      runs: Object.fromEntries(weeks.map(({ login }) => [login, onEach(login)])),
    })),
  };
  const lines = [...kept.filter(({ at }) => now - at < KEPT_MS), snapshot].map((one) =>
    capturedJsonStringify(one),
  );
  writeFileSync(history, `${lines.join("\n")}\n`);
}
