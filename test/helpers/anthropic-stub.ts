// A stand-in for the Anthropic Messages API on localhost, so the real Claude Code binary can run a
// session without a credential or a model: it records every request the CLI sends and answers each
// `/v1/messages` that offers tools with the next scripted reply as a stream, the last one again once
// the script runs out. A request offering none, as Claude Code's side request for a session title
// on Linux, is answered in text and takes no reply from the script. What a request's `tools` names
// is what the model would have been offered.
import { capturedJsonParse, capturedJsonStringify } from "../../src/meta/json-runtime.ts";
import { asRecord, isString, type JsonObject } from "../../src/meta/json-shape.ts";

/** A reply: a text that ends the turn, or one call of a tool by the name the request offered it. */
type Reply = { readonly text: string } | { readonly tool: string; readonly input: JsonObject };

/** One request as the stub received it. */
export interface Heard {
  readonly path: string;
  /** The `x-api-key` header, where the CLI held an API key. */
  readonly apiKey: string | null;
  /** The token of the `Authorization: Bearer` header, where the CLI held a login. */
  readonly bearer: string | null;
  /** The `anthropic-beta` header, which names the betas the CLI asked for. */
  readonly beta: string | null;
  readonly body: JsonObject;
}

const sse = (events: readonly (JsonObject & { readonly type: string })[]) =>
  events.map((data) => `event: ${data.type}\ndata: ${capturedJsonStringify(data)}\n\n`).join("");

function stream(reply: Reply, model: string, at: number): string {
  const usage = { input_tokens: 1, output_tokens: 1 };
  const block =
    "text" in reply
      ? { start: { type: "text", text: "" }, delta: { type: "text_delta", text: reply.text } }
      : {
          start: { type: "tool_use", id: `toolu_stub_${String(at)}`, name: reply.tool, input: {} },
          delta: { type: "input_json_delta", partial_json: capturedJsonStringify(reply.input) },
        };
  const message = { id: `msg_stub_${String(at)}`, type: "message", role: "assistant", model, content: [] };
  return sse([
    { type: "message_start", message: { ...message, stop_reason: null, stop_sequence: null, usage } },
    { type: "content_block_start", index: 0, content_block: block.start },
    { type: "content_block_delta", index: 0, delta: block.delta },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "text" in reply ? "end_turn" : "tool_use", stop_sequence: null },
      usage: { output_tokens: 1 },
    },
    { type: "message_stop" },
  ]);
}

/** A stub at `url` answering with `replies`; `heard` fills as requests arrive. */
export function anthropicStub(replies: readonly Reply[]) {
  const heard: Heard[] = [];
  let answered = 0;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const body = asRecord(capturedJsonParse((await request.text()) || "{}")) ?? {};
      const { headers } = request;
      const bearer = headers.get("authorization")?.replace(/^Bearer /u, "") ?? null;
      heard.push({
        path,
        apiKey: headers.get("x-api-key"),
        bearer,
        beta: headers.get("anthropic-beta"),
        body,
      });
      if (path !== "/v1/messages") return Response.json({}, { status: 404 });
      const scripted = Array.isArray(body.tools) && body.tools.length > 0;
      const reply = (scripted ? replies[Math.min(answered, replies.length - 1)] : undefined) ?? {
        text: "Done.",
      };
      if (scripted) answered += 1;
      const model = isString(body.model) ? body.model : "stub";
      return new Response(stream(reply, model, answered), {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  return {
    url: `http://127.0.0.1:${String(server.port)}`,
    heard,
    /** The tool names each `/v1/messages` request offered the model. */
    offered: () =>
      heard
        .filter(({ path }) => path === "/v1/messages")
        .map(({ body }) =>
          (Array.isArray(body.tools) ? body.tools : []).map((tool) => {
            const name = asRecord(tool)?.name;
            return isString(name) ? name : "";
          }),
        ),
    stop: () => server.stop(true),
  };
}
