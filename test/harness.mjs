/**
 * What both live suites share: a browser minus the browser, the connector
 * pointed at the engine, and an admin client for seeding.
 *
 * The connector keeps the cart id, the session and order tokens in the
 * shopper's browser. Node has none, so this gives it the three globals it
 * reads — the engine is still the real one.
 */
import { execFileSync } from 'node:child_process'

export const BASE = (process.env.GOCOMMERCE_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '')
export const TOKEN = process.env.GOCOMMERCE_ADMIN_TOKEN ?? ''
export const RUN = Date.now().toString(36)

export const store = new Map()
globalThis.localStorage = {
	getItem: (k) => (store.has(k) ? store.get(k) : null),
	setItem: (k, v) => store.set(k, String(v)),
	removeItem: (k) => store.delete(k),
	clear: () => store.clear(),
}
export const jar = new Map()
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

export const m = await import('../dist/index.js')
m.BaseService.setCredentials({ apiUrl: BASE })
m.setStaticStore(() => ({ id: 'from_config', name: 'Test shop', currency: { code: 'USD', symbol: '$' }, plugins: {} }))

export let live = false
try {
	live = (await fetch(`${BASE}/health`)).ok && Boolean(TOKEN)
} catch {
	live = false
}
if (!live) console.log(`\n  ! no engine at ${BASE} (or no GOCOMMERCE_ADMIN_TOKEN) — the live tests are skipped\n`)

export async function admin(method, path, body) {
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
export async function mounted(path) {
	const res = await fetch(BASE + path)
	const body = await res.json().catch(() => ({}))
	return !(res.status === 404 && /no route/i.test(body?.error?.message ?? ''))
}

/**
 * Marks an account's email confirmed, straight in the test database. The
 * engine confirms one only from a link it emails, and a test cannot read its
 * mail; this is fixture setup on a throwaway database, never connector
 * behaviour. Without GOCOMMERCE_TEST_DB the tests that need it skip.
 */
export const canConfirm = Boolean(process.env.GOCOMMERCE_TEST_DB)
export function confirmEmail(email) {
	execFileSync('psql', [
		process.env.GOCOMMERCE_TEST_DB,
		'-v',
		'ON_ERROR_STOP=1',
		'-c',
		`UPDATE identity_customers SET email_verified_at = now() WHERE email = '${email.replace(/'/g, "''")}'`,
	])
}
