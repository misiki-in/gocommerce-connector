/**
 * The translation layer, without an engine: money, the mappers, the guard on
 * Litekart paths, and the export surface the storefront imports by name.
 *
 * The fixtures are shaped from the engine's Go struct tags (see src/engine.ts),
 * not invented. Whether the engine still answers in that shape is the live
 * suite's question, not this one's.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const m = await import('../dist/index.js')

const money = (amount_minor, currency = 'USD') => ({ amount_minor, currency })

const variant = (over = {}) => ({
	id: 11,
	product_id: 7,
	sku: 'TEE-M-BLK',
	price: money(2500),
	taxable: true,
	requires_shipping: true,
	options: ['M', 'Black'],
	label: 'M / Black',
	available: 8,
	track_inventory: true,
	continue_selling: false,
	active: true,
	position: 0,
	images: [{ media_id: 1, url: 'https://cdn.example/v11.jpg', kind: 'image' }],
	image: { media_id: 1, url: 'https://cdn.example/v11.jpg', kind: 'image' },
	...over,
})

const product = (over = {}) => ({
	id: 7,
	slug: 'cotton-tee',
	title: 'Cotton tee',
	description: '<p>Plain.</p>',
	status: 'active',
	currency: 'USD',
	product_type: '',
	vendor: '',
	tags: ['cotton', 'basics'],
	category: { id: 3, slug: 'shirts', title: 'Shirts', full_name: 'Apparel / Shirts' },
	seo_title: '',
	seo_description: '',
	image_url: 'https://cdn.example/lead.jpg',
	options: [
		{ id: 1, name: 'Size', position: 0, values: [{ id: 1, value: 'M', position: 0 }] },
		{ id: 2, name: 'Colour', position: 1, values: [{ id: 2, value: 'Black', position: 0 }] },
	],
	variants: [
		variant(),
		variant({ id: 12, sku: 'TEE-L-BLK', options: ['L', 'Black'], label: 'L / Black', active: false }),
	],
	collections: [],
	metadata: {},
	created_at: '2026-09-01T00:00:00Z',
	updated_at: '2026-09-02T00:00:00Z',
	...over,
})

// ---------------------------------------------------------------- money

test('minor units become the number the storefront renders, per currency', () => {
	assert.equal(m.toMajor(money(2500)), 25)
	assert.equal(m.toMajor(money(1999)), 19.99)
	// The yen writes no decimals: dividing by 100 would price ¥2,500 at ¥25.
	assert.equal(m.toMajor(money(2500, 'JPY')), 2500)
	assert.equal(m.toMajor(money(2500, 'KWD')), 2.5)
	assert.equal(m.toMinor(19.99, 'USD'), 1999, '19.99 * 100 is 1998.999…, and must round, not truncate')
	assert.equal(m.toMinor(2500, 'JPY'), 2500)
	assert.equal(m.toMajor(null), 0)
})

// ---------------------------------------------------------------- products

test('a product crosses with string ids, major-unit prices and only live variants', () => {
	const p = m.toProduct(product())
	assert.equal(p.id, '7')
	assert.equal(p.price, 25)
	assert.equal(p.mrp, 25, 'no compare-at price is no discount, not a 100% one')
	assert.equal(p.variants.length, 1, 'an inactive variant is the merchant’s business')
	assert.equal(p.variants[0].id, '11')
	assert.deepEqual(p.variants[0].options, [
		{ optionId: '1', value: 'M' },
		{ optionId: '2', value: 'Black' },
	])
	assert.equal(typeof p.images, 'string', 'the storefront splits images on commas')
	assert.deepEqual(p.images.split(','), ['https://cdn.example/lead.jpg', 'https://cdn.example/v11.jpg'])
	assert.equal(p.productTags, 'cotton,basics')
	assert.equal(p.categoryId, '3')
	assert.deepEqual(p.categories, [{ category: { id: '3', name: 'Shirts', slug: 'shirts' } }])
	assert.equal(p.stock, 8)
	assert.equal(p.manageInventory, true)
})

test('an engine upload is loaded from the engine, never the storefront’s own origin', () => {
	const uploaded = () =>
		m.toProduct(
			product({
				image_url: '/media/lead.png',
				variants: [variant({ image: null, images: [{ media_id: 2, url: '/media/v11.png', kind: 'image' }] })],
			}),
		)
	try {
		m.BaseService.setCredentials({ apiUrl: 'https://engine.example/', proxyPath: '/backend' })
		assert.deepEqual(uploaded().images.split(','), ['/backend/media/lead.png', '/backend/media/v11.png'])
		assert.equal(uploaded().variants[0].thumbnail, '/backend/media/v11.png')

		m.BaseService.setCredentials({ proxyPath: '' })
		assert.equal(uploaded().thumbnail, 'https://engine.example/media/lead.png')

		assert.equal(m.toProduct(product()).thumbnail, 'https://cdn.example/lead.jpg', 'a linked picture stays put')
		assert.equal(m.mediaUrl('//cdn.example/x.png'), '//cdn.example/x.png')
	} finally {
		m.BaseService.setCredentials({ apiUrl: '', proxyPath: '' })
	}
})

test('a compare-at price is the struck-through mrp', () => {
	const p = m.toProduct(product({ variants: [variant({ compare_at_price: money(3000) })] }))
	assert.equal(p.price, 25)
	assert.equal(p.mrp, 30)
})

test('an optionless product’s one variant is titled "default"', () => {
	const p = m.toProduct(product({ options: [], variants: [variant({ options: [], label: '' })] }))
	assert.equal(p.variants[0].title, 'default')
})

test('nulls from the engine become arrays, so a card can read variants[0]', () => {
	const p = m.toProduct(product({ variants: null, options: null, tags: null, collections: null }))
	assert.deepEqual(p.variants, [])
	assert.deepEqual(p.options, [])
	assert.equal(p.productTags, '')
	assert.equal(p.price, 0)
})

test('an untracked variant is never "managed", so it is never out of stock', () => {
	const v = m.toProduct(product({ variants: [variant({ track_inventory: false, available: 0 })] })).variants[0]
	assert.equal(v.manageInventory, false)
})

// ---------------------------------------------------------------- cart

const cart = (over = {}) => ({
	id: 'a'.repeat(64),
	status: 'open',
	currency: 'USD',
	email: 'shopper@example.com',
	line_items: [
		{
			id: 5,
			variant_id: 11,
			product_id: 7,
			sku: 'TEE-M-BLK',
			title: 'Cotton tee',
			variant_label: 'M / Black',
			quantity: 2,
			unit_price: money(2500),
			total: money(5000),
			current_price: money(2500),
			available: 8,
			in_stock: true,
			price_changed: false,
		},
	],
	item_count: 2,
	subtotal: money(5000),
	created_at: '2026-10-01T00:00:00Z',
	updated_at: '2026-10-01T00:00:00Z',
	expires_at: '2026-10-31T00:00:00Z',
	...over,
})

test('a cart carries its lines with string ids, selected for checkout', () => {
	const c = m.toCart(cart())
	assert.equal(c.id, 'a'.repeat(64))
	assert.equal(c.qty, 2)
	assert.equal(c.subtotal, 50)
	assert.equal(c.total, 50)
	assert.equal(c.lineItems[0].id, '5')
	assert.equal(c.lineItems[0].variantId, '11')
	assert.equal(c.lineItems[0].isSelectedForCheckout, true)
	assert.equal('message' in c, false, 'the storefront discards a cart that has a message key')
})

test('a cart’s totals take the kept coupon and delivery choice', () => {
	const c = m.toCart(cart(), {
		discount: { discount_id: 1, code: 'TENOFF', title: '10 off', kind: 'fixed', amount_minor: 1000 },
		shippingRate: { id: '4', name: 'Standard', minor: 500, currency: 'USD' },
		shippingRateId: '4',
	})
	assert.equal(c.couponCode, 'TENOFF')
	assert.equal(c.discountAmount, 10)
	assert.equal(c.shippingCharges, 5)
	assert.equal(c.total, 45)
})

test('free shipping zeroes the delivery charge rather than discounting the goods', () => {
	const c = m.toCart(cart(), {
		discount: {
			discount_id: 1,
			code: 'SHIPFREE',
			title: 'Free shipping',
			kind: 'free_shipping',
			amount_minor: 0,
			free_shipping: true,
		},
		shippingRate: { id: '4', name: 'Standard', minor: 500, currency: 'USD' },
	})
	assert.equal(c.shippingCharges, 0)
	assert.equal(c.total, 50)
})

test('a checked-out cart answers no lines, which is how the bag learns to empty', () => {
	const c = m.toCart(cart({ status: 'converted' }))
	assert.deepEqual(c.lineItems, [])
	assert.equal(c.total, 0)
})

// ---------------------------------------------------------------- addresses and orders

test('a checkout address carries only the fields the engine declares', () => {
	const a = m.toEngineAddress({
		id: 'new',
		firstName: 'Ada',
		lastName: 'Lovelace',
		email: 'ada@example.com',
		phone: '0123',
		address_1: '1 Analytical Way',
		address_2: '',
		city: 'London',
		state: '',
		zip: 'N1 1AA',
		countryCode: 'gb',
	})
	assert.deepEqual(a, {
		name: 'Ada Lovelace',
		phone: '0123',
		line1: '1 Analytical Way',
		city: 'London',
		postal_code: 'N1 1AA',
		country: 'GB',
	})
})

test('an order is its own parent, with lines as an array', () => {
	const o = m.toOrder({
		id: 123,
		number: 'GC-000123',
		status: 'confirmed',
		payment_status: 'pending',
		payment_provider: 'cod',
		currency: 'INR',
		subtotal: money(50000, 'INR'),
		shipping: money(0, 'INR'),
		discount: money(0, 'INR'),
		tax: money(9000, 'INR'),
		tax_inclusive: true,
		total: money(50000, 'INR'),
		refunded: money(0, 'INR'),
		email: 'a@example.com',
		address: { name: 'Ada Lovelace', line1: '1 Way', city: 'Pune', postal_code: '411001', country: 'IN' },
		line_items: null,
		fulfillments: null,
		created_at: '2026-10-01T00:00:00Z',
		updated_at: '2026-10-01T00:00:00Z',
	})
	assert.equal(o.orderNo, 'GC-000123')
	assert.equal(o.parentOrderNo, 'GC-000123')
	assert.equal(o.paymentMethod, 'COD')
	assert.equal(o.total, 500)
	assert.deepEqual(o.lineItems, [])
	assert.equal(o.shippingAddress.firstName, 'Ada')
})

// ---------------------------------------------------------- google reviews

const googlePlace = {
	rating: 4.6,
	user_rating_count: 182,
	google_maps_uri: 'https://maps.google.com/?cid=1',
	reviews: [
		{
			author: {
				name: 'Asha R',
				uri: 'https://www.google.com/maps/contrib/1',
				photo_uri: 'https://lh3.googleusercontent.com/a/1',
			},
			rating: 5,
			text: 'Lovely staff.',
			language: 'en',
			relative_time: 'a month ago',
			publish_time: '2026-09-28T10:00:00Z',
			visit_date: '2026-09',
			google_maps_uri: 'https://www.google.com/maps/reviews/1',
			flag_uri: 'https://www.google.com/local/review/rap/report?postId=1',
		},
		{ author: { name: 'Vikram' }, rating: 1 },
	],
}

/** An engine with ext/google-reviews: `plugins` is GET /api/plugins, `answers` the module's routes. */
function googleEngine(plugins, answers, seen) {
	return async (url) => {
		const u = new URL(String(url))
		seen?.push(u.pathname + u.search)
		if (u.pathname === '/api/plugins') return Response.json({ data: plugins })
		const answer = answers[u.pathname]
		if (typeof answer === 'number') return Response.json({ error: { code: 'x', message: 'no' } }, { status: answer })
		if (answer) return Response.json({ data: answer })
		return Response.json({ error: { code: 'not_found', message: 'no route' } }, { status: 404 })
	}
}

test("Google's rating and reviews are Google's answer, asked for every time, and nothing while off", async () => {
	m.clearStoreCache()
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test', proxyPath: undefined, baseDomain: undefined })
	const seen = []
	const on = [{ key: 'google-reviews', title: 'Google reviews', settings: { show_place: true } }]
	const svc = new m.GoogleReviewService(googleEngine(on, { '/x/google-reviews/place': googlePlace }, seen))
	const got = await svc.place()
	assert.equal(got.rating, 4.6)
	assert.equal(got.count, 182)
	assert.equal(got.mapsUrl, 'https://maps.google.com/?cid=1')
	assert.deepEqual(got.reviews[0], {
		author: 'Asha R',
		authorUrl: 'https://www.google.com/maps/contrib/1',
		authorPhoto: 'https://lh3.googleusercontent.com/a/1',
		rating: 5,
		text: 'Lovely staff.',
		language: 'en',
		when: 'a month ago',
		visited: '2026-09',
		url: 'https://www.google.com/maps/reviews/1',
		reportUrl: 'https://www.google.com/local/review/rap/report?postId=1',
	})
	// The one-star review is there too, as Google sent it.
	assert.equal(got.reviews[1].rating, 1)
	assert.equal(got.reviews[1].text, '')
	// Google's terms forbid keeping the answer, so a second read asks again.
	await svc.place()
	assert.equal(seen.filter((p) => p === '/x/google-reviews/place').length, 2)

	// The day's lookups spent, or Google refusing: nothing, not an error.
	for (const status of [429, 502]) {
		m.clearStoreCache()
		const quiet = new m.GoogleReviewService(googleEngine(on, { '/x/google-reviews/place': status }))
		assert.equal(await quiet.place(), null)
	}
	// Anything else is still a failure the caller sees.
	m.clearStoreCache()
	const broken = new m.GoogleReviewService(googleEngine(on, { '/x/google-reviews/place': 500 }))
	await assert.rejects(broken.place(), (err) => err instanceof m.GoCommerceError && err.status === 500)

	// A place with no ratings yet shows nothing rather than "0 reviews".
	m.clearStoreCache()
	const unrated = new m.GoogleReviewService(
		googleEngine(on, { '/x/google-reviews/place': { ...googlePlace, rating: 0, user_rating_count: 0, reviews: [] } }),
	)
	assert.equal(await unrated.place(), null)

	// The switch off, or the plugin off: Google is not asked at all.
	for (const plugins of [[{ key: 'google-reviews', title: 'Google reviews', settings: { show_place: false } }], []]) {
		m.clearStoreCache()
		const asked = []
		const off = new m.GoogleReviewService(googleEngine(plugins, { '/x/google-reviews/place': googlePlace }, asked))
		assert.equal(await off.place(), null)
		assert.ok(!asked.includes('/x/google-reviews/place'), `asked Google with ${JSON.stringify(plugins)}`)
	}
})

