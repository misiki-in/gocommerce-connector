import type { Address, Cart, CheckoutResult, ListMeta, Order, PaymentIntent } from '../engine'
import type { Money } from '../money'
import { GoCommerceError } from '../errors'
import { toCart, toEngineAddress, toOrder } from '../map'
import { cartExtras, rememberCartId, rememberOrder, storedCartId, type StorefrontAddress } from '../browser'
import { BaseService } from './base.service'

// ---------------------------------------------------------------- ext/b2b shapes

export type B2bRole = 'admin' | 'approver' | 'buyer'

export type Company = {
	id: number
	code: string
	name: string
	tax_id: string
	status: 'active' | 'on_hold' | 'closed'
	group_id: number | null
	/** `null`: no account with the store — the company pays up front. */
	credit_limit: Money | null
	net_days: number
	/** `null`: a buyer never needs approval. */
	approval_threshold: Money | null
	require_po: boolean
	member_count: number
	/** More than 0: the company is a dealer, and receives leads. */
	territory_count: number
	created_at: string
	updated_at: string
}

export type Credit = {
	limit: Money | null
	outstanding: Money
	available: Money | null
	overdue: Money
	overdue_orders: number
	net_days: number
}

export type Member = {
	company_id: number
	customer_id: number
	email: string
	confirmed: boolean
	name: string
	role: B2bRole
	created_at: string
}

export type Invitation = {
	id: number
	company_id: number
	email: string
	role: B2bRole
	invited_by: string
	expires_at: string
	accepted_at?: string
	created_at: string
}

export type CompanyOrder = {
	order_id: number
	number: string
	status: string
	payment_status: string
	total: Money
	po_number: string
	placed_by: string
	on_account: boolean
	due_at?: string
	overdue: boolean
	company_id: number
	company_name: string
	approval_id?: number
	quote_id?: number
	created_at: string
}

export type Approval = {
	id: number
	company_id: number
	kind: 'cart' | 'quote'
	quote_id?: number
	status: 'pending' | 'placing' | 'approved' | 'rejected' | 'cancelled'
	requested_by: number
	requested_by_email: string
	lines: { variant_id: number; sku: string; quantity: number; unit_price: Money }[]
	subtotal: Money
	total: Money
	payment_method: string
	po_number: string
	decided_by?: number
	decided_at?: string
	reason?: string
	last_error?: string
	order_id?: number
	order_number?: string
	created_at: string
	updated_at: string
}

export type Quote = {
	id: number
	number: string
	company_id: number
	company_name: string
	status: 'requested' | 'quoted' | 'awaiting_approval' | 'accepted' | 'declined' | 'expired'
	requested_by: number
	requested_by_email: string
	note: string
	reply: string
	declined_by?: string
	lines: { variant_id: number; sku: string; title: string; quantity: number; unit_price: Money | null }[]
	total: Money | null
	expires_at?: string
	quoted_at?: string
	accepted_at?: string
	order_id?: number
	order_number?: string
	created_at: string
	updated_at: string
}

export type Lead = {
	id: number
	name: string
	email: string
	phone: string
	message: string
	country: string
	state: string
	postal_code: string
	variant_id: number | null
	product_id: number | null
	product_title?: string
	variant_sku?: string
	status: 'new' | 'contacted' | 'won' | 'lost'
	company_id: number | null
	company_name?: string
	routed_by: 'territory' | 'store' | 'unrouted'
	source: string
	created_at: string
	updated_at: string
}

export type RejectedLine = {
	sku: string
	variant_id: number | null
	quantity: number
	reason: 'not_found' | 'inactive' | 'insufficient_stock' | 'invalid'
	message: string
}

type Paged<T> = { data: T[]; meta?: ListMeta }

type PlaceOptions = {
	/** An engine payment code; omitted, the company's account (`on_account`) when it has one. */
	paymentMethod?: string
	/** Required when the company says so (`company.require_po`). */
	poNumber?: string
	name?: string
	phone?: string
	/** Defaults to the address the checkout's address step kept for this cart. */
	address?: StorefrontAddress | Address
}

/** A checkout or quote acceptance either placed an order or, for a buyer over the limit, asked for approval. */
export type B2bPlaced =
	| { kind: 'order'; orderNo: string; order: ReturnType<typeof toOrder>; payment: PaymentIntent }
	| { kind: 'approval'; approval: Approval }

