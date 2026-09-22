import { Picker } from "../src/components/picker.js";
import { ReviewCounts } from "../src/views/current-run.js";
import { matchesTask, ToolCallDetail } from "../src/views/cases.js";
import { FileInspector } from "../src/views/file-inspector.js";
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordView } from "../src/components/record.js";
import { evaluationLabel, evidenceLabel, runLabel } from "../src/views/format.js";

test("review counts use compared verdicts and leave absent reviews unknown", () => {
  const html = renderToStaticMarkup(
    <ReviewCounts evidence={{ judge: "unvalidated", disagreementDenominator: 7, disagreements: 2 }} />,
  );
  expect(html).toContain('aria-label="Agreements: 5"');
  expect(html).toContain('aria-label="Disagreements: 2"');
  for (const evidence of [null, { judge: "off" } as const]) {
    const missing = renderToStaticMarkup(<ReviewCounts evidence={evidence} />);
    expect(missing).toContain('aria-label="Agreements: unavailable"');
    expect(missing).toContain('aria-label="Disagreements: unavailable"');
  }
});

test("records preserve missing and false values, escape content and defer large nested records", () => {
  const html = renderToStaticMarkup(
    <RecordView
      value={{ truthOk: false, cost: null, note: "<script>bad</script>", nested: { secret: "not mounted" } }}
    />,
  );
  expect(html).toContain("Truth Ok");
  expect(html).toContain("No</span>");
  expect(html).toContain("Not recorded");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("not mounted");
  const many = renderToStaticMarkup(
    <RecordView value={Array.from({ length: 13440 }, (_, i) => `row-${i}-end`)} />,
  );
  expect(many).toContain("row-99-end");
  expect(many).not.toContain("row-100-end");
  expect(many).toContain("Next");
});

test("visible run names use recorded dates and evaluation numbers", () => {
  expect(evidenceLabel("campaigns/project/controller/run/intent.json")).toBe("controller/run/intent.json");
  expect(evidenceLabel("domains/project/campaigns/intent.json")).toBe(
    "domains/project/campaigns/intent.json",
  );
  expect(runLabel({ startedAt: "2026-09-08T21:40:13Z" })).not.toContain("20260908T");
  expect(runLabel({ startedAt: null })).toBe("Undated run");
  expect(runLabel({ startedAt: "invalid" })).toBe("Undated run");
  expect(evaluationLabel("second-id", ["first-id", "second-id"])).toBe("Evaluation 2");
  expect(evaluationLabel("all", [])).toBe("All evaluations");
  expect(evaluationLabel("unknown", [])).toBe("Evaluation");
});

test("an evidence refresh keeps the displayed content while loading", () => {
  const html = renderToStaticMarkup(
    <FileInspector
      path="previous.json"
      payload={{
        path: "previous.json",
        contentType: "json",
        protected: false,
        value: { result: "previous evidence" },
        truncated: false,
        bytes: 100,
      }}
      loading={true}
      error={null}
      onClose={() => {}}
      onReveal={() => {}}
    />,
  );
  expect(html).toContain("previous.json");
  expect(html).toContain("previous evidence");
  expect(html).toContain('aria-busy="true"');
  expect(html).not.toContain("Reading local evidence");
});

test("task search includes public content with independent case-insensitive terms", () => {
  const item = {
    id: "timer-01",
    family: "timer",
    assistantPreview: null,
    publicTask: { input: { board: "esp32", request: "Create a stopwatch" }, resources: [] },
  };
  expect(matchesTask(item, "CREATE ESP32 stopwatch")).toBe(true);
  expect(matchesTask(item, "raspberry")).toBe(false);
  expect(matchesTask({ ...item, publicTask: { input: {}, resources: [] } }, "create")).toBe(false);
});

test("tool calls expand into recorded commands and results, with honest missing states", () => {
  const tool = {
    seq: 3,
    turn: 1,
    toolName: "bash",
    toolCallId: "call-3",
    isError: true,
    argsExcerpt: JSON.stringify({ command: "ls .toolchain && echo '<tag>'", timeout: 120 }),
    resultExcerpt: "ls: .toolchain: No such file or directory",
    resultPreview: "short result",
    timingMs: 156,
  };
  const html = renderToStaticMarkup(<ToolCallDetail tool={tool} />);
  expect(html).toContain("<details");
  expect(html).toContain("<summary>");
  expect(html).toContain("ls .toolchain &amp;&amp; echo &#x27;&lt;tag&gt;&#x27;");
  expect(html).toContain("No such file or directory");
  expect(html).not.toContain("short result");
  expect(html).toContain("156");
  const missing = renderToStaticMarkup(
    <ToolCallDetail
      tool={{ ...tool, argsExcerpt: null, resultExcerpt: null, resultPreview: null, timingMs: null }}
    />,
  );
  expect(missing).toContain("Arguments not recorded");
  expect(missing).toContain("Result not recorded");
  const truncated = renderToStaticMarkup(
    <ToolCallDetail tool={{ ...tool, argsExcerpt: '{"command":"cut', resultExcerpt: null }} />,
  );
  expect(truncated).toContain("cut");
  expect(truncated).toContain("short result");
});