test("the survey is asked for with the order's own key, and only for an order placed in this browser", async () => {
	const kept = { gocommerce_orders: JSON.stringify([{ number: 'GC-000049', token: 'tok_49', cartId: 'c1' }]) }
	globalThis.window = {
		location: { origin: 'http://storefront.test', hostname: 'storefront.test' },
		localStorage: { getItem: (k) => kept[k] ?? null, setItem() {}, removeItem() {} },
	}
	globalThis.document = { cookie: '' }
	const survey = {
		merchant_id: 1234567,
		order_id: 'GC-000049',
		email: 'a@example.com',
		delivery_country: 'IN',
		estimated_delivery_date: '2026-11-04',
		opt_in_style: 'BOTTOM_TRAY',
	}
	try {
		m.clearStoreCache()
		m.BaseService.setCredentials({ apiUrl: 'http://engine.test', proxyPath: undefined, baseDomain: undefined })
		const on = [{ key: 'google-reviews', title: 'Google reviews', settings: { customer_reviews: true } }]
		const seen = []
		const svc = new m.GoogleReviewService(googleEngine(on, { '/x/google-reviews/survey/GC-000049': survey }, seen))
		assert.deepEqual(await svc.survey('GC-000049'), survey)
		assert.deepEqual(
			seen.filter((p) => p.startsWith('/x/')),
			['/x/google-reviews/survey/GC-000049?token=tok_49'],
		)

		// Another browser's order, or none: there is no key, so nothing is asked.
		assert.equal(await svc.survey('GC-000050'), null)
		assert.equal(await svc.survey(''), null)
		assert.equal(seen.filter((p) => p.startsWith('/x/')).length, 1)

		// The survey switched off: nothing.
		m.clearStoreCache()
		const off = new m.GoogleReviewService(
			googleEngine([{ key: 'google-reviews', title: 'Google reviews', settings: { customer_reviews: false } }], {
				'/x/google-reviews/survey/GC-000049': survey,
			}),
		)
		assert.equal(await off.survey('GC-000049'), null)
	} finally {
		delete globalThis.window
		delete globalThis.document
	}
})

test("the store record turns on Google's survey and store widget from the engine alone", async () => {
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test/', proxyPath: undefined, baseDomain: undefined })
	m.setStaticStore(() => ({ id: 'from_config', name: 'Shop', plugins: { googleReviewsOptIn: { active: true } } }))
	let settings = { customer_reviews: true, store_widget: 'Bottom left', show_place: true }
	const svc = new m.StoreService(async (url) => {
		const path = new URL(String(url)).pathname
		if (path === '/api/checkout') return Response.json({ data: { currency: 'INR', methods: [] } })
		if (path === '/api/plugins')
			return Response.json({ data: settings ? [{ key: 'google-reviews', title: 'Google reviews', settings }] : [] })
		return Response.json({ data: [] })
	})
	m.clearStoreCache()
	let store = await svc.getStoreByIdOrDomain()
	assert.equal(store.plugins.googleReviewsOptIn.active, true)
	assert.deepEqual(store.plugins.googleStoreWidget, { active: true, position: 'LEFT_BOTTOM' })

	// The widget belongs to the survey's programme: without the survey, no widget.
	m.clearStoreCache()
	settings = { customer_reviews: false, store_widget: 'Bottom right' }
	store = await svc.getStoreByIdOrDomain()
	assert.equal(store.plugins.googleReviewsOptIn.active, false)
	assert.deepEqual(store.plugins.googleStoreWidget, { active: false })

	// The plugin off: both off, whatever the static record says.
	m.clearStoreCache()
	settings = null
	store = await svc.getStoreByIdOrDomain()
	assert.equal(store.plugins.googleReviewsOptIn.active, false)
	assert.equal(store.plugins.googleStoreWidget.active, false)
})

// ---------------------------------------------------------------- the surface

test('every service the storefront imports by name is exported', () => {
	for (const name of [
		'BaseService',
		'productService',
		'ProductService',
		'cartService',
		'checkoutService',
		'orderService',
		'userService',
		'authService',
		'profileService',
		'addressService',
		'wishlistService',
		'reviewService',
		'googleReviewService',
		'GoogleReviewService',
		'storeService',
		'menuService',
		'pageService',
		'layoutService',
		'LayoutService',
		'faqService',
		'FaqService',
		'searchService',
		'SearchService',
		'meilisearchService',
		'categoryService',
		'collectionService',
		'paymentMethodService',
		'couponService',
		'vendorService',
		'blogService',
		'bannerService',
		'reelsService',
		'chatService',
		'contactService',
		'enquiryService',
		'countryService',
		'currencyService',
		'stateService',
		'regionService',
		'initService',
		'homeService',
		'pluginsService',
		'PluginsService',
		'settingsService',
		'SettingsService',
		'pluginService',
		'settingService',
		'popularSearchService',
		'popularityService',
		'dealService',
		'galleryService',
		'feedbackService',
		'uploadService',
		'warrantyService',
		'varniCustomDesignService',
		'varniCustomProductService',
		'autocompleteService',
		'whatsappService',
		'WhatsappService',
	]) {
		assert.ok(m[name] !== undefined, `${name} is exported`)
	}
	assert.equal(m.connectorName, 'gocommerce')
	assert.equal(typeof m.BaseService.setCredentials, 'function')
	assert.equal(typeof m.setStaticStore, 'function')
	assert.equal(typeof m.serveRestLocally, 'function')
	assert.equal(typeof m.searchService.emptyResult().data.length, 'number', 'emptyResult is synchronous')
})

test('checkout offers the WhatsApp boxes the store has, and none when the engine cannot say', async () => {
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test', proxyPath: undefined, baseDomain: undefined })
	const answering = (status, body) => new m.WhatsappService(async () => Response.json(body, { status }))
	assert.deepEqual(await answering(200, { data: { enabled: true, marketing: true } }).consentOffer(), {
		enabled: true,
		marketing: true,
	})
	assert.deepEqual(await answering(200, { data: { enabled: true, marketing: false } }).consentOffer(), {
		enabled: true,
		marketing: false,
	})
	// Marketing alone is not an offer: there is no order-update box to sit under.
	assert.deepEqual(await answering(200, { data: { enabled: false, marketing: true } }).consentOffer(), {
		enabled: false,
		marketing: false,
	})
	for (const [status, body] of [
		[404, { error: { code: 'not_found', message: 'no route for GET /x/notify-whatsapp/consent' } }],
		[500, { error: { code: 'internal', message: 'boom' } }],
	]) {
		assert.deepEqual(await answering(status, body).consentOffer(), { enabled: false, marketing: false })
	}
	const down = new m.WhatsappService(async () => {
		throw new TypeError('fetch failed')
	})
	assert.deepEqual(await down.consentOffer(), { enabled: false, marketing: false })
})

test('a WhatsApp answer is sent for the bag with both boxes, unticked as false', async () => {
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test', proxyPath: undefined, baseDomain: undefined })
	globalThis.window = {
		location: { origin: 'http://storefront.test', hostname: 'storefront.test' },
		localStorage: { getItem: (k) => (k === 'cart_id' ? 'cart_tok' : null), setItem() {}, removeItem() {} },
	}
	globalThis.document = { cookie: '' }
	const sent = []
	const svc = new m.WhatsappService(async (url, init) => {
		sent.push({ url: String(url), method: init?.method, body: JSON.parse(init.body) })
		const b = JSON.parse(init.body)
		if (b.phone === '12') {
			return Response.json(
				{ error: { code: 'validation_failed', message: 'not a WhatsApp number' } },
				{ status: 400 },
			)
		}
		return Response.json({ data: { phone: '+919876543210', order_updates: b.order_updates, marketing: b.marketing } })
	})
	try {
		assert.deepEqual(
			await svc.setConsent({ cartId: 'cart_abc', phone: ' 98765 43210 ', orderUpdates: true, marketing: false }),
			{ phone: '+919876543210', orderUpdates: true, marketing: false },
		)
		await svc.setConsent({ phone: '9876543210', orderUpdates: false, marketing: false })
		assert.deepEqual(sent, [
			{
				url: 'http://engine.test/x/notify-whatsapp/consent',
				method: 'PUT',
				body: { cart_id: 'cart_abc', phone: '98765 43210', order_updates: true, marketing: false },
			},
			{
				url: 'http://engine.test/x/notify-whatsapp/consent',
				method: 'PUT',
				body: { cart_id: 'cart_tok', phone: '9876543210', order_updates: false, marketing: false },
			},
		])
		await assert.rejects(
			svc.setConsent({ phone: '12', orderUpdates: true, marketing: false }),
			(err) => err instanceof m.GoCommerceError && err.status === 400 && /WhatsApp number/.test(err.message),
		)
	} finally {
		delete globalThis.window
		delete globalThis.document
	}
})

test('credentials merge, so an unset variable does not erase a set one', () => {
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test' })
	m.BaseService.setCredentials({ channel: 'web' })
	assert.equal(m.BaseService.getCredentials().apiUrl, 'http://engine.test')
	assert.equal(m.BaseService.getCredentials().channel, 'web')
})

// ---------------------------------------------------------------- Litekart paths

test('a Litekart path is answered locally or refused, never sent', async () => {
	let called = false
	const svc = new m.BlogService(async () => {
		called = true
		return new Response('{}')
	})
	m.serveRestLocally((url) => (url.startsWith('/api/menu') ? { data: ['local'] } : undefined))
	assert.deepEqual(await svc.get('/api/menu'), { data: ['local'] })
	assert.deepEqual((await svc.get('/api/blogs/list')).data, [], 'a collection is empty')
	await assert.rejects(svc.get('/api/blogs/42'), /not available/, 'one record is a dead link')
	await assert.rejects(svc.post('/api/feedback', {}), /not available/, 'a write never pretends')
	assert.equal(called, false)
})

test('the category filter’s raw path is served from the engine’s tree', async () => {
	m.clearStoreCache()
	const seen = []
	const svc = new m.CategoryService(async (url) => {
		seen.push(String(url))
		return Response.json({
			data: [
				{
					id: 1,
					parent_id: null,
					slug: 'apparel',
					title: 'Apparel',
					position: 0,
					full_name: 'Apparel',
					depth: 0,
					child_count: 1,
				},
				{
					id: 3,
					parent_id: 1,
					slug: 'shirts',
					title: 'Shirts',
					position: 0,
					full_name: 'Apparel / Shirts',
					depth: 1,
					child_count: 0,
				},
			],
		})
	})
	const res = await svc.get('/api/categories/all')
	assert.deepEqual(
		res.data.map((c) => [c.slug, c.parentCategoryId]),
		[
			['apparel', null],
			['shirts', '1'],
		],
	)
	assert.match(
		seen[0],
		/^http:\/\/engine\.test\/api\/categories\?flat=1$/,
		'absolute, so the storefront’s guard lets it through',
	)
})

test('an engine error arrives as an Error carrying the engine’s message and status', async () => {
	const svc = new m.PageService(async () =>
		Response.json({ error: { code: 'not_found', message: 'no page at "nope"' } }, { status: 404 }),
	)
	await assert.rejects(
		svc.getOne('nope'),
		(err) => err instanceof m.GoCommerceError && err.status === 404 && /no page/.test(err.message),
	)
})

test('the store record never fails, even with no engine to ask', async () => {
	m.clearStoreCache()
	m.setStaticStore(() => ({ id: 'from_config', name: 'Shop', currency: { code: 'USD', symbol: '$' } }))
	const svc = new m.StoreService(async () => {
		throw new TypeError('fetch failed')
	})
	const store = await svc.getStoreByIdOrDomain({ domain: 'shop.example' })
	assert.equal(store.id, 'from_config')
	assert.equal(store.name, 'Shop')
})

// ---------------------------------------------------------------- 0.3.0: the rest of the engine

test('category attribute answers become the specs table', () => {
	const p = m.toProduct(
		product({ metadata: { category: { color: ['Black', 'White'], 'neck-style': 'Crew', empty: [] } } }),
	)
	assert.deepEqual(p.attributes, [
		{ name: 'Color', value: 'Black, White', handle: 'color' },
		{ name: 'Neck style', value: 'Crew', handle: 'neck-style' },
	])
})

test('a hosted-page gateway rides the storefront’s redirect flow under its own name, never a PayPal mark', async () => {
	m.clearStoreCache()
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test' })
	const svc = new m.PaymentMethodService(async () =>
		Response.json({
			data: {
				payment_methods: ['cod', 'stripe', 'paddle', 'adyen'],
				methods: [
					{ code: 'cod', name: 'Cash on delivery' },
					{ code: 'stripe', name: 'Card (Stripe)' },
					{ code: 'paddle', name: 'Paddle' },
					{ code: 'adyen', name: 'Adyen' },
				],
				currency: 'USD',
			},
		}),
	)
	const { data } = await svc.list({})
	assert.deepEqual(
		data.map((x) => [x.code, x.engineCode, x.name]),
		[
			['COD', 'cod', 'Cash on delivery'],
			['PAYPAL', 'paddle', 'Paddle'],
		],
		'Stripe has no flow here; only the first hosted-page gateway can be told apart',
	)
	assert.equal(data[1].img, '/payment/card.svg')
})

