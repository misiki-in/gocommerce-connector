/**
 * Engine shapes to storefront shapes.
 *
 * Svelte Commerce's types were drawn around Litekart's API, so every connector
 * is a translation and this file is most of ours. Four rules run through it:
 *
 *   1. Ids cross as strings. The storefront matches variants and cart lines
 *      with `===` against ids it read from a URL.
 *   2. Money crosses as a major-unit number, through money.ts and nowhere else.
 *   3. A field the engine does not have is empty, never invented. There is no
 *      popularity score, so none is made up; there is no compare-at price, so
 *      `mrp` equals the price rather than 0, which would render as a 100%
 *      discount on everything in the shop.
 *   4. Lists are always arrays. Product cards read `variants[0]` unguarded.
 */
import type {
	Address,
	Cart,
	CartLine,
	Category,
	CmsPage,
	Collection,
	Customer,
	IdentityAddress,
	Order,
	OrderLine,
	Product,
	Review,
	SearchDoc,
	Variant,
	Vendor,
} from './engine'
import { minorToMajor, toMajor, type Money } from './money'
import type { CartExtras, StorefrontAddress } from './browser'

const str = (v: number | string | null | undefined): string => (v === null || v === undefined ? '' : String(v))

const arr = <T>(v: T[] | null | undefined): T[] => v ?? []

// ---------------------------------------------------------------- products

/** Variants a shopper can see: inactive ones are the merchant's business. */
const liveVariants = (p: Product): Variant[] => arr(p.variants).filter((v) => v.active)

function variantImages(v: Variant): string[] {
	const out: string[] = []
	for (const img of [v.image, ...arr(v.images)]) {
		if (img?.url && (img.kind ?? 'image') === 'image' && !out.includes(img.url)) out.push(img.url)
	}
	return out
}

/**
 * Every picture the public API offers for a product: the lead image, then each
 * variant's. The engine keeps the full gallery on admin routes only, so this
 * is the honest union rather than the whole media library.
 */
export function productImages(p: Product): string[] {
	const out: string[] = []
	const push = (url?: string) => {
		if (url && !out.includes(url)) out.push(url)
	}
	push(p.image_url)
	for (const v of arr(p.variants)) for (const url of variantImages(v)) push(url)
	return out
}

export function toVariant(v: Variant, p: Product, optionless: boolean) {
	const images = variantImages(v)
	const options = arr(p.options)
	return {
		id: str(v.id),
		productId: str(v.product_id),
		// The storefront picks the default variant of an optionless product by
		// this exact title, and hides the variant name when it sees it.
		title: optionless ? 'default' : v.label || v.sku,
		sku: v.sku,
		barcode: v.barcode ?? null,
		price: toMajor(v.price),
		mrp: toMajor(v.compare_at_price ?? v.price),
		// The engine's own vocabulary, unchanged: `available` is on hand minus
		// reserved; an untracked variant is never managed, so its count is moot.
		stock: v.active ? v.available : 0,
		manageInventory: v.active ? v.track_inventory : true,
		allowBackorder: v.active && v.continue_selling,
		active: v.active,
		weight: v.weight_grams ?? null,
		length: v.dimensions?.length_mm ?? null,
		width: v.dimensions?.width_mm ?? null,
		height: v.dimensions?.height_mm ?? null,
		images: images.join(','),
		img: images[0] ?? null,
		image: images[0] ?? null,
		thumbnail: images[0] ?? null,
		// Values in option order — `options[i]` answers `p.options[i]`.
		options: arr(v.options).map((value, i) => ({ optionId: str(options[i]?.id), value })),
		metadata: v.metadata ?? null,
	}
}

export type StorefrontProduct = ReturnType<typeof toProduct>

