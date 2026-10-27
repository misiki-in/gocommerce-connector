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
	]) {
		assert.ok(m[name] !== undefined, `${name} is exported`)
	}
	assert.equal(m.connectorName, 'gocommerce')
	assert.equal(typeof m.BaseService.setCredentials, 'function')
	assert.equal(typeof m.setStaticStore, 'function')
	assert.equal(typeof m.serveRestLocally, 'function')
	assert.equal(typeof m.searchService.emptyResult().data.length, 'number', 'emptyResult is synchronous')
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