test('a configured language is asked for on reads, never on writes', async () => {
	const seen = []
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test', language: 'fr' })
	const svc = new m.PageService(async (url, init) => {
		seen.push(`${init?.method ?? 'GET'} ${url}`)
		return Response.json({
			data: {
				id: 1,
				slug: 'a',
				title: 'A',
				body: '',
				status: 'published',
				language: 'fr',
				created_at: '',
				updated_at: '',
			},
		})
	})
	await svc.getOne('a')
	const news = new m.NewsletterService(async (url, init) => {
		seen.push(`${init?.method ?? 'GET'} ${url}`)
		return Response.json({ data: { status: 'subscribed' } })
	})
	await news.subscribe({ email: 'a@example.com' })
	m.BaseService.setCredentials({ language: undefined })
	assert.deepEqual(seen, [
		'GET http://engine.test/x/cms/pages/a?lang=fr',
		'POST http://engine.test/x/newsletter/subscribe',
	])
})

test('a company’s record reaches the storefront without the store’s own notes', async () => {
	globalThis.window = {
		location: { origin: 'http://storefront.test' },
		localStorage: { getItem: () => 'tok', setItem() {}, removeItem() {} },
	}
	globalThis.document = { cookie: '' }
	try {
		const svc = new m.B2bService(async (_url, init) => {
			assert.equal(init.headers.Authorization, 'Bearer tok', 'a b2b call carries the shopper’s session')
			return Response.json({
				data: {
					company: { id: 1, name: 'Acme', notes: 'slow payer', metadata: { internal: true } },
					role: 'buyer',
					credit: { limit: null },
				},
			})
		})
		const me = await svc.me()
		assert.equal(me.company.name, 'Acme')
		assert.equal('notes' in me.company, false)
		assert.equal('metadata' in me.company, false)
	} finally {
		delete globalThis.window
		delete globalThis.document
	}
})

// ---------------------------------------------------------------- 0.4.0: one storefront, every store

test('a host under the base domain names its store; anything else names none', () => {
	assert.equal(m.storeForHost('acme.shopnx.in', 'shopnx.in'), 'acme')
	assert.equal(m.storeForHost('ACME.ShopNX.in.', 'shopnx.in'), 'acme', 'case and a trailing dot do not matter')
	assert.equal(m.storeForHost('acme.shopnx.in:3000', 'shopnx.in'), 'acme', 'nor does a port')
	assert.equal(m.storeForHost('shopnx.in', 'shopnx.in'), undefined, 'the base domain itself is no store')
	assert.equal(m.storeForHost('a.b.shopnx.in', 'shopnx.in'), undefined, 'one label only, as the engine rules')
	assert.equal(m.storeForHost('localhost', 'shopnx.in'), undefined)
	assert.equal(m.storeForHost('acme.shopnx.in', undefined), undefined, 'no base domain, no mapping')
	assert.equal(m.storeForHost('evilshopnx.in', 'shopnx.in'), undefined, 'a suffix match needs the dot')
})

test('X-Store follows the request host, not a process-wide value', async () => {
	m.clearStoreCache()
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test', baseDomain: 'shopnx.in', store: 'fallback' })
	let host
	m.setRequestHost(() => host)
	const seen = []
	const svc = new m.PageService(async (url, init) => {
		seen.push(init.headers['X-Store'])
		return Response.json({
			data: { id: 1, slug: 'a', title: 'A', body: '', status: 'published', language: 'en', created_at: '', updated_at: '' },
		})
	})
	try {
		host = 'acme.shopnx.in'
		await svc.getOne('a')
		host = 'zed.shopnx.in'
		await svc.getOne('a')
		host = 'localhost'
		await svc.getOne('a')
		assert.deepEqual(seen, ['acme', 'zed', 'fallback'])
	} finally {
		m.setRequestHost(() => undefined)
		m.BaseService.setCredentials({ baseDomain: undefined, store: undefined })
	}
})

test('an unknown store under the base domain is a 404 the storefront can show', async () => {
	m.clearStoreCache()
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test', baseDomain: 'shopnx.in' })
	m.setRequestHost(() => 'zz123.shopnx.in')
	m.setStaticStore(() => ({ id: 'from_config', name: 'Shop', currency: { code: 'USD', symbol: '$' } }))
	const svc = new m.StoreService(async () =>
		Response.json({ error: { code: 'not_found', message: 'store not found' } }, { status: 404 }),
	)
	try {
		await assert.rejects(
			svc.getStoreByIdOrDomain({ domain: 'zz123.shopnx.in' }),
			(err) => err instanceof m.GoCommerceError && err.status === 404 && /store not found/i.test(err.message),
		)
	} finally {
		m.setRequestHost(() => undefined)
		m.BaseService.setCredentials({ baseDomain: undefined })
	}
})

test('a store the engine knows still renders, keyed apart from its neighbours', async () => {
	m.clearStoreCache()
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test', baseDomain: 'shopnx.in' })
	m.setRequestHost(() => 'acme.shopnx.in')
	m.setStaticStore(() => ({ id: 'from_config', name: 'Shop', currency: { code: 'USD', symbol: '$' } }))
	const stores = []
	const svc = new m.StoreService(async (url, init) => {
		stores.push(init.headers['X-Store'])
		if (String(url).endsWith('/api/checkout')) return Response.json({ data: { currency: 'INR', methods: [] } })
		return Response.json({ data: [] })
	})
	try {
		const store = await svc.getStoreByIdOrDomain({ domain: 'acme.shopnx.in' })
		assert.equal(store.id, 'from_config')
		assert.equal(store.currencyCode, 'INR')
		assert.ok(stores.length > 0 && stores.every((s) => s === 'acme'), `every call named acme: ${stores}`)
	} finally {
		m.setRequestHost(() => undefined)
		m.BaseService.setCredentials({ baseDomain: undefined })
	}
})

test('each store under the base domain renders its own name, not the static record’s', async () => {
	m.clearStoreCache()
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test', baseDomain: 'shopnx.in' })
	m.setStaticStore(() => ({ id: 'from_config', name: 'Test', businessEmail: null }))
	const names = { chillish: 'Chillish', bee: '' }
	const svc = new m.StoreService(async (url, init) => {
		const store = init.headers['X-Store']
		if (String(url).endsWith('/api/checkout')) return Response.json({ data: { currency: 'INR', methods: [] } })
		if (new URL(String(url)).pathname === '/api/store')
			return Response.json({ data: { name: names[store], email: names[store] ? 'hi@chillish.example' : '', phone: '' } })
		return Response.json({ data: [] })
	})
	try {
		m.setRequestHost(() => 'chillish.shopnx.in')
		const chillish = await svc.getStoreByIdOrDomain()
		assert.equal(chillish.name, 'Chillish')
		assert.equal(chillish.businessEmail, 'hi@chillish.example')
		m.setRequestHost(() => 'bee.shopnx.in')
		const bee = await svc.getStoreByIdOrDomain()
		assert.equal(bee.name, 'Test', 'a store with no name of its own keeps the static one')
		assert.equal(bee.businessEmail, null)
	} finally {
		m.setRequestHost(() => undefined)
		m.BaseService.setCredentials({ baseDomain: undefined })
	}
})

test('each store is priced in its own currency, not the install’s', async () => {
	m.clearStoreCache()
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test', baseDomain: 'shopnx.in' })
	m.setStaticStore(() => ({ id: 'from_config', name: 'Test', currency: { code: 'USD', symbol: '$' } }))
	const currencies = { chillish: 'INR', bee: 'EUR' }
	const svc = new m.StoreService(async (url, init) => {
		const store = init.headers['X-Store']
		const path = new URL(String(url)).pathname
		// The install's own answer, whichever store asks.
		if (path === '/health/ready') return Response.json({ data: { currency: 'USD', language: 'en', version: 'x' } })
		if (path === '/api/checkout') return Response.json({ data: { currency: currencies[store], methods: [] } })
		if (path === '/api/store') return Response.json({ data: { name: '', email: '', phone: '', language: store === 'bee' ? 'de' : 'en' } })
		return Response.json({ data: [] })
	})
	try {
		m.setRequestHost(() => 'chillish.shopnx.in')
		const chillish = await svc.getStoreByIdOrDomain()
		assert.equal(chillish.currencyCode, 'INR')
		assert.equal(chillish.currency.symbol, '₹')
		m.setRequestHost(() => 'bee.shopnx.in')
		const bee = await svc.getStoreByIdOrDomain()
		assert.equal(bee.currencyCode, 'EUR')
		assert.equal(bee.language, 'de')
	} finally {
		m.setRequestHost(() => undefined)
		m.BaseService.setCredentials({ baseDomain: undefined })
	}
})

test("a store's own domain names it, after the subdomain and the static store", async () => {
	m.clearStoreCache()
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test', baseDomain: 'shopnx.in' })
	let host
	m.setRequestHost(() => host)
	const seen = []
	const svc = new m.PageService(async (url, init) => {
		seen.push(init.headers['X-Store'])
		return Response.json({
			data: { id: 1, slug: 'a', title: 'A', body: '', status: 'published', language: 'en', created_at: '', updated_at: '' },
		})
	})
	try {
		for (host of ['Chillish.in.', 'www.chillish.in:443', 'acme.shopnx.in', 'shopnx.in', 'localhost', '127.0.0.1', '[::1]']) {
			await svc.getOne('a')
		}
		assert.deepEqual(seen, ['chillish.in', 'www.chillish.in', 'acme', undefined, undefined, undefined, undefined])

		// A storefront pinned to one store keeps it on any address.
		m.BaseService.setCredentials({ store: 'pinned' })
		seen.length = 0
		host = 'chillish.in'
		await svc.getOne('a')
		assert.deepEqual(seen, ['pinned'])
	} finally {
		m.setRequestHost(() => undefined)
		m.BaseService.setCredentials({ baseDomain: undefined, store: undefined })
	}
})

test('a guest opens an order with a code, and the browser keeps it', async () => {
	const store = {}
	globalThis.window = {
		location: { origin: 'http://storefront.test', hostname: 'storefront.test' },
		localStorage: {
			getItem: (k) => store[k] ?? null,
			setItem: (k, v) => {
				store[k] = v
			},
			removeItem: (k) => {
				delete store[k]
			},
		},
	}
	globalThis.document = { cookie: '' }
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test' })
	const seen = []
	const order = {
		id: 7, number: 'GC-000049', status: 'confirmed', payment_status: 'pending', payment_provider: 'cod', currency: 'INR',
		subtotal: { amount_minor: 1000, currency: 'INR' }, total: { amount_minor: 1000, currency: 'INR' },
		email: 'a@example.com', lines: [], fulfillments: [], address: {}, created_at: '', updated_at: '',
	}
	try {
		const svc = new m.OrderService(async (url, init) => {
			seen.push(`${init.method ?? 'GET'} ${url} ${init.body ?? ''}`)
			if (url.endsWith('/code')) return Response.json({ data: { expires_in_minutes: 10 } }, { status: 202 })
			if (url.endsWith('/code/verify')) return Response.json({ data: { order, access_token: 'tok_49' } })
			return Response.json({ data: order })
		})
		const sent = await svc.requestOrderCode({ orderNo: ' GC-000049 ', contact: 'a@example.com' })
		assert.equal(sent.expiresInMinutes, 10)
		const res = await svc.getOrderByEmailAndOTP({ orderNo: 'GC-000049', otp: '0420' })
		assert.equal(res.data[0].orderNo, 'GC-000049')
		// Kept like an order placed here, so the order page reads it again.
		await svc.getOrder('GC-000049')
		assert.deepEqual(seen, [
			'POST http://engine.test/api/orders/GC-000049/code {"contact":"a@example.com"}',
			'POST http://engine.test/api/orders/GC-000049/code/verify {"code":"0420"}',
			'GET http://engine.test/api/orders/GC-000049?token=tok_49 ',
		])
	} finally {
		delete globalThis.window
		delete globalThis.document
		m.BaseService.setCredentials({ apiUrl: undefined })
	}
})

test('a guest opens an order with its number and email, or the key in their email link', async () => {
	const store = {}
	globalThis.window = {
		location: { origin: 'http://storefront.test', hostname: 'storefront.test' },
		localStorage: {
			getItem: (k) => store[k] ?? null,
			setItem: (k, v) => {
				store[k] = v
			},
			removeItem: (k) => {
				delete store[k]
			},
		},
	}
	globalThis.document = { cookie: '' }
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test' })
	const seen = []
	const order = (number) => ({
		id: 7, number, status: 'confirmed', payment_status: 'pending', payment_provider: 'cod', currency: 'INR',
		subtotal: { amount_minor: 1000, currency: 'INR' }, total: { amount_minor: 1000, currency: 'INR' },
		email: 'a@example.com', lines: [], fulfillments: [], address: {}, created_at: '', updated_at: '',
	})
	try {
		const svc = new m.OrderService(async (url, init) => {
			seen.push(`${init.method ?? 'GET'} ${url} ${init.body ?? ''}`)
			if (url.endsWith('/open')) return Response.json({ data: { order: order('GC-000050'), access_token: 'tok_50' } })
			return Response.json({ data: order(url.includes('GC-000004') ? 'GC-000004' : 'GC-000050') })
		})
		const opened = await svc.openOrder({ orderNo: ' GC-000050 ', contact: ' a@example.com ' })
		assert.equal(opened.data[0].orderNo, 'GC-000050')
		await svc.getOrder('GC-000050')
		const linked = await svc.openOrderWithKey({ orderNo: 'GC-000004', key: 'key_4' })
		assert.equal(linked.data[0].orderNo, 'GC-000004')
		// Kept like an order placed here, so the order page reads it again.
		await svc.getOrder('GC-000004')
		assert.deepEqual(seen, [
			'POST http://engine.test/api/orders/GC-000050/open {"contact":"a@example.com"}',
			'GET http://engine.test/api/orders/GC-000050?token=tok_50 ',
			'GET http://engine.test/api/orders/GC-000004?token=key_4 ',
			'GET http://engine.test/api/orders/GC-000004?token=key_4 ',
		])
	} finally {
		delete globalThis.window
		delete globalThis.document
		m.BaseService.setCredentials({ apiUrl: undefined })
	}
})