test("the picker announces its current value alongside its label", () => {
  const html = renderToStaticMarkup(
    <Picker
      label="Project"
      value="second"
      groups={[
        {
          key: "projects",
          label: null,
          options: [
            { value: "first", label: "First project" },
            { value: "second", label: "Second project" },
          ],
        },
      ]}
      onChange={() => {}}
    />,
  );
  const valueId = html.match(/id="([^"]+-value)"/)?.[1];
  expect(valueId).toBeDefined();
  const labelledBy = html.match(/aria-labelledby="([^"]+)"/)?.[1];
  expect(labelledBy?.split(" ")).toContain(valueId);
  expect(html).toContain('role="combobox"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain("Second project");
  expect(html).not.toContain('role="option"');
});

test("task input shows its items while nested contents and evidence stay collapsed", () => {
  const value = { supports: [{ position: { x: 17, fixed: true } }], region: { limit: 29 } };
  const expanded = renderToStaticMarkup(<RecordView value={value} defaultExpanded />);
  expect(expanded).toContain("Item 1");
  expect(expanded).not.toContain("Position");
  expect(expanded).not.toContain(">17</span>");
  expect(expanded).not.toContain(">29</span>");
  expect(expanded.match(/open=""/g)?.length).toBe(1);
  const collapsed = renderToStaticMarkup(<RecordView value={value} />);
  expect(collapsed).not.toContain("Item 1");
  expect(collapsed).not.toContain("Position");
  expect(collapsed).not.toContain(">17</span>");
});

test("collection labels use the first scalar key-value pair with a numbered fallback", () => {
  const html = renderToStaticMarkup(
    <RecordView
      value={{
        peripherals: [
          { id: "ldr", model: "hidden model" },
          { id: "lamp" },
          { enabled: false },
          { pin: 0 },
          { position: { x: 1 } },
          { id: null },
          {},
        ],
      }}
      defaultExpanded
    />,
  );
  for (const title of ["Id: ldr", "Id: lamp", "Enabled: false", "Pin: 0", "Item 5", "Item 6", "Item 7"]) {
    expect(html).toContain(title);
  }
  expect(html).not.toContain("hidden model");
});

test("tool-call rows use their call number and tool name rather than a repeated turn", () => {
  const html = renderToStaticMarkup(
    <RecordView
      value={{
        toolCalls: [
          { turn: 1, toolName: "bash" },
          { turn: 1, toolName: "write" },
          { turn: 1, toolName: "bash" },
        ],
      }}
      defaultExpanded
    />,
  );
  expect(html).toContain("1. bash");
  expect(html).toContain("2. write");
  expect(html).toContain("3. bash");
  expect(html).not.toContain("Turn: 1");
});

test("a run-record inspector can open nested objects and items with their values visible", () => {
  const html = renderToStaticMarkup(
    <FileInspector
      path="opening.json"
      payload={{
        path: "opening.json",
        contentType: "json",
        protected: false,
        value: { condition: { slots: [{ model: "recorded-model", enabled: false }] } },
        truncated: false,
        bytes: 100,
      }}
      loading={false}
      error={null}
      expandAll
      onClose={() => {}}
      onReveal={() => {}}
    />,
  );
  expect(html).toContain("recorded-model");
  expect(html).toContain("No</span>");
  expect(html.match(/open=""/g)?.length).toBe(3);
});

test("empty record groups have a count without an interactive disclosure", () => {
  const html = renderToStaticMarkup(
    <RecordView value={{ abandonedRuns: [], metadata: {} }} defaultExpanded="all" />,
  );
  expect(html).toContain("Abandoned Runs");
  expect(html).toContain('class="ana-record-empty">0 items');
  expect(html).toContain('class="ana-record-empty">0 fields');
  expect(html).not.toContain("<details");
  expect(html).not.toContain("<summary");
});
