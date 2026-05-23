import type { ReviewPage } from '../engine'
import { toRating } from '../map'
import { BaseService } from './base.service'

/**
 * Product reviews (ext/reviews). Approved reviews only, newest first. The
 * product page gets them with the product; this is the paged form, and
 * `productService.addReview` writes one.
 */
export class ReviewService extends BaseService {
	async fetchReviews({
		productId,
		currentPage = 1,
		page,
		limit = 20,
	}: { productId?: string; currentPage?: number; page?: number; limit?: number; search?: string; sort?: string } = {}) {
		// A vendor's "all my reviews" page has no product to ask about.
		if (!productId) return { data: [], count: 0, pageSize: limit, noOfPage: 0, page: 1 }
		const p = Math.max(1, Number(page ?? currentPage) || 1)
		const res = await this.data<ReviewPage>('/x/reviews', { query: { product_id: productId, page: p, limit } })
		const total = res.meta?.total ?? res.summary?.count ?? 0
		return {
			data: (res.reviews ?? []).map(toRating),
			count: total,
			pageSize: limit,
			noOfPage: Math.max(1, Math.ceil(total / limit)),
			page: p,
			summary: res.summary ?? null,
		}
	}

	async allReviews(args: { productId?: string; page?: number } = {}) {
		return this.fetchReviews(args)
	}
}

export const reviewService = new ReviewService()
