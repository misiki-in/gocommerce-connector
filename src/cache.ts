/**
 * A short memory for store-level facts: which plugins are on, the settlement
 * currency, the category tree.
 *
 * The storefront asks for the store record on every server request, and a
 * category page needs the whole tree to draw one breadcrumb. Asking the engine
 * each time would multiply its load by the page count for answers that change
 * when a merchant edits something, not when a shopper clicks.
 *
 * Only facts that are the same for every shopper may go in here — this module
 * is shared by every request a server process handles. Keyed by engine URL, so
 * a platform storefront talking to several stores keeps them apart.
 */
const TTL_MS = 60_000

type Entry = { at: number; value: Promise<unknown> }

const entries = new Map<string, Entry>()

export function remember<T>(key: string, load: () => Promise<T>, ttl = TTL_MS): Promise<T> {
	const hit = entries.get(key)
	if (hit && Date.now() - hit.at < ttl) return hit.value as Promise<T>
	const value = load()
	entries.set(key, { at: Date.now(), value })
	// A failure is not remembered: the next caller tries again.
	value.catch(() => {
		if (entries.get(key)?.value === value) entries.delete(key)
	})
	return value
}

/** For tests, and for a storefront that has just changed something itself. */
export function forgetAll(): void {
	entries.clear()
}
