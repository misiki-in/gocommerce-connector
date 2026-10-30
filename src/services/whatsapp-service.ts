import { storedCartId } from '../browser'
import { BaseService } from './base.service'

/** Which WhatsApp boxes checkout shows. */
export type WhatsappConsentOffer = {
	/** The store sends order updates on WhatsApp: show the opt-in. */
	enabled: boolean
	/** It sends basket reminders too: show the marketing box as well. */
	marketing: boolean
}

/** What the engine kept for a phone: the number as it reads it, in E.164. */
export type WhatsappConsent = {
	phone: string
	orderUpdates: boolean
	marketing: boolean
}

/**
 * The shopper's WhatsApp opt-in at checkout (ext/notify-whatsapp).
 *
 * The engine keeps the latest answer per phone, so an unticked box is sent as
 * `false` rather than left out: it is how a shopper who said yes last time
 * says no now.
 */
export class WhatsappService extends BaseService {
	/**
	 * Whether to show the boxes. Never throws: an engine without the module, or
	 * one that fails, answers both off, because checkout must not depend on it.
	 */
	async consentOffer(): Promise<WhatsappConsentOffer> {
		try {
			const d = await this.data<Partial<WhatsappConsentOffer> | null>('/x/notify-whatsapp/consent')
			const enabled = d?.enabled === true
			return { enabled, marketing: enabled && d?.marketing === true }
		} catch {
			return { enabled: false, marketing: false }
		}
	}

	/**
	 * Records both answers for the phone as typed, against the bag (with
	 * `marketing`, the engine keeps the phone on it for basket reminders). Throws
	 * the engine's 400 (`validation_failed`) when the phone is not a WhatsApp
	 * number for the store's country.
	 */
	async setConsent({
		cartId,
		phone,
		orderUpdates,
		marketing,
	}: {
		cartId?: string | null
		phone: string
		orderUpdates: boolean
		marketing: boolean
	}): Promise<WhatsappConsent> {
		const d = await this.data<{ phone: string; order_updates: boolean; marketing: boolean }>(
			'/x/notify-whatsapp/consent',
			{
				method: 'PUT',
				body: {
					cart_id: cartId || storedCartId() || '',
					phone: String(phone ?? '').trim(),
					order_updates: orderUpdates === true,
					marketing: marketing === true,
				},
			},
		)
		return { phone: d.phone, orderUpdates: d.order_updates, marketing: d.marketing }
	}
}

export const whatsappService = new WhatsappService()