export function toProduct(p: Product, extra: { categoryHierarchy?: { name: string; slug: string }[] } = {}) {
	const live = liveVariants(p)
	const lead = live[0] ?? arr(p.variants)[0]
	const optionless = arr(p.options).length === 0
	const images = productImages(p)
	const prices = live.map((v) => toMajor(v.price))
	const tracked = live.filter((v) => v.track_inventory)
	const category = p.category
	const tags = arr(p.tags)

	return {
		id: str(p.id),
		slug: p.slug,
		title: p.title,
		name: p.title,
		subtitle: null,
		description: p.description ?? '',
		status: p.status === 'active' ? 'published' : p.status,
		active: p.status === 'active',
		type: p.product_type ?? '',
		currency: p.currency,
		currencyCode: p.currency,
		price: lead ? toMajor(lead.price) : 0,
		mrp: lead ? toMajor(lead.compare_at_price ?? lead.price) : 0,
		minPrice: prices.length ? Math.min(...prices) : 0,
		maxPrice: prices.length ? Math.max(...prices) : 0,
		sku: lead?.sku ?? null,
		barcode: lead?.barcode ?? null,
		weight: lead?.weight_grams ?? null,
		originCountry: lead?.origin_country ?? null,
		thumbnail: images[0] ?? null,
		image_url: images[0] ?? null,
		images: images.join(','),
		imageList: images,
		// Product-level stock is what a card shows before a variant is picked:
		// buyable when any live variant is, counted only where counting means
		// something.
		manageInventory: live.length > 0 && tracked.length === live.length,
		allowBackorder: live.some((v) => v.continue_selling),
		stock: tracked.reduce((n, v) => n + Math.max(0, v.available), 0),
		hasStock: live.some((v) => !v.track_inventory || v.continue_selling || v.available > 0),
		categoryId: category ? str(category.id) : null,
		category: category ? { id: str(category.id), name: category.title, slug: category.slug } : null,
		categories: category ? [{ category: { id: str(category.id), name: category.title, slug: category.slug } }] : [],
		categoryHierarchy: extra.categoryHierarchy ?? (category ? [{ name: category.title, slug: category.slug }] : []),
		collections: arr(p.collections).map((c) => ({ id: str(c.id), name: c.title, slug: c.slug })),
		// Free text on the engine's product, not a vendor record.
		vendor: p.vendor ? { businessName: p.vendor } : null,
		productTags: tags.join(','),
		keywords: tags.join(','),
		metaTitle: p.seo_title || p.title,
		metaDescription: p.seo_description || null,
		link: `/products/${p.slug}`,
		options: arr(p.options).map((o) => ({
			id: str(o.id),
			title: o.name,
			name: o.name,
			type: 'text',
			values: arr(o.values).map((val) => ({ id: str(val.id), value: val.value })),
		})),
		variants: live.map((v) => toVariant(v, p, optionless)),
		// Filled by the product page from ext/reviews when it is installed.
		ratings: [] as ReturnType<typeof toRating>[],
		rating: null as number | null,
		ratingCount: 0,
		reviewCount: 0,
		attributes: [] as { name: string; value: string }[],
		metadata: p.metadata ?? null,
		createdAt: p.created_at,
		updatedAt: p.updated_at,
	}
}

/** A Meilisearch hit — the search index's document, which is thinner than a product. */
export function fromSearchDoc(d: SearchDoc) {
	const price = minorToMajor(d.price_minor, d.currency)
	return {
		id: str(d.id),
		slug: d.slug,
		title: d.title,
		name: d.title,
		description: d.description,
		currency: d.currency,
		price,
		mrp: price,
		minPrice: price,
		maxPrice: minorToMajor(d.price_max_minor, d.currency),
		thumbnail: d.image ?? null,
		image_url: d.image ?? null,
		images: d.image ?? '',
		stock: d.in_stock ? 1 : 0,
		hasStock: d.in_stock,
		// The index cannot say how much is left, only whether any is; a card
		// built from it must not claim to count.
		manageInventory: false,
		allowBackorder: false,
		productTags: arr(d.tags).join(','),
		category: d.category ? { name: d.category.split(' / ').pop() ?? d.category, slug: '' } : null,
		vendor: d.vendor ? { businessName: d.vendor } : null,
		variants: [] as ReturnType<typeof toVariant>[],
		options: [],
		ratings: [],
		link: `/products/${d.slug}`,
		updatedAt: new Date(d.updated_at * 1000).toISOString(),
	}
}

// ---------------------------------------------------------------- taxonomy

export type StorefrontCategory = {
	id: string
	name: string
	title: string
	slug: string
	link: string
	parentCategoryId: string | null
	path: string
	level: number
	rank: number
	childCount: number
	thumbnail: string | null
	description: string | null
	isActive: boolean
	isFeatured: boolean
	isMegamenu: boolean
	metaTitle: string
	children: StorefrontCategory[]
	createdAt: string
	updatedAt: string
}

