import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "../../../src/meta/filesystem.ts";
import { tmpdir } from "../../../src/meta/os.ts";
import { join } from "../../../src/meta/path.ts";
import { parseJsonAs } from "../../../src/meta/json-runtime.ts";
import {
  type AnswerOf,
  type ApiError,
  type Endpoint,
  PARAMETERS,
  type Query,
  TOKEN_HEADER,
} from "../src/models.ts";
import { handleApiRequest, type ServerOptions } from "../src/server/api.ts";
import { answersOver, type Fixture, writeFixtureCampaign } from "./fixture-campaign.ts";

/** One query of every endpoint. */
type Samples = { readonly [Name in Endpoint]: Query<Name> };

const TOKEN = "fake-token-of-this-test";
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-ui-server-")));
let fixture: Fixture;
let options: ServerOptions;

beforeAll(() => {
  fixture = writeFixtureCampaign(join(scratch, "main"));
  options = { repo: fixture.root, trees: "directory", token: TOKEN, examSide: false };
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A GET of `path` as a browser on the loopback sends it, with the token unless told otherwise. */
function get(
  path: string,
  served: ServerOptions = options,
  headers: Readonly<Record<string, string>> = { host: "127.0.0.1:5173", [TOKEN_HEADER]: TOKEN },
): Response {
  return handleApiRequest(served, new Request(`http://127.0.0.1:5173${path}`, { headers }));
}

/** The fixture's main campaign and one id of each kind of detail in it, read from its own answers. */
function sampleQueries() {
  const answers = answersOver(fixture.root, "exam");
  const key = fixture.key;
  const reading = answers.campaign(key);
  const comparison = reading.comparisons.at(-1);
  if (comparison === undefined) throw new Error("the fixture holds no comparison");
  const detail = answers.move(key, String(comparison.move));
  const solve = detail.kind === "comparison" ? (detail.tasks[0]?.fresh[0]?.id ?? "") : "";
  const digests = reading.harnesses.map((card) => card.digest ?? "");
  const [first = "", last = ""] = [digests[0], digests.at(-1)];
  const grid = answers.tasks(key);
  return {
    campaigns: {},
    campaign: { key },
    move: { key, move: String(comparison.move) },
    solve: { key, id: solve },
    tasks: { key },
    task: { key, id: grid.rows[4]?.version ?? "" },
    log: { key, offset: "100", kind: "solve.finished" },
    event: { key, index: "3" },
    harness: { key, digest: last },
    "harness-file": { key, digest: last, path: "agent/BUILT_AGENTS.md" },
    "harness-diff": { key, a: first, b: last },
  } satisfies Samples;
}

function pathOf<Name extends Endpoint>(endpoint: Name, query: Query<Name>): string {
  const values: Readonly<Record<string, string | undefined>> = query;
  const { required, optional } = PARAMETERS[endpoint];
  const search = new URLSearchParams(
    [...required, ...optional].flatMap((name) => {
      const value = values[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
  return `/api/${endpoint}?${search.toString()}`;
}

describe("the API's refusals", () => {
  test("refuses a request with no token or another token, before reading anything", async () => {
    for (const headers of [
      { host: "127.0.0.1:5173" },
      { host: "127.0.0.1:5173", [TOKEN_HEADER]: "fake-token-that-is-wrong" },
    ]) {
      const response = get("/api/campaigns", options, headers);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ refused: "token" });
    }
  });

  test("refuses a Host that is not the loopback, whatever the token, and answers the loopback names", async () => {
    for (const host of ["evil.example", "127.0.0.1.evil.example:5173", "192.168.1.4:5173"]) {
      const response = get("/api/campaigns", options, { host, [TOKEN_HEADER]: TOKEN });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ refused: "host" });
    }
    for (const host of ["localhost:5173", "127.0.0.1", "[::1]:5173"]) {
      expect(get("/api/campaigns", options, { host, [TOKEN_HEADER]: TOKEN }).status).toBe(200);
    }
  });

  test("refuses the exam-side endpoint without --exam-side and answers it with the flag", async () => {
    const { event } = sampleQueries();
    const refused = get(pathOf("event", event));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ refused: "exam-side" });
    expect(get(pathOf("event", event), { ...options, examSide: true }).status).toBe(200);
  });

  test("answers an unknown endpoint, a missing parameter and a write with a JSON error", async () => {
    const unknown = get("/api/workspace");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: "no endpoint /api/workspace" });
    const missing = get("/api/campaign");
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: "/api/campaign needs key" });
    const write = handleApiRequest(
      options,
      new Request("http://127.0.0.1:5173/api/campaigns", {
        method: "POST",
        headers: { host: "127.0.0.1", [TOKEN_HEADER]: TOKEN },
      }),
    );
    expect(write.status).toBe(405);
  });

  test("answers a directory that holds no campaign with no row and an issue that says why", async () => {
    const response = get("/api/campaigns", { ...options, repo: join(scratch, "nowhere") });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      campaigns: [],
      issues: [{ level: "warning", message: "no .ana/d2 folder here, so no campaign" }],
    });
  });
});

describe("the router", () => {
  test("answers every endpoint with its handler's answer, in the tier the server runs in", async () => {
    const queries = sampleQueries();
    for (const tier of ["default", "exam"] as const) {
      const served = { ...options, examSide: tier === "exam" };
      const answers = answersOver(fixture.root, tier);
      const q = queries;
      const expected = {
        campaigns: answers.campaigns(),
        campaign: answers.campaign(q.campaign.key),
        move: answers.move(q.move.key, q.move.move),
        solve: answers.solve(q.solve.key, q.solve.id),
        tasks: answers.tasks(q.tasks.key),
        task: answers.task(q.task.key, q.task.id),
        log: answers.log(q.log),
        event: answers.event(q.event.key, Number(q.event.index)),
        harness: answers.harness(q.harness.key, q.harness.digest),
        "harness-file": answers.harnessFile(
          q["harness-file"].key,
          q["harness-file"].digest,
          q["harness-file"].path,
        ),
        "harness-diff": answers.harnessDiff(q["harness-diff"].key, q["harness-diff"].a, q["harness-diff"].b),
      } satisfies { readonly [Name in Endpoint]: AnswerOf<Name> };
      // SAFETY: `PARAMETERS` is typed by `satisfies` to hold exactly the keys of `Endpoints`.
      for (const endpoint of Object.keys(PARAMETERS) as Endpoint[]) {
        if (endpoint === "event" && tier === "default") continue;
        const query: Query<typeof endpoint> = queries[endpoint];
        const response = get(pathOf(endpoint, query), served);
        expect({ endpoint, status: response.status }).toEqual({ endpoint, status: 200 });
        expect(await response.json()).toEqual(JSON.parse(JSON.stringify(expected[endpoint])));
      }
    }
  });

  test("refuses a move named by an id two moves share, naming both places, and a place no move starts at", async () => {
    const refused = get(pathOf("move", { key: fixture.key, move: "b-1" }));
    expect(refused.status).toBe(400);
    expect(parseJsonAs<ApiError>(await refused.text()).error).toContain("b-1 names 2 moves");
    expect(get(pathOf("move", { key: fixture.key, move: "1" })).status).toBe(404);
  });
});
