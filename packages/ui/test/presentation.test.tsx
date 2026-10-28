import { afterAll, beforeAll, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtempSync, realpathSync, rmSync } from "../../../src/meta/filesystem.ts";
import { tmpdir } from "../../../src/meta/os.ts";
import { join } from "../../../src/meta/path.ts";
import { Picker } from "../src/components/picker.tsx";
import { RecordView } from "../src/components/record.tsx";
import { matchesTerms, ToolCallDetail } from "../src/components/tool-call.tsx";
import type { Live } from "../src/live.ts";
import type { AnswerOf } from "../src/models.ts";
import { type Navigation, type RouteChange, routeOf } from "../src/route.ts";
import { Shell, selectionOf } from "../src/shell.tsx";
import { answersOver, type Fixture, writeFixtureCampaign } from "./fixture-campaign.ts";

const CALL = {
  index: 12,
  at: "2026-10-10T08:00:05.000Z",
  seq: 3,
  turn: 1,
  tool: "bash",
  args: { command: "ls .toolchain && echo '<tag>'", timeout: 120 },
  isError: true,
  result: "ls: .toolchain: No such file or directory",
  truncated: false,
  ms: 156.4,
};
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-ui-presentation-")));
let fixture: Fixture;

beforeAll(() => {
  fixture = writeFixtureCampaign(join(scratch, "main"));
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A hook's state once its answer has arrived. */
function arrived<Answer>(data: Answer): Live<Answer> {
  return { data, key: "sample", current: true, loading: false, error: null, refused: null };
}

function navigationAt(search: string, moves: RouteChange[] = []): Navigation {
  return {
    route: routeOf(search),
    push: (change) => moves.push(change),
    replace: (change) => moves.push(change),
  };
}

test("the selection falls back to the newest campaign of the route's project, and the route's campaign names its project", () => {
  const campaigns = answersOver(fixture.root, "default").campaigns();
  const newest = selectionOf(campaigns, routeOf(""));
  expect(newest.campaign).toBe(fixture.key);
  expect(newest.projects).toHaveLength(2);
  expect(newest.campaigns.map((row) => row.name)).toEqual([fixture.name, fixture.early]);
  const units = campaigns.campaigns.find((row) => row.name === fixture.units);
  const named = selectionOf(campaigns, routeOf(`?campaign=${encodeURIComponent(units?.key ?? "")}`));
  expect([named.project, named.campaign]).toEqual([units?.project ?? null, units?.key ?? null]);
  expect([newest.project, units?.project]).toEqual([fixture.projects.vowels, fixture.projects.units]);
  const gone = selectionOf(campaigns, routeOf("?campaign=elsewhere%2Fgone"));
  expect(gone.campaign).toBe(newest.campaign);
  expect(selectionOf(null, routeOf("")).campaign).toBeNull();
});

test("the shell says what is missing before a campaign is read, and asks for the token when it was refused", () => {
  const navigation = navigationAt("");
  const waiting: Live<AnswerOf<"campaign">> = {
    data: null,
    key: null,
    current: false,
    loading: true,
    error: null,
    refused: null,
  };
  const list = arrived(answersOver(fixture.root, "default").campaigns());
  expect(
    renderToStaticMarkup(<Shell navigation={navigation} campaigns={list} reading={waiting} />),
  ).toContain("Reading the campaign");
  const refused: Live<AnswerOf<"campaigns">> = {
    data: null,
    key: null,
    current: false,
    loading: false,
    error: "the API needs the token",
    refused: "token",
  };
  expect(
    renderToStaticMarkup(<Shell navigation={navigation} campaigns={refused} reading={waiting} />),
  ).toContain("the address the server printed");
});

test("an inspected record opens nested objects and items with their values visible", () => {
  const html = renderToStaticMarkup(
    <RecordView
      value={{ seats: { builder: [{ model: "recorded-model", enabled: false }] } }}
      defaultExpanded="all"
    />,
  );
  expect(html).toContain("recorded-model");
  expect(html).toContain("No</span>");
  expect(html.match(/open=""/g)?.length).toBe(3);
});

test("tool calls expand into the command and the result, with honest missing states", () => {
  const html = renderToStaticMarkup(<ToolCallDetail call={CALL} />);
  expect(html).toContain("<details");
  expect(html).toContain("ls .toolchain &amp;&amp; echo &#x27;&lt;tag&gt;&#x27;");
  expect(html).toContain("No such file or directory");
  expect(html).toContain("156 ms");
  expect(html).toContain("error");
  const missing = renderToStaticMarkup(
    <ToolCallDetail call={{ ...CALL, args: null, result: null, ms: null }} />,
  );
  expect(missing).toContain("Arguments not recorded");
  expect(missing).toContain("Result not recorded");
  const cut = renderToStaticMarkup(
    <ToolCallDetail call={{ ...CALL, tool: "read", args: { path: "task.json" }, truncated: true }} />,
  );
  expect(cut).toContain("Arguments");
  expect(cut).toContain("&quot;path&quot;: &quot;task.json&quot;");
  expect(cut).toContain("The result is cut");
});

test("a search matches every term apart and regardless of case", () => {
  expect(matchesTerms("expr-05 held (5 + 8) * 3", "HELD expr-05")).toBe(true);
  expect(matchesTerms("expr-05 held", "released")).toBe(false);
  expect(matchesTerms("expr-05", "  ")).toBe(true);
});

test("the picker announces its current value beside its label, with the option's small label", () => {
  const html = renderToStaticMarkup(
    <Picker
      label="Campaign"
      value="second"
      groups={[
        {
          key: "campaigns",
          label: null,
          options: [
            { value: "first", label: "arith", detail: "anabasis" },
            { value: "second", label: "arith", detail: "anabasis-arith" },
          ],
        },
      ]}
      onChange={() => {}}
    />,
  );
  const valueId = /id="([^"]+-value)"/.exec(html)?.[1];
  expect(valueId).toBeDefined();
  expect(/aria-labelledby="([^"]+)"/.exec(html)?.[1]?.split(" ")).toContain(valueId);
  expect(html).toContain('role="combobox"');
  expect(html).toContain("arith<small> anabasis-arith</small>");
  expect(html).not.toContain('role="option"');
});
test("records keep missing and false values, escape content and defer large nested records", () => {
  const html = renderToStaticMarkup(
    <RecordView
      value={{ valid: false, cost: null, note: "<script>bad</script>", nested: { secret: "not mounted" } }}
    />,
  );
  expect(html).toContain("No</span>");
  expect(html).toContain("Not recorded");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("not mounted");
  const many = renderToStaticMarkup(
    <RecordView value={Array.from({ length: 13440 }, (_, i) => `row-${String(i)}-end`)} />,
  );
  expect(many).toContain("row-99-end");
  expect(many).not.toContain("row-100-end");
  expect(many).toContain("Next");
});

test("collection labels use the call number and tool name, else the first scalar pair, else a number", () => {
  const calls = renderToStaticMarkup(
    <RecordView
      value={{
        calls: [
          { turn: 1, toolName: "bash" },
          { turn: 1, toolName: "write" },
        ],
      }}
      defaultExpanded
    />,
  );
  expect(calls).toContain("1. bash");
  expect(calls).toContain("2. write");
  expect(calls).not.toContain("Turn: 1");
  const items = renderToStaticMarkup(
    <RecordView
      value={{ items: [{ id: "a", model: "hidden model" }, { enabled: false }, { position: { x: 1 } }, {}] }}
      defaultExpanded
    />,
  );
  for (const title of ["Id: a", "Enabled: false", "Item 3", "Item 4"]) expect(items).toContain(title);
  expect(items).not.toContain("hidden model");
});
