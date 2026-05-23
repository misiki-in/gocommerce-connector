/**
 * The rest of the family's service surface.
 *
 * Svelte Commerce imports some four dozen services by name because Litekart
 * has them, and an export that is missing is a TypeError at import. Each one
 * is here. Where the engine has the thing, it is wired; where it does not, a
 * read of a list answers empty (a shop legitimately has no reels) and anything
 * that would write, or that names one record, throws `NotSupportedError` —
 * a silent success would tell a shopper their message was sent when nothing
 * left the browser.
 */
import type { Plugin } from '../engine'
import { NotSupportedError } from '../errors'
import { readStaticStore } from '../static-store'
import { resolveRestLocally } from '../rest-guard'
import { BaseService, emptyPage } from './base.service'
import { StoreFacts } from './facts'
import { MeilisearchService } from './meilisearch-service'
import { StoreService } from './store-service'

const refuse = (service: string, method: string, why: string) => new NotSupportedError(service, method, why)

/** The storefront's contact form and product enquiries, through ext/contact's inbox. */
export class ContactService extends BaseService {
	async submitContactUsForm({
		name,
		email,
		phone,
		message,
		subject,
	}: {
		name: string
		email: string
		phone?: string
		message: string
		subject?: string
	}) {
		return this.data<{ status: string }>('/x/contact/messages', {
			method: 'POST',
			body: {
				name: String(name ?? ''),
				email: String(email ?? ''),
				...(phone ? { phone: String(phone) } : {}),
				...(subject ? { subject: String(subject) } : {}),
				body: String(message ?? ''),
			},
		})
	}
}

export class EnquiryService extends ContactService {
	async create({
		name,
		email,
		phone,
		message,
		productId,
	}: {
		name: string
		email: string
		phone?: string
		message: string
		productId?: string
	}) {
		return this.submitContactUsForm({
			name,
			email,
			phone,
			subject: productId ? `Enquiry about product ${productId}` : 'Enquiry',
			message,
		})
	}
}

/** Enabled plugins and their public settings, `{ key, title, settings }`. */
export class PluginService extends BaseService {
	private readonly facts = new StoreFacts(this._fetch)
	async list(_args: Record<string, unknown> = {}) {
		const data: Plugin[] = [...(await this.facts.plugins()).values()]
		return { data, count: data.length, pageSize: data.length, noOfPage: 1, page: 1 }
	}
}

/** The store record again, for the callers that ask for it as "settings" or "init". */
export class SettingService extends BaseService {
	async fetchSettings(_args: Record<string, unknown> = {}) {
		return new StoreService(this._fetch).getStoreByIdOrDomain()
	}
	async list(args: Record<string, unknown> = {}) {
		return this.fetchSettings(args)
	}
}

export class InitService extends SettingService {
	async fetchInit(_args: Record<string, unknown> = {}) {
		const store = await this.fetchSettings()
		return { storeOne: store, store, settings: store }
	}
}

export class HomeService extends BaseService {
	/** A homepage is assembled by the storefront from shelves; the engine has no page of its own for it. */
	async getHome(_args: Record<string, unknown> = {}) {
		return { banners: [], groupByBanner: [], categories: [], products: [] }
	}
}

/** Countries for the address form: the storefront's own list, which is what it offers anyway. */
export class CountryService extends BaseService {
	async list(_args: Record<string, unknown> = {}) {
		return resolveRestLocally('get', '/api/countries')
	}
}

/** The one currency an engine store settles in. */
export class CurrencyService extends BaseService {
	private readonly facts = new StoreFacts(this._fetch)
	async listCurrencies(_args: Record<string, unknown> = {}) {
		const { currency } = await this.facts.ready()
		const data = [{ code: currency, name: currency, isDefault: true }]
		return { data, count: 1, pageSize: 1, noOfPage: 1, page: 1 }
	}
	async list(args: Record<string, unknown> = {}) {
		return this.listCurrencies(args)
	}
}

/** States are free text on a GoCommerce address; there is no list to offer. */
export class StateService extends BaseService {
	async list(_args: Record<string, unknown> = {}) {
		return emptyPage()
	}
}

export class RegionService extends BaseService {
	async list(_args: Record<string, unknown> = {}) {
		return emptyPage()
	}
}

