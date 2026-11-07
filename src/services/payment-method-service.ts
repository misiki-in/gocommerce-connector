import { toMajor } from '../money'
import { BaseService } from './base.service'
import { StoreFacts } from './facts'
import { cashfreeIsTest, REDIRECT_GATEWAYS } from './checkout-service'

/**
 * The engine's payment methods this storefront can actually drive.
 *
 * The storefront dispatches on an upper-cased code from a fixed list, so a
 * method is offered only where one of its flows can complete it: cash on
 * delivery, Razorpay's and Cashfree's modals, and the engine's hosted-page gateways.
 * The first of those takes the storefront's redirect flow, by the code `PAYPAL`. The
 * rest get their own code and `redirects: true`, which a kitcommerce-core of 0.1.60 or
 * later sends through `checkoutService.checkout(engineCode)`. Each keeps its own name
 * and gets a neutral card icon, never a PayPal mark. Stripe is not offered, since its
 * engine gateway is a Payment Element this storefront does not mount. Each method left off is reported once, and every one stays reachable
 * through `checkoutService.checkout(code)` for a storefront that drives its own.
 * Cashfree takes only rupees, and the engine would find that out after creating
 * the order, so it is offered only on a rupee store. It has no icon of its own
 * here, so it gets the neutral card one.
 */
const DRIVABLE: Record<string, { code: string; img?: string }> = {
	cod: { code: 'COD', img: '/payment/cod.svg' },
	razorpay: { code: 'RAZORPAY' },
	cashfree: { code: 'CASHFREE', img: '/payment/card.svg' },
}

const reported = new Set<string>()

export class PaymentMethodService extends BaseService {
	private readonly facts = new StoreFacts(this._fetch)

	async list(_args: Record<string, unknown> = {}) {
		const options = await this.facts.checkoutOptions()
		const methods = options.methods ?? []
		const redirect = methods.find((m) => REDIRECT_GATEWAYS.has(m.code))?.code
		const drive = (code: string) => {
			if (code === 'cashfree' && options.currency !== 'INR') return undefined
			if (DRIVABLE[code]) return DRIVABLE[code]
			if (code === redirect) return { code: 'PAYPAL', img: '/payment/card.svg' }
			return REDIRECT_GATEWAYS.has(code) ? { code: code.toUpperCase(), img: '/payment/card.svg' } : undefined
		}
		const data = methods
			.filter((m) => {
				if (drive(m.code)) return true
				if (!reported.has(m.code)) {
					reported.add(m.code)
					console.warn(
						`[gocommerce] payment method "${m.code}" is switched on but this storefront cannot drive its flow, so it is not offered here; checkoutService.checkout('${m.code}') still reaches it.`,
					)
				}
				return false
			})
			.map((m, i) => {
				const method = {
					id: m.code,
					code: drive(m.code)!.code,
					engineCode: m.code,
					name: m.name,
					title: m.name,
					description: '',
					img: drive(m.code)!.img ?? null,
					fee: toMajor(m.fee),
					rank: i,
					active: true,
					isActive: true,
				}
				if (REDIRECT_GATEWAYS.has(m.code) && m.code !== redirect) Object.assign(method, { redirects: true })
				// A getter, not a value: see cashfreeIsTest.
				if (m.code === 'cashfree') Object.defineProperty(method, 'isTest', { get: cashfreeIsTest, enumerable: true })
				return method
			})
		return { data, count: data.length, pageSize: data.length, noOfPage: 1, page: 1 }
	}
}

export const paymentMethodService = new PaymentMethodService()
