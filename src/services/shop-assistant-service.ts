import { GoCommerceError } from '../errors'
import { mediaUrl, BaseService } from './base.service'
import { minorToMajor } from '../money'

/** One line of the conversation. The browser holds it: the engine stores none. */
export type ShopAssistantMessage = { role: 'user' | 'assistant'; text: string }

/** A product as the catalogue has it. `variantId` is null when the shopper has something to choose first. */
export type ShopAssistantCard = {
	productId: number
	slug: string
	title: string
	image: string | null
	price: number
	compareAtPrice: number | null
	currency: string
	variantId: number | null
}

export type ShopAssistantReply = {
	reply: string
	products: ShopAssistantCard[]
	/** The cards match only part of what was asked for. */
	closest: boolean
	faqs: { id: number; question: string; answer: string }[]
	/** Offer the shop's contact form. */
	handover: boolean
}

type EngineMoney = { amount_minor: number; currency: string }
type EngineReply = {
	reply: string
	products: {
		product_id: number
		slug: string
		title: string
		image_url?: string
		price: EngineMoney
		compare_at_price?: EngineMoney
		variant_id: number | null
	}[]
	closest: boolean
	faqs: { id: number; question: string; answer: string }[]
	handover: boolean
}

/**
 * The storefront's shopping assistant (ext/shop-assistant). Each turn spends the store's AI credit,
 * so a storefront asks `enabled` first and draws nothing unless the store has switched it on.
 */
export class ShopAssistantService extends BaseService {
	/** Off, or an engine without the module: either way there is nothing to show. */
	async enabled(): Promise<boolean> {
		try {
			return (await this.data<{ enabled: boolean } | null>('/x/shop-assistant/status'))?.enabled === true
		} catch (err) {
			if (err instanceof GoCommerceError && err.status === 404) return false
			throw err
		}
	}

	/** One message. Failures throw a `GoCommerceError` in words a shopper can read. */
	async turn(messages: ShopAssistantMessage[]): Promise<ShopAssistantReply> {
		const { language } = this.creds
		const out = await this.data<EngineReply>('/x/shop-assistant/turn', {
			method: 'POST',
			// The engine's connector-wide language goes only on reads, and these cards are one.
			query: language ? { lang: language } : undefined,
			body: { messages },
		})
		return {
			reply: out.reply,
			closest: out.closest,
			faqs: out.faqs ?? [],
			handover: out.handover,
			products: (out.products ?? []).map((p) => ({
				productId: p.product_id,
				slug: p.slug,
				title: p.title,
				image: mediaUrl(p.image_url),
				price: minorToMajor(p.price.amount_minor, p.price.currency),
				compareAtPrice: p.compare_at_price ? minorToMajor(p.compare_at_price.amount_minor, p.price.currency) : null,
				currency: p.price.currency,
				variantId: p.variant_id,
			})),
		}
	}
}

export const shopAssistantService = new ShopAssistantService()
