import type { CustomizerDesign, CustomizerDocument, CustomizerSetup, CustomizerUpload } from '../engine'
import { BaseService, mediaUrl } from './base.service'
import { StoreFacts } from './facts'

/** What a product's design editor draws and offers, in the mockup's pixels. */
export type CustomizerEditor = {
	productId: string
	mockup: { url: string; width: number; height: number }
	/** Drawn above the design: the camera cut-out, the case's edges. */
	overlayUrl: string | null
	printArea: { x: number; y: number; width: number; height: number; radius: number }
	printSize: { widthMm: number; heightMm: number; dpi: number }
	tools: { upload: boolean; text: boolean; shapes: boolean; background: boolean; stickers: boolean }
	fonts: { key: string; family: string }[]
	stickers: { id: number; url: string; width: number; height: number }[]
	/** A photo whose shorter side is below this is likely to print soft: warn, the engine still takes it. */
	minPhotoPx: number
	/** Shown before the shopper chooses a photo. */
	consent: string
}

export type CustomizerFile = { uploadId: string; url: string; width: number; height: number }

export type CustomizerSavedDesign = { designId: string; previewUrl: string }

/**
 * A shopper's own design on a product (ext/customizer, D162). Every URL goes
 * through the proxy path when one is set, so it is same-origin and a canvas
 * that draws it can still be exported.
 */
export class CustomizerService extends BaseService {
	private readonly facts = new StoreFacts(this._fetch)

	/** Null when the product cannot be designed, or on any failure: the page draws without the editor. */
	async setup(productId: string | number): Promise<CustomizerEditor | null> {
		const plugins = await this.facts.plugins().catch(() => null)
		if (plugins && !plugins.has('customizer')) return null
		const path = `/x/customizer/products/${encodeURIComponent(String(productId))}`
		const s = await this.data<CustomizerSetup>(path).catch(() => null)
		if (!s) return null
		return {
			productId: String(s.product_id),
			mockup: { ...s.mockup, url: media(s.mockup.url) },
			overlayUrl: mediaUrl(s.overlay_url),
			printArea: s.print_area,
			printSize: { widthMm: s.print_size.width_mm, heightMm: s.print_size.height_mm, dpi: s.print_size.dpi },
			tools: s.tools,
			fonts: s.fonts,
			stickers: s.stickers.map((k) => ({ ...k, url: media(k.url) })),
			minPhotoPx: s.min_photo_px,
			consent: s.consent,
		}
	}

	/** A photo, or the finished preview or print file. The engine's refusal is thrown with its message. */
	async upload(file: Blob, filename?: string): Promise<CustomizerFile> {
		const body = new FormData()
		body.append('file', file, filename)
		const u = await this.data<CustomizerUpload>('/x/customizer/uploads', { method: 'POST', body })
		return { uploadId: u.upload_id, url: media(u.url), width: u.width, height: u.height }
	}

	/** The document goes as it is: the order keeps it, and whatever renders the print reads it there. */
	async saveDesign(design: {
		productId: string | number
		variantId: string | number
		previewUploadId: string
		printUploadId: string
		document: CustomizerDocument
	}): Promise<CustomizerSavedDesign> {
		const d = await this.data<CustomizerDesign>('/x/customizer/designs', {
			method: 'POST',
			body: {
				product_id: Number(design.productId),
				variant_id: Number(design.variantId),
				preview_upload_id: design.previewUploadId,
				print_upload_id: design.printUploadId,
				document: design.document,
			},
		})
		return { designId: d.design_id, previewUrl: media(d.preview_url) }
	}
}

const media = (url: string) => mediaUrl(url) ?? url

export const customizerService = new CustomizerService()
