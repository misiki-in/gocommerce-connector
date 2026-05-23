import { emptyPage } from './base.service'
import { BaseService } from './base.service'

/**
 * Discount codes are typed, not browsed: the engine has no public list of
 * them, by design — a list would hand every shopper every code. An empty list
 * hides the storefront's coupon drawer, and the code box still works through
 * `cartService.applyCoupon`.
 */
export class CouponService extends BaseService {
	async listCoupons(_args: Record<string, unknown> = {}) {
		return emptyPage()
	}
}

export const couponService = new CouponService()