test('a shopper signs in with a code texted to their phone', async () => {
	const store = {}
	globalThis.window = {
		location: { origin: 'http://storefront.test', hostname: 'storefront.test' },
		localStorage: {
			getItem: (k) => store[k] ?? null,
			setItem: (k, v) => {
				store[k] = v
			},
			removeItem: (k) => {
				delete store[k]
			},
		},
	}
	globalThis.document = { cookie: '' }
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test' })
	m.clearStoreCache()
	const seen = []
	try {
		const svc = new m.AuthService(async (url, init) => {
			seen.push(`${init.method ?? 'GET'} ${url} ${init.body ?? ''}`)
			if (url.endsWith('/api/plugins')) {
				return Response.json({ data: [{ key: 'identity', title: 'Customer sign-in', settings: { login_method: 'phone_otp' } }] })
			}
			if (url.endsWith('/x/identity/otp')) return Response.json({ data: { expires_in_minutes: 10 } }, { status: 202 })
			return Response.json({
				data: {
					token: 'sess_1',
					expires_at: new Date(Date.now() + 86400000).toISOString(),
					record: { id: 9, email: '', email_verified: false, name: '', phone: '+919876543210', created_at: '', updated_at: '' },
				},
			})
		})
		assert.equal(await svc.loginMethod(), 'phone_otp')
		await svc.getOtp({ phone: '+91 98765 43210' })
		const me = await svc.verifyOtp({ phone: '+91 98765 43210', otp: '0420' })
		assert.equal(me.phone, '+919876543210')
		assert.ok(Object.values(store).includes('sess_1'), 'the session is kept in the browser')
		assert.deepEqual(seen.slice(1, 3), [
			'POST http://engine.test/x/identity/otp {"phone":"+91 98765 43210","domain":"storefront.test"}',
			'POST http://engine.test/x/identity/otp/verify {"phone":"+91 98765 43210","code":"0420"}',
		])
	} finally {
		delete globalThis.window
		delete globalThis.document
		m.BaseService.setCredentials({ apiUrl: undefined })
	}
})

test('a store that says nothing signs in by email and password', async () => {
	m.clearStoreCache()
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test' })
	try {
		const svc = new m.AuthService(async () => Response.json({ data: [] }))
		assert.equal(await svc.loginMethod(), 'email_password')
	} finally {
		m.BaseService.setCredentials({ apiUrl: undefined })
	}
})

test('the sign-in form follows the way the store chose', async () => {
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test' })
	m.setStaticStore(() => ({ id: 'from_config', name: 'Shop', loginType: 'BOTH' }))
	let method
	const svc = new m.StoreService(async (url) => {
		if (String(url).endsWith('/api/checkout')) return Response.json({ data: { currency: 'INR', methods: [] } })
		if (new URL(String(url)).pathname === '/api/plugins')
			return Response.json({ data: method ? [{ key: 'identity', title: 'Customer sign-in', settings: { login_method: method } }] : [] })
		return Response.json({ data: [] })
	})
	for (const [chosen, want] of [['phone_otp', 'PHONE'], ['email_password', 'EMAIL'], [undefined, 'BOTH']]) {
		m.clearStoreCache()
		method = chosen
		const store = await svc.getStoreByIdOrDomain()
		assert.equal(store.loginType, want, `login_method ${chosen}`)
	}
})

test('the address form offers only the countries the store delivers to', async () => {
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test' })
	m.setStaticStore(() => ({
		id: 'from_config',
		name: 'Shop',
		country: { code: 'US', name: 'United States' },
		countries: [
			{ code: 'IN', name: 'India' },
			{ code: 'US', name: 'United States' },
		],
	}))
	let ships
	const svc = new m.StoreService(async (url) => {
		const path = new URL(String(url)).pathname
		if (path === '/api/checkout') return Response.json({ data: { currency: 'INR', methods: [] } })
		if (path === '/api/checkout/countries') return Response.json({ data: ships })
		return Response.json({ data: [] })
	})

	m.clearStoreCache()
	ships = { everywhere: false, countries: ['IN'] }
	let store = await svc.getStoreByIdOrDomain()
	assert.deepEqual(store.countries, [{ code: 'IN', name: 'India' }])
	assert.equal(store.country.code, 'IN', 'the one country is the default')

	m.clearStoreCache()
	ships = { everywhere: false, countries: ['IN', 'NP'] }
	store = await svc.getStoreByIdOrDomain()
	assert.deepEqual(
		store.countries.map((c) => c.code),
		['IN', 'NP'],
	)
	assert.ok(store.countries[1].name, 'a country the static list lacks still has a name')
	assert.equal(store.country.code, 'IN', 'a default the store does not deliver to gives way to the first it does')

	m.clearStoreCache()
	ships = { everywhere: true, countries: [] }
	store = await svc.getStoreByIdOrDomain()
	assert.equal(store.countries.length, 2, 'everywhere keeps the static list')
})

test('a signed-in shopper adds a phone with a code, and the account says it is verified', async () => {
	const store = { gocommerce_token: 'sess_1' }
	globalThis.window = {
		location: { origin: 'http://storefront.test', hostname: 'storefront.test' },
		localStorage: {
			getItem: (k) => store[k] ?? null,
			setItem: (k, v) => {
				store[k] = v
			},
			removeItem: (k) => {
				delete store[k]
			},
		},
	}
	globalThis.document = { cookie: '' }
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test' })
	const seen = []
	const record = { id: 9, email: 'ada@example.com', email_verified: false, name: 'Ada', phone: '+919876543210', phone_verified: true, created_at: '', updated_at: '' }
	try {
		const svc = new m.ProfileService(async (url, init) => {
			seen.push(`${init.method ?? 'GET'} ${new URL(String(url)).pathname} ${init.body ?? ''}`)
			if (String(url).endsWith('/me/phone')) return Response.json({ data: { expires_in_minutes: 10 } }, { status: 202 })
			return Response.json({ data: record })
		})
		const sent = await svc.requestPhoneLink({ phone: '+91 98765 43210' })
		assert.equal(sent.expiresInMinutes, 10)
		const me = await svc.verifyPhoneLink({ phone: '+91 98765 43210', otp: '0420' })
		assert.equal(me.phoneVerified, true)
		assert.deepEqual(seen, [
			'POST /x/identity/me/phone {"phone":"+91 98765 43210"}',
			'POST /x/identity/me/phone/verify {"phone":"+91 98765 43210","code":"0420"}',
		])
	} finally {
		delete globalThis.window
		delete globalThis.document
		m.BaseService.setCredentials({ apiUrl: undefined })
	}
})

test('a store allowing email or phone offers both on the sign-in form', async () => {
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test' })
	m.setStaticStore(() => ({ id: 'from_config', name: 'Shop', loginType: 'EMAIL' }))
	m.clearStoreCache()
	const svc = new m.StoreService(async (url) => {
		const path = new URL(String(url)).pathname
		if (path === '/api/checkout') return Response.json({ data: { currency: 'INR', methods: [] } })
		if (path === '/api/plugins')
			return Response.json({ data: [{ key: 'identity', title: 'Customer sign-in', settings: { login_method: 'email_or_phone' } }] })
		return Response.json({ data: [] })
	})
	const store = await svc.getStoreByIdOrDomain()
	assert.equal(store.loginType, 'BOTH')
	assert.equal(await new m.AuthService(async (url) => Response.json({ data: [{ key: 'identity', title: '', settings: { login_method: 'email_or_phone' } }] })).loginMethod(), 'email_or_phone')
})

test('a new phone asks "already have an account?" before one opens (D123)', async () => {
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test' })
	const calls = []
	const auth = { token: 't', expires_at: '2030-01-01T00:00:00Z', record: { id: 9, email: 'ada@example.com', phone: '+919876543210' } }
	const svc = new m.AuthService(async (url, init) => {
		const path = new URL(String(url)).pathname
		calls.push({ path, body: JSON.parse(init.body ?? '{}') })
		if (path === '/x/identity/otp/verify') return Response.json({ data: { new_phone: true, phone_token: 'proof' } })
		return Response.json({ data: auth })
	})

	const asked = await svc.verifyOtp({ phone: '+919876543210', otp: '0420', askIfNew: true })
	assert.deepEqual(asked, { newPhone: true, phoneToken: 'proof' })
	assert.equal(calls[0].body.ask_if_new, true)

	await svc.login({ email: 'ada@example.com', password: 'pw', phone: '+919876543210', phoneToken: 'proof' })
	assert.deepEqual(calls[1], { path: '/x/identity/login', body: { email: 'ada@example.com', password: 'pw', phone: '+919876543210', phone_token: 'proof' } })

	await svc.openPhoneAccount({ phone: '+919876543210', phoneToken: 'proof' })
	assert.deepEqual(calls[2], { path: '/x/identity/otp/new-account', body: { phone: '+919876543210', phone_token: 'proof' } })

	await svc.login({ email: 'ada@example.com', password: 'pw' })
	assert.deepEqual(calls[3].body, { email: 'ada@example.com', password: 'pw' })
})

test('a sign-in code names the site it is asked from, for Chrome to fill it in (D124)', async () => {
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test' })
	const bodies = []
	const svc = new m.AuthService(async (_url, init) => {
		bodies.push(JSON.parse(init.body))
		return new Response(JSON.stringify({ data: { expires_in_minutes: 10 } }), { status: 202, headers: { 'Content-Type': 'application/json' } })
	})
	await svc.getOtp({ phone: '+919876543210', domain: 'chillish.in' })
	await svc.getOtp({ phone: '+919876543210' })
	assert.deepEqual(bodies, [{ phone: '+919876543210', domain: 'chillish.in' }, { phone: '+919876543210' }])
})

// ---------------------------------------------------------------- composed home page (ext/layouts)

test('a published home layout keeps its order and settings, and its grids carry storefront products', async () => {
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test', proxyPath: '' })
	const seen = []
	const svc = new m.LayoutService(async (url) => {
		seen.push(url)
		return Response.json({
			data: {
				page: 'home',
				theme: 'default',
				revision: 3,
				sections: [
					{ id: 'a', type: 'announcement-bar', settings: { text: 'Free shipping', link: '/sale' } },
					{ id: 'h', type: 'hero', settings: { heading: 'New in', image: '/media/hero.jpg', mobile_image: 'https://cdn.example/m.jpg' } },
					{ id: 'g', type: 'product-grid', settings: { heading: 'Best sellers', columns: 4 }, products: [product()] },
					{ id: 'e', type: 'product-grid', settings: { heading: 'Empty' } },
					{ id: 'x', type: 'from-the-future', settings: { anything: 1 } },
				],
			},
		})
	})
	const layout = await svc.getHomeLayout()
	assert.equal(seen[0], 'http://engine.test/x/layouts/home', 'no preview asked for, none sent')
	assert.equal(layout.revision, 3)
	assert.equal(layout.preview, false)
	assert.deepEqual(layout.sections.map((s) => s.type), ['announcement-bar', 'hero', 'product-grid', 'product-grid', 'from-the-future'])
	assert.deepEqual(layout.sections[0].settings, { text: 'Free shipping', link: '/sale' })
	assert.equal(layout.sections[1].settings.image, 'http://engine.test/media/hero.jpg', 'an upload is loaded from the engine')
	assert.equal(layout.sections[1].settings.mobile_image, 'https://cdn.example/m.jpg')
	assert.equal(layout.sections[1].products, undefined)
	const [card] = layout.sections[2].products
	assert.equal(card.id, '7')
	assert.equal(card.price, 25, 'mapped like a collection product: major units')
	assert.equal(card.link, '/products/cotton-tee')
	assert.deepEqual(layout.sections[3].products, [])
	assert.deepEqual(layout.sections[4].settings, { anything: 1 }, 'an unknown type passes through for the storefront to skip')
})

test('a preview key asks for the draft', async () => {
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test' })
	const seen = []
	const svc = new m.LayoutService(async (url) => {
		seen.push(url)
		return Response.json({ data: { page: 'home', theme: 'default', preview: true, sections: [] } })
	})
	const layout = await svc.getHomeLayout({ preview: 'k3y' })
	assert.equal(seen[0], 'http://engine.test/x/layouts/home?preview=k3y')
	assert.equal(layout.preview, true)
	assert.deepEqual(layout.sections, [])
})

test('no layout — plugin off, nothing published, a bad key or no module — is null, and other failures still throw', async () => {
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test' })
	const missing = new m.LayoutService(async () =>
		Response.json({ error: { code: 'not_found', message: 'no published layout' } }, { status: 404 }),
	)
	assert.equal(await missing.getHomeLayout(), null)
	assert.equal(await missing.getHomeLayout({ preview: 'expired' }), null)
	const noRoute = new m.LayoutService(async () => new Response('', { status: 404 }))
	assert.equal(await noRoute.getHomeLayout(), null)
	const broken = new m.LayoutService(async () =>
		Response.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 }),
	)
	await assert.rejects(broken.getHomeLayout(), (err) => err instanceof m.GoCommerceError && err.status === 500)
})

test('a layout carries its theme settings, its nested uploads and its collection cards', async () => {
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test', proxyPath: '' })
	const svc = new m.LayoutService(async () =>
		Response.json({
			data: {
				page: 'home',
				theme: 'default',
				revision: 4,
				theme_settings: { accent: '#aa3300', body_font: 'lora' },
				sections: [
					{ id: 's', type: 'slideshow', settings: { slides: [{ image: '/media/s1.jpg', mobile_image: '/media/s1m.jpg', heading: '/media/words' }, { image: 'https://cdn.example/s2.jpg' }] } },
					{ id: 'v', type: 'video', settings: { video_file: '/media/v.mp4', poster: '/media/v.jpg' } },
					{ id: 'c', type: 'collection-list', settings: { collections: [2, 1] }, collections: [{ id: 2, slug: 'rings', title: 'Rings', image: '/media/r.jpg' }, { id: 1, slug: 'chains', title: 'Chains' }] },
					{ id: 'e', type: 'collection-list', settings: {} },
				],
			},
		}),
	)
	const layout = await svc.getHomeLayout()
	assert.deepEqual(layout.themeSettings, { accent: '#aa3300', body_font: 'lora' })
	const slides = layout.sections[0].settings.slides
	assert.equal(slides[0].image, 'http://engine.test/media/s1.jpg', 'an upload inside a list is loaded from the engine')
	assert.equal(slides[0].mobile_image, 'http://engine.test/media/s1m.jpg')
	assert.equal(slides[0].heading, '/media/words', 'only picture and video settings are addresses')
	assert.equal(slides[1].image, 'https://cdn.example/s2.jpg')
	assert.equal(layout.sections[1].settings.video_file, 'http://engine.test/media/v.mp4')
	assert.equal(layout.sections[1].settings.poster, 'http://engine.test/media/v.jpg')
	assert.deepEqual(layout.sections[2].collections, [
		{ id: '2', title: 'Rings', slug: 'rings', link: '/collections/rings', image: 'http://engine.test/media/r.jpg' },
		{ id: '1', title: 'Chains', slug: 'chains', link: '/collections/chains', image: null },
	])
	assert.deepEqual(layout.sections[3].collections, [])
})

