import type { ListMeta, Offer, Variant } from '../engine'
import { toMajor } from '../money'
import { BaseService } from './base.service'

/**
 * Variants on their own, and the marketplace's offers on one.
 *
 * Svelte Commerce reads variants through their product, so this service is
 * for code written against GoCommerce: it answers the engine's own shapes —
 * numeric ids, money as `{ amount_minor, currency }` — with a major-unit
 * `amount` added beside each price so a template need not divide.
 */
export class VariantService extends BaseService {
	/** A product's variants, inactive ones included (filter on `active`), in the merchant's order. */
	async list(productId: string | number, { page = 1, limit = 50 }: { page?: number; limit?: number } = {}) {
		const env = await this.engine<Variant[] | null>('/api/variants', { query: { product_id: productId, page, limit } })
		return { data: (env.data ?? []).map(withAmounts), meta: env.meta as ListMeta | undefined }
	}

	async getOne(id: string | number) {
		return withAmounts(await this.data<Variant>(`/api/variants/${encodeURIComponent(String(id))}`))
	}

	/**
	 * What each approved seller asks for this variant, cheapest first. A cart
	 * line takes a variant, not an offer, so this informs a shopper rather than
	 * choosing who fulfils.
	 */
	async offers(variantId: string | number) {
		const offers =
			(await this.data<Offer[] | null>(`/api/variants/${encodeURIComponent(String(variantId))}/offers`)) ?? []
		return offers.map((o) => ({ ...o, price: { ...o.price, amount: toMajor(o.price) } }))
	}
}

function withAmounts(v: Variant) {
	return {
		...v,
		price: { ...v.price, amount: toMajor(v.price) },
		compare_at_price: v.compare_at_price ? { ...v.compare_at_price, amount: toMajor(v.compare_at_price) } : undefined,
	}
}

export const variantService = new VariantService()
