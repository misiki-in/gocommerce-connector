import type { Credentials } from '../config'
import type { Envelope } from '../engine'
import { GoCommerceError } from '../errors'
import { resolveRestLocally } from '../rest-guard'
import { sessionToken } from '../browser'

type Query = Record<string, string | number | boolean | null | undefined | (string | number)[]>

export type EngineRequest = {
	method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
	query?: Query
	body?: unknown
	headers?: Record<string, string>
	/** Send the signed-in shopper's bearer token. Only ext/identity reads it. */
	auth?: boolean
}

/**
 * BaseService — the one place this connector talks to the engine.
 *
 * - Credentials arrive through the static `setCredentials` (both hooks), never
 *   a constructor, and merge: the storefront drops unset variables rather than
 *   sending `undefined`, so a second call must not erase the first.
 * - Server-side, a service is built with SvelteKit's `fetch`; client-side, the
 *   prebuilt singletons use the global one. Either way it is called with the
 *   global object as receiver, because the browser's native fetch throws
 *   "Illegal invocation" when called as a method of anything else.
 * - Every engine call goes through `engine()`, with an absolute URL. The
 *   engine's own routes start with `/api/`, and the storefront patches this
 *   class's `get/post/put/patch/delete` to swallow any relative `/api/` path
 *   (see rest-guard.ts), so those verbs are kept for the Litekart paths the
 *   storefront still sends and never used for the engine.
 * - Failures throw a `GoCommerceError`: an `Error` with the engine's message,
 *   status and code, which is what the storefront toasts.
 */
export class BaseService {
	private static _credentials: Credentials = { apiUrl: '' }
	protected _fetch: typeof fetch

	constructor(fetchFn?: typeof fetch) {
		this._fetch = fetchFn ?? ((input, init) => globalThis.fetch(input, init))
	}

	static setCredentials(creds: Partial<Credentials>): void {
		BaseService._credentials = { ...BaseService._credentials, ...creds }
	}

	static getCredentials(): Credentials {
		return BaseService._credentials
	}

	protected get creds(): Credentials {
		return BaseService._credentials
	}

	/**
	 * The engine's base URL from wherever this code runs. In the browser a
	 * configured proxy path wins, because the engine answers no CORS preflight.
	 */
	protected engineBase(): string {
		const { apiUrl, proxyPath } = this.creds
		if (proxyPath && typeof window !== 'undefined' && window.location) {
			return new URL(proxyPath, window.location.origin).href.replace(/\/+$/, '')
		}
		const url = (apiUrl ?? '').trim()
		if (!url) {
			throw new GoCommerceError(
				'PUBLIC_GOCOMMERCE_API_URL is not set, so this storefront does not know where its commerce ' +
					'engine is. Point it at a running GoCommerce, e.g. http://127.0.0.1:8080.',
				0,
			)
		}
		return url.replace(/\/+$/, '')
	}

	/** An absolute engine URL for a path and query, without sending anything. */
	protected engineURL(path: string, query?: Query): string {
		return this.engineBase() + path + qs(query)
	}

	/**
	 * One request to the engine, envelope and all.
	 *
	 * The body is read as text first, so a proxy's HTML error page is reported
	 * as what it is rather than as a JSON parse error three frames away.
	 */
	protected async engine<T>(path: string, req: EngineRequest = {}): Promise<Envelope<T>> {
		// A language only means something on a read; a write's answer is a cart
		// or an order, whose lines keep the words they were bought under.
		const lang = (req.method ?? 'GET') === 'GET' ? this.creds.language : undefined
		const url = this.engineURL(path, lang ? { lang, ...req.query } : req.query)
		const headers: Record<string, string> = { Accept: 'application/json', ...req.headers }
		if (req.body !== undefined) headers['Content-Type'] = 'application/json'
		if (this.creds.store) headers['X-Store'] = this.creds.store
		if (req.auth) {
			const token = sessionToken()
			if (!token) throw new GoCommerceError('Please sign in to continue.', 401, 'unauthorized')
			headers.Authorization = `Bearer ${token}`
		}

		const init: RequestInit = {
			method: req.method ?? 'GET',
			headers,
			body: req.body === undefined ? undefined : JSON.stringify(req.body),
		}
		let res: Response
		try {
			res = await this._fetch.call(globalThis, url, init)
		} catch (cause) {
			// SvelteKit's server-side fetch applies the browser's CORS rule to a
			// universal load, and the engine sends no CORS headers. On the server
			// there is no browser to protect, so ask again with Node's own fetch;
			// in the browser the same call goes through PUBLIC_GOCOMMERCE_PROXY_PATH.
			if (typeof window === 'undefined' && /CORS/i.test(String((cause as Error)?.message))) {
				try {
					res = await globalThis.fetch(url, init)
				} catch (again) {
					throw unreachable(this.engineBase(), again)
				}
			} else {
				throw unreachable(this.engineBase(), cause)
			}
		}
		return this.unwrap<T>(res)
	}

