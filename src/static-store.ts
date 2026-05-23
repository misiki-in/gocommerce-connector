/**
 * Store identity — name, logo, favicon, menus, theme variables.
 *
 * Some of that the engine has (the settlement currency, the payment methods,
 * the switched-on plugins) and most of it it does not: a logo and a hero banner
 * are the storefront's own business. The storefront registers its static store
 * record here at boot — `default-store.json` merged under the project's
 * `kitcommerce.config.ts` — and `storeService` lays the engine's live facts
 * over it, so the engine wins wherever it has an opinion.
 */
export type StaticStoreProvider = () => Promise<Record<string, any>> | Record<string, any>

let provider: StaticStoreProvider | undefined

export const setStaticStore = (fn: StaticStoreProvider) => {
	provider = fn
}

export const hasStaticStore = () => Boolean(provider)

export const readStaticStore = async (): Promise<Record<string, any>> => {
	if (!provider) return {}
	return (await provider()) ?? {}
}

/** The marker the storefront reads to tell which backend is active. */
export const connectorName = 'gocommerce'
