/**
 * Every shopper-facing route the engine serves is called somewhere in src/.
 *
 *   node scripts/route-coverage.mjs <path to a gocommerce checkout>
 *
 * Reads the engine's route registrations straight from its Go source — core
 * and every ext/ module — so a route added to the engine fails this check
 * until the connector reaches it. Admin routes are the operator's, not a
 * storefront's; feeds, sitemaps, IndexNow and gateway webhooks are read by
 * machines, not shoppers.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const engine = process.argv[2]
if (!engine) {
	console.error('usage: node scripts/route-coverage.mjs <gocommerce checkout>')
	process.exit(2)
}

const files = (dir, ext) =>
	readdirSync(dir).flatMap((name) => {
		const p = join(dir, name)
		return statSync(p).isDirectory() ? files(p, ext) : p.endsWith(ext) ? [p] : []
	})

const MACHINE = ['/webhook', '/x/feeds/', '/x/sitemaps/', '/x/indexnow/']
const routes = new Set()
for (const f of [...files(join(engine, 'core'), '.go'), ...files(join(engine, 'ext'), '.go')]) {
	if (f.endsWith('_test.go')) continue
	for (const [, route] of readFileSync(f, 'utf8').matchAll(
		/HandleFunc\("((?:GET|POST|PUT|PATCH|DELETE) \/(?:api|x)\/[^"]+)"/g,
	)) {
		if (route.includes('/api/admin') || MACHINE.some((s) => route.includes(s))) continue
		routes.add(route)
	}
}

const src = files(new URL('../src', import.meta.url).pathname, '.ts')
	.map((f) => readFileSync(f, 'utf8'))
	.join('\n')

const missing = [...routes].sort().filter((route) => {
	const path = route.split(' ')[1]
	const pattern = path
		.split('/')
		.map((seg) => (/^\{[^}]+\}$/.test(seg) ? '(\\$\\{[^}]+\\}|[a-z-]+)' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
		.join('/')
	return !new RegExp(pattern + "(['`?]|\\$\\{)").test(src)
})

console.log(`${routes.size} shopper-facing engine routes; ${routes.size - missing.length} reached by the connector`)
if (missing.length) {
	console.error('not reached:\n  ' + missing.join('\n  '))
	process.exit(1)
}
