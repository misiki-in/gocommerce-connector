import type { IdentityAddress } from '../engine'
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

	async deleteAddress(id: string) {
		await this.engine(`/x/identity/me/addresses/${enc(id)}`, { method: 'DELETE', auth: true })
		return { id: String(id), deleted: true }
	}
}

const enc = (id: string) => encodeURIComponent(String(id))

export const addressService = new AddressService()
