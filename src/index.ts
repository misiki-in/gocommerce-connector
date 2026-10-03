/**
 * @misiki/gocommerce-connector — Svelte Commerce, talking to a GoCommerce engine.
 *
 * The storefront resolves its backend to whichever `@misiki/*-connector` is
 * installed and imports the family's service surface from it by name. This
 * package is that surface, mapped onto the engine's public API and the
 * storefront modules it ships (ext/identity, reviews, wishlist, cms,
 * navigation, faq, contact, meilisearch).
 */
export * from './config'
export * from './errors'
export * from './money'
export type * from './engine'
export { connectorName, setStaticStore, hasStaticStore, readStaticStore } from './static-store'
export { serveRestLocally, type RestResolver } from './rest-guard'
export { forgetAll as clearStoreCache } from './cache'
export * from './map'
export * from './services/index'
