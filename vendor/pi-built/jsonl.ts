import { capturedJsonStringify } from "../../src/meta/json-runtime.ts";
import { typeName } from "../../src/meta/json-shape.ts";

export { JSONL_LINE_MAX_BYTES, attachJsonlLineReader } from "./jsonl-reader.ts";

export function serializeJsonLine(value: unknown): string {
	const json = capturedJsonStringify(value);
	if (json === undefined) throw new TypeError(`not JSON-serialisable: ${typeName(value)}`);
	return `${json}\n`;
}
