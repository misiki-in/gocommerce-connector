import { BaseService } from './base.service'
import { StoreFacts } from './facts'

/**
 * The engine's payment methods this storefront can actually drive.
 *
 * The storefront dispatches on an upper-cased code from a fixed list, and two
 * of the engine's gateways have a flow it can complete: cash on delivery, and
 * Razorpay's modal. The rest are left off rather than shown as a button that
 * fails at the last step — Stripe here is a Payment Element and the other
 * gateways are hosted pages this storefront has no route for. Each one left
 * off is reported once, so a merchant who switched one on can see why it is
 * missing.
 */
const DRIVABLE: Record<string, { code: string; img?: string }> = {
	cod: { code: 'COD', img: '/payment/cod.svg' },
	razorpay: { code: 'RAZORPAY' },
}

const reported = new Set<string>()

export class PaymentMethodService extends BaseService {
	private readonly facts = new StoreFacts(this._fetch)

	async list(_args: Record<string, unknown> = {}) {
		const options = await this.facts.checkoutOptions()
		const methods = options.methods ?? []
		const data = methods
			.filter((m) => {
				if (DRIVABLE[m.code]) return true
				if (!reported.has(m.code)) {
					reported.add(m.code)
					console.warn(
						`[gocommerce] payment method "${m.code}" is switched on but this storefront cannot drive its flow, so it is not offered.`,
					)
				}
				return false
			})
			.map((m, i) => ({
				id: m.code,
				code: DRIVABLE[m.code].code,
				engineCode: m.code,
				name: m.name,
				title: m.name,
				description: '',
				img: DRIVABLE[m.code].img ?? null,
				rank: i,
				active: true,
				isActive: true,
			}))
		return { data, count: data.length, pageSize: data.length, noOfPage: 1, page: 1 }
	}
}

export const paymentMethodService = new PaymentMethodService()
