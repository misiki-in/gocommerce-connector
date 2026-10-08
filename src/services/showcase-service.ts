import type { PublicShowcase } from '../engine'
import { GoCommerceError } from '../errors'
import { BaseService } from './base.service'
import { StoreFacts } from './facts'

/** A store's video, as a storefront plays it. */
export type Showcase = {
	slug: string
	title: string
	description: string
	label: string
	provider: string
	embedUrl: string
	watchUrl: string
	thumbnailUrl: string | null
}

/**
 * A store's videos of what it sells (ext/showcases). The list is an extra on a page that must draw
 * without it, so a store with the module off simply has none.
 */
export class ShowcaseService extends BaseService {
	private readonly facts = new StoreFacts(this._fetch)

	/** The videos for one place: a product's page, a collection's, or the home page. */
	async list(place: { product: number | string } | { collection: number | string } | { on: 'home' }): Promise<Showcase[]> {
		if (!(await this.facts.pluginOn('showcases'))) return []
		try {
			const rows = await this.data<PublicShowcase[] | null>('/x/showcases', { query: place })
			return (rows ?? []).map((s) => ({
				slug: s.slug,
				title: s.title,
				description: s.description,
				label: s.label,
				provider: s.video.provider,
				embedUrl: s.video.embed_url,
				watchUrl: s.video.watch_url,
				thumbnailUrl: s.video.thumbnail_url ?? null,
			}))
		} catch (err) {
			if (err instanceof GoCommerceError && err.status === 404) return []
			throw err
		}
	}

	/** Counts a play on the panel's figures. A count not kept never troubles the shopper. */
	async recordView(slug: string): Promise<void> {
		await this.data(`/x/showcases/${encodeURIComponent(slug)}/events`, {
			method: 'POST',
			body: { type: 'view' },
		}).catch(() => undefined)
	}
}

export const showcaseService = new ShowcaseService()