test('a layout without theme settings says so with null', async () => {
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test' })
	const svc = new m.LayoutService(async () => Response.json({ data: { page: 'home', theme: 'default', sections: [] } }))
	assert.equal((await svc.getHomeLayout()).themeSettings, null)
})

test('the theme settings come alone for every page, and a preview key asks for the draft', async () => {
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test' })
	const seen = []
	const svc = new m.LayoutService(async (url) => {
		seen.push(url)
		return Response.json({ data: { revision: 2, settings: { radius: 'large' } } })
	})
	assert.deepEqual(await svc.getThemeSettings(), { revision: 2, preview: false, settings: { radius: 'large' } })
	assert.equal(seen[0], 'http://engine.test/x/layouts/theme')
	await svc.getThemeSettings({ preview: 'k3y' })
	assert.equal(seen[1], 'http://engine.test/x/layouts/theme?preview=k3y')

	const missing = new m.LayoutService(async () => Response.json({ error: { code: 'not_found', message: 'none' } }, { status: 404 }))
	assert.equal(await missing.getThemeSettings(), null, 'nothing published, or the editor off: the storefront keeps its look')
	const broken = new m.LayoutService(async () => Response.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 }))
	assert.equal(await broken.getThemeSettings(), null, 'a failure costs the look, never the page')
})

// ---------------------------------------------------------------- product and collection templates (ext/layouts, D128)

test('the product page template keeps its core where the shop put it, and its own sections', async () => {
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test', proxyPath: '' })
	const seen = []
	const svc = new m.LayoutService(async (url) => {
		seen.push(url)
		return Response.json({
			data: {
				page: 'product',
				theme: 'default',
				revision: 2,
				sections: [
					{ id: 'h', type: 'hero', settings: { heading: 'Made by hand', image: '/media/h.jpg' } },
					{ id: 'product', type: 'main-product', settings: {} },
					{ id: 'r', type: 'product-reviews', settings: null },
					{ id: 'rel', type: 'related-products', settings: { heading: 'You may also like' } },
					{ id: 'g', type: 'product-grid', settings: { heading: 'Pairs well with' }, products: [product()] },
				],
			},
		})
	})
	const layout = await svc.getProductLayout()
	assert.equal(seen[0], 'http://engine.test/x/layouts/product')
	assert.equal(layout.page, 'product')
	assert.equal(layout.revision, 2)
	assert.deepEqual(layout.sections.map((s) => s.type), ['hero', 'main-product', 'product-reviews', 'related-products', 'product-grid'])
	assert.equal(layout.sections[0].settings.image, 'http://engine.test/media/h.jpg')
	assert.deepEqual(layout.sections[1].settings, {}, 'the core carries no settings: the catalogue draws it')
	assert.deepEqual(layout.sections[2].settings, {}, 'a null settings object is an empty one')
	assert.equal(layout.sections[3].settings.heading, 'You may also like')
	assert.equal(layout.sections[4].products[0].link, '/products/cotton-tee')
	assert.equal(layout.themeSettings, null, 'the design tokens come with the home page, not with a template')
})

test('the collection page template and its preview', async () => {
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test' })
	const seen = []
	const svc = new m.LayoutService(async (url) => {
		seen.push(url)
		return Response.json({ data: { page: 'collection', theme: 'default', preview: true, sections: [{ id: 'products', type: 'main-collection', settings: {} }] } })
	})
	const layout = await svc.getCollectionLayout({ preview: 'k3y' })
	assert.equal(seen[0], 'http://engine.test/x/layouts/collection?preview=k3y')
	assert.equal(layout.preview, true)
	assert.deepEqual(layout.sections.map((s) => s.id), ['products'])
	await svc.getProductLayout({ preview: '  ' })
	assert.equal(seen[1], 'http://engine.test/x/layouts/product', 'a blank key is no key')
})

test('no template published, the editor off, or an engine without templates: null, so the page draws as before', async () => {
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test' })
	const missing = new m.LayoutService(async () => Response.json({ error: { code: 'not_found', message: 'the product page has not been published' } }, { status: 404 }))
	assert.equal(await missing.getProductLayout(), null)
	assert.equal(await missing.getCollectionLayout({ preview: 'expired' }), null)
	const older = new m.LayoutService(async () => new Response('', { status: 404 }))
	assert.equal(await older.getCollectionLayout(), null)
	const broken = new m.LayoutService(async () => Response.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 }))
	await assert.rejects(broken.getProductLayout(), (err) => err instanceof m.GoCommerceError && err.status === 500)
})

// ---------------------------------------------------------------- related products

// A shop that never filled in categories still shows related products: the
// product's own category first, then its collections, then the newest — never
// the product itself, and never the same product twice.
test('related products fall back from the category to the collections to the newest', async () => {
	m.clearStoreCache()
	const p = (id) => product({ id, slug: `p${id}` })
	const answer = (path) => {
		if (path === '/api/products/slug/p1') {
			return { data: p(1) }
		}
		if (path === '/api/products/slug/p2') {
			return { data: product({ id: 2, slug: 'p2', category: null, collections: [{ id: 5, slug: 'gifts', title: 'Gifts' }] }) }
		}
		if (path === '/api/products/slug/p3') {
			return { data: product({ id: 3, slug: 'p3', category: null, collections: [] }) }
		}
		if (path === '/api/categories') return { data: [{ id: 3, parent_id: null, slug: 'shirts', title: 'Shirts', position: 0, full_name: 'Shirts', depth: 0, child_count: 0 }] }
		if (path === '/api/categories/shirts') return { data: { products: [p(1), p(4)] }, meta: { total: 2, page: 1, limit: 13, total_pages: 1 } }
		if (path === '/api/collections/gifts') return { data: { products: [p(2), p(6)] }, meta: { total: 2, page: 1, limit: 13, total_pages: 1 } }
		if (path === '/api/products') return { data: [p(9), p(6), p(3), p(4), p(1)], meta: { total: 5, page: 1, limit: 13, total_pages: 1 } }
		return null
	}
	const svc = new m.ProductService(async (url) => {
		const body = answer(new URL(String(url)).pathname)
		return body ? Response.json(body) : Response.json({ error: { code: 'not_found', message: 'nope' } }, { status: 404 })
	})
	const ids = async (slug) => (await svc.listRelatedProducts({ product: slug, limit: 12 })).data.map((x) => x.id)

	assert.deepEqual(await ids('p1'), ['4', '9', '6', '3'], 'its category, then the newest, without itself')
	assert.deepEqual(await ids('p2'), ['6', '9', '3', '4', '1'], 'no category: its collection, then the newest')
	assert.deepEqual(await ids('p3'), ['9', '6', '4', '1'], 'nothing to go on: the newest')
	assert.equal((await svc.listRelatedProducts({ product: 'p3', limit: 2 })).data.length, 2, 'the limit holds')
})

// ---------------------------------------------------------------- listing facets

/** An engine that answers the store, the category tree and the listing; `facets` is what its listing counts, or nothing. */
function listingEngine(base, facets) {
	const asked = []
	const fetch = async (url) => {
		const u = new URL(url)
		if (u.pathname === '/api/checkout') return Response.json({ data: { currency: 'INR' } })
		if (u.pathname === '/api/store') return Response.json({ data: { language: 'en' } })
		if (u.pathname === '/api/categories') return Response.json({ data: [{ id: 1, slug: 'rings', title: 'Rings', parent_id: null }] })
		asked.push(u)
		const meta = { total: 1, limit: 24, offset: 0, page: 1, total_pages: 1, ...(facets && u.searchParams.get('facets') ? { facets } : {}) }
		if (u.pathname === '/api/categories/rings') return Response.json({ data: { products: [product()] }, meta })
		return Response.json({ data: [product()], meta })
	}
	m.BaseService.setCredentials({ apiUrl: base })
	return { svc: new m.SearchService(fetch), asked }
}

test('every filter the storefront writes reaches the engine, and its counts come back in the rail’s shape', async () => {
	const { svc, asked } = listingEngine('http://facets.test', {
		price: { min: money(150000, 'INR'), max: money(1299950, 'INR') },
		tags: [{ value: 'bridal', count: 4 }],
		vendors: [{ value: 'Acme', count: 3 }],
		product_types: [],
		categories: [{ id: 1, slug: 'rings', title: 'Rings', count: 4 }],
		attributes: { metal: [{ value: 'Gold', count: 2 }, { value: 'Silver, sterling', count: 1 }] },
	})
	const res = await svc.searchWithUrl(
		new URL(
			'http://storefront.test/rings?tags=bridal,daily&vendor=Acme&product_type=Ring&attributes.metal=Gold%2CSilver&priceFrom=1500&priceTo=12999.5&sort=-price&search=band',
		),
		'rings',
	)
	assert.equal(asked.length, 1, 'one request answers the whole page')
	const q = asked[0].searchParams
	assert.equal(asked[0].pathname, '/api/products')
	assert.deepEqual(
		{
			q: q.get('q'),
			category: q.get('category'),
			tag: q.getAll('tag'),
			vendor: q.getAll('vendor'),
			product_type: q.getAll('product_type'),
			attr: q.getAll('attr'),
			price_min: q.get('price_min'),
			price_max: q.get('price_max'),
			sort: q.get('sort'),
			order: q.get('order'),
			facets: q.get('facets'),
		},
		{
			q: 'band',
			category: 'rings',
			tag: ['bridal', 'daily'],
			vendor: ['Acme'],
			product_type: ['Ring'],
			attr: ['metal:Gold', 'metal:Silver'],
			price_min: '150000',
			price_max: '1299950',
			sort: 'price',
			order: 'desc',
			facets: '1',
		},
	)
	assert.deepEqual(res.facets, {
		priceStat: { min: 1500, max: 12999.5 },
		categories: [{ name: 'Rings', slug: 'rings', count: 4 }],
		tags: [{ name: 'bridal', count: 4 }],
		allFilters: { vendor: { Acme: 3 }, 'attributes.metal': { Gold: 2, 'Silver, sterling': 1 } },
	})
	assert.deepEqual(res.categoryHierarchy, [{ name: 'Rings', slug: 'rings' }])
})

test('an engine that does not count facets is asked the old way, once, and the rail stays empty', async () => {
	const { svc, asked } = listingEngine('http://old-engine.test', null)
	const first = await svc.searchWithUrl(new URL('http://storefront.test/rings'), 'rings')
	assert.deepEqual(
		asked.map((u) => u.pathname),
		['/api/products', '/api/categories/rings'],
	)
	assert.deepEqual(first.facets, { priceStat: {}, categories: [], tags: [], allFilters: {} })
	assert.equal(first.count, 1)
	asked.length = 0
	await svc.searchWithUrl(new URL('http://storefront.test/rings'), 'rings')
	assert.deepEqual(
		asked.map((u) => u.pathname),
		['/api/categories/rings'],
		'remembered: no second wasted request',
	)
})

// ---------------------------------------------------------------- Meilisearch, and the database behind it

/** An engine with the Meilisearch plugin on; `index` answers its search route (a Response), or it is down. */
function indexedEngine(base, index) {
	const asked = []
	const fetch = async (url) => {
		const u = new URL(url)
		if (u.pathname === '/api/checkout') return Response.json({ data: { currency: 'INR' } })
		if (u.pathname === '/api/store') return Response.json({ data: { language: 'en' } })
		if (u.pathname === '/api/plugins') return Response.json({ data: [{ key: 'meilisearch', settings: {} }] })
		asked.push(u)
		if (u.pathname === '/x/meilisearch/search') return index(u)
		const facets = u.searchParams.get('facets') ? { facets: { tags: [{ value: 'silver', count: 1 }] } } : {}
		return Response.json({ data: [product({ title: 'From the database' })], meta: { total: 1, limit: 24, offset: 0, page: 1, total_pages: 1, ...facets } })
	}
	m.BaseService.setCredentials({ apiUrl: base, channel: undefined })
	return { search: new m.SearchService(fetch), typeahead: new m.MeilisearchService(fetch), products: new m.ProductService(fetch), asked }
}

const down = () => Response.json({ data: { hits: [], query: '', total: 0, limit: 24, offset: 0, configured: true, unavailable: true } })
const hit = { id: 7, slug: 'silver-bracelet', title: 'Silver bracelet', currency: 'INR', price_minor: 250000, price_max_minor: 250000, in_stock: true, tags: [], skus: [], updated_at: 1793169689 }

test('a search on a store with Meilisearch on is answered by the index, typos and all', async () => {
	const { search, typeahead, asked } = indexedEngine('http://meili-on.test', () =>
		Response.json({ data: { hits: [hit], total: 1, limit: 24, offset: 0 } }),
	)
	const res = await search.searchWithUrl(new URL('http://storefront.test/search?search=braclet'))
	assert.deepEqual(res.data.map((p) => p.title), ['Silver bracelet'])
	assert.equal(res.count, 1)
	assert.deepEqual(res.facets.tags, [{ name: 'silver', count: 1 }], 'the rail is still there to narrow by')
	assert.ok(asked.some((u) => u.pathname === '/x/meilisearch/search' && u.searchParams.get('q') === 'braclet'))
	assert.deepEqual((await typeahead.searchAutoComplete({ query: 'braclet' })).data.map((p) => p.title), ['Silver bracelet'])
})

test('a search narrowed by tags or attributes stays with the database, which counts those filters', async () => {
	const { search, asked } = indexedEngine('http://meili-refined.test', () => assert.fail('the index was asked'))
	await search.searchWithUrl(new URL('http://storefront.test/search?search=band&tags=bridal'))
	assert.ok(asked.length && asked.every((u) => u.pathname === '/api/products'), asked.map((u) => u.pathname).join(' '))
})

