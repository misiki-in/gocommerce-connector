/**
 * Litekart REST paths, intercepted.
 *
 * Every connector in the family exposes `get/post/put/patch/delete(path)` on
 * its BaseService because Litekart's does, and a little storefront code still
 * calls them with a Litekart path — `storeService.post('/api/…')`. Those paths
 * are relative, so they would land on the storefront's own origin, where
 * nothing answers.
 *
 * GoCommerce's own routes also start with `/api/`, which is why this connector
 * never sends an engine request through those verbs: every engine call goes
 * through `BaseService.engine()` with an absolute URL, and the storefront's own
 * guard (which patches the same verbs) cannot reach it either. What arrives
 * here is only ever an inherited Litekart path.
 *
 * Reads for a collection resolve empty (a store legitimately has none); reads
 * for one record and every write throw, because a blank detail page reads as
 * broken and a silent success would tell a shopper their enquiry was saved when
 * nothing left the browser. Each distinct path is reported once.
 */

const COLLECTION_SEGMENTS = new Set([
	'all',
	'list',
	'list-by-parent',
	'list-public',
	'latest',
	'search',
	'public',
	'public-details',
	'me',
	'multiple',
])

const emptyResult = () => ({ data: [], count: 0, pageSize: 0, noOfPage: 0, page: 1 })

const addressesOneRecord = (url: string) => {
	const segments = url.split('?')[0].split('/').filter(Boolean)
	if (segments.length < 3) return false
	return !COLLECTION_SEGMENTS.has(segments[segments.length - 1].toLowerCase())
}

const reported = new Set<string>()

const report = (method: string, url: string) => {
	const key = `${method} ${url.split('?')[0]}`
	if (reported.has(key)) return
	reported.add(key)
	console.warn(
		`[gocommerce] no native implementation for \`${key}\` — that is a Litekart REST path, and it was not called.`,
	)
}

/**
 * Answers a Litekart REST path from data the storefront holds (menus,
 * countries, plugin toggles…). Return `undefined` to fall through.
 */
export type RestResolver = (url: string) => Promise<unknown> | unknown | undefined

let localResolver: RestResolver | undefined

export const serveRestLocally = (resolver: RestResolver) => {
	localResolver = resolver
}

export const resolveRestLocally = async (method: string, url: string) => {
	if (method === 'get') {
		const local = await localResolver?.(url)
		if (local !== undefined) return local
	}
	report(method, url)
	if (method !== 'get' || addressesOneRecord(url)) {
		throw new Error(`This feature is not available on this store (gocommerce).`)
	}
	return emptyResult()
}
