/**
 * The connector against a running GoCommerce engine.
 *
 * Not mocked: a connector is a translation between two systems, and a mock of
 * one tests the translation against an idea of the engine rather than the
 * engine — which is exactly what is wrong when a connector is wrong. It seeds
 * what it needs through the admin API, under names unique to the run, so it
 * can share a store with anything else.
 *
 *   GOCOMMERCE_URL=http://127.0.0.1:8080 GOCOMMERCE_ADMIN_TOKEN=dev-token npm test
 *
 * Start the engine with the storefront modules for the whole suite:
 *
 *   gocommerce serve -identity -wishlist -reviews -cms -faq -menus
 *
 * A module the engine was built without skips its tests rather than failing
 * them; with no engine at all, the suite skips and says so.
 */
import { before, describe, test } from 'node:test'
import assert from 'node:assert/strict'

const BASE = (process.env.GOCOMMERCE_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '')
const TOKEN = process.env.GOCOMMERCE_ADMIN_TOKEN ?? ''
const RUN = Date.now().toString(36)

// ---------------------------------------------------------------- a browser, minus the browser
//
// The connector keeps the cart id, the session and order tokens in the
// shopper's browser. Node has none, so the suite gives it the three globals it
// reads — the engine is still the real one.

const store = new Map()
globalThis.localStorage = {
	getItem: (k) => (store.has(k) ? store.get(k) : null),
	setItem: (k, v) => store.set(k, String(v)),
	removeItem: (k) => store.delete(k),
	clear: () => store.clear(),
}
const jar = new Map()
globalThis.document = {
	get cookie() {
		return [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
	},
	set cookie(line) {
		const [pair, ...attrs] = line.split(';')
		const at = pair.indexOf('=')
		const name = pair.slice(0, at).trim()
		const expired = attrs.some((a) => /expires=Thu, 01 Jan 1970/i.test(a))
		if (expired) jar.delete(name)
		else jar.set(name, pair.slice(at + 1).trim())
	},
}
globalThis.window = { localStorage: globalThis.localStorage, location: { origin: 'http://storefront.test' } }

const m = await import('../dist/index.js')
m.BaseService.setCredentials({ apiUrl: BASE })
m.setStaticStore(() => ({ id: 'from_config', name: 'Test shop', currency: { code: 'USD', symbol: '$' }, plugins: {} }))

let live = false
try {
	live = (await fetch(`${BASE}/health`)).ok && Boolean(TOKEN)
} catch {
	live = false
}
if (!live) console.log(`\n  ! no engine at ${BASE} (or no GOCOMMERCE_ADMIN_TOKEN) — the live tests are skipped\n`)

async function admin(method, path, body) {
	const res = await fetch(BASE + path, {
		method,
		headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	})
	const json = await res.json().catch(() => ({}))
	if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`)
	return json.data
}

/** Whether a module's routes are mounted: an absent module answers "no route for". */
async function mounted(path) {
	const res = await fetch(BASE + path)
	const body = await res.json().catch(() => ({}))
	return !(res.status === 404 && /no route/i.test(body?.error?.message ?? ''))
}

const seed = {}

before(async () => {
	if (!live) return
	const parent = await admin('POST', '/api/admin/categories', { slug: `conn-${RUN}`, title: `Connector ${RUN}` })
	const child = await admin('POST', '/api/admin/categories', {
		slug: `conn-${RUN}-tees`,
		title: 'Tees',
		parent_id: parent.id,
	})
	seed.parent = parent
	seed.child = child
	seed.tee = await admin('POST', '/api/admin/products', {
		slug: `conn-tee-${RUN}`,
		title: `Connector tee ${RUN}`,
		status: 'active',
		description: 'A tee for the connector suite.',
		category_id: child.id,
		options: [{ name: 'Size', values: ['M', 'L'] }],
		variants: [
			{ sku: `CT-M-${RUN}`, price_minor: 2500, options: ['M'], stock_on_hand: 10 },
			{ sku: `CT-L-${RUN}`, price_minor: 2500, compare_at_price_minor: 3000, options: ['L'], stock_on_hand: 2 },
		],
	})
	seed.mug = await admin('POST', '/api/admin/products', {
		slug: `conn-mug-${RUN}`,
		title: `Connector mug ${RUN}`,
		status: 'active',
		description: 'One size.',
		sku: `CM-${RUN}`,
		price_minor: 1400,
		stock: 40,
	})
	seed.code = `CONN${RUN}`.toUpperCase()
	await admin('POST', '/api/admin/discounts', {
		code: seed.code,
		title: 'Connector 5 off',
		kind: 'fixed',
		value_minor: 500,
		scope: 'order',
	})
})

const address = {
	id: 'new',
	firstName: 'Ada',
	lastName: 'Lovelace',
	email: `ada-${RUN}@example.com`,
	phone: '+441234567890',
	address_1: '1 Analytical Way',
	city: 'London',
	zip: 'N1 1AA',
	countryCode: 'GB',
}

// ---------------------------------------------------------------- catalogue

describe('catalogue', { skip: !live }, () => {
	test('a product page, by slug, with its breadcrumb', async () => {
		const p = await m.productService.getOne(seed.tee.slug)
		assert.equal(p.id, String(seed.tee.id))
		assert.equal(p.price, 25)
		assert.equal(p.variants.length, 2)
		const large = p.variants.find((v) => v.sku === `CT-L-${RUN}`)
		assert.equal(large.mrp, 30, 'compare-at is the struck-through price')
		assert.equal(large.stock, 2)
		assert.deepEqual(
			p.categoryHierarchy.map((c) => c.slug),
			[seed.parent.slug, seed.child.slug],
		)
	})

	test('a product page, by numeric id or SKU, for links that arrive that way', async () => {
		assert.equal((await m.productService.getOne(String(seed.mug.id))).slug, seed.mug.slug)
		assert.equal((await m.productService.getOne(`CM-${RUN}`)).slug, seed.mug.slug)
	})

	test('a missing product is a 404', async () => {
		await assert.rejects(m.productService.getOne(`nope-${RUN}`), (e) => e.status === 404)
	})

	test('a search finds by title, with the engine’s own count', async () => {
		const res = await m.productService.list({ search: `Connector mug ${RUN}` })
		assert.equal(res.count, 1)
		assert.equal(res.data[0].slug, seed.mug.slug)
	})

	test('a category page sells its descendants, and knows where it is', async () => {
		const res = await m.searchService.searchWithUrl(new URL('http://storefront.test/x'), seed.parent.slug)
		assert.ok(
			res.data.some((p) => p.slug === seed.tee.slug),
			'the parent sells the child’s products',
		)
		assert.deepEqual(
			res.categoryHierarchy.map((c) => c.slug),
			[seed.parent.slug],
		)
	})

	test('an unknown category is an empty result, which the storefront turns into its 404', async () => {
		const res = await m.searchService.searchWithUrl(new URL('http://storefront.test/x'), `nope-${RUN}`)
		assert.deepEqual(res.data, [])
		assert.deepEqual(res.categoryHierarchy, [])
	})

	test('the category tree, flat, each naming its parent', async () => {
		m.clearStoreCache()
		const res = await m.categoryService.get('/api/categories/all')
		const child = res.data.find((c) => c.slug === seed.child.slug)
		assert.equal(child.parentCategoryId, String(seed.parent.id))
	})

	test('the store record carries the engine’s currency over the static one', async () => {
		const ready = await (await fetch(`${BASE}/health/ready`)).json()
		const s = await m.storeService.getStoreByIdOrDomain({ domain: 'storefront.test' })
		assert.equal(s.id, 'from_config')
		assert.equal(s.currency.code, ready.data.currency)
	})
})

// ---------------------------------------------------------------- a guest's whole sale

describe('a guest sale', { skip: !live }, () => {
	test('bag → address → coupon → cash on delivery → order → empty bag', async () => {
		store.clear()
		const tee = await m.productService.getOne(seed.tee.slug)
		const medium = tee.variants.find((v) => v.sku === `CT-M-${RUN}`)

		let cart = await m.cartService.addToCart({
			cartId: '',
			lineId: null,
			qty: 1,
			productId: tee.id,
			variantId: medium.id,
		})
		assert.ok(cart.id, 'a cart was opened')
		assert.equal(localStorage.getItem('cart_id'), cart.id, 'and remembered where the storefront looks')
		assert.equal(cart.lineItems[0].variantId, medium.id)
		assert.equal(cart.lineItems[0].slug, seed.tee.slug)

		cart = await m.cartService.addToCart({
			cartId: cart.id,
			lineId: cart.lineItems[0].id,
			qty: 1,
			productId: tee.id,
			variantId: medium.id,
		})
		assert.equal(cart.lineItems[0].qty, 2, 'qty on add is a change, not a total')

		cart = await m.cartService.updateCart({ cartId: cart.id, lineId: cart.lineItems[0].id, qty: 3 })
		assert.equal(cart.qty, 3)
		assert.equal(cart.subtotal, 75)

		cart = await m.cartService.applyCoupon({ cartId: cart.id, couponCode: seed.code })
		assert.equal(cart.couponCode, seed.code)
		assert.equal(cart.discountAmount, 5)
		assert.equal(cart.total, 70)

		await assert.rejects(m.cartService.applyCoupon({ cartId: cart.id, couponCode: `NOPE${RUN}` }), /discount/i)

		cart = await m.cartService.updateCart2({ email: address.email, phone: address.phone })
		assert.equal(cart.email, address.email)
		cart = await m.cartService.updateCart2({
			shippingAddress: address,
			billingAddress: null,
			isBillingAddressSameAsShipping: true,
		})
		assert.ok(cart.shippingAddress && cart.shippingAddressId, 'the payment step needs both')

		const rates = await m.checkoutService.getShippingRates({ cartId: cart.id })
		assert.ok(Array.isArray(rates.data))
		if (rates.data.length)
			cart = await m.cartService.updateShippingRate({ cartId: cart.id, shippingRateId: rates.data[0].id })

		const methods = await m.paymentMethodService.list({})
		assert.ok(
			methods.data.some((p) => p.code === 'COD'),
			'cash on delivery is always installed',
		)

		const placed = await m.checkoutService.checkoutCOD({ cartId: cart.id, origin: 'http://storefront.test' })
		assert.match(placed.order_no, /\w+-\d+/)
		seed.guestOrder = { number: placed.order_no, cartId: cart.id }

		const after = await m.cartService.refereshCart()
		assert.deepEqual(after.lineItems, [], 'the success page empties the bag on this')

		const found = await m.orderService.listOrdersByParent({ orderNo: placed.order_no, cartId: cart.id })
		assert.equal(found.data.length, 1)
		const order = found.data[0]
		assert.equal(order.orderNo, placed.order_no)
		assert.equal(order.paymentMethod, 'COD')
		assert.equal(order.discount, 5)
		assert.equal(order.lineItems[0].qty, 3)
		assert.equal(order.shippingAddress.firstName, 'Ada')
	})

	test('an order from another browser is not readable from this one', async () => {
		// Another browser: none of the access tokens the sale above kept.
		store.clear()
		const { number, cartId } = seed.guestOrder
		const res = await m.orderService.listOrdersByParent({ orderNo: number, cartId })
		assert.deepEqual(res.data, [])
	})

	test('stock the engine does not have is refused with its own message', async () => {
		store.clear()
		const tee = await m.productService.getOne(seed.tee.slug)
		const large = tee.variants.find((v) => v.sku === `CT-L-${RUN}`)
		await assert.rejects(
			m.cartService.addToCart({ qty: 5, productId: tee.id, variantId: large.id }),
			(e) => e.status === 409 && /left/.test(e.message),
		)
	})
})

// ---------------------------------------------------------------- accounts

describe('accounts (ext/identity)', { skip: !live }, async () => {
	const on = live && (await mounted('/x/identity/me'))
	const email = `shopper-${RUN}@example.com`

	test('sign up, and the storefront’s cookies say so', { skip: !on }, async () => {
		store.clear()
		jar.clear()
		const me = await m.userService.signup({
			email,
			password: 'correct horse battery',
			firstName: 'Grace',
			lastName: 'Hopper',
		})
		assert.equal(me.role, 'USER')
		assert.ok(me.userId)
		assert.ok(jar.has('connect.sid'))
		const cookie = JSON.parse(decodeURIComponent(jar.get('me')))
		assert.equal(cookie.email, email)
		assert.equal(cookie.firstName, 'Grace')
	})

	test('the address book: add, edit, list, delete', { skip: !on }, async () => {
		const saved = await m.addressService.saveAddress({ ...address, id: 'new' })
		assert.ok(saved.id)
		const edited = await m.addressService.saveAddress({ ...saved, city: 'Cambridge' })
		assert.equal(edited.city, 'Cambridge')
		const list = await m.addressService.list({ page: 1 })
		assert.ok(list.data.some((a) => a.id === saved.id))
		await m.addressService.deleteAddress(saved.id)
		assert.ok(!(await m.addressService.list({ page: 1 })).data.some((a) => a.id === saved.id))
	})

	test('a signed-in order joins the account', { skip: !on }, async () => {
		const mug = await m.productService.getOne(seed.mug.slug)
		const cart = await m.cartService.addToCart({ qty: 1, productId: mug.id, variantId: mug.variants[0].id })
		await m.cartService.updateCart2({ email })
		await m.cartService.updateCart2({
			shippingAddress: address,
			billingAddress: null,
			isBillingAddressSameAsShipping: true,
		})
		const placed = await m.checkoutService.checkoutCOD({ cartId: cart.id })
		const mine = await m.orderService.list({ page: 1 })
		assert.ok(mine.data.some((o) => o.orderNo === placed.order_no))
		const again = await m.orderService.buyAgain()
		assert.ok(again.some((l) => l.slug === seed.mug.slug))
	})

	test('a wrong password is refused, and signing out clears the cookies', { skip: !on }, async () => {
		await assert.rejects(m.userService.login({ email, password: 'wrong password' }), (e) => e.status === 400)
		const back = await m.userService.login({ email, password: 'correct horse battery' })
		assert.equal(back.email, email)
		assert.equal(await m.userService.logout(), null)
		assert.ok(!jar.has('me') && !jar.has('connect.sid'))
		await assert.rejects(m.userService.getMe(), (e) => e.status === 401)
	})
})

// ---------------------------------------------------------------- other modules

describe('wishlist (ext/wishlist)', { skip: !live }, async () => {
	const on = live && (await mounted('/x/wishlist/none'))
	test('toggle on, check, list, toggle off', { skip: !on }, async () => {
		store.clear()
		const id = String(seed.mug.id)
		assert.equal((await m.wishlistService.toggleWishlist({ productId: id })).active, true)
		assert.equal(await m.wishlistService.checkWishlist({ productId: id }), true)
		const list = await m.wishlistService.fetchWishlist({})
		assert.equal(list.data[0].product.slug, seed.mug.slug)
		assert.equal((await m.wishlistService.toggleWishlist({ productId: id })).active, false)
		assert.equal(await m.wishlistService.checkWishlist({ productId: id }), false)
	})
})

describe('reviews (ext/reviews)', { skip: !live }, async () => {
	const on = live && (await mounted(`/x/reviews?product_id=1`))
	test('a signed-in shopper reviews; the product page lists approved reviews', { skip: !on }, async () => {
		jar.set('me', encodeURIComponent(JSON.stringify({ email: `reviewer-${RUN}@example.com`, firstName: 'Rev' })))
		const res = await m.productService.addReview({ productId: String(seed.mug.id), rating: 5, review: 'Holds tea.' })
		assert.match(res.status, /pending|approved/)
		const page = await m.reviewService.fetchReviews({ productId: String(seed.mug.id) })
		assert.ok(Array.isArray(page.data))
		jar.delete('me')
	})
})

describe('content (ext/cms, ext/faq, ext/navigation)', { skip: !live }, async () => {
	const cms = live && (await mounted('/x/cms/pages'))
	const faq = live && (await mounted('/x/faq'))
	const menus = live && (await mounted('/x/navigation/menus'))

	test('pages list, and a missing page is a 404', { skip: !cms }, async () => {
		assert.ok(Array.isArray((await m.pageService.list({})).data))
		await assert.rejects(m.pageService.getOne(`nope-${RUN}`), (e) => e.status === 404)
	})

	test('the FAQ, flattened', { skip: !faq }, async () => {
		const res = await m.faqService.listFaqs({})
		assert.ok(Array.isArray(res.data))
	})

	test('the header menu, in the storefront’s shape', { skip: !menus }, async () => {
		m.clearStoreCache()
		const res = await m.menuService.list()
		assert.ok(Array.isArray(res.data))
		for (const menu of res.data) assert.ok(['header', 'footer'].includes(menu.menuId))
	})
})