test('words the index has nothing for, or a channel the index does not know, are asked of the database', async () => {
	const empty = indexedEngine('http://meili-empty.test', () => Response.json({ data: { hits: [], total: 0, limit: 24, offset: 0 } }))
	assert.deepEqual((await empty.typeahead.searchAutoComplete({ query: 'bracelet' })).data.map((p) => p.title), ['From the database'])
	const channel = indexedEngine('http://meili-channel.test', () => assert.fail('the index was asked'))
	m.BaseService.setCredentials({ apiUrl: 'http://meili-channel.test', channel: 'wholesale' })
	try {
		assert.deepEqual((await channel.typeahead.searchAutoComplete({ query: 'bracelet' })).data.map((p) => p.title), ['From the database'])
	} finally {
		m.BaseService.setCredentials({ apiUrl: 'http://meili-channel.test', channel: undefined })
	}
})

test('a store with Meilisearch off counts its facets once per search', async () => {
	const asked = []
	const svc = new m.SearchService(async (url) => {
		const u = new URL(url)
		if (u.pathname === '/api/plugins') return Response.json({ data: [] })
		if (u.pathname === '/api/checkout') return Response.json({ data: { currency: 'INR' } })
		asked.push(u.pathname)
		return Response.json({ data: [product()], meta: { total: 1, limit: 24, offset: 0, page: 1, total_pages: 1, facets: { tags: [] } } })
	})
	m.BaseService.setCredentials({ apiUrl: 'http://meili-off.test', channel: undefined })
	await svc.searchWithUrl(new URL('http://storefront.test/products?search=bracelet'))
	assert.deepEqual(asked.filter((p) => p === '/api/products'), ['/api/products'])
})

test('with Meilisearch down, search, the type-ahead and a sorted listing answer from the database', async () => {
	const { search, typeahead, products } = indexedEngine('http://meili-down.test', down)
	assert.deepEqual((await indexedEngine('http://meili-broken.test', () => new Response('', { status: 502 })).typeahead.searchAutoComplete({ query: 'x' })).data.map((p) => p.title), ['From the database'], 'an engine error too')
	const res = await search.searchWithUrl(new URL('http://storefront.test/search?search=bracelet&sort=-price'))
	assert.deepEqual(res.data.map((p) => p.title), ['From the database'])
	assert.deepEqual((await typeahead.searchAutoComplete({ query: 'bracelet' })).data.map((p) => p.title), ['From the database'])
	assert.deepEqual((await products.list({ sort: '-price' })).data.map((p) => p.title), ['From the database'])
})

// ---------------------------------------------------------------- the header and footer (ext/layouts, D131)

const engineMenu = (handle, items) => ({ id: 3, handle, title: handle === 'main' ? 'Main menu' : 'Footer', items })
const menuItem = (id, title, kind, target, children = null) => ({ id, title, kind, target, url: '', position: id, children })

test('the header comes with its settings and its menu, read live by handle', async () => {
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test', proxyPath: '' })
	const seen = []
	const svc = new m.LayoutService(async (url) => {
		seen.push(url)
		if (String(url).includes('/x/navigation/menus/main')) {
			return Response.json({ data: engineMenu('main', [menuItem(1, 'Rings', 'collection', 'rings'), menuItem(2, 'About', 'page', 'about-us')]) })
		}
		return Response.json({
			data: {
				page: 'header',
				theme: 'default',
				revision: 4,
				sections: [
					{
						id: 'header',
						type: 'header',
						settings: { show_announcement: true, announcement_text: 'Free returns', announcement_link: '/products', announcement_pages: 'all', menu: 'main' },
					},
				],
			},
		})
	})
	const header = await svc.getHeader()
	assert.equal(seen[0], 'http://engine.test/x/layouts/header')
	assert.equal(seen[1], 'http://engine.test/x/navigation/menus/main')
	assert.equal(header.revision, 4)
	assert.equal(header.preview, false)
	assert.equal(header.settings.announcement_text, 'Free returns')
	assert.equal(header.settings.announcement_pages, 'all')
	assert.equal(header.menu.menuId, 'main')
	assert.deepEqual(
		header.menu.items.map((i) => [i.name, i.link]),
		[
			['Rings', '/collections/rings'],
			['About', '/p/about-us'],
		],
	)
})

test('the footer comes with its columns menu, its words and social links; a preview key asks for the draft', async () => {
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test' })
	const seen = []
	const svc = new m.LayoutService(async (url) => {
		seen.push(url)
		if (String(url).includes('/x/navigation/menus/')) {
			return Response.json({ data: engineMenu('footer', [menuItem(1, 'Help', 'url', '', [menuItem(2, 'Shipping', 'page', 'shipping')])]) })
		}
		return Response.json({
			data: {
				page: 'footer',
				theme: 'default',
				preview: true,
				sections: [
					{
						id: 'footer',
						type: 'footer',
						settings: {
							menu: 'footer',
							about: 'Small-batch goods.',
							newsletter: true,
							social: [{ network: 'instagram', url: 'https://instagram.com/example' }],
							copyright: '© The shop',
						},
					},
				],
			},
		})
	})
	const footer = await svc.getFooter({ preview: 'k3y' })
	assert.equal(seen[0], 'http://engine.test/x/layouts/footer?preview=k3y')
	assert.equal(footer.preview, true)
	assert.equal(footer.settings.about, 'Small-batch goods.')
	assert.equal(footer.settings.newsletter, true)
	assert.deepEqual(footer.settings.social, [{ network: 'instagram', url: 'https://instagram.com/example' }])
	assert.equal(footer.menu.items[0].name, 'Help')
	assert.equal(footer.menu.items[0].items[0].link, '/p/shipping')
})

test('a menu that is gone, or none named, leaves the menu null and the rest standing', async () => {
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test' })
	const svc = new m.LayoutService(async (url) => {
		if (String(url).includes('/x/navigation/menus/')) return Response.json({ error: { code: 'not_found', message: 'no menu' } }, { status: 404 })
		return Response.json({ data: { page: 'header', theme: 'default', revision: 1, sections: [{ id: 'header', type: 'header', settings: { menu: 'gone' } }] } })
	})
	const header = await svc.getHeader()
	assert.equal(header.menu, null)
	assert.equal(header.settings.menu, 'gone')

	const none = new m.LayoutService(async () =>
		Response.json({ data: { page: 'footer', theme: 'default', revision: 1, sections: [{ id: 'footer', type: 'footer', settings: { copyright: '© Shop' } }] } }),
	)
	const footer = await none.getFooter()
	assert.equal(footer.menu, null)
	assert.equal(footer.settings.copyright, '© Shop')
})

test('no header or footer published, the editor off, an older engine, or any failure: null, so the storefront keeps its own', async () => {
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test' })
	const missing = new m.LayoutService(async () => Response.json({ error: { code: 'not_found', message: 'the header has not been published' } }, { status: 404 }))
	assert.equal(await missing.getHeader(), null)
	assert.equal(await missing.getFooter({ preview: 'expired' }), null)
	const broken = new m.LayoutService(async () => Response.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 }))
	assert.equal(await broken.getHeader(), null, 'a failure costs the header its settings, never the page')
	const empty = new m.LayoutService(async () => Response.json({ data: { page: 'footer', theme: 'default', revision: 1, sections: [] } }))
	assert.equal(await empty.getFooter(), null)
})

test("the store's header and footer menus are the ones the shop chose in the theme editor", async () => {
	// An address of its own: store-level facts are remembered per engine.
	m.BaseService.setCredentials({ apiUrl: 'http://chosen-menus.test' })
	const seen = []
	const svc = new m.MenuService(async (url) => {
		const u = String(url)
		seen.push(u)
		if (u.endsWith('/api/plugins')) return Response.json({ data: [{ key: 'navigation' }, { key: 'layouts' }] })
		if (u.endsWith('/x/layouts/header')) {
			return Response.json({ data: { page: 'header', theme: 'default', revision: 1, sections: [{ id: 'header', type: 'header', settings: { menu: 'main' } }] } })
		}
		if (u.endsWith('/x/layouts/footer')) return Response.json({ error: { code: 'not_found', message: 'the footer has not been published' } }, { status: 404 })
		if (u.endsWith('/x/navigation/menus/main')) return Response.json({ data: engineMenu('main', [menuItem(1, 'Rings', 'collection', 'rings')]) })
		if (u.endsWith('/x/navigation/menus/footer')) return Response.json({ data: engineMenu('footer', [menuItem(2, 'Help', 'page', 'help')]) })
		return Response.json({ error: { code: 'not_found', message: u } }, { status: 404 })
	})
	const menus = await svc.engineMenus()
	assert.deepEqual(
		menus.map((x) => [x.menuId, x.name, x.items.map((i) => i.name).join(',')]),
		[
			['header', 'Main menu', 'Rings'],
			['footer', 'Footer', 'Help'],
		],
		'the header reads the chosen menu under the name every storefront looks for; an unpublished footer keeps "footer"',
	)
	assert.ok(!seen.some((u) => u.endsWith('/x/navigation/menus/header')), 'the menu the shop did not choose is not read')
})

test('the newsletter sign-up is on exactly when the newsletter module is', async () => {
	for (const [list, want] of [
		[[{ key: 'newsletter' }], true],
		[[], false],
	]) {
		m.clearStoreCache()
		m.BaseService.setCredentials({ apiUrl: 'http://newsletter.test' })
		m.setStaticStore(() => ({ id: 'from_config', name: 'Shop', plugins: { newsletter: { active: !want, label: 'kept' } } }))
		const svc = new m.StoreService(async (url) => {
			const path = new URL(String(url)).pathname
			if (path === '/api/checkout') return Response.json({ data: { currency: 'USD', methods: [] } })
			if (path === '/api/plugins') return Response.json({ data: list })
			return Response.json({ data: [] })
		})
		const store = await svc.getStoreByIdOrDomain()
		assert.equal(store.plugins.newsletter.active, want)
		assert.equal(store.plugins.newsletter.label, 'kept', 'the static record’s other settings stay')
	}
})

// ---------------------------------------------------------------- 0.12.0: add-ons, suggestions, offers (D133)

const withCart = async (fn) => {
	globalThis.window = {
		location: { origin: 'http://storefront.test' },
		localStorage: { getItem: (k) => (k === 'cart_id' ? 'cart1' : null), setItem() {}, removeItem() {} },
	}
	globalThis.document = { cookie: '' }
	try {
		return await fn()
	} finally {
		delete globalThis.window
		delete globalThis.document
	}
}

const cartLine = (over = {}) => ({
	id: 1, variant_id: 11, product_id: 7, sku: 'GRIP', title: 'Phone grip', quantity: 1,
	unit_price: money(4900, 'INR'), total: money(4900, 'INR'), current_price: money(4900, 'INR'),
	available: 5, in_stock: true, price_changed: false, ...over,
})

test('a cart line carries its compare-at price as its MRP, and says it is an add-on', () => {
	const l = m.toCartLine(cartLine({ add_on_id: 3, add_on_for: 9, compare_at_price: money(12900, 'INR') }))
	assert.equal(l.mrp, 129)
	assert.equal(l.price, 49)
	assert.equal(l.addOnId, '3')
	assert.equal(l.addOnFor, '9')
	const plain = m.toCartLine(cartLine({ compare_at_price: money(1000, 'INR') }))
	assert.equal(plain.mrp, 49, 'a compare-at below the price is no MRP')
	assert.equal(plain.addOnId, null)
})

test('a product’s add-ons arrive priced, the own price struck and the offer added', async () => {
	m.clearStoreCache()
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test' })
	const seen = []
	const svc = new m.ProductService(async (url) => {
		const u = new URL(String(url))
		seen.push(u.pathname + u.search)
		if (u.pathname === '/api/products/slug/case') return Response.json({ data: product({ id: 9, slug: 'case' }) })
		return Response.json({
			data: [{
				id: 3, product_id: 9, variant_id: 11, position: 0,
				offer_price: money(4900, 'INR'), price: money(12900, 'INR'),
				item: { product_id: 7, slug: 'grip', title: 'Phone grip', sku: 'GRIP', image_url: '/m/g.jpg', live: true, in_stock: true },
			}, {
				id: 4, product_id: 9, variant_id: 12, position: 1, offer_price: null, price: money(9900, 'INR'),
				item: { product_id: 8, slug: 'key', title: 'Key chain', sku: 'KEY', live: true, in_stock: false },
			}],
		})
	})
	const addOns = await svc.listAddOns({ product: 'case' })
	assert.ok(seen.includes('/api/add-ons?product_id=9'))
	assert.equal(addOns.length, 2)
	assert.deepEqual(
		[addOns[0].id, addOns[0].variantId, addOns[0].price, addOns[0].regularPrice, addOns[0].hasOffer, addOns[0].title],
		['3', '11', 49, 129, true, 'Phone grip'],
	)
	assert.equal(addOns[1].price, 99, 'no offer is its own price')
	assert.equal(addOns[1].hasOffer, false)
	assert.equal(addOns[1].inStock, false)
})

test('an add-on goes into the stored cart by its id', async () => {
	await withCart(async () => {
		const bodies = []
		const svc = new m.CartService(async (url, init) => {
			const u = new URL(String(url))
			if (init?.method === 'POST') bodies.push([u.pathname, JSON.parse(init.body)])
			return Response.json({ data: { id: 'cart1', status: 'open', currency: 'INR', line_items: [cartLine({ add_on_id: 3 })], item_count: 1, subtotal: money(4900, 'INR') } })
		})
		const cart = await svc.addAddOn({ addOnId: '3' })
		assert.deepEqual(bodies, [['/api/carts/cart1/line-items', { add_on_id: 3, quantity: 1 }]])
		assert.equal(cart.lineItems[0].addOnId, '3')
	})
})

