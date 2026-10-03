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
