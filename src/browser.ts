/**
 * The state this connector keeps in the shopper's browser, and only there.
 *
 * The storefront renders some services from a server singleton shared by every
 * shopper, so nothing about one shopper may live in module scope: a token held
 * in a static field would be served to the next request. Everything here is
 * read from `localStorage` or `document.cookie` at the moment it is needed, and
 * on the server every reader answers "nothing".
 *
 * What lives here, and why the engine does not hold it:
 *
 * - the account session token — ext/identity is bearer-only and sets no cookie;
 * - the `me` and `connect.sid` cookies — the storefront's own idea of who is
 *   signed in, which every connector in the family writes itself;
 * - `cart_id` — the storefront reads it, the connector writes it;
 * - per-cart checkout details — the engine's cart holds lines and an email, and
 *   takes the address, phone and delivery choice only in the checkout request,
 *   so they are kept here until then;
 * - order access tokens — returned once, at checkout, and the only way a guest
 *   can read an order back;
 * - the wishlist token — ext/wishlist keys a list by its own token.
 */
import type { AppliedDiscount, AuthResponse, Customer } from './engine'

export const inBrowser = (): boolean => typeof window !== 'undefined' && typeof document !== 'undefined'

export function readLocal(key: string): string | null {
	if (!inBrowser()) return null
	try {
		return window.localStorage.getItem(key)
	} catch {
		return null
	}
}

export function writeLocal(key: string, value: string): void {
	if (!inBrowser()) return
	try {
		window.localStorage.setItem(key, value)
	} catch {
		// Private mode or a full quota. The call it belongs to still succeeds;
		// only the memory of it is lost.
	}
}

export function removeLocal(key: string): void {
	if (!inBrowser()) return
	try {
		window.localStorage.removeItem(key)
	} catch {
		// see writeLocal
	}
}

function readJSON<T>(key: string): T | null {
	const raw = readLocal(key)
	if (!raw) return null
	try {
		return JSON.parse(raw) as T
	} catch {
		return null
	}
}

const YEAR = 60 * 60 * 24 * 365

function setCookie(name: string, value: string, maxAge = YEAR): void {
	if (!inBrowser()) return
	document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; samesite=lax`
}

function clearCookie(name: string): void {
	if (!inBrowser()) return
	document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`
}

export function readCookie(name: string): string | null {
	if (!inBrowser()) return null
	for (const pair of document.cookie.split(';')) {
		const at = pair.indexOf('=')
		if (at < 0) continue
		if (pair.slice(0, at).trim() === name) return pair.slice(at + 1).trim()
	}
	return null
}

// ---------------------------------------------------------------- session

const TOKEN = 'gocommerce_token'

/** The ext/identity bearer token, when a shopper is signed in in this browser. */
export const sessionToken = (): string | null => readLocal(TOKEN)

/**
 * The user object the storefront keeps in its `me` cookie. `userId` is its
 * signed-in test and `role: 'USER'` its shopper test; the rest fills forms.
 */
export function toMe(c: Customer) {
	const [firstName, ...rest] = (c.name ?? '').trim().split(/\s+/)
	return {
		id: String(c.id),
		userId: String(c.id),
		email: c.email,
		phone: c.phone || null,
		firstName: firstName || '',
		lastName: rest.join(' '),
		name: c.name ?? '',
		fullName: c.name ?? '',
		avatar: null,
		role: 'USER',
		emailVerified: c.email_verified,
		storeId: null,
	}
}

export type Me = ReturnType<typeof toMe>

/**
 * Signs this browser in: the token for the engine, the two cookies for the
 * storefront. `connect.sid` carries no secret — the storefront's server only
 * checks that it exists — so it holds a marker rather than the token, which
 * would otherwise ride along on every request to the storefront's origin.
 */