	/** The envelope opened: the payload, or the engine's error as a GoCommerceError. */
	private async unwrap<T>(res: Response): Promise<Envelope<T>> {
		const text = await res.text()
		let parsed: any = null
		if (text) {
			try {
				parsed = JSON.parse(text)
			} catch {
				throw new GoCommerceError(
					`The commerce engine answered ${res.status} with something that is not JSON: ${text.slice(0, 120)}`,
					res.status,
				)
			}
		}
		if (!res.ok) {
			const err = parsed?.error ?? {}
			throw new GoCommerceError(
				err.message ?? `The commerce engine answered ${res.status}.`,
				res.status,
				err.code,
				err.details,
			)
		}
		// 204 is a success with nothing to say; the caller decides what that means.
		return (parsed ?? { data: null }) as Envelope<T>
	}

	/** The bare payload, for the many callers that never look at `meta`. */
	protected async data<T>(path: string, req: EngineRequest = {}): Promise<T> {
		return (await this.engine<T>(path, req)).data
	}

	/**
	 * Prices a cart at the signed-in shopper's customer-group prices. The
	 * engine does this only for an account whose email is confirmed (403
	 * otherwise), and the cart stays the shopper's either way — so a refusal
	 * is not an error, and neither is a build without ext/identity.
	 */
	protected async claimCartForAccount(cartId: string): Promise<void> {
		try {
			await this.engine('/x/identity/me/carts', { method: 'POST', body: { cart_id: cartId }, auth: true })
		} catch {
			// Unconfirmed email, no identity module, or a cart already checked out.
		}
	}

	// ------------------------------------------------------------ Litekart verbs

	/**
	 * The family's path-addressed verbs. An absolute URL is fetched as-is; a
	 * relative one is a Litekart REST path, answered from the storefront's own
	 * data where it has some and refused otherwise (rest-guard.ts).
	 */
	get<T = any>(path: string): Promise<T> {
		return this.raw<T>('get', path)
	}
	post<T = any>(path: string, data?: unknown): Promise<T> {
		return this.raw<T>('post', path, data)
	}
	put<T = any>(path: string, data?: unknown): Promise<T> {
		return this.raw<T>('put', path, data)
	}
	patch<T = any>(path: string, data?: unknown): Promise<T> {
		return this.raw<T>('patch', path, data)
	}
	delete<T = any>(path: string): Promise<T> {
		return this.raw<T>('delete', path)
	}

	private async raw<T>(method: string, path: string, data?: unknown): Promise<T> {
		if (!/^https?:\/\//i.test(path)) return (await resolveRestLocally(method, path)) as T
		const res = await this._fetch.call(globalThis, path, {
			method: method.toUpperCase(),
			headers: { Accept: 'application/json', ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
			body: data === undefined ? undefined : JSON.stringify(data),
		})
		const body = await res.json().catch(() => ({}))
		if (!res.ok)
			throw new GoCommerceError(body?.error?.message ?? `Request failed with status ${res.status}`, res.status)
		return body as T
	}
}

/** A refused connection is the commonest failure in development; it says which address did not answer. */
const unreachable = (base: string, cause: unknown) =>
	new GoCommerceError(`Could not reach the commerce engine at ${base}: ${(cause as Error)?.message ?? cause}`, 0)

/** `?a=1&b=2`, dropping what was not asked for. Arrays repeat the key. */
export function qs(query?: Query): string {
	if (!query) return ''
	const sp = new URLSearchParams()
	for (const [key, value] of Object.entries(query)) {
		// Undefined, null and '' are "did not ask", not "asked for nothing":
		// `?q=` would filter to the empty string.
		if (value === undefined || value === null || value === '') continue
		if (Array.isArray(value)) for (const v of value) sp.append(key, String(v))
		else sp.append(key, String(value))
	}
	const s = sp.toString()
	return s ? `?${s}` : ''
}

/** The family's list shape, from the engine's `{data, meta}`. Totals are the engine's, never invented. */
export function toPage<T, U>(env: Envelope<T[] | null>, map: (row: T) => U) {
	const rows = env.data ?? []
	const meta = env.meta
	return {
		data: rows.map(map),
		count: meta?.total ?? rows.length,
		pageSize: meta?.limit ?? rows.length,
		noOfPage: meta?.total_pages ?? 1,
		page: meta?.page ?? 1,
	}
}

export const emptyPage = <T = never>() => ({ data: [] as T[], count: 0, pageSize: 0, noOfPage: 0, page: 1 })
