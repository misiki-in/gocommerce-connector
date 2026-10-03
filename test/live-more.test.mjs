/**
 * The rest of the engine's shopper-facing surface, against a running engine:
 * variants and offers, attribute filters, the newsletter, menus by handle, a
 * wishlist's email, account extras, any-gateway checkout, and ext/b2b.
 *
 *   gocommerce serve -identity -wishlist -menus -newsletter -b2b
 *   GOCOMMERCE_URL=… GOCOMMERCE_ADMIN_TOKEN=… GOCOMMERCE_TEST_DB=… npm test
 *
 * GOCOMMERCE_TEST_DB lets the b2b suite mark its accounts' emails confirmed
 * (see harness.mjs); without it those tests skip.
 */
import { before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { RUN, store, jar, m, live, admin, mounted, canConfirm, confirmEmail } from './harness.mjs'

const seed = {}

const address = {
	id: 'new',
	firstName: 'Mary',
	lastName: 'Jackson',
	email: `mary-${RUN}@example.com`,
	phone: '+15550100',
	address_1: '1 Langley Way',
	city: 'Hampton',
	state: 'VA',
	zip: '23666',
	countryCode: 'US',
}

before(async () => {
	if (!live) return
	seed.mug = await admin('POST', '/api/admin/products', {
		slug: `more-mug-${RUN}`,
		title: `More mug ${RUN}`,
		status: 'active',
		description: 'One size.',
		sku: `MM-${RUN}`,
		price_minor: 1400,
		stock: 100,
	})
})

/** A fresh browser: no cart, no session, no kept tokens. */
function newBrowser() {
	store.clear()
	jar.clear()
}

/** A guest's bag with the mug in it and an address on it, ready to place. */
async function bagWithMug(qty = 1, email = address.email) {
	const mug = await m.productService.getOne(seed.mug.slug)
	const cart = await m.cartService.addToCart({ qty, productId: mug.id, variantId: mug.variants[0].id })
	await m.cartService.updateCart2({ email })
	await m.cartService.updateCart2({
		shippingAddress: { ...address, email },
		billingAddress: null,
		isBillingAddressSameAsShipping: true,
	})
	return { cart, mug }
}

// ---------------------------------------------------------------- catalogue

describe('variants and offers', { skip: !live }, () => {
	test('a product’s variants, one variant, and its offers, in the engine’s shapes', async () => {
		const list = await m.variantService.list(seed.mug.id)
		assert.equal(list.data.length, 1)
		const v = list.data[0]
		assert.equal(v.sku, `MM-${RUN}`)
		assert.equal(v.price.amount_minor, 1400)
		assert.equal(v.price.amount, 14, 'a major-unit amount rides beside the minor one')
		assert.equal((await m.variantService.getOne(v.id)).id, v.id)
		assert.ok(Array.isArray(await m.variantService.offers(v.id)), 'no vendors offer it, which is an empty list')
	})
})

describe('attribute filters', { skip: !live }, () => {
	test('?attributes.<handle>= reaches the engine and narrows the listing', async () => {
		const all = await m.searchService.searchWithUrl(new URL(`http://storefront.test/products?search=More mug ${RUN}`))
		assert.equal(all.count, 1)
		const none = await m.searchService.searchWithUrl(
			new URL(`http://storefront.test/products?search=More mug ${RUN}&attributes.material=unobtainium`),
		)
		assert.equal(none.count, 0, 'no product answers material=unobtainium')
	})
})

describe('menus (ext/navigation)', { skip: !live }, async () => {
	const on = live && (await mounted('/x/navigation/menus'))
	test('every menu by handle, and one in the storefront’s shape', { skip: !on }, async () => {
		const menus = await m.menuService.listMenus()
		assert.ok(
			menus.some((x) => x.handle === 'header'),
			'a store has a header menu from day one',
		)
		const header = await m.menuService.getMenu('header')
		assert.equal(header.menuId, 'header')
		assert.ok(Array.isArray(header.items))
	})
})

describe('newsletter (ext/newsletter)', { skip: !live }, async () => {
	const on = live && (await mounted('/x/newsletter/unsubscribe?token=x'))
	test('subscribe, twice without error, and the storefront’s box reaches it too', { skip: !on }, async () => {
		const email = `news-${RUN}@example.com`
		assert.equal((await m.newsletterService.subscribe({ email, source: 'test' })).status, 'subscribed')
		assert.equal((await m.newsletterService.subscribe({ email })).status, 'subscribed', 'idempotent')
		assert.equal((await m.storeService.post('/api/newsletter/subscribe', { email })).status, 'subscribed')
		assert.equal((await m.newsletterService.unsubscribe('not-a-token')).status, 'unsubscribed', 'never reveals a match')
	})
})

// ---------------------------------------------------------------- checkout with any gateway

describe('any-gateway checkout', { skip: !live }, () => {
	test('checkout(code) answers what to do next; listMethods names every gateway', async () => {
		newBrowser()
		const { methods } = await m.checkoutService.listMethods()
		assert.ok(methods.some((x) => x.code === 'cod'))
		await bagWithMug(2)
		const res = await m.checkoutService.checkout('cod')
		assert.match(res.orderNo, /\w+-\d+/)
		assert.equal(res.payment.kind, 'none', 'cash on delivery: nothing to pay now')
		assert.equal(res.order.total, 28)
		assert.equal((await m.orderService.getOrder(res.orderNo)).orderNo, res.orderNo)
	})
})

// ---------------------------------------------------------------- accounts

describe('account extras (ext/identity)', { skip: !live }, async () => {
	const on = live && (await mounted('/x/identity/me'))

	test('a guest order is claimed into the account explicitly, and only then', { skip: !on }, async () => {
		newBrowser()
		await bagWithMug(1)
		const { order_no } = await m.checkoutService.checkoutCOD({})
		await m.userService.signup({
			email: `claim-${RUN}@example.com`,
			password: 'correct horse battery',
			firstName: 'Kat',
		})
		assert.ok(!(await m.orderService.list({})).data.some((o) => o.orderNo === order_no), 'signing in claims nothing')
		const claimed = await m.userService.claimOrder({ number: order_no })
		assert.equal(claimed.orderNo, order_no)
		assert.ok((await m.orderService.list({})).data.some((o) => o.orderNo === order_no))
	})

	test('a confirmation mail on request, and a session refreshed in place', { skip: !on }, async () => {
		assert.equal((await m.userService.requestEmailVerification()).accepted, true)
		const me = await m.userService.refreshSession()
		assert.equal(me.email, `claim-${RUN}@example.com`)
		assert.ok(jar.has('connect.sid'))
	})
})

describe('wishlist email (ext/wishlist)', { skip: !live }, async () => {
	const on = live && (await mounted('/x/wishlist/none'))
	test('an address for back-in-stock mail, and taking it off', { skip: !on }, async () => {
		newBrowser()
		assert.equal((await m.wishlistService.setEmail(`wish-${RUN}@example.com`)).email, `wish-${RUN}@example.com`)
		assert.equal((await m.wishlistService.setEmail('')).email, null)
	})
})

// ---------------------------------------------------------------- ext/b2b

describe('buying for a business (ext/b2b)', { skip: !live }, async () => {
	const on = live && canConfirm && (await mounted('/x/b2b/me'))
	const boss = `boss-${RUN}@example.com`
	const buyer = `buyer-${RUN}@example.com`
	const password = 'correct horse battery'
	const as = async (email) => {
		newBrowser()
		await m.userService.login({ email, password })
	}
	const b2b = {}

	before(async () => {
		if (!on) return
		for (const email of [boss, buyer]) {
			newBrowser()
			await m.userService.signup({ email, password, firstName: email.split('-')[0] })
			confirmEmail(email)
		}
		// A company with an account: 1,000.00 of credit, buyers need approval over 20.00.
		b2b.company = await admin('POST', '/api/admin/x/b2b/companies', {
			name: `Acme ${RUN}`,
			credit_limit_minor: 100000,
			approval_threshold_minor: 2000,
		})
		await admin('POST', `/api/admin/x/b2b/companies/${b2b.company.id}/members`, { email: boss, role: 'admin' })
		await admin('POST', `/api/admin/x/b2b/companies/${b2b.company.id}/members`, { email: buyer, role: 'buyer' })
	})

	test('a consumer account is told it buys for no company', { skip: !on }, async () => {
		newBrowser()
		await m.userService.signup({ email: `consumer-${RUN}@example.com`, password, firstName: 'Con' })
		await assert.rejects(m.b2bService.me(), (e) => e.status === 403)
	})

	test('the company, the role, the credit — and none of the store’s own notes', { skip: !on }, async () => {
		await as(boss)
		const me = await m.b2bService.me()
		assert.equal(me.role, 'admin')
		assert.equal(me.company.name, `Acme ${RUN}`)
		assert.equal(me.credit.limit.amount_minor, 100000)
		assert.equal('notes' in me.company, false)
		assert.equal((await m.b2bService.members()).length, 2)
	})

	test('an admin invites, sees, and withdraws an invitation', { skip: !on }, async () => {
		await as(boss)
		const inv = await m.b2bService.invite({ email: `new-${RUN}@example.com`, role: 'buyer' })
		assert.ok((await m.b2bService.invitations()).some((i) => i.id === inv.id))
		await m.b2bService.withdrawInvitation(inv.id)
		assert.ok(!(await m.b2bService.invitations()).some((i) => i.id === inv.id))
	})

	test('a quick order by SKU reports the lines that would not go in', { skip: !on }, async () => {
		await as(buyer)
		const res = await m.b2bService.addLines({
			lines: [
				{ sku: `MM-${RUN}`, quantity: 2 },
				{ sku: `NOPE-${RUN}`, quantity: 1 },
			],
		})
		assert.equal(res.cart.qty, 2)
		assert.equal(localStorage.getItem('cart_id'), res.cart.id, 'the bag is remembered where the storefront looks')
		assert.deepEqual(
			res.rejected.map((r) => r.reason),
			['not_found'],
		)
		b2b.buyerCart = res.cart.id
	})

	test(
		'a buyer over the threshold asks for approval; an admin approves it onto the account',
		{ skip: !on },
		async () => {
			// A new browser session for the same buyer: the bag is named, not remembered.
			await as(buyer)
			await m.cartService.updateCart2({
				cartId: b2b.buyerCart,
				shippingAddress: address,
				billingAddress: null,
				isBillingAddressSameAsShipping: true,
			})
			const asked = await m.b2bService.checkout({ cartId: b2b.buyerCart, poNumber: `PO-${RUN}` })
			assert.equal(asked.kind, 'approval', '28.00 is over the 20.00 threshold')
			assert.equal(asked.approval.status, 'pending')

			await as(boss)
			const pending = await m.b2bService.approvals({ status: 'pending' })
			assert.ok(pending.data.some((a) => a.id === asked.approval.id))
			const done = await m.b2bService.approve(asked.approval.id)
			assert.equal(done.approval.status, 'approved')
			assert.equal(done.payment.provider, 'on_account')
			b2b.order = done
			const ledger = await m.b2bService.orders({ q: `PO-${RUN}` })
			assert.ok(ledger.data.some((o) => o.number === done.orderNo && o.on_account))
		},
	)

	test('a buyer withdraws their own request', { skip: !on }, async () => {
		await as(buyer)
		await m.b2bService.addLines({ lines: [{ sku: `MM-${RUN}`, quantity: 3 }] })
		await m.cartService.updateCart2({
			shippingAddress: address,
			billingAddress: null,
			isBillingAddressSameAsShipping: true,
		})
		const asked = await m.b2bService.checkout({ poNumber: `PO2-${RUN}` })
		assert.equal(asked.kind, 'approval')
		assert.equal((await m.b2bService.cancelApproval(asked.approval.id)).status, 'cancelled')
	})

	test('a repeat order fills a new bag at today’s prices', { skip: !on }, async () => {
		await as(boss)
		const res = await m.b2bService.reorder(b2b.order.order.id)
		assert.equal(res.cart.qty, 2)
		assert.deepEqual(res.rejected, [])
	})

	test('a quote is requested, then declined', { skip: !on }, async () => {
		await as(buyer)
		const mug = await m.productService.getOne(seed.mug.slug)
		const q = await m.b2bService.requestQuote({
			lines: [{ variantId: mug.variants[0].id, quantity: 50 }],
			note: 'bulk',
		})
		assert.equal(q.status, 'requested')
		assert.equal((await m.b2bService.quote(q.id)).id, q.id)
		assert.ok((await m.b2bService.quotes({})).data.some((x) => x.id === q.id))
		assert.equal((await m.b2bService.declineQuote(q.id)).status, 'declined')
	})

	test('an admin changes a buyer’s role', { skip: !on }, async () => {
		await as(boss)
		const member = (await m.b2bService.members()).find((x) => x.email === buyer)
		assert.equal((await m.b2bService.setMemberRole(member.customer_id, 'approver')).role, 'approver')
	})

	test('the public dealer form answers the same whoever gets it; a dealer reads its leads', { skip: !on }, async () => {
		newBrowser()
		const res = await m.b2bService.submitLead({
			email: `lead-${RUN}@example.com`,
			country: 'US',
			message: 'Do you deliver?',
		})
		assert.equal(res.accepted, true)
		await as(boss)
		assert.ok(Array.isArray((await m.b2bService.leads({})).data))
	})
})
