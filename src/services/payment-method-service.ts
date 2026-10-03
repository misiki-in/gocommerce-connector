import { BaseService } from './base.service'
import { StoreFacts } from './facts'
import { REDIRECT_GATEWAYS } from './checkout-service'

/**
 * The engine's payment methods this storefront can actually drive.
 *
 * The storefront dispatches on an upper-cased code from a fixed list, so a
 * method is offered only where one of its flows can complete it: cash on
 * delivery, Razorpay's modal, and — through the storefront's redirect flow,
 * which it reaches by the code `PAYPAL` — the first of the engine's hosted-page
 * gateways. That one keeps its own name and gets a neutral card icon, never a
 * PayPal mark. The flow carries no gateway code, so a second hosted-page
 * gateway cannot be told apart from the first and is not offered; nor is
 * Stripe, whose engine gateway is a Payment Element this storefront does not
 * mount. Each method left off is reported once, and every one stays reachable
 * through `checkoutService.checkout(code)` for a storefront that drives its own.
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
		const redirect = methods.find((m) => REDIRECT_GATEWAYS.has(m.code))?.code
		const drive = (code: string) =>
			DRIVABLE[code] ?? (code === redirect ? { code: 'PAYPAL', img: '/payment/card.svg' } : undefined)
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
			.map((m, i) => ({
				id: m.code,
				code: drive(m.code)!.code,
				engineCode: m.code,
				name: m.name,
				title: m.name,
				description: '',
				img: drive(m.code)!.img ?? null,
				rank: i,
				active: true,
				isActive: true,
			}))
		return { data, count: data.length, pageSize: data.length, noOfPage: 1, page: 1 }
	}
}

export const paymentMethodService = new PaymentMethodService()
