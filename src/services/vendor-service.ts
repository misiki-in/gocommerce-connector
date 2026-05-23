import type { Vendor } from '../engine'
import { toVendor } from '../map'
import { BaseService, emptyPage, toPage } from './base.service'

/** The marketplace's sellers: approved vendors only. */
export class VendorService extends BaseService {
	async list({
		page = 1,
		limit = 24,
		q,
		search,
	}: { page?: number; limit?: number; q?: string; search?: string; sort?: string } = {}) {
		const env = await this.engine<Vendor[] | null>('/api/vendors', { query: { page, limit, q: q ?? search } })
		return toPage(env, toVendor)
	}

	async getVendor(slug: string) {
		return toVendor(await this.data<Vendor>(`/api/vendors/${encodeURIComponent(String(slug))}`))
	}

	/**
	 * A seller's shelf. The engine's vendors sell through offers on the shop's
	 * own variants and the public API lists no products by seller, so the shelf
	 * is empty — the seller's page still renders, with their details.
	 */
	async fetchProductsOfVendor(_vendorId?: string) {
		return emptyPage()
	}
}

export const vendorService = new VendorService()
