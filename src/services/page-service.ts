import type { CmsPage, Faq } from '../engine'
import { toCmsPage as toStorefrontPage } from '../map'
import { BaseService, toPage } from './base.service'

/**
 * Content pages from ext/cms, in the shopper's language with the store's
 * default as the fallback. A slug with no page is the page's 404.
 */
export class PageService extends BaseService {
	async getOne(slug: string) {
		return toStorefrontPage(await this.data<CmsPage>(`/x/cms/pages/${encodeURIComponent(String(slug))}`))
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
