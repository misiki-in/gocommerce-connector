import type { Product } from '../engine'
import { GoCommerceError } from '../errors'
import { toProduct, type StorefrontProduct } from '../map'
import { BaseService, mediaUrl } from './base.service'

/** A collection list's card, as the engine resolves it. */
type EngineLayoutCollection = {
	id: number
	slug: string
	title: string
	image?: string
}

/** One section as the engine stores it, before the storefront maps anything. */
type EngineLayoutSection = {
	id: string
	type: string
	settings: Record<string, unknown> | null
	products?: Product[] | null
	collections?: EngineLayoutCollection[] | null
}

/**
 * The store's design tokens (ext/layouts, D127). Every key is optional and
 * an absent one means the storefront keeps its own look: colours are
 * `#rrggbb`, fonts are keys of the storefront's font list, `radius` is
 * none, small, medium or large.
 */
export type ThemeSettings = Partial<
	Record<'background' | 'text' | 'accent' | 'accent_text' | 'muted' | 'heading_font' | 'body_font' | 'radius', string>
>

type EngineLayout = {
	page: string
	theme: string
	revision?: number
	preview?: boolean
	theme_settings?: ThemeSettings | null
	sections: EngineLayoutSection[] | null
}

/** A collection list's card: enough to draw a picture and a title and link to it. */
export type LayoutCollection = {
	id: string
	title: string
	slug: string
	link: string
	image: string | null
}

/**
 * One section of a composed page. `settings` is the merchant's, as validated
 * by the engine: plain text (never HTML) and links that are `/path` or
 * `http(s)://`. A product grid also carries its products, resolved live and
 * mapped like any other product the storefront renders; a collection list
 * carries its collections.
 */
export type HomeLayoutSection = {
	id: string
	type: string
	settings: Record<string, unknown>
	products?: StorefrontProduct[]
	collections?: LayoutCollection[]
}

export type HomeLayout = {
	page: string
	theme: string
	/** The published revision this is; absent on a preview. */
	revision?: number
	/** True when this is the saved draft shown through a preview key. */
	preview: boolean
	/** The design tokens published with the page, or null for none. */
	themeSettings: ThemeSettings | null
	sections: HomeLayoutSection[]
}

/** The design tokens alone, for every page the storefront draws. */
export type ThemeSettingsResult = {
	revision?: number
	preview: boolean
	settings: ThemeSettings
}

/** Settings that hold a picture's or a video's address, which may be the engine's own upload. */
const MEDIA_KEYS = new Set(['image', 'mobile_image', 'poster', 'video_file'])

/**
 * Composed pages from ext/layouts. A store without one — the plugin off,
 * nothing published, an engine built without the module, or a preview key
 * that is wrong or expired — answers null, and the storefront renders its
 * built-in page.
 */
export class LayoutService extends BaseService {
	async getHomeLayout({ preview }: { preview?: string | null } = {}): Promise<HomeLayout | null> {
		let layout: EngineLayout
		try {
			layout = await this.data<EngineLayout>('/x/layouts/home', {
				query: { preview: preview?.trim() || undefined },
			})
		} catch (err) {
			if (err instanceof GoCommerceError && err.status === 404) return null
			throw err
		}
		if (!layout) return null
		return {
			page: layout.page,
			theme: layout.theme,
			revision: layout.revision,
			preview: !!layout.preview,
			themeSettings: tokens(layout.theme_settings),
			sections: (layout.sections ?? []).map(toSection),
		}
	}

	/**
	 * The store's design tokens, for a page other than the home page: the
	 * published ones, or a preview key's draft. Null when there are none to
	 * apply — nothing published, the editor off, an engine without the
	 * module — and on any failure too: a missing look must never cost the
	 * page.
	 */
	async getThemeSettings({ preview }: { preview?: string | null } = {}): Promise<ThemeSettingsResult | null> {
		try {
			const out = await this.data<{ revision?: number; preview?: boolean; settings?: ThemeSettings | null }>('/x/layouts/theme', {
				query: { preview: preview?.trim() || undefined },
			})
			if (!out) return null
			return { revision: out.revision, preview: !!out.preview, settings: tokens(out.settings) ?? {} }
		} catch {
			return null
		}
	}
}

function tokens(v: ThemeSettings | null | undefined): ThemeSettings | null {
	return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length ? { ...v } : null
}

/**
 * An upload is answered root-relative, which the shopper's browser would
 * resolve against the storefront rather than the engine — at the top of a
 * section's settings and inside its lists (a slideshow's slides) alike.
 */
function withMedia(value: unknown, key: string | null): unknown {
	if (Array.isArray(value)) return value.map((x) => withMedia(x, null))
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, x]) => [k, withMedia(x, k)]))
	}
	if (key && MEDIA_KEYS.has(key) && typeof value === 'string') return mediaUrl(value)
	return value
}

function toSection(s: EngineLayoutSection): HomeLayoutSection {
	const settings = withMedia(s.settings ?? {}, null) as Record<string, unknown>
	const out: HomeLayoutSection = { id: s.id, type: s.type, settings }
	if (s.type === 'product-grid') out.products = (s.products ?? []).map((p) => toProduct(p))
	if (s.type === 'collection-list') {
		out.collections = (s.collections ?? []).map((c) => ({
			id: String(c.id),
			title: c.title,
			slug: c.slug,
			link: `/collections/${c.slug}`,
			image: mediaUrl(c.image) ?? null,
		}))
	}
	return out
}

export const layoutService = new LayoutService()