/**
 * Buying for a business (ext/b2b): a company with buyers in roles, orders on
 * account against a credit limit, approvals, quotes, a quick order by SKU, a
 * repeat order, and a dealer's leads.
 *
 * Every call but `submitLead` needs a signed-in shopper (ext/identity) who is
 * a member of a company; a signed-in account that is not answers 403, so
 * `me()` is how a storefront tells a business account from a consumer one.
 * Answers are the engine's own shapes — numeric ids, money as
 * `{ amount_minor, currency }` — except carts, which come back as the
 * storefront's bag so a quick-order page can hand them straight to it.
 */
export class B2bService extends BaseService {
	// ------------------------------------------------------------ company

	/** The company, the caller's role in it, and its credit: limit, outstanding, available, overdue. */
	async me() {
		const me = await this.data<{
			company: Company & { notes?: string; metadata?: unknown }
			role: B2bRole
			credit: Credit
		}>('/x/b2b/me', { auth: true })
		// The engine answers the store's own notes on the company to its buyers;
		// they are not this storefront's to show.
		const { notes: _notes, metadata: _metadata, ...company } = me.company
		return { company: company as Company, role: me.role, credit: me.credit }
	}

	async members() {
		return (await this.data<Member[] | null>('/x/b2b/members', { auth: true })) ?? []
	}

	/** Admin only. Demoting the last admin is refused (409). */
	async setMemberRole(customerId: number | string, role: B2bRole) {
		return this.data<Member>(`/x/b2b/members/${id(customerId)}`, { method: 'PATCH', auth: true, body: { role } })
	}

	/** An admin removes anyone; any member may remove themselves. */
	async removeMember(customerId: number | string) {
		await this.engine(`/x/b2b/members/${id(customerId)}`, { method: 'DELETE', auth: true })
	}

	// ------------------------------------------------------------ invitations

	/** Admin only. Open invitations: not accepted, not expired. */
	async invitations() {
		return (await this.data<Invitation[] | null>('/x/b2b/invitations', { auth: true })) ?? []
	}

	/** Admin only. Emails a link; a second invitation to the same address replaces the first. */
	async invite({ email, role }: { email: string; role: B2bRole }) {
		return this.data<Invitation>('/x/b2b/invitations', {
			method: 'POST',
			auth: true,
			body: { email: String(email ?? '').trim(), role },
		})
	}

	async withdrawInvitation(invitationId: number | string) {
		await this.engine(`/x/b2b/invitations/${id(invitationId)}`, { method: 'DELETE', auth: true })
	}

	/**
	 * The token from the invitation email, accepted by the account it was sent
	 * to — which also confirms that account's email address.
	 */
	async acceptInvitation(token: string) {
		return this.data<Member>('/x/b2b/invitations/accept', {
			method: 'POST',
			auth: true,
			body: { token: String(token ?? '').trim() },
		})
	}

	// ------------------------------------------------------------ filling a basket

	/**
	 * A quick order: up to 500 lines by SKU or variant id, into the bag (or a new
	 * one), at the company's prices. A line that will not go in is reported in
	 * `rejected` with its reason; the rest are added.
	 */
	async addLines({
		cartId,
		lines,
	}: {
		cartId?: string
		lines: { sku?: string; variantId?: number | string; quantity: number }[]
	}) {
		const res = await this.data<{ cart: Cart; rejected: RejectedLine[] | null }>('/x/b2b/cart/lines', {
			method: 'POST',
			auth: true,
			body: {
				...((cartId ?? storedCartId()) ? { cart_id: cartId ?? storedCartId() } : {}),
				lines: (lines ?? []).map((l) => ({
					...(l.variantId ? { variant_id: Number(l.variantId) } : {}),
					...(l.sku ? { sku: String(l.sku).trim() } : {}),
					quantity: Number(l.quantity),
				})),
			},
		})
		rememberCartId(res.cart.id)
		return { cart: toCart(res.cart, cartExtras(res.cart.id)), rejected: res.rejected ?? [] }
	}

	/** A past order's lines in a new bag, at today's prices. Nothing is placed. */
	async reorder(orderId: number | string) {
		const res = await this.data<{ cart: Cart; rejected: RejectedLine[] | null }>(
			`/x/b2b/orders/${id(orderId)}/reorder`,
			{
				method: 'POST',
				auth: true,
			},
		)
		rememberCartId(res.cart.id)
		return { cart: toCart(res.cart, cartExtras(res.cart.id)), rejected: res.rejected ?? [] }
	}

	// ------------------------------------------------------------ placing an order

