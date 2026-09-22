// Long-lived streaming-input prompt for query().
//
// The SDK accepts `prompt: AsyncIterable<SDKUserMessage>` and pumps it to the
// CLI's stdin. Keeping that iterable parked for the life of the query lets us
// write a steer to stdin *while* a tool is running, which is what makes CC
// drain it at the next tool boundary (`priority: "next"`) instead of treating
// it as a follow-up turn.
//
// The acknowledgement determines ordering. `push()` resolves on the line after
// `yield`, and the SDK's pump is `for await (m of stream) { await
// transport.write(m) }` — so resuming past the yield proves the write to stdin
// completed. Callers await it before releasing the MCP tool result, which
// travels back over the same stdin FIFO. That ordering puts the steer before
// the tool result when the CLI reads them.
//
// The drain and the FIFO ordering are CC CLI internals, not SDK contract, so
// this can break under a CC upgrade without any type error.

import type { SDKUserMessage } from "claude-agent-sdk-bridge";

export interface PromptStream {
	stream: AsyncGenerator<SDKUserMessage>;
	/** Enqueue a message; resolves once the SDK has written it to stdin.
	 *  Rejects (never hangs) if the stream is already ended or failed. */
	push: (msg: SDKUserMessage) => Promise<void>;
	/** Close the input: the generator returns, the SDK closes the CLI's stdin. */
	end: () => void;
	/** Abandon the input, rejecting every queued and in-flight ack. */
	fail: (error: Error) => void;
}

export function makePromptStream(): PromptStream {
	type Item = { msg: SDKUserMessage; resolve: () => void; reject: (e: Error) => void };
	const queue: Item[] = [];
	// The item currently parked at `yield`. Tracked separately so fail() can
	// settle it — a dying CLI may abandon the pump without ever resuming us,
	// and an unsettled acknowledgement would block tool-result delivery indefinitely.
	let inflight: Item | null = null;
	let wake: (() => void) | null = null;
	let done = false;
	let failure: Error | null = null;

	const kick = () => { wake?.(); wake = null; };

	async function* gen(): AsyncGenerator<SDKUserMessage> {
		while (true) {
			// oxlint-disable-next-line eslint/no-unmodified-loop-condition -- `done` and `failure` are set by the producer below and this wait is resumed by `kick()`; the rule sees only the loop.
			while (queue.length === 0 && !done && !failure) {
				await new Promise<void>((resolve) => { wake = resolve; });
			}
			if (failure) throw failure;
			const item = queue.shift();
			if (!item) return; // ended and drained
			inflight = item;
			try {
				yield item.msg;
				item.resolve();
			} finally {
				// Reached either normally (no-op, already resolved) or when the
				// pump abandons iteration — a `for await` break/throw calls
				// gen.return(), which resumes the yield as a return.
				item.reject(new Error("prompt stream closed"));
				inflight = null;
			}
		}
	}

	return {
		stream: gen(),
		push: (msg) => failure || done
			? Promise.reject(failure ?? new Error("prompt stream closed"))
			: new Promise<void>((resolve, reject) => { queue.push({ msg, resolve, reject }); kick(); }),
		end: () => { done = true; kick(); },
		fail: (error) => {
			failure = error;
			for (const item of queue.splice(0)) item.reject(error);
			inflight?.reject(error);
			kick();
		},
	};
}

/** `uuid` is deliberately omitted: we need no dedup, and supplying one makes
 *  CC's stdin loop do a session lookup on the message. */
export function userMessage(content: SDKUserMessage["message"]["content"], priority?: SDKUserMessage["priority"]): SDKUserMessage {
	return {
		type: "user",
		message: { role: "user", content },
		parent_tool_use_id: null,
		...(priority ? { priority } : {}), // oxlint-disable-line anti-slop/no-conditional-empty-object-spread
	};
}
