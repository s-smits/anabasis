// Copied from pi coding-agent v1.0.0 (github.com/earendil-works/pi, a13d35a, MIT, see LICENSE):
// packages/coding-agent/src/utils/text.ts, verbatim.
/** Split a leading UTF-8 byte order mark from decoded text. */
export function splitBom(content: string): { bom: string; text: string } {
	return content.startsWith("\uFEFF") ? { bom: "\uFEFF", text: content.slice(1) } : { bom: "", text: content };
}

/** Remove a leading UTF-8 byte order mark from decoded text. */
export function stripBom(content: string): string {
	return splitBom(content).text;
}