test('the basket’s offers and its distance from free delivery are in major units', async () => {
	await withCart(async () => {
		const svc = new m.CartService(async (url) => {
			const u = new URL(String(url))
			if (u.pathname.endsWith('/offers')) {
				return Response.json({ data: [
					{ code: 'HELLO5', title: '5% off', kind: 'percentage', value_bp: 500, applies: true, amount: money(645, 'INR') },
					{ code: 'BIG100', title: '₹100 off', kind: 'fixed', value_minor: 10000, min_subtotal_minor: 30000, applies: false, remaining: money(17100, 'INR') },
				] })
			}
			if (u.pathname.endsWith('/free-shipping')) {
				assert.equal(u.searchParams.get('country'), 'IN')
				return Response.json({ data: { qualifies: false, threshold: money(49900, 'INR'), remaining: money(37000, 'INR'), subtotal: money(12900, 'INR') } })
			}
			return Response.json({ error: { code: 'not_found', message: 'nope' } }, { status: 404 })
		})
		const offers = await svc.getOffers()
		assert.deepEqual(offers.map((o) => [o.code, o.applies, o.amount, o.remaining, o.isPercent, o.value]), [
			['HELLO5', true, 6.45, null, true, 5],
			['BIG100', false, null, 171, false, 100],
		])
		const free = await svc.getFreeShipping({ country: 'IN' })
		assert.deepEqual(free, { qualifies: false, threshold: 499, remaining: 370, subtotal: 129 })
	})
})

test('the coupon drawer lists the shop’s listed codes for the stored cart', async () => {
	await withCart(async () => {
		const svc = new m.CouponService(async () =>
			Response.json({ data: [{ code: 'BIG100', title: '₹100 off', kind: 'fixed', value_minor: 10000, min_subtotal_minor: 30000, applies: false, remaining: money(17100, 'INR') }] }),
		)
		const page = await svc.listCoupons()
		assert.equal(page.count, 1)
		assert.deepEqual([page.data[0].code, page.data[0].amount, page.data[0].isPercent, page.data[0].minAmount], ['BIG100', 100, false, 300])
		assert.match(page.data[0].description, /171/)
	})
})

test('a basket’s suggestions fall back to its first product’s related products', async () => {
	await withCart(async () => {
		const svc = new m.CartService(async (url) => {
			const u = new URL(String(url))
			if (u.pathname === '/api/carts/cart1/cross-sells') return Response.json({ data: [] })
			if (u.pathname === '/api/carts/cart1') return Response.json({ data: { id: 'cart1', status: 'open', currency: 'USD', line_items: [cartLine({ product_id: 7 })], item_count: 1, subtotal: money(4900) } })
			if (u.pathname === '/api/products/7') return Response.json({ data: product({ category: null }) })
			if (u.pathname === '/api/products') return Response.json({ data: [product({ id: 4, slug: 'p4' }), product()], meta: { total: 2, limit: 12, offset: 0 } })
			return Response.json({ error: { code: 'not_found', message: 'nope' } }, { status: 404 })
		})
		const got = await svc.listCrossSells({ limit: 4 })
		assert.deepEqual(got.map((p) => p.id), ['4'], 'what the basket holds is not suggested')
	})
})

// ---------------------------------------------------------------- D134

test('a product’s gallery carries its pictures, then its videos, and the thumbnail stays a picture', () => {
	const p = m.toProduct(
		product({
			media: [
				{ media_id: 3, url: 'https://cdn.example/lead.jpg', kind: 'image' },
				{ media_id: 4, url: 'https://cdn.example/clip.mp4', kind: 'video' },
				{ media_id: 5, url: 'https://cdn.example/side.jpg', kind: 'image' },
				{ media_id: 6, url: 'https://www.youtube.com/watch?v=abc', kind: 'video' },
			],
		}),
	)
	assert.deepEqual(p.images.split(','), [
		'https://cdn.example/lead.jpg',
		'https://cdn.example/side.jpg',
		'https://cdn.example/v11.jpg',
		'https://cdn.example/clip.mp4',
		'https://www.youtube.com/watch?v=abc',
	])
	assert.deepEqual(p.imageList, ['https://cdn.example/lead.jpg', 'https://cdn.example/side.jpg', 'https://cdn.example/v11.jpg'], 'a card’s list is pictures only')
	assert.deepEqual(p.videos, ['https://cdn.example/clip.mp4', 'https://www.youtube.com/watch?v=abc'])
	assert.equal(p.thumbnail, 'https://cdn.example/lead.jpg')
	const onlyVideo = m.toProduct(product({ image_url: undefined, variants: [variant({ images: [], image: undefined })], media: [{ media_id: 4, url: 'https://cdn.example/clip.mp4', kind: 'video' }] }))
	assert.equal(onlyVideo.thumbnail, null, 'a video is never drawn as an <img>')
})

test('highlights, the free gift note and the sold count cross as the engine keeps them', () => {
	const p = m.toProduct(product({ metadata: { highlights: ['Shockproof', '', 7, 'Slim'], free_gift: ' A screen guard ' }, sold_at_least: 45000 }))
	assert.deepEqual(p.highlights, ['Shockproof', 'Slim'])
	assert.equal(p.freeGift, 'A screen guard')
	assert.equal(p.soldAtLeast, 45000)
	const bare = m.toProduct(product())
	assert.deepEqual(bare.highlights, [])
	assert.equal(bare.freeGift, null)
	assert.equal(bare.soldAtLeast, null, 'no count is no count, never zero')
})

test('a PIN code is looked up on the engine, and an unknown one is null', async () => {
	const asked = []
	const svc = new m.AddressService(async (url) => {
		const u = new URL(String(url))
		asked.push(u.pathname)
		if (u.pathname === '/api/postcodes/IN/400001')
			return Response.json({ data: { country: 'IN', postcode: '400001', city: 'Mumbai', state: 'Maharashtra', state_code: 'MH' } })
		return Response.json({ error: { code: 'not_found', message: 'no address is known for that postcode' } }, { status: 404 })
	})
	assert.deepEqual(await svc.lookupPostcode({ country: 'IN', postcode: '400001' }), {
		country: 'IN',
		postcode: '400001',
		city: 'Mumbai',
		state: 'Maharashtra',
		stateCode: 'MH',
	})
	assert.equal(await svc.lookupPostcode({ country: 'IN', postcode: '999999' }), null)
	assert.equal(await svc.lookupPostcode({ country: 'IN', postcode: '40' }), null, 'not six digits is not asked')
	assert.deepEqual(asked, ['/api/postcodes/IN/400001', '/api/postcodes/IN/999999'])
})

test('an address keeps its label, and a label cleared in the form is sent as cleared', () => {
	const base = { firstName: 'A', lastName: 'B', address_1: '1 Marine Drive', city: 'Mumbai', state: 'Maharashtra', zip: '400001', countryCode: 'IN' }
	assert.equal(m.toIdentityAddress({ ...base, label: 'Work' }).label, 'Work')
	assert.equal(m.toIdentityAddress({ ...base, label: '' }).label, '', 'the engine keeps a label it is not sent')
	assert.equal('label' in m.toIdentityAddress(base), false, 'a form without the chips says nothing about it')
})

test('the store record points the image CDN at the engine when it resizes pictures', async () => {
	m.clearStoreCache()
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test/', baseDomain: undefined })
	m.setStaticStore(() => ({ id: 'from_config', name: 'Shop', plugins: { imageCdn: { provider: '', url: '', active: false } } }))
	let imagesPath = '/images/store_01ABC'
	const svc = new m.StoreService(async (url) => {
		const path = new URL(String(url)).pathname
		if (path === '/api/checkout') return Response.json({ data: { currency: 'INR', methods: [] } })
		if (path === '/api/store') return Response.json({ data: { name: '', email: '', phone: '', images_path: imagesPath } })
		return Response.json({ data: [] })
	})
	const store = await svc.getStoreByIdOrDomain()
	assert.deepEqual(store.plugins.imageCdn, {
		provider: 'cloudflare',
		url: 'http://engine.test/images/store_01ABC',
		active: true,
	})

	// An engine from before D139 says nothing, and the static record stands.
	m.clearStoreCache()
	imagesPath = undefined
	const old = await svc.getStoreByIdOrDomain()
	assert.equal(old.plugins.imageCdn.active, false)
})

test("the store's own logo and icon win over the storefront's, and an absent one keeps the static", async () => {
	m.clearStoreCache()
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test/', proxyPath: undefined, baseDomain: undefined })
	m.setStaticStore(() => ({ id: 'from_config', name: 'Shop', logo: '/static-logo.png', logoDark: '/static-dark.png', favicon: '/favicon.png' }))
	let profile = { name: '', email: '', phone: '', logo_url: '/media/stores/s1/logo.png', logo_dark_url: '', icon_url: 'https://cdn.example/icon.png' }
	const svc = new m.StoreService(async (url) => {
		const path = new URL(String(url)).pathname
		if (path === '/api/checkout') return Response.json({ data: { currency: 'INR', methods: [] } })
		if (path === '/api/store') return Response.json({ data: profile })
		return Response.json({ data: [] })
	})
	const store = await svc.getStoreByIdOrDomain()
	assert.equal(store.logo, 'http://engine.test/media/stores/s1/logo.png', "the engine's logo, on the engine's origin")
	assert.equal(store.favicon, 'https://cdn.example/icon.png', 'an icon held elsewhere is used as it is')
	assert.equal(store.logoDark, undefined, "the store's own logo is not paired with the deployment's dark one")

	// A store that has chosen none, or an engine from before D148, changes nothing.
	m.clearStoreCache()
	profile = { name: '', email: '', phone: '' }
	const plain = await svc.getStoreByIdOrDomain()
	assert.equal(plain.logo, '/static-logo.png')
	assert.equal(plain.favicon, '/favicon.png')
	assert.equal(plain.logoDark, '/static-dark.png')
})

test('a contact page gets the address, map, hours and WhatsApp number the store published, and nothing it did not', async () => {
	m.clearStoreCache()
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test/', proxyPath: undefined, baseDomain: undefined })
	m.setStaticStore(() => ({ id: 'from_config', name: 'Shop', plugins: { whatsappChatButton: { active: false } } }))
	let profile = {
		name: '',
		email: '',
		phone: '',
		country: 'IN',
		address: { line1: '12 Market Road', line2: 'Unit 4', city: 'Pune', state: 'Maharashtra', postal_code: '411001', country: 'IN' },
		map_location: '18.5204,73.8567',
		opening_hours: [{ day: 'mon', opens: '10:00', closes: '19:00' }],
	}
	let plugins = [{ key: 'whatsapp-chat', title: 'WhatsApp', settings: { phone: '919800000000', message: 'Hi' } }]
	const svc = new m.StoreService(async (url) => {
		const path = new URL(String(url)).pathname
		if (path === '/api/checkout') return Response.json({ data: { currency: 'INR', methods: [] } })
		if (path === '/api/store') return Response.json({ data: profile })
		if (path === '/api/plugins') return Response.json({ data: plugins })
		return Response.json({ data: [] })
	})
	const store = await svc.getStoreByIdOrDomain()
	// The shape the storefront's contact page and home-page JSON-LD already read.
	assert.deepEqual(store.address, { street: '12 Market Road, Unit 4', city: 'Pune', state: 'Maharashtra', pincode: '411001', country: 'IN' })
	assert.equal(store.mapLocation, '18.5204,73.8567')
	// Beside the address form's default country, never over it.
	assert.equal(store.businessCountry, 'IN')
	assert.equal(store.country, undefined)
	assert.deepEqual(store.openingHours, [{ day: 'mon', opens: '10:00', closes: '19:00' }])
	assert.deepEqual(store.plugins.whatsappChatButton, { active: true, phone: '919800000000', message: 'Hi' })

	// A store that keeps its address to itself, sets no map or hours and has no
	// WhatsApp button — or an engine from before D156 — publishes none of them.
	m.clearStoreCache()
	profile = { name: '', email: '', phone: '', address: null, map_location: '', opening_hours: [] }
	plugins = []
	const quiet = await svc.getStoreByIdOrDomain()
	assert.equal(quiet.address, undefined)
	assert.equal(quiet.mapLocation, undefined)
	assert.equal(quiet.openingHours, undefined)
	assert.equal(quiet.businessCountry, undefined)
	assert.equal(quiet.plugins.whatsappChatButton.active, false)
	assert.equal(quiet.plugins.whatsappChatButton.phone, undefined)
})

test("Criteo loads with the store's own account, and only when the store switched it on", async () => {
	m.clearStoreCache()
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test/', proxyPath: undefined, baseDomain: undefined })
	// A shared deployment's static record is every store's: it must not switch Criteo on.
	m.setStaticStore(() => ({ id: 'from_config', name: 'Shop', plugins: { criteo: { active: true, accountId: '111' } } }))
	let plugins = [{ key: 'criteo', title: 'Criteo', settings: { account_id: '67357' } }]
	const svc = new m.StoreService(async (url) => {
		const path = new URL(String(url)).pathname
		if (path === '/api/checkout') return Response.json({ data: { currency: 'INR', methods: [] } })
		if (path === '/api/plugins') return Response.json({ data: plugins })
		return Response.json({ data: [] })
	})
	const store = await svc.getStoreByIdOrDomain()
	assert.deepEqual(store.plugins.criteo, { active: true, accountId: '67357' })

	m.clearStoreCache()
	plugins = []
	const off = await svc.getStoreByIdOrDomain()
	assert.equal(off.plugins.criteo.active, false)
})

test('the contact form sends the honeypot, so the engine is the one that drops a bot', async () => {
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test/', proxyPath: undefined, baseDomain: undefined })
	const sent = []
	const svc = new m.ContactService(async (url, init) => {
		sent.push(`${new URL(String(url)).pathname} ${init.body}`)
		return Response.json({ data: { status: 'new' } }, { status: 201 })
	})
	await svc.submitContactUsForm({ name: 'Asha', email: 'asha@example.com', message: 'Hello', subject: 'An order', website: 'http://spam.example' })
	await svc.submitContactUsForm({ name: 'Asha', email: 'asha@example.com', message: 'Hello' })
	assert.deepEqual(sent, [
		'/x/contact/messages {"name":"Asha","email":"asha@example.com","subject":"An order","body":"Hello","website":"http://spam.example"}',
		'/x/contact/messages {"name":"Asha","email":"asha@example.com","body":"Hello"}',
	])
})