/** The header's type-ahead, under the name some storefront builds still call it by. */
export class AutocompleteService extends MeilisearchService {
	async list({ q, search }: { q?: string; search?: string } = {}) {
		return this.searchAutoComplete({ query: q ?? search })
	}
}

export class PopularSearchService extends BaseService {
	async list(_args: Record<string, unknown> = {}) {
		return emptyPage()
	}
}

/** The engine keeps no popularity score; a page view is not recorded. */
export class PopularityService extends BaseService {
	async updatePopularity(_args: Record<string, unknown> = {}) {
		return undefined
	}
}

export class BlogService extends BaseService {
	async list(_args: Record<string, unknown> = {}) {
		return emptyPage()
	}
	async getOne(_slug: string): Promise<never> {
		throw refuse('BlogService', 'getOne', 'the engine has no blog; publish articles as pages')
	}
}

export class BannerService extends BaseService {
	async list(_args: Record<string, unknown> = {}) {
		return emptyPage()
	}
	async listBanners(args: Record<string, unknown> = {}) {
		return this.list(args)
	}
	async fetchBanners(args: Record<string, unknown> = {}) {
		return this.list(args)
	}
}

export class ReelsService extends BaseService {
	async list(_args: Record<string, unknown> = {}) {
		return emptyPage()
	}
}

export class DealService extends BaseService {
	async fetchDeals(_args: Record<string, unknown> = {}) {
		return emptyPage()
	}
}

export class GalleryService extends BaseService {
	async list(_args: Record<string, unknown> = {}) {
		return emptyPage()
	}
}

export class ChatService extends BaseService {
	async list(_args: Record<string, unknown> = {}) {
		return emptyPage()
	}
	async chats(): Promise<never> {
		throw refuse('ChatService', 'chats', 'the engine has no shopper chat')
	}
	async save(): Promise<never> {
		throw refuse('ChatService', 'save', 'the engine has no shopper chat')
	}
}

export class FeedbackService extends BaseService {
	async save(): Promise<never> {
		throw refuse('FeedbackService', 'save', 'use the contact form')
	}
}

export class DemoRequestService extends BaseService {
	async save(): Promise<never> {
		throw refuse('DemoRequestService', 'save', 'use the contact form')
	}
}

export class UploadService extends BaseService {
	async uploadMultipleToS3(): Promise<never> {
		throw refuse('UploadService', 'uploadMultipleToS3', 'shoppers cannot upload files to the engine')
	}
	async upload(): Promise<never> {
		throw refuse('UploadService', 'upload', 'shoppers cannot upload files to the engine')
	}
}

export class WarrantyService extends BaseService {
	async submitWarrantyRegistration(): Promise<never> {
		throw refuse('WarrantyService', 'submitWarrantyRegistration', 'the engine has no warranty registrations')
	}
}

export class VarniCustomDesignService extends BaseService {
	async submitForm(): Promise<never> {
		throw refuse('VarniCustomDesignService', 'submitForm', 'custom design requests are a Litekart feature')
	}
}

export class VarniCustomProductService extends BaseService {
	async list(_args: Record<string, unknown> = {}) {
		return emptyPage()
	}
}

/** The storefront's static store record, for code that wants the raw config. */
export const staticStore = () => readStaticStore()

export const contactService = new ContactService()
export const enquiryService = new EnquiryService()
export const pluginService = new PluginService()
export const settingService = new SettingService()
export const initService = new InitService()
export const homeService = new HomeService()
export const countryService = new CountryService()
export const currencyService = new CurrencyService()
export const stateService = new StateService()
export const regionService = new RegionService()
export const autocompleteService = new AutocompleteService()
export const popularSearchService = new PopularSearchService()
export const popularityService = new PopularityService()
export const blogService = new BlogService()
export const bannerService = new BannerService()
export const reelsService = new ReelsService()
export const dealService = new DealService()
export const galleryService = new GalleryService()
export const chatService = new ChatService()
export const feedbackService = new FeedbackService()
export const demoRequestService = new DemoRequestService()
export const uploadService = new UploadService()
export const warrantyService = new WarrantyService()
export const varniCustomDesignService = new VarniCustomDesignService()
export const varniCustomProductService = new VarniCustomProductService()

// kitcommerce-core reads the plural spellings; the family exports the singular. Both, then.
export { PluginService as PluginsService, SettingService as SettingsService }
export const pluginsService = pluginService
export const settingsService = settingService