export function startSession(auth: AuthResponse): Me {
	writeLocal(TOKEN, auth.token)
	const me = toMe(auth.record)
	const expires = Math.max(60, Math.floor((Date.parse(auth.expires_at) - Date.now()) / 1000)) || YEAR
	setCookie('me', encodeURIComponent(JSON.stringify(me)), expires)
	setCookie('connect.sid', 'gocommerce', expires)
	return me
}

/** Refreshes the `me` cookie after a profile change, keeping the session. */
export function updateMe(c: Customer): Me {
	const me = toMe(c)
	setCookie('me', encodeURIComponent(JSON.stringify(me)))
	return me
}

export function endSession(): void {
	removeLocal(TOKEN)
	clearCookie('me')
	clearCookie('connect.sid')
}

/** The `me` cookie, decoded — the name and email a review is signed with. */
export function currentMe(): Partial<Me> | null {
	const raw = readCookie('me')
	if (!raw) return null
	try {
		return JSON.parse(decodeURIComponent(raw))
	} catch {
		return null
	}
}

// ---------------------------------------------------------------- cart

/** `localStorage.cart_id`, the storefront's own key, with its stale spellings refused. */
export function storedCartId(): string | null {
	const v = readLocal('cart_id')
	if (!v || v === 'undefined' || v === 'null') return null
	return v
}

export const rememberCartId = (id: string): void => writeLocal('cart_id', id)

/** The storefront's address shape, as its checkout form builds it. */
export type StorefrontAddress = {
	id?: string
	firstName?: string
	lastName?: string
	email?: string
	phone?: string
	address_1?: string
	address_2?: string
	locality?: string
	city?: string
	state?: string
	zip?: string
	country?: string
	countryCode?: string
	[key: string]: unknown
}

export type CartExtras = {
	phone?: string
	shippingAddress?: StorefrontAddress | null
	billingAddress?: StorefrontAddress | null
	shippingRateId?: string | null
	shippingRate?: { id: string; name: string; minor: number; currency: string } | null
	discount?: AppliedDiscount | null
	/** The Idempotency-Key of the last checkout attempt, and the body it was sent with. */
	attempt?: { key: string; body: string } | null
}

const extrasKey = (cartId: string) => `gocommerce_cart_${cartId}`

export const cartExtras = (cartId: string): CartExtras => readJSON<CartExtras>(extrasKey(cartId)) ?? {}

export function saveCartExtras(cartId: string, patch: CartExtras): CartExtras {
	const next = { ...cartExtras(cartId), ...patch }
	writeLocal(extrasKey(cartId), JSON.stringify(next))
	return next
}

export const forgetCartExtras = (cartId: string): void => removeLocal(extrasKey(cartId))

// ---------------------------------------------------------------- orders

type PlacedOrder = { number: string; token: string; cartId: string; reference?: string }

const ORDERS = 'gocommerce_orders'

export const placedOrders = (): PlacedOrder[] => readJSON<PlacedOrder[]>(ORDERS) ?? []

/**
 * Keeps an order's access token. The engine returns it exactly once — a
 * replayed checkout leaves it out — and without it a guest cannot read the
 * order back, so losing it here loses the order.
 */
export function rememberOrder(o: PlacedOrder): void {
	const kept = placedOrders().filter((p) => p.number !== o.number)
	// Bounded: a shared computer should not accumulate a history forever.
	writeLocal(ORDERS, JSON.stringify([o, ...kept].slice(0, 50)))
}

export const placedOrder = (number: string): PlacedOrder | undefined => placedOrders().find((p) => p.number === number)

export const placedOrderForCart = (cartId: string): PlacedOrder | undefined =>
	placedOrders().find((p) => p.cartId === cartId)

export const placedOrderByReference = (reference: string): PlacedOrder | undefined =>
	placedOrders().find((p) => p.reference === reference)

// ---------------------------------------------------------------- wishlist

const WISHLIST = 'gocommerce_wishlist'
export const wishlistToken = (): string | null => readLocal(WISHLIST)
export const rememberWishlistToken = (token: string): void => writeLocal(WISHLIST, token)
export const forgetWishlistToken = (): void => removeLocal(WISHLIST)