test('each ad and analytics tag reaches the storefront with its ID only while it is on', async () => {
	m.clearStoreCache()
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test/', proxyPath: undefined, baseDomain: undefined })
	m.setStaticStore(() => ({ id: 'from_config', name: 'Shop', plugins: { facebookPixel: {} } }))
	let plugins = [
		{ key: 'meta-pixel', title: 'Meta pixel', settings: { pixel_id: '1234567890' } },
		{ key: 'microsoft-clarity', title: 'Microsoft Clarity', settings: { project_id: 'abcd1234ef' } },
		{ key: 'hotjar', title: 'Hotjar', settings: { site_id: '3712345' } },
		{ key: 'tiktok-pixel', title: 'TikTok pixel', settings: { pixel_id: 'C4ABCDEF' } },
		{ key: 'pinterest-tag', title: 'Pinterest tag', settings: { tag_id: '2612345678901' } },
		{ key: 'snapchat-pixel', title: 'Snap pixel', settings: { pixel_id: '6abc82ca-4a3a-4391-98ba-0317a8471234' } },
	]
	const svc = new m.StoreService(async (url) => {
		const path = new URL(String(url)).pathname
		if (path === '/api/checkout') return Response.json({ data: { currency: 'INR', methods: [] } })
		if (path === '/api/plugins') return Response.json({ data: plugins })
		return Response.json({ data: [] })
	})
	const tags = (store) => ({
		facebookPixel: store.plugins.facebookPixel,
		microsoftClarity: store.plugins.microsoftClarity,
		hotjar: store.plugins.hotjar,
		tiktokPixel: store.plugins.tiktokPixel,
		pinterestTag: store.plugins.pinterestTag,
		snapchatPixel: store.plugins.snapchatPixel,
	})
	assert.deepEqual(tags(await svc.getStoreByIdOrDomain()), {
		facebookPixel: { active: true, id: '1234567890' },
		microsoftClarity: { active: true, id: 'abcd1234ef' },
		hotjar: { active: true, id: '3712345' },
		tiktokPixel: { active: true, id: 'C4ABCDEF' },
		pinterestTag: { active: true, id: '2612345678901' },
		snapchatPixel: { active: true, id: '6abc82ca-4a3a-4391-98ba-0317a8471234' },
	})

	// Off on the engine, each is off here, whatever the static record says,
	// and carries no ID for a storefront to load by mistake.
	m.clearStoreCache()
	plugins = []
	for (const [name, tag] of Object.entries(tags(await svc.getStoreByIdOrDomain()))) {
		assert.deepEqual(tag, { active: false }, name)
	}
})

test('Google Analytics, Tag Manager and Ads reach the storefront in the shape it reads, only while set', async () => {
	m.clearStoreCache()
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test/', proxyPath: undefined, baseDomain: undefined })
	m.setStaticStore(() => ({ id: 'from_config', name: 'Shop', plugins: { googleTagManager: { id: 'GTM-STATIC', active: true } } }))
	let settings = { ga4_measurement_id: ' G-ABC123XYZ ', gtm_container_id: 'GTM-K9ZZ1', google_ads_id: 'AW-1234567890', conversion_label: 'AbC-dEf_1' }
	const svc = new m.StoreService(async (url) => {
		const path = new URL(String(url)).pathname
		if (path === '/api/checkout') return Response.json({ data: { currency: 'INR', methods: [] } })
		if (path === '/api/plugins') return Response.json({ data: settings ? [{ key: 'google-analytics', title: 'Google Analytics', settings }] : [] })
		return Response.json({ data: [] })
	})

	assert.deepEqual((await svc.getStoreByIdOrDomain()).plugins.googleTagManager, {
		active: true,
		tags: ['G-ABC123XYZ', 'AW-1234567890', 'GTM-K9ZZ1'],
		conversions: [{ event: 'purchase', label: 'AbC-dEf_1' }],
	})

	// GA4 alone: no Ads conversion to send.
	m.clearStoreCache()
	settings = { ga4_measurement_id: 'G-ABC123XYZ', gtm_container_id: '', google_ads_id: '', conversion_label: 'orphan' }
	assert.deepEqual((await svc.getStoreByIdOrDomain()).plugins.googleTagManager, {
		active: true,
		tags: ['G-ABC123XYZ'],
		conversions: [],
	})

	// The whole `send_to` Google Ads shows, pasted as the label, still names the conversion.
	m.clearStoreCache()
	settings = { ga4_measurement_id: '', gtm_container_id: '', google_ads_id: '', conversion_label: 'AW-1234567890/AbC-dEf_1' }
	assert.deepEqual((await svc.getStoreByIdOrDomain()).plugins.googleTagManager, {
		active: true,
		tags: ['AW-1234567890'],
		conversions: [{ event: 'purchase', label: 'AbC-dEf_1' }],
	})

	// Installed with nothing filled in, or not installed: off, with no ID to load by mistake,
	// whatever the static record says.
	for (const off of [{ ga4_measurement_id: ' ', gtm_container_id: '', google_ads_id: '' }, null]) {
		m.clearStoreCache()
		settings = off
		assert.deepEqual((await svc.getStoreByIdOrDomain()).plugins.googleTagManager, { active: false })
	}
})

test('a checkout from a browser where Meta’s pixel ran tells the engine so, and one without it does not', async () => {
	const local = {
		cart_id: 'cart_1',
		gocommerce_cart_cart_1: JSON.stringify({ shippingAddress: { firstName: 'Asha', email: 'a@example.com', address_1: '1 MG Road', city: 'Pune', zip: '411001', countryCode: 'IN' } }),
	}
	globalThis.window = {
		location: { origin: 'https://shop.test', pathname: '/checkout/payment', hostname: 'shop.test', href: 'https://shop.test/checkout/payment?email=a%40example.com' },
		navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile' },
		fbq() {},
		localStorage: {
			getItem: (k) => local[k] ?? null,
			setItem: (k, v) => {
				local[k] = v
			},
			removeItem: (k) => {
				delete local[k]
			},
		},
	}
	globalThis.document = { cookie: '_fbp=fb.1.1700000000000.1234567890; other=1; _fbc=fb.1.1700000000000.AbC' }
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test', proxyPath: undefined, baseDomain: undefined })
	const bodies = []
	const order = { id: 1, number: 'GC-1', status: 'confirmed', payment_status: 'pending', payment_provider: 'cod', currency: 'INR',
		total: { amount_minor: 1000, currency: 'INR' }, lines: [], address: {}, created_at: '', updated_at: '' }
	const svc = new m.CheckoutService(async (url, init) => {
		const path = new URL(String(url)).pathname
		if (path === '/api/carts/cart_1') return Response.json({ data: { id: 'cart_1', email: 'a@example.com', lines: [], currency: 'INR' } })
		if (path === '/api/checkout/cod') {
			bodies.push(JSON.parse(init.body))
			return Response.json({ data: { order, payment: { kind: 'none', provider: 'cod' } } })
		}
		return Response.json({ data: [] })
	})
	try {
		await svc.checkoutCOD({ cartId: 'cart_1' })
		assert.deepEqual(bodies[0].metadata, {
			meta_capi: {
				fbp: 'fb.1.1700000000000.1234567890',
				fbc: 'fb.1.1700000000000.AbC',
				client_user_agent: 'Mozilla/5.0 (Linux; Android 14) Mobile',
				// The page without its query, which can carry the shopper's details.
				event_source_url: 'https://shop.test/checkout/payment',
			},
		})

		// The cookie from an earlier visit, but no pixel on this page: the
		// shopper took the choice back, and the engine is told nothing.
		delete globalThis.window.fbq
		await svc.checkoutCOD({ cartId: 'cart_1' })
		assert.equal(bodies[1].metadata, undefined)

		// No _fbp: the pixel never ran here, refused or blocked.
		globalThis.window.fbq = () => {}
		globalThis.document.cookie = 'other=1'
		await svc.checkoutCOD({ cartId: 'cart_1' })
		assert.equal(bodies[2].metadata, undefined)
	} finally {
		delete globalThis.window
		delete globalThis.document
		m.BaseService.setCredentials({ apiUrl: undefined })
	}
})

test('a retry after a failed checkout keeps its key and body, though the pixel started in between', async () => {
	const local = {
		cart_id: 'cart_2',
		gocommerce_cart_cart_2: JSON.stringify({ shippingAddress: { firstName: 'Asha', email: 'a@example.com', address_1: '1 MG Road', city: 'Pune', zip: '411001', countryCode: 'IN' } }),
	}
	globalThis.window = {
		location: { origin: 'https://shop.test', pathname: '/checkout/payment', hostname: 'shop.test' },
		navigator: { userAgent: 'UA' },
		localStorage: {
			getItem: (k) => local[k] ?? null,
			setItem: (k, v) => {
				local[k] = v
			},
			removeItem: (k) => {
				delete local[k]
			},
		},
	}
	globalThis.document = { cookie: '' }
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test', proxyPath: undefined, baseDomain: undefined })
	const sent = []
	let fail = true
	const order = { id: 2, number: 'GC-2', status: 'confirmed', payment_status: 'pending', payment_provider: 'cod', currency: 'INR',
		total: { amount_minor: 1000, currency: 'INR' }, lines: [], address: {}, created_at: '', updated_at: '' }
	const svc = new m.CheckoutService(async (url, init) => {
		const path = new URL(String(url)).pathname
		if (path === '/api/carts/cart_2') return Response.json({ data: { id: 'cart_2', email: 'a@example.com', lines: [], currency: 'INR' } })
		if (path === '/api/checkout/cod') {
			sent.push({ key: init.headers['Idempotency-Key'], body: JSON.stringify(init.body) })
			if (fail) {
				fail = false
				return Response.json({ error: { code: 'internal', message: 'gateway timeout' } }, { status: 502 })
			}
			return Response.json({ data: { order, payment: { kind: 'none', provider: 'cod' } } })
		}
		return Response.json({ data: [] })
	})
	try {
		// No pixel on the first attempt; the shopper accepts the banner before retrying.
		await assert.rejects(svc.checkoutCOD({ cartId: 'cart_2' }))
		globalThis.window.fbq = () => {}
		globalThis.document.cookie = '_fbp=fb.1.1700000000000.42'
		await svc.checkoutCOD({ cartId: 'cart_2' })
		assert.equal(sent.length, 2)
		assert.equal(sent[1].key, sent[0].key, 'the retry resumes the first attempt')
		assert.equal(sent[1].body, sent[0].body, 'and sends exactly what it sent')
	} finally {
		delete globalThis.window
		delete globalThis.document
		m.BaseService.setCredentials({ apiUrl: undefined })
	}
})

test('a checkout carries where the shopper came from, as the storefront recorded it, and nothing stale', async () => {
	const now = Date.now()
	const ago = (days) => new Date(now - days * 86400000).toISOString()
	const local = {
		cart_id: 'cart_3',
		gocommerce_cart_cart_3: JSON.stringify({ shippingAddress: { firstName: 'Asha', email: 'a@example.com', address_1: '1 MG Road', city: 'Pune', zip: '411001', countryCode: 'IN' } }),
		gc_attribution: JSON.stringify({
			first: { utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'Launch', fbclid: 'IwAR1', at: ago(12) },
			last: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'Diwali', gclid: 'Cj0', referrer: 'www.google.com', at: ago(1), email: 'x@y.z' },
		}),
	}
	globalThis.window = {
		location: { origin: 'https://shop.test', pathname: '/checkout/payment', hostname: 'shop.test' },
		navigator: { userAgent: 'UA' },
		localStorage: {
			getItem: (k) => local[k] ?? null,
			setItem: (k, v) => {
				local[k] = v
			},
			removeItem: (k) => {
				delete local[k]
			},
		},
	}
	globalThis.document = { cookie: '' }
	m.BaseService.setCredentials({ apiUrl: 'http://engine.test', proxyPath: undefined, baseDomain: undefined })
	const bodies = []
	const order = { id: 3, number: 'GC-3', status: 'confirmed', payment_status: 'pending', payment_provider: 'cod', currency: 'INR',
		total: { amount_minor: 1000, currency: 'INR' }, lines: [], address: {}, created_at: '', updated_at: '' }
	const svc = new m.CheckoutService(async (url, init) => {
		const path = new URL(String(url)).pathname
		if (path === '/api/carts/cart_3') return Response.json({ data: { id: 'cart_3', email: 'a@example.com', lines: [], currency: 'INR' } })
		if (path === '/api/checkout/cod') {
			bodies.push(JSON.parse(init.body))
			return Response.json({ data: { order, payment: { kind: 'none', provider: 'cod' } } })
		}
		return Response.json({ data: [] })
	})
	try {
		await svc.checkoutCOD({ cartId: 'cart_3' })
		assert.deepEqual(bodies[0].metadata, {
			attribution: {
				first: { utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'Launch', fbclid: 'IwAR1', at: ago(12) },
				// Only the names the engine reads travel; anything else in storage stays there.
				last: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'Diwali', gclid: 'Cj0', referrer: 'www.google.com', at: ago(1) },
			},
		})

		// A first visit older than 30 days is forgotten, and the last one, still fresh, is the first
		// visit in the window too. A visit naming no source, or dated in the future, is none.
		local.gc_attribution = JSON.stringify({ first: { utm_source: 'old', at: ago(31) }, last: { utm_source: 'google', at: ago(2) } })
		await svc.checkoutCOD({ cartId: 'cart_3' })
		const google = { utm_source: 'google', at: ago(2) }
		assert.deepEqual(bodies[1].metadata, { attribution: { first: google, last: google } })
		local.gc_attribution = JSON.stringify({ first: { at: ago(1) }, last: { utm_source: 'x', at: ago(-5) } })
		await svc.checkoutCOD({ cartId: 'cart_3' })
		assert.equal(bodies[2].metadata, undefined)

		// Nothing recorded, or nothing readable: no attribution at all.
		local.gc_attribution = '{not json'
		await svc.checkoutCOD({ cartId: 'cart_3' })
		assert.equal(bodies[3].metadata, undefined)
	} finally {
		delete globalThis.window
		delete globalThis.document
		m.BaseService.setCredentials({ apiUrl: undefined })
	}
})
