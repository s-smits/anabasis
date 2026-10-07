// Written for Anabasis in place of pi coding-agent v1.0.0's packages/coding-agent/src/utils/image-process.ts
// (github.com/earendil-works/pi, a13d35a, MIT, see LICENSE): the same exported names, with no image
// pipeline behind them. Upstream converts and resizes through the photon WebAssembly package, which
// Anabasis does not carry, and no Anabasis read tool attaches images: the draft's operations detect
// none, so the copied read tool never reaches this.

export interface ProcessImageOptions {
	/** Whether to resize images to inline provider limits. Default: true */
	autoResizeImages?: boolean;
	/** Optional resize overrides. Uses resizeImage defaults when omitted. */
	resizeOptions?: unknown;
}

export type ProcessImageResult =
	| {
			ok: true;
			data: string;
			mimeType: string;
			hints: string[];
	  }
	| {
			ok: false;
			message: string;
	  };

export async function processImage(
	_bytes: Uint8Array,
	_mimeType: string,
	_options?: ProcessImageOptions,
): Promise<ProcessImageResult> {
	return { ok: false, message: "[Image attachments are not available in this build.]" };
}