export function toCategory(c: Category): StorefrontCategory {
	return {
		id: str(c.id),
		name: c.title,
		title: c.title,
		slug: c.slug,
		link: `/${c.slug}`,
		parentCategoryId: c.parent_id === null || c.parent_id === undefined ? null : str(c.parent_id),
		path: c.full_name,
		level: c.depth,
		rank: c.position,
		childCount: c.child_count,
		thumbnail: (c.metadata?.image as string | undefined) ?? null,
		description: (c.metadata?.description as string | undefined) ?? null,
		isActive: true,
		isFeatured: false,
		isMegamenu: false,
		metaTitle: c.title,
		children: arr(c.children).map(toCategory),
		createdAt: c.created_at,
		updatedAt: c.updated_at,
	}
}

export function toCollection(c: Collection) {
	return {
		id: str(c.id),
		name: c.title,
		title: c.title,
		slug: c.slug,
		description: c.description || null,
		subTitle: null,
		rank: str(c.position),
		thumbnail: (c.metadata?.image as string | undefined) ?? null,
		isActive: true,
		metaTitle: c.title,
		metaDescription: c.description || null,
		createdAt: c.created_at,
		updatedAt: c.updated_at,
	}
}

// ---------------------------------------------------------------- addresses

/** The engine's address — on a checkout or an order — to the storefront's form shape. */
export function fromEngineAddress(a: Address | undefined, email?: string) {
	if (!a) return null
	const [firstName, ...rest] = (a.name ?? '').trim().split(/\s+/)
	return {
		firstName: firstName || '',
		lastName: rest.join(' '),
		email: email ?? null,
		phone: a.phone ?? null,
		address_1: a.line1,
		address_2: a.line2 ?? '',
		city: a.city,
		state: a.state ?? '',
		zip: a.postal_code,
		country: a.country,
		countryCode: a.country,
	}
}

/** The storefront's form shape to the engine's checkout address. */
export function toEngineAddress(a: StorefrontAddress): Address {
	const name = [a.firstName, a.lastName].filter(Boolean).join(' ').trim()
	return {
		...(name ? { name } : {}),
		...(a.phone ? { phone: String(a.phone) } : {}),
		line1: String(a.address_1 ?? '').trim(),
		...(a.address_2 || a.locality ? { line2: [a.address_2, a.locality].filter(Boolean).join(', ') } : {}),
		city: String(a.city ?? '').trim(),
		...(a.state ? { state: String(a.state) } : {}),
		postal_code: String(a.zip ?? '').trim(),
		country: String(a.countryCode || a.country || '')
			.trim()
			.toUpperCase(),
	}
}

/** An address-book entry (ext/identity) to the storefront's Address. */
export function fromIdentityAddress(a: IdentityAddress, email?: string) {
	const [firstName, ...rest] = (a.name ?? '').trim().split(/\s+/)
	return {
		id: str(a.id),
		firstName: firstName || '',
		lastName: rest.join(' '),
		email: email ?? null,
		phone: a.phone || null,
		address_1: a.line1,
		address_2: a.line2,
		city: a.city,
		state: a.state,
		zip: a.postal_code,
		country: a.country,
		countryCode: a.country,
		label: a.label,
		isPrimary: a.is_default,
		createdAt: a.created_at,
		updatedAt: a.updated_at,
	}
}

/** The storefront's Address to ext/identity's AddressInput. Only declared fields: the engine refuses others. */
export function toIdentityAddress(a: StorefrontAddress & { isPrimary?: boolean; label?: string }) {
	const e = toEngineAddress(a)
	return {
		name: e.name ?? '',
		phone: e.phone ?? '',
		line1: e.line1,
		line2: e.line2 ?? '',
		city: e.city,
		state: e.state ?? '',
		postal_code: e.postal_code,
		country: e.country,
		...(a.label ? { label: String(a.label) } : {}),
		...(a.isPrimary ? { is_default: true } : {}),
	}
}

// ---------------------------------------------------------------- cart

export function toCartLine(l: CartLine, extra: { slug?: string; thumbnail?: string | null } = {}) {
	return {
		id: str(l.id),
		productId: str(l.product_id),
		variantId: str(l.variant_id),
		sku: l.sku,
		title: l.title,
		name: l.title,
		slug: extra.slug ?? '',
		thumbnail: extra.thumbnail ?? null,
		variantTitle: l.variant_label ?? '',
		qty: l.quantity,
		price: toMajor(l.unit_price),
		mrp: toMajor(l.unit_price),
		subtotal: toMajor(l.total),
		total: toMajor(l.total),
		inStock: l.in_stock,
		priceChanged: l.price_changed,
		currentPrice: toMajor(l.current_price),
		// The storefront's review step lists only lines marked for checkout. The
		// engine checks a cart out whole, so every line is.
		isSelectedForCheckout: true,
		variant: {
			id: str(l.variant_id),
			options: l.variant_label ? l.variant_label.split(' / ').map((value) => ({ option: { title: '' }, value })) : [],
		},
		product: { id: str(l.product_id), categories: [] as unknown[] },
	}
}

