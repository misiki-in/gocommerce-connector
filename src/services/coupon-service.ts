import { emptyPage } from './base.service'
import { BaseService } from './base.service'
import { CartService } from './cart-service'

/**
 * Discount codes are typed, not browsed, except the ones the shop chose to
 * show (D132): the engine lists a code only when the shop ticked "Show in the
 * basket's offers", judged against the stored bag. Every other code stays
 * known only to whoever was given it, and still works through
 * `cartService.applyCoupon`.
 *
 * The drawer's shape: `amount` is the percentage or the amount,
 * `minAmount` the bag it needs, and `description` says what is
 * still missing.
 */
export class CouponService extends BaseService {
	async listCoupons(_args: Record<string, unknown> = {}) {
		const offers = await new CartService(this._fetch).getOffers().catch(() => [])
		if (!offers.length) return emptyPage()
		const data = offers.map((o) => ({
			id: o.code,
			code: o.code,
			title: o.title,
			isPercent: o.isPercent,
			amount: o.value,
			minAmount: o.minAmount,
			description: o.applies
				? o.title
				: o.remaining !== null
					? `${o.title}. Add ${o.remaining} more to use this.`
					: o.reason || o.title,
			applies: o.applies,
			remaining: o.remaining,
		}))
		return { data, count: data.length, pageSize: data.length, noOfPage: 1, page: 1 }
	}
}

export const couponService = new CouponService()
