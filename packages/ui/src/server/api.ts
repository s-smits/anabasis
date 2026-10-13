/**
 * The page's API: every `/api/*` request ends here with a JSON answer.
 *
 * Three refusals come before any reading. The server binds the loopback, and a request whose
 * `Host` is not a loopback name is refused, so a page on another origin cannot reach it through a
 * name it controls. Every request carries the token the server printed at its start: on macOS the
 * command wall lets a Builder's or a solver's shell reach the network, so a loopback port alone
 * keeps nothing from them (the brief of 11 October, section 8). And an endpoint the exam tier alone
 * answers (`EXAM_ONLY`) is refused on a server started without `--exam-side`.
 *
 * Nothing here writes. The API reads the campaigns' logs on every request, refolding a log only
 * where its size or its time changed (`logs.ts`), so a step that lands in a log is on the next
 * poll.
 */
import {
  API_PREFIX,
  type AnswerOf,
  type ApiError,
  type Endpoint,
  type Endpoints,
  EXAM_ONLY,
  PARAMETERS,
  type Query,
  type Refusal,
  type Tier,
  TOKEN_HEADER,
} from "../models.ts";
import { campaignAnswer } from "./campaign.ts";
import { campaignsAnswer } from "./campaigns.ts";
import { type Handler, type Reading, type Trees, Unanswerable } from "./context.ts";
import { harnessAnswer, harnessDiffAnswer, harnessFileAnswer } from "./harness.ts";
import { eventAnswer, logAnswer } from "./log.ts";
import { moveAnswer } from "./move.ts";
import { solveAnswer } from "./solve.ts";
import { taskAnswer, tasksAnswer } from "./tasks.ts";
import { capturedJsonStringify } from "../../../../src/meta/json-runtime.ts";
import { errorMessage } from "../../../../src/meta/runtime-values.ts";

/** What the server was started with. */
export interface ServerOptions {
  /** The repository whose worktrees hold the campaigns, or the one directory that does. */
  readonly repo: string;
  readonly trees: Trees;
  /** The token every request must carry, printed once at the start. */
  readonly token: string;
  /** `--exam-side`: answer in the exam tier. */
  readonly examSide: boolean;
}

/** Every endpoint's handler. */
type Handlers = { readonly [Name in Endpoint]: Handler<Name> };

const HANDLERS: Handlers = {
  campaigns: campaignsAnswer,
  campaign: campaignAnswer,
  move: moveAnswer,
  solve: solveAnswer,
  tasks: tasksAnswer,
  task: taskAnswer,
  log: logAnswer,
  event: eventAnswer,
  harness: harnessAnswer,
  "harness-file": harnessFileAnswer,
  "harness-diff": harnessDiffAnswer,
};

const LOOPBACK: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1"]);

function json(status: number, body: AnswerOf<Endpoint> | ApiError): Response {
  return new Response(capturedJsonStringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

const refusal = (refused: Refusal, error: string): Response => json(403, { error, refused });

/** Whether a `Host` header names the loopback. A request with none is refused: every browser and
 *  every HTTP/1.1 client sends one. */
function loopbackHost(host: string | null): boolean {
  if (host === null) return false;
  const named = host.trim().toLowerCase();
  const name = named.startsWith("[") ? named.slice(1, named.indexOf("]")) : named.replace(/:\d+$/u, "");
  return LOOPBACK.has(name);
}

/** The two tokens compared in a time that does not depend on where they first differ. */
function sameToken(offered: string | null, token: string): boolean {
  if (offered === null || offered.length !== token.length) return false;
  let differs = 0;
  for (let index = 0; index < token.length; index += 1) {
    differs |= offered.charCodeAt(index) ^ token.charCodeAt(index);
  }
  return differs === 0;
}

const isEndpoint = (name: string): name is Endpoint => Object.hasOwn(PARAMETERS, name);

/** The 403 for an endpoint the exam tier alone answers, on a server in the default tier; null
 *  where the endpoint may answer. */
function examSideRefusal(endpoint: Endpoint, tier: Tier): Response | null {
  if (tier === "exam" || !EXAM_ONLY.has(endpoint)) return null;
  return refusal(
    "exam-side",
    `/api/${endpoint} is exam-side: start the server with --exam-side to read it, on a host no Builder or solver shares`,
  );
}

/** The query of `endpoint` as the URL carries it, holding every required parameter. */
function queryOf<Name extends Endpoint>(endpoint: Name, url: URL): Query<Name> {
  const { required, optional } = PARAMETERS[endpoint];
  const missing = required.filter((name) => !url.searchParams.has(name));
  if (missing.length > 0) {
    throw new Unanswerable(400, `/api/${endpoint} needs ${missing.join(", ")}`);
  }
  const query: Record<string, string> = {};
  for (const name of [...required, ...optional]) {
    const value = url.searchParams.get(name);
    if (value !== null) query[name] = value;
  }
  // Every required parameter of the endpoint was found above, and the optional ones are present
  // only where the URL holds them: the query each handler is typed to take.
  return query;
}

function answerOf<Name extends Endpoint>(
  endpoint: Name,
  query: Query<Name>,
  reading: Reading,
): Endpoints[Name]["answer"] {
  const handler: Handler<Name> = HANDLERS[endpoint];
  return handler(reading, query);
}

/** Every `/api/*` request, answered. */
export function handleApiRequest(options: ServerOptions, request: Request): Response {
  const url = new URL(request.url);
  if (!loopbackHost(request.headers.get("host"))) {
    return refusal("host", "the API answers a loopback Host alone");
  }
  if (!sameToken(request.headers.get(TOKEN_HEADER), options.token)) {
    return refusal("token", "the API needs the token the server printed at its start");
  }
  if (request.method !== "GET") return json(405, { error: "the API reads and writes nothing" });
  const endpoint = url.pathname.slice(API_PREFIX.length);
  if (!url.pathname.startsWith(API_PREFIX) || !isEndpoint(endpoint)) {
    return json(404, { error: `no endpoint ${url.pathname}` });
  }
  const tier: Tier = options.examSide ? "exam" : "default";
  const refused = examSideRefusal(endpoint, tier);
  if (refused !== null) return refused;
  try {
    const query = queryOf(endpoint, url);
    return json(200, answerOf(endpoint, query, { repo: options.repo, trees: options.trees, tier }));
  } catch (error) {
    return json(error instanceof Unanswerable ? error.status : 500, { error: errorMessage(error) });
  }
}
