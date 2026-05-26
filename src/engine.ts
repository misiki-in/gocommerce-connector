/**
 * The engine's JSON, as its handlers write it.
 *
 * Field names are the Go struct tags in core/ and ext/, not the OpenAPI
 * descriptions: where the two could disagree, these follow the code. Ids are
 * int64 numbers everywhere except the cart, whose `id` is its 64-hex token.
 */
import type { Money } from './money'

export type ListMeta = { total: number; limit: number; offset: number; page: number; total_pages: number }

export type Envelope<T> = { data: T; meta?: ListMeta }

export type VariantImage = { media_id: number; url: string; kind: string; alt?: string }

export type Variant = {
	id: number
	product_id: number
	sku: string
	barcode?: string
	price: Money
	compare_at_price?: Money
	taxable: boolean
	requires_shipping: boolean
	options: string[] | null
	label: string
	available: number
	track_inventory: boolean
	continue_selling: boolean
	active: boolean
	origin_country?: string
	hs_code?: string
	weight_grams?: number
	dimensions?: { length_mm?: number; width_mm?: number; height_mm?: number }
	images?: VariantImage[]
	image?: VariantImage
	position: number
	metadata?: Record<string, unknown>
}

export type ProductOption = {
	id: number
	name: string
	position: number
	values: { id: number; value: string; position: number }[] | null
}

export type Product = {
	id: number
	slug: string
	title: string
	description: string
	status: string
	currency: string
	product_type: string
	vendor: string
	tags: string[] | null
	category?: { id: number; slug: string; title: string; full_name: string }
	seo_title: string
	seo_description: string
	image_url?: string
	media_count?: number
	options: ProductOption[] | null
	variants: Variant[] | null
	collections: { id: number; slug: string; title: string }[] | null
	metadata?: Record<string, unknown>
	created_at: string
	updated_at: string
}

export type Category = {
	id: number
	parent_id: number | null
	slug: string
	title: string
	position: number
	full_name: string
	depth: number
	child_count: number
	children?: Category[]
	metadata?: Record<string, unknown>
	created_at: string
	updated_at: string
}

export type Collection = {
	id: number
	slug: string
	title: string
	description: string
	position: number
	metadata?: Record<string, unknown>
	created_at: string
	updated_at: string
}

export type CartLine = {
	id: number
	variant_id: number
	product_id: number
	sku: string
	title: string
	variant_label?: string
	quantity: number
	unit_price: Money
	total: Money
	current_price: Money
	available: number
	in_stock: boolean
	price_changed: boolean
}

export type Cart = {
	id: string
	status: 'open' | 'converted' | 'abandoned'
	currency: string
	email?: string
	verified_email?: string
	channel?: string
	line_items: CartLine[] | null
	item_count: number
	subtotal: Money
	metadata?: Record<string, unknown>
	created_at: string
	updated_at: string
	expires_at: string
}

/** What `PUT /api/carts/{token}/discount` answers: a preview, re-decided at checkout. */
export type AppliedDiscount = {
	discount_id: number
	code?: string
	title: string
	kind: 'percentage' | 'fixed' | 'free_shipping'
	amount_minor: number
	free_shipping?: boolean
}

export type Address = {
	name?: string
	phone?: string
	line1: string
	line2?: string
	city: string
	state?: string
	postal_code: string
	country: string
}

export type OrderLine = {
	id: number
	product_id?: number
	variant_id?: number
	sku: string
	title: string
	image_url?: string
	variant_label?: string
	quantity: number
	shipped_quantity: number
	unit_price: Money
	total: Money
}

export type Fulfillment = {
	id: number
	provider: string
	tracking?: string
	carrier?: string
	carrier_name?: string
	tracking_url?: string
	status: string
	created_at: string
	lines: { order_line_id: number; sku: string; title: string; quantity: number }[] | null
}

export type Order = {
	id: number
	number: string
	status: string
	payment_status: string
	payment_provider: string
	currency: string
	subtotal: Money
	shipping: Money
	shipping_method?: string
	discount: Money
	tax: Money
	tax_inclusive: boolean
	total: Money
	refunded: Money
	email: string
	phone?: string
	name?: string
	address: Address
	discounts?: AppliedDiscount[] | null
	line_items: OrderLine[] | null
	fulfillments: Fulfillment[] | null
	access_token?: string
	created_at: string
	updated_at: string
}

export type PaymentIntent = {
	kind: 'none' | 'client_action' | 'redirect'
	provider: string
	reference?: string
	client_data?: Record<string, string>
}

export type CheckoutResult = { order: Order; payment: PaymentIntent }

export type CheckoutOptions = {
	payment_methods: string[]
	methods: { code: string; name: string }[]
	currency: string
}

export type ShippingRate = { rate_id: number; name: string; price: Money; zone_id: number }

export type Plugin = { key: string; title: string; settings: Record<string, unknown> }

export type Vendor = {
	id: number
	slug: string
	name: string
	about: string
	website: string
	logo_media_id: number | null
	address: { line1: string; line2: string; city: string; state: string; postal_code: string; country: string }
}

// ---------------------------------------------------------------- ext/identity

export type Customer = {
	id: number
	email: string
	email_verified: boolean
	name: string
	phone: string
	created_at: string
	updated_at: string
}

export type AuthResponse = { token: string; expires_at: string; record: Customer }

export type IdentityAddress = {
	id: number
	label: string
	name: string
	phone: string
	line1: string
	line2: string
	city: string
	state: string
	postal_code: string
	country: string
	is_default: boolean
	created_at: string
	updated_at: string
}

// ---------------------------------------------------------------- other modules

export type Review = {
	id: number
	name: string
	rating: number
	title?: string
	body: string
	verified: boolean
	reply?: string
	created_at: string
}

export type ReviewPage = {
	reviews: Review[] | null
	summary: { product_id: number; count: number; average: number; distribution: Record<string, number> }
	meta: { total: number; limit: number; offset: number }
}

export type WishlistItem = {
	id: number
	product_id: number
	variant_id?: number
	title: string
	slug: string
	sku?: string
	price?: Money
	available: number
	in_stock: boolean
	deleted?: boolean
	created_at: string
}

export type Wishlist = { id: number; token?: string; email?: string; items: WishlistItem[] | null }

export type CmsPage = {
	id: number
	slug: string
	title: string
	body: string
	excerpt?: string
	status: string
	language: string
	seo?: Record<string, string>
	published_at?: string
	created_at: string
	updated_at: string
}

export type MenuItem = {
	id?: number
	title: string
	kind: string
	target?: string
	url: string
	children: MenuItem[] | null
}

export type Menu = { id: number; handle: string; title: string; items: MenuItem[] | null }

export type Faq = {
	heading: string
	blurb: string
	sections: { section: string; entries: { id: number; question: string; answer: string }[] | null }[] | null
}

export type SearchDoc = {
	id: number
	slug: string
	title: string
	description: string
	vendor?: string
	product_type?: string
	tags: string[] | null
	category?: string
	image?: string
	currency: string
	price_minor: number
	price_max_minor: number
	in_stock: boolean
	skus: string[] | null
	updated_at: number
}

export type SearchResult = { hits: SearchDoc[] | null; query: string; total: number; limit: number; offset: number }

/** One approved vendor's offer on a variant, from `GET /api/variants/{id}/offers`. Cheapest first. */
export type Offer = {
	vendor_id: number
	vendor: string
	vendor_slug: string
	price: Money
	in_stock: boolean
	variant_id: number
}

/** A menu's name, from `GET /x/navigation/menus`. */
export type MenuSummary = { handle: string; title: string }