	/**
	 * Places the bag through the company: on account by default, with a PO
	 * number, optionally only some lines (`lineIds`). A buyer over the company's
	 * approval threshold gets `{ kind: 'approval' }` instead of an order — the
	 * bag stays as it was, and an approver places it later.
	 *
	 * Over the credit limit is 403 `credit_limit_exceeded`; `me().credit` says
	 * how much is available before the shopper tries.
	 */
	async checkout({
		cartId,
		lineIds,
		shippingRateId,
		returnUrl,
		paymentData,
		...opts
	}: PlaceOptions & {
		cartId?: string
		lineIds?: (number | string)[]
		shippingRateId?: number | string
		returnUrl?: string
		paymentData?: Record<string, string>
	} = {}): Promise<B2bPlaced> {
		const cart = cartId || storedCartId()
		if (!cart) throw new GoCommerceError('Your bag is empty.', 400)
		const extras = cartExtras(cart)
		const rate = shippingRateId ?? extras.shippingRateId
		const body = {
			cart_id: cart,
			...this.placeBody(opts, extras.shippingAddress ?? undefined),
			...(rate ? { shipping_rate_id: Number(rate) } : {}),
			...(lineIds?.length ? { line_ids: lineIds.map(Number) } : {}),
			...(returnUrl ? { return_url: returnUrl } : {}),
			...(paymentData ? { payment_data: paymentData } : {}),
		}
		const res = await this.data<CheckoutResult & { approval?: Approval }>('/x/b2b/checkout', {
			method: 'POST',
			auth: true,
			body,
			headers: { 'Idempotency-Key': attemptKey(`b2b:${JSON.stringify(body)}`) },
		})
		return this.placed(res, cart)
	}

	// ------------------------------------------------------------ the company's orders

	/** Admins and approvers see the company's; a buyer sees their own. `q` matches the number, PO or email. */
	async orders({
		page = 1,
		limit = 20,
		q,
		overdue,
	}: { page?: number; limit?: number; q?: string; overdue?: boolean } = {}) {
		return this.engine<CompanyOrder[]>('/x/b2b/orders', {
			auth: true,
			query: { page, limit, q, ...(overdue ? { overdue: 'true' } : {}) },
		}) as Promise<Paged<CompanyOrder>>
	}

	// ------------------------------------------------------------ approvals

	async approvals({
		page = 1,
		limit = 20,
		status,
	}: { page?: number; limit?: number; status?: Approval['status'] } = {}) {
		return this.engine<Approval[]>('/x/b2b/approvals', { auth: true, query: { page, limit, status } }) as Promise<
			Paged<Approval>
		>
	}

	async approval(approvalId: number | string) {
		return this.data<Approval>(`/x/b2b/approvals/${id(approvalId)}`, { auth: true })
	}

	/**
	 * Admin or approver: places the requested order at the prices it was
	 * requested at. Credit limits and holds still apply. The payment intent is
	 * the approver's to act on — for an account order there is nothing to do.
	 */
	async approve(approvalId: number | string) {
		const res = await this.data<CheckoutResult & { approval: Approval }>(`/x/b2b/approvals/${id(approvalId)}/approve`, {
			method: 'POST',
			auth: true,
		})
		return { approval: res.approval, orderNo: res.order.number, order: toOrder(res.order), payment: res.payment }
	}

	async reject(approvalId: number | string, reason?: string) {
		return this.data<Approval>(`/x/b2b/approvals/${id(approvalId)}/reject`, {
			method: 'POST',
			auth: true,
			...(reason ? { body: { reason } } : {}),
		})
	}

	/** The buyer who asked withdraws the request. */
	async cancelApproval(approvalId: number | string) {
		return this.data<Approval>(`/x/b2b/approvals/${id(approvalId)}/cancel`, { method: 'POST', auth: true })
	}

	// ------------------------------------------------------------ quotes

	async quotes({ page = 1, limit = 20, status }: { page?: number; limit?: number; status?: Quote['status'] } = {}) {
		return this.engine<Quote[]>('/x/b2b/quotes', { auth: true, query: { page, limit, status } }) as Promise<
			Paged<Quote>
		>
	}

	async quote(quoteId: number | string) {
		return this.data<Quote>(`/x/b2b/quotes/${id(quoteId)}`, { auth: true })
	}

	/** Asks the store to price these lines. The store answers with unit prices and an expiry. */
	async requestQuote({ lines, note }: { lines: { variantId: number | string; quantity: number }[]; note?: string }) {
		return this.data<Quote>('/x/b2b/quotes', {
			method: 'POST',
			auth: true,
			body: {
				lines: (lines ?? []).map((l) => ({ variant_id: Number(l.variantId), quantity: Number(l.quantity) })),
				...(note ? { note } : {}),
			},
		})
	}

