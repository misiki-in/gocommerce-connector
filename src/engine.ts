/**
 * The engine's JSON, as its handlers write it.
 *
 * Field names are the Go struct tags in core/ and ext/, not the OpenAPI
 * descriptions: where the two could disagree, these follow the code. Ids are
 * int64 numbers everywhere except the cart, whose `id` is its 64-hex token.
 */
import type { Money } from './money'

export type ListMeta = {
	total: number
	limit: number
	offset: number
	page: number
	total_pages: number
	/** Only on `GET /api/products?facets=1`, from an engine that counts them (D130). */
	facets?: ProductFacets
}

export type FacetValue = { value: string; count: number }

/** core/catalog_facets.go: counted over the whole listing, each group without its own selection. */
export type ProductFacets = {
	price: { min: Money; max: Money } | null
	tags: FacetValue[] | null
	vendors: FacetValue[] | null
	product_types: FacetValue[] | null
	categories: { id: number; slug: string; title: string; count: number }[] | null
	attributes: Record<string, FacetValue[]> | null
}

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
	/** The gallery, pictures and videos in order: on the public product only (D134). */
	media?: VariantImage[]
	/** The sold count rounded down; absent unless the shop shows counts and it passed the threshold (D134). */
	sold_at_least?: number
	/** Sold only made to a shopper's design (D174); absent from an engine that predates the flag. */
	designable?: boolean
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
	/** The add-on this line was bought as (D133), and the product it is offered with. */
	add_on_id?: number
	add_on_for?: number
	/** The shopper's own design this line is made to (D162), and its picture. */
	design_id?: string
	design_preview_url?: string
	compare_at_price?: Money
}

/** A variant offered with a product, optionally at an offer price (D133). */
export type AddOn = {
	id: number
	product_id: number
	variant_id: number
	position: number
	offer_price: Money | null
	price: Money
	compare_at_price?: Money
	item: {
		product_id: number
		slug: string
		title: string
		variant_label?: string
		sku: string
		image_url?: string
		live: boolean
		in_stock: boolean
	}
}

/** A listed discount code, judged against one basket (D133). */
export type CartOffer = {
	code: string
	title: string
	kind: 'percentage' | 'fixed' | 'free_shipping' | string
	value_bp?: number
	value_minor?: number
	min_subtotal_minor?: number
	applies: boolean
	amount?: Money
	free_shipping?: boolean
	remaining?: Money
	reason?: string
}

/** How far a basket is from free delivery (D133). */
export type FreeShipping = {
	qualifies: boolean
	threshold?: Money
	remaining?: Money
	subtotal: Money
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
	/** `design` is a copy of the design a line was made to (D162), kept whatever later happens to it. */
	metadata?: { design?: { id: string; preview_url: string } } & Record<string, unknown>
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
	/** What the payment method added (D165): cash on delivery's extra charge. Absent on an engine before it. */
	payment_fee?: Money
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
	/** `fee` is what choosing the method adds to the order (D165); absent, it adds nothing. */
	methods: { code: string; name: string; fee?: Money }[]
	currency: string
}

export type ShippingRate = { rate_id: number; name: string; price: Money; zone_id: number }

export type Plugin = { key: string; title: string; settings: Record<string, unknown> }

/** `GET /x/google-reviews/place` (ext/google-reviews): Google's answer just now, never stored. */
export type GooglePlace = {
	rating: number
	user_rating_count: number
	google_maps_uri: string
	reviews: {
		author: { name: string; uri?: string; photo_uri?: string }
		rating: number
		text?: string
		language?: string
		relative_time?: string
		publish_time?: string
		visit_date?: string
		google_maps_uri?: string
		flag_uri?: string
	}[]
}

/** `GET /x/google-reviews/survey/{number}`: Google Customer Reviews' opt-in fields, from the order. */
export type GoogleSurvey = {
	merchant_id: number
	order_id: string
	email: string
	delivery_country: string
	estimated_delivery_date: string
	opt_in_style?: string
}

/** `GET /x/customizer/products/{id}` (ext/customizer, D162): a product's design editor, in the mockup's pixels. */
export type CustomizerSetup = {
	product_id: number
	mockup: { url: string; width: number; height: number }
	overlay_url: string | null
	print_area: { x: number; y: number; width: number; height: number; radius: number }
	print_size: { width_mm: number; height_mm: number; dpi: number }
	tools: { upload: boolean; text: boolean; shapes: boolean; background: boolean; stickers: boolean }
	fonts: { key: string; family: string }[]
	stickers: { id: number; url: string; width: number; height: number }[]
	min_photo_px: number
	consent: string
}

/** `POST /x/customizer/uploads`: the file as the engine kept it, turned upright, so its size is as seen. */
export type CustomizerUpload = { upload_id: string; url: string; width: number; height: number }

/** `POST /x/customizer/designs`. */
export type CustomizerDesign = { design_id: string; preview_url: string }

/**
 * A design, version 1, as the engine checks it and stores it on the order:
 * coordinates in the mockup's pixels from the print area's top left corner,
 * layers drawn first to last. The engine refuses a field a layer's type does
 * not carry.
 */
export type CustomizerDocument = {
	version: 1
	background?: string | null
	layers: CustomizerLayer[]
}

export type CustomizerLayer = {
	id: string
	x: number
	y: number
	width: number
	height: number
	/** Degrees clockwise about the box's centre. */
	rotation: number
	opacity: number
} & (
	| { type: 'image'; upload_id: string }
	| { type: 'text'; text: string; font: string; color: string; font_size: number; align?: 'left' | 'center' | 'right' }
	| { type: 'shape'; shape: 'rect' | 'circle' | 'heart' | 'star'; color: string }
	| { type: 'sticker'; sticker_media_id: number }
)

/** `GET /api/store`: what anyone may read about the shop. */
export type StoreProfile = {
	name: string
	email: string
	phone: string
	support_url: string
	language: string
	/** Whether the store's prices include tax (D177); absent on an engine before it. */
	prices_include_tax?: boolean
	/** Where the engine serves this store's pictures resized (D139); absent on an engine before it. */
	images_path?: string
	/** The store's logo, logo for dark backgrounds and square icon (D148); empty or absent when it has none. */
	logo_url?: string
	logo_dark_url?: string
	icon_url?: string
	/**
	 * For a contact page (D156); absent on an engine before it. The address is
	 * null unless the store chose to show it; the map location is a Google Maps
	 * link or "lat,long"; the hours are one range per open day, Monday first.
	 * The country (ISO alpha-2) is public on its own, for the phone's country code.
	 */
	country?: string
	address?: { line1: string; line2: string; city: string; state: string; postal_code: string; country: string } | null
	map_location?: string
	opening_hours?: OpeningHours[]
}

/** When the shop is open on one day: `day` is mon…sun, the times 24-hour HH:MM. */
export type OpeningHours = { day: string; opens: string; closes: string }

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
	/** The phone was proved with a code and signs in to this account (D118). */
	phone_verified?: boolean
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
	/** As on the product (D174), as of its last change or reindex; absent from an index built before the flag. */
	designable?: boolean
	updated_at: number
}

export type SearchResult = {
	hits: SearchDoc[] | null
	query: string
	total: number
	limit: number
	offset: number
	/** Meilisearch did not answer: search the product listing instead. */
	unavailable?: boolean
}

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

/** GET /api/postcodes/{country}/{code} (D134). */
export type Postcode = { country: string; postcode: string; city: string; state: string; state_code: string }