/**
 * A cart, with what the engine does not keep laid over it: the coupon and its
 * previewed saving, the delivery choice and the addresses. Totals here are an
 * estimate the engine settles at checkout — tax in particular exists only on
 * the order — and the storefront is told so by `taxIncluded: false`.
 */
export function toCart(
	c: Cart,
	extras: CartExtras = {},
	lineExtra: (l: CartLine) => { slug?: string; thumbnail?: string | null } = () => ({}),
) {
	const lines = c.status === 'converted' ? [] : arr(c.line_items)
	const currency = c.currency
	const subtotalMinor = lines.reduce((n, l) => n + l.total.amount_minor, 0)
	const discountMinor = extras.discount && !extras.discount.free_shipping ? extras.discount.amount_minor : 0
	const shippingMinor = extras.discount?.free_shipping ? 0 : (extras.shippingRate?.minor ?? 0)
	const totalMinor = Math.max(0, subtotalMinor - discountMinor) + shippingMinor
	const money = (minor: number) => minorToMajor(minor, currency)
	const ship = extras.shippingAddress ?? null

	return {
		id: c.id,
		status: c.status,
		email: c.email ?? ship?.email ?? null,
		phone: extras.phone ?? ship?.phone ?? null,
		name: ship ? [ship.firstName, ship.lastName].filter(Boolean).join(' ') : null,
		lineItems: lines.map((l) => toCartLine(l, lineExtra(l))),
		qty: lines.reduce((n, l) => n + l.quantity, 0),
		currencyCode: currency,
		currency,
		subtotal: money(subtotalMinor),
		discountAmount: money(discountMinor),
		savingAmount: money(discountMinor),
		couponCode: extras.discount?.code ?? null,
		discount: extras.discount ?? null,
		shippingCharges: money(shippingMinor),
		shippingRateId: extras.shippingRateId ?? null,
		shippingMethod: extras.shippingRate?.name ?? null,
		tax: 0,
		taxIncluded: false,
		codCharges: 0,
		total: money(totalMinor),
		shippingAddress: ship,
		shippingAddressId: ship ? (ship.id && ship.id !== 'new' ? String(ship.id) : 'cart') : null,
		billingAddress: extras.billingAddress ?? ship,
		billingAddressId: extras.billingAddress
			? extras.billingAddress.id && extras.billingAddress.id !== 'new'
				? String(extras.billingAddress.id)
				: 'cart-billing'
			: ship
				? ship.id && ship.id !== 'new'
					? String(ship.id)
					: 'cart'
				: null,
		paymentMethod: null,
		needAddress: lines.length > 0,
		completedAt: c.status === 'converted' ? c.updated_at : null,
		createdAt: c.created_at,
		updatedAt: c.updated_at,
		expiresAt: c.expires_at,
	}
}

/** What the storefront shows for "no bag yet": its own initial cart, field for field. */
export function emptyCart(currency = 'USD') {
	return {
		id: '',
		status: 'open',
		email: null,
		phone: null,
		lineItems: [] as ReturnType<typeof toCartLine>[],
		qty: 0,
		currencyCode: currency,
		subtotal: 0,
		discountAmount: 0,
		savingAmount: 0,
		couponCode: null,
		shippingCharges: 0,
		tax: 0,
		total: 0,
		shippingAddress: null,
		shippingAddressId: null,
		billingAddress: null,
		billingAddressId: null,
	}
}

// ---------------------------------------------------------------- orders

const STATUS: Record<string, string> = {
	pending: 'Pending',
	confirmed: 'Confirmed',
	partial: 'Partially shipped',
	shipped: 'Shipped',
	delivered: 'Delivered',
	cancelled: 'Cancelled',
}

const PAYMENT_STATUS: Record<string, string> = {
	pending: 'Pending',
	paid: 'Paid',
	failed: 'Failed',
	refunded: 'Refunded',
}

