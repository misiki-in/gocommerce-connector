/**
 * What this connector is told about its engine.
 *
 * The storefront hands over every `PUBLIC_GOCOMMERCE_*` variable it has,
 * camelCased, through `BaseService.setCredentials` — from the server hook and
 * again from the client hook. Never through a constructor: the browser imports
 * prebuilt singletons.
 */
export interface Credentials {
	/**
	 * `PUBLIC_GOCOMMERCE_API_URL` — the engine's origin, `https://api.shop.example`.
	 * Every server-side call goes here, and so does every browser call unless
	 * `proxyPath` is set.
	 */
	apiUrl: string
	/**
	 * `PUBLIC_GOCOMMERCE_PROXY_PATH` — a path on the storefront's own origin,
	 * `/gocommerce`, that a reverse proxy forwards to the engine with the prefix
	 * stripped. The browser uses it instead of `apiUrl`.
	 *
	 * It exists because the engine sends no CORS headers, so a browser on the
	 * storefront's origin cannot read a response from the engine's. Deploying
	 * the two on one origin is the other answer; this is the one that needs no
	 * change to either side's routes. Server-side calls ignore it: Node has no
	 * origin to resolve a path against, and needs no CORS.
	 */
	proxyPath?: string
	/**
	 * `PUBLIC_GOCOMMERCE_STORE` — under `gocommerce platform`, the store this
	 * storefront sells for, sent as `X-Store` when `apiUrl` is the platform's
	 * shared API host. Leave unset when the store has a host of its own.
	 */
	store?: string
	/**
	 * `PUBLIC_GOCOMMERCE_CHANNEL` — the sales channel new carts and the product
	 * listing belong to, when the store sells through more than one.
	 */
	channel?: string
	/**
	 * `PUBLIC_GOCOMMERCE_LANGUAGE` — the language to ask the engine for, `fr`. Sent
	 * as `?lang=` on every read, which wins over the browser's Accept-Language
	 * and needs no CORS preflight. Product titles and descriptions follow it when
	 * the store has a translator installed, and content pages always do. Unset,
	 * the engine answers in the store's default language.
	 */
	language?: string
}
