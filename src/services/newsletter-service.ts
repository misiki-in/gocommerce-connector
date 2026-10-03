import { BaseService } from './base.service'

/**
 * The signup box and its unsubscribe link (ext/newsletter). Subscribing twice
 * is not an error, and unsubscribing answers the same whether or not the token
 * matched, so neither call tells a stranger whether an address is on the list.
 */
export class NewsletterService extends BaseService {
	async subscribe({ email, name, source }: { email: string; name?: string; source?: string }) {
		return this.data<{ status: 'subscribed' }>('/x/newsletter/subscribe', {
			method: 'POST',
			body: { email: String(email ?? '').trim(), ...(name ? { name } : {}), ...(source ? { source } : {}) },
		})
	}

	/** The token from the unsubscribe link in a newsletter email. */
	async unsubscribe(token: string) {
		return this.data<{ status: 'unsubscribed' }>('/x/newsletter/unsubscribe', {
			method: 'POST',
			body: { token: String(token ?? '') },
		})
	}
}

export const newsletterService = new NewsletterService()