function toOrderLine(l: OrderLine, currency: string) {
	return {
		id: str(l.id),
		productId: str(l.product_id),
		variantId: str(l.variant_id),
		sku: l.sku,
		title: l.title,
		name: l.title,
		slug: '',
		thumbnail: l.image_url ?? null,
		img: l.image_url ?? null,
		variantTitle: l.variant_label ?? '',
		qty: l.quantity,
		shippedQty: l.shipped_quantity,
		price: toMajor(l.unit_price),
		mrp: toMajor(l.unit_price),
		subtotal: toMajor(l.total),
		total: toMajor(l.total),
		currencyCode: currency,
		status: l.shipped_quantity >= l.quantity ? 'Shipped' : 'Pending',
		files: [],
		usedOptions: [],
	}
}

export type StorefrontOrder = ReturnType<typeof toOrder>

export function toOrder(o: Order) {
	const address = fromEngineAddress(o.address, o.email)
	const code = (o.discounts ?? []).find((d) => d.code)?.code
	return {
		id: str(o.id),
		orderNo: o.number,
		orderNumber: o.number,
		number: o.number,
		// The storefront links an order by this; the engine has no sub-orders,
		// so an order is its own parent.
		parentOrderNo: o.number,
		status: STATUS[o.status] ?? o.status,
		engineStatus: o.status,
		paymentStatus: PAYMENT_STATUS[o.payment_status] ?? o.payment_status,
		paymentMethod: o.payment_provider.toUpperCase(),
		currencyCode: o.currency,
		subtotal: toMajor(o.subtotal),
		shippingCharges: toMajor(o.shipping),
		discount: toMajor(o.discount),
		tax: toMajor(o.tax),
		taxIncluded: o.tax_inclusive,
		total: toMajor(o.total),
		refunded: toMajor(o.refunded),
		codCharges: 0,
		coupon: code ? { code } : null,
		userEmail: o.email,
		email: o.email,
		phone: o.phone ?? null,
		shippingAddress: address,
		billingAddress: address,
		shippingMethod: o.shipping_method ?? null,
		shippingRate: o.shipping_method ? { name: o.shipping_method } : null,
		lineItems: arr(o.line_items).map((l) => toOrderLine(l, o.currency)),
		fulfillments: arr(o.fulfillments).map((f) => ({
			id: str(f.id),
			status: f.status,
			carrier: f.carrier_name || f.carrier || f.provider,
			trackingNumber: f.tracking ?? null,
			trackingUrl: f.tracking_url ?? null,
			lineItems: arr(f.lines).map((l) => ({ id: str(l.order_line_id), title: l.title, qty: l.quantity })),
			createdAt: f.created_at,
		})),
		tracking: [],
		orderHistory: [],
		isReplaceOrReturn: false,
		createdAt: o.created_at,
		updatedAt: o.updated_at,
	}
}

// ---------------------------------------------------------------- the rest

export function toRating(r: Review) {
	return {
		id: str(r.id),
		rating: r.rating,
		name: r.name,
		title: r.title ?? '',
		review: r.body,
		message: r.body,
		reply: r.reply ?? null,
		verified: r.verified,
		img: '',
		createdAt: r.created_at,
	}
}

export function toCmsPage(p: CmsPage) {
	return {
		id: str(p.id),
		slug: p.slug,
		name: p.title,
		title: p.title,
		content: p.body,
		excerpt: p.excerpt ?? null,
		layouts: [],
		language: p.language,
		metaTitle: p.seo?.title || p.title,
		metaDescription: p.seo?.description || p.excerpt || null,
		metaKeywords: p.seo?.keywords || null,
		publishedAt: p.published_at ?? null,
		createdAt: p.created_at,
		updatedAt: p.updated_at,
	}
}

export function toVendor(v: Vendor) {
	return {
		id: str(v.id),
		slug: v.slug,
		name: v.name,
		businessName: v.name,
		about: v.about,
		description: v.about,
		website: v.website,
		address: v.address,
		banners: [],
		rating: null,
	}
}

export function toUser(c: Customer) {
	const [firstName, ...rest] = (c.name ?? '').trim().split(/\s+/)
	return {
		id: str(c.id),
		userId: str(c.id),
		email: c.email,
		emailVerified: c.email_verified,
		phone: c.phone || null,
		firstName: firstName || '',
		lastName: rest.join(' '),
		name: c.name,
		fullName: c.name,
		avatar: null,
		role: 'USER',
		createdAt: c.created_at,
		updatedAt: c.updated_at,
	}
}

export const priceOf = (m: Money | undefined) => (m ? toMajor(m) : 0)
