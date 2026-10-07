// Copied from pi coding-agent v1.0.4 (github.com/earendil-works/pi, 7c10bd43, MIT, see LICENSE):
// packages/coding-agent/src/utils/image-convert.ts. Departure: loadPngTranscoder and
// ensurePngTranscoder, which register photon as pi-tui's Kitty image transcoder, are left out with
// their pi-tui import, since no terminal draws images here.
import { applyExifOrientation } from "./exif-orientation.ts";
import { loadPhoton } from "./photon.ts";

type Photon = NonNullable<Awaited<ReturnType<typeof loadPhoton>>>;

function encodePng(photon: Photon, bytes: Uint8Array): Uint8Array | null {
	try {
		const rawImage = photon.PhotonImage.new_from_byteslice(bytes);
		const image = applyExifOrientation(photon, rawImage, bytes);
		if (image !== rawImage) rawImage.free();
		try {
			return new Uint8Array(image.get_bytes());
		} finally {
			image.free();
		}
	} catch {
		// Conversion failed
		return null;
	}
}

export async function convertImageBytesToPng(bytes: Uint8Array): Promise<Uint8Array | null> {
	const photon = await loadPhoton();
	if (!photon) {
		// Photon not available, can't convert
		return null;
	}
	return encodePng(photon, bytes);
}

/**
 * Convert image to PNG format for terminal display.
 * Kitty graphics protocol requires PNG format (f=100).
 */
export async function convertToPng(
	base64Data: string,
	mimeType: string,
): Promise<{ data: string; mimeType: string } | null> {
	// Already PNG, no conversion needed
	if (mimeType === "image/png") {
		return { data: base64Data, mimeType };
	}

	const bytes = new Uint8Array(Buffer.from(base64Data, "base64"));
	const pngBytes = await convertImageBytesToPng(bytes);
	if (!pngBytes) {
		return null;
	}

	return {
		data: Buffer.from(pngBytes).toString("base64"),
		mimeType: "image/png",
	};
}
