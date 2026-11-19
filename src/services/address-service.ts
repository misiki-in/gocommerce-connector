import type { DeliveryCheck, IdentityAddress, Postcode } from '../engine'
import { GoCommerceError } from '../errors'
import { fromIdentityAddress, toIdentityAddress } from '../map'
import { currentMe, type StorefrontAddress } from '../browser'
import { BaseService } from './base.service'

type AddressArg = StorefrontAddress & { isPrimary?: boolean; label?: string }

/** The signed-in shopper's address book (ext/identity). A guest's address lives on the cart. */
export class AddressService extends BaseService {
	async list({
		page = 1,
		limit = 20,
	}: { page?: number; limit?: number; user?: string; q?: string; sort?: string } = {}) {
		const env = await this.engine<IdentityAddress[] | null>('/x/identity/me/addresses', {
			query: { page, limit },
			auth: true,
		})
		const email = currentMe()?.email
		const rows = env.data ?? []
		return {
			data: rows.map((a) => fromIdentityAddress(a, email)),
			count: env.meta?.total ?? rows.length,
			pageSize: env.meta?.limit ?? limit,
			noOfPage: env.meta?.total_pages ?? 1,
			page: env.meta?.page ?? page,
		}
	}

	async fetchAddress(id: string) {
		return fromIdentityAddress(
			await this.data<IdentityAddress>(`/x/identity/me/addresses/${enc(id)}`, { auth: true }),
			currentMe()?.email,
		)
	}

	/** New when it has no id (or the form's `'new'`), an edit when it has one — the storefront saves both here. */
	async saveAddress(address: AddressArg) {
		const id = address?.id && address.id !== 'new' ? String(address.id) : null
		if (id) return this.editAddress(id, address)
		const a = await this.data<IdentityAddress>('/x/identity/me/addresses', {
			method: 'POST',
			auth: true,
			body: toIdentityAddress(address),
		})
		return fromIdentityAddress(a, currentMe()?.email)
	}

	async editAddress(id: string, address: AddressArg) {
		const a = await this.data<IdentityAddress>(`/x/identity/me/addresses/${enc(id)}`, {
			method: 'PATCH',
			auth: true,
			body: toIdentityAddress(address),
		})
		return fromIdentityAddress(a, currentMe()?.email)
	}

	/**
	 * The city and state for a postcode (D134), for the address form to fill
	 * in. India's six-digit PIN codes only, from the directory the engine was
	 * given; null for anything it cannot answer, so the form simply leaves the
	 * fields to the shopper.
	 */
	async lookupPostcode({ country = 'IN', postcode }: { country?: string; postcode: string }) {
		const code = String(postcode ?? '').trim()
		const cc = String(country ?? '').trim().toUpperCase()
		if (cc !== 'IN' || !/^[1-9][0-9]{5}$/.test(code)) return null
		try {
			const p = await this.data<Postcode>(`/api/postcodes/${cc}/${code}`)
			return { country: p.country, postcode: p.postcode, city: p.city, state: p.state, stateCode: p.state_code }
		} catch (err) {
			if (err instanceof GoCommerceError && (err.status === 404 || err.status === 400)) return null
			throw err
		}
	}

	/**
	 * Whether the store delivers to a postcode and roughly when (D286), for the
	 * product page's PIN code check. The country defaults to the store's own on
	 * the engine. `minDays`/`maxDays` are null when no delivery rate states days;
	 * `unknownPostcode` is a PIN India Post never issued. A network or engine
	 * failure throws, so the page can offer a retry rather than a wrong "no".
	 */
	async checkDelivery({ postcode, country }: { postcode: string; country?: string }) {
		const query: Record<string, string> = { postcode: String(postcode ?? '').trim() }
		if (country) query.country = String(country).trim().toUpperCase()
		const d = await this.data<DeliveryCheck>('/api/shipping/check', { query })
		return {
			postcode: d.postcode,
			country: d.country,
			city: d.city ?? '',
			state: d.state ?? '',
			deliverable: d.deliverable === true,
			unknownPostcode: d.unknown_postcode === true,
			minDays: d.min_days ?? null,
			maxDays: d.max_days ?? null,
		}
	}

	async deleteAddress(id: string) {
		await this.engine(`/x/identity/me/addresses/${enc(id)}`, { method: 'DELETE', auth: true })
		return { id: String(id), deleted: true }
	}
}

const enc = (id: string) => encodeURIComponent(String(id))

export const addressService = new AddressService()