	/** Places the quote at its agreed prices — or, for a buyer over the threshold, asks for approval. */
	async acceptQuote(quoteId: number | string, opts: PlaceOptions = {}): Promise<B2bPlaced> {
		const res = await this.data<CheckoutResult & { approval?: Approval }>(`/x/b2b/quotes/${id(quoteId)}/accept`, {
			method: 'POST',
			auth: true,
			body: this.placeBody(opts),
		})
		return this.placed(res)
	}

	async declineQuote(quoteId: number | string) {
		return this.data<Quote>(`/x/b2b/quotes/${id(quoteId)}/decline`, { method: 'POST', auth: true })
	}

	// ------------------------------------------------------------ dealer leads

	/**
	 * The public "find a dealer" form: no account needed. The engine routes it to
	 * the dealer whose territory covers the address — or keeps it — and answers
	 * the same either way, so the form never reveals who got it.
	 */
	async submitLead(lead: {
		name?: string
		email?: string
		phone?: string
		message?: string
		country?: string
		state?: string
		postalCode?: string
		productId?: number | string
		variantId?: number | string
		source?: string
	}) {
		return this.data<{ accepted: boolean }>('/x/b2b/leads', {
			method: 'POST',
			body: {
				...(lead.name ? { name: lead.name } : {}),
				...(lead.email ? { email: lead.email } : {}),
				...(lead.phone ? { phone: lead.phone } : {}),
				...(lead.message ? { message: lead.message } : {}),
				...(lead.country ? { country: lead.country } : {}),
				...(lead.state ? { state: lead.state } : {}),
				...(lead.postalCode ? { postal_code: lead.postalCode } : {}),
				...(lead.productId ? { product_id: Number(lead.productId) } : {}),
				...(lead.variantId ? { variant_id: Number(lead.variantId) } : {}),
				...(lead.source ? { source: lead.source } : {}),
			},
		})
	}

	/** A dealer's admins and approvers: the leads routed to their company. */
	async leads({ page = 1, limit = 20, status }: { page?: number; limit?: number; status?: Lead['status'] } = {}) {
		return this.engine<Lead[]>('/x/b2b/leads', { auth: true, query: { page, limit, status } }) as Promise<Paged<Lead>>
	}

	async setLeadStatus(leadId: number | string, status: Lead['status']) {
		return this.data<Lead>(`/x/b2b/leads/${id(leadId)}`, { method: 'PATCH', auth: true, body: { status } })
	}

	// ------------------------------------------------------------ internals

	/** The fields checkout and quote acceptance share. Only declared ones: the engine refuses the rest. */
	private placeBody(opts: PlaceOptions, fallback?: StorefrontAddress) {
		const raw = opts.address ?? fallback
		if (!raw) throw new GoCommerceError('Add a delivery address first.', 400)
		const address = 'line1' in raw ? (raw as Address) : toEngineAddress(raw as StorefrontAddress)
		return {
			address,
			...(opts.paymentMethod ? { payment_method: String(opts.paymentMethod).toLowerCase() } : {}),
			...(opts.poNumber ? { po_number: String(opts.poNumber).trim() } : {}),
			...((opts.name ?? address.name) ? { name: opts.name ?? address.name } : {}),
			...((opts.phone ?? address.phone) ? { phone: opts.phone ?? address.phone } : {}),
		}
	}

	private placed(res: Partial<CheckoutResult> & { approval?: Approval }, cartId?: string): B2bPlaced {
		if (res.approval && !res.order) return { kind: 'approval', approval: res.approval }
		const order = res.order as Order
		if (order.access_token && cartId) {
			rememberOrder({ number: order.number, token: order.access_token, cartId, reference: res.payment?.reference })
		}
		return { kind: 'order', orderNo: order.number, order: toOrder(order), payment: res.payment as PaymentIntent }
	}
}

const id = (v: number | string) => encodeURIComponent(String(v))

/**
 * One Idempotency-Key per distinct request, kept for the page's life: a retry
 * of the same checkout — a double click, a timeout — resumes it rather than
 * placing a second order, and a changed request gets a new key, since the
 * engine refuses a key replayed with a different body.
 */
const keys = new Map<string, string>()
function attemptKey(request: string): string {
	let key = keys.get(request)
	if (!key) {
		const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
		key = c?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
		keys.set(request, key)
	}
	return key
}

export const b2bService = new B2bService()
