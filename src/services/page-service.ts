import type { CmsPage, Faq, PublicBanner, PublicBanners } from '../engine'
import { toCmsPage as toStorefrontPage } from '../map'
import { BaseService, mediaUrl, toPage } from './base.service'

/**
 * Content pages from ext/cms, in the shopper's language with the store's
 * default as the fallback. A slug with no page is the page's 404.
 */
export class PageService extends BaseService {
	async getOne(slug: string) {
		const read = () => this.data<CmsPage>(`/x/cms/pages/${encodeURIComponent(String(slug))}`)
		if (slug !== 'home') return toStorefrontPage(await read())
		// The home page's pictures are their own rows (ext/banners), under the names the storefront
		// reads from a page. A store with banners and no home page record still shows them.
		const [page, banners] = await Promise.allSettled([read(), this.homeBanners()])
		const extra = banners.status === 'fulfilled' ? banners.value : null
		if (page.status === 'rejected' && !extra) throw page.reason
		return { ...(page.status === 'fulfilled' ? toStorefrontPage(page.value) : {}), ...extra }
	}

	/** Null when the store shows none, which leaves the page exactly as it was. */
	private async homeBanners() {
		const res = await this.data<PublicBanners>('/x/banners', { query: { page: 'home' } })
		const slides = res.slides ?? []
		const grids = res.grids ?? []
		if (!slides.length && !grids.length) return null
		const tile = (b: PublicBanner, url = b.image_url) => ({ url: mediaUrl(url), link: b.link, title: b.title })
		return {
			desktopBanners: slides.map((b) => tile(b)),
			mobileBanners: slides.map((b) => tile(b, b.mobile_image_url || b.image_url)),
			// The storefront draws a section only on the device it names, so each grid is one of each.
			sections: grids.flatMap((g) => [
				{ title: g.title, layout: 'grid', isActive: true, screenType: 'desktop', banners: (g.banners ?? []).map((b) => tile(b)) },
				{
					title: g.title,
					layout: 'grid',
					isActive: true,
					screenType: 'mobile',
					banners: (g.banners ?? []).map((b) => tile(b, b.mobile_image_url || b.image_url)),
				},
			]),
		}
	}

	async list({ page = 1, limit = 50 }: { page?: number; limit?: number; search?: string; sort?: string } = {}) {
		const env = await this.engine<CmsPage[] | null>('/x/cms/pages', { query: { page, limit } })
		return toPage(env, toStorefrontPage)
	}
}

/** The shop's questions and answers (ext/faq), flattened in the shop's own order. */
export class FaqService extends BaseService {
	async listFaqs(_args: Record<string, unknown> = {}) {
		const faq = await this.data<Faq>('/x/faq')
		const data = (faq.sections ?? []).flatMap((s) =>
			(s.entries ?? []).map((e) => ({
				id: String(e.id),
				question: e.question,
				answer: e.answer,
				category: s.section || null,
			})),
		)
		return { data, count: data.length, heading: faq.heading, blurb: faq.blurb }
	}

	async list(args: Record<string, unknown> = {}) {
		return this.listFaqs(args)
	}
}

export const pageService = new PageService()
export const faqService = new FaqService()
