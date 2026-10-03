# @misiki/gocommerce-connector

[Svelte Commerce](https://github.com/itswadesh/svelte-commerce) on a
[GoCommerce](https://github.com/itswadesh/gocommerce) engine.

The storefront talks to every backend through a connector: a package that maps
one platform's API onto a shared surface of some forty services (`product`,
`cart`, `checkout`, `order`, `user`, `address`, …). This is GoCommerce's. It
covers the engine's public API and the storefront modules it ships — accounts,
reviews, wishlists, content pages, menus, FAQ, contact and search — and says
plainly where the two do not meet.

## Install

```bash
bun remove @misiki/litekart-connector @misiki/vendure-connector
bun add @misiki/gocommerce-connector
```

The storefront runs on whichever `@misiki/*-connector` is installed. If you keep
another one installed, set `PUBLIC_CONNECTOR=@misiki/gocommerce-connector`.

```bash
# .env
PUBLIC_GOCOMMERCE_API_URL=https://api.shop.example    # the engine
PUBLIC_GOCOMMERCE_PROXY_PATH=/gocommerce              # see "The browser and CORS"
# PUBLIC_GOCOMMERCE_CHANNEL=web                       # a sales channel, if the store has several
# PUBLIC_GOCOMMERCE_STORE=acme                        # under `gocommerce platform`, on a shared API host
```

**Leave `PUBLIC_LITEKART_API_URL` unset.** The storefront rewrites every
server-side request whose path starts with `/api` to that host, and the
engine's routes start with `/api` too.

### The engine

Start it with the modules the storefront has screens for:

```bash
gocommerce serve -identity -wishlist -reviews -cms -faq -menus
```

Each is optional. Without `-identity` there is no sign-in (guest checkout
always works); without `-reviews` products show no stars; and so on. Add
`-meilisearch` (with `MEILI_HOST` and keys) for price sorting and price filters.

### The browser and CORS

The engine sends no CORS headers, so a browser on the storefront's origin cannot
read a response from the engine's. Server-side rendering is unaffected; it is
the bag, sign-in and checkout — which run in the browser — that need a route.

Proxy a path on the storefront's own origin to the engine and name it in
`PUBLIC_GOCOMMERCE_PROXY_PATH`. The browser then calls
`https://shop.example/gocommerce/api/carts`, and the server keeps calling
`PUBLIC_GOCOMMERCE_API_URL` directly. With Caddy:

```caddyfile
shop.example {
	handle_path /gocommerce/* {
		reverse_proxy engine:8080
	}
	reverse_proxy storefront:3000
}
```

or nginx:

```nginx
location /gocommerce/ { proxy_pass http://engine:8080/; }
location /            { proxy_pass http://storefront:3000; }
```

Serving the storefront and the engine from one origin works too; then leave the
proxy path unset and point the API URL at that origin.

## What maps to what

| Storefront | Engine |
| --- | --- |
| product page, listings, search | `/api/products`, `/api/products/slug/{slug}` (an id or SKU also works) |
| category pages and tree | `/api/categories`, `/api/categories/{slug}` — a category sells its descendants |
| collections | `/api/collections`, `/api/collections/{slug}` |
| featured / trending shelves | the collection with slug `featured` / `trending`; newest products when there is none |
| bag | `/api/carts…`, `/api/carts/{token}/discount` |
| delivery options | `/api/checkout/rates` |
| payment methods | `/api/checkout` — cash on delivery and Razorpay (see below) |
| place order | `POST /api/checkout/{code}` with an `Idempotency-Key` |
| order lookup | `/api/orders/{number}?token=` (guest), `/x/identity/me/orders` (account) |
| sign-in, sign-up, profile, password reset | `/x/identity/*` |
| address book | `/x/identity/me/addresses` |
| wishlist | `/x/wishlist` |
| reviews | `/x/reviews` |
| content pages (`/p/…`, legal pages) | `/x/cms/pages` |
| FAQ | `/x/faq` |
| menus | `/x/navigation/menus/{header,footer}`, laid over `store.menu` |
| contact form, product enquiries | `/x/contact/messages` |
| price sort and filter, type-ahead | `/x/meilisearch/search`, falling back to the engine's own search |
| store record | the storefront's own config, with the engine's currency, menus and module switches over it |

Blogs, banners, reels, chat, warranties, deals and uploads have no engine
equivalent. Their lists answer empty and anything that would write or open one
record throws `NotSupportedError`, naming the service and the method — a silent
success would tell a shopper their message was sent when nothing left the
browser.

## Two things this package is careful about

**Money.** The engine speaks minor units and a currency code and never a
formatted string. The storefront wants `price: 19.99`. The conversion happens in
`money.ts` and nowhere else, and it is per currency: the yen has no decimals and
the dinar has three, so ¥2,500 stays 2500 rather than becoming 25.

**Nothing is invented.** There is no popularity score, so "most popular" sorts
nothing rather than sorting by a made-up number. No compare-at price means `mrp`
equals the price, not 0 — which would render as a 100% discount. Counts and page
totals are the engine's own.

## Where the two do not meet yet

Each of these is a real gap, listed so nobody has to find it in production.

- **The order-success page shows no details.** The storefront looks the order up
  on the server with only the number and cart id from the URL. A guest's order is
  readable only with the access token checkout returned, which lives in the
  browser that placed it, so the server answers "not available yet". The bag
  still empties, and the order is readable from that browser and, for a
  signed-in shopper, under My orders. Using the cart token in the URL as a
  credential would have fixed the page and made that URL — which lands in
  history and referrers — a key to the shopper's address.
- **A missing product is a 503, not a 404.** The storefront decides by the status
  of a request to exactly `/api/products/<slug>`; the engine's slug route is
  `/api/products/slug/<slug>`, and `/api/products/<slug>` answers 400 for a
  non-numeric id.
- **Payment.** The storefront drives a fixed list of gateway flows. Of the
  engine's, cash on delivery and Razorpay's modal match. GoCommerce's Stripe is a
  Payment Element (a client secret), not the hosted page the storefront
  redirects to, and the engine's redirect gateways (Adyen, Paddle, Lemon
  Squeezy, Creem, Hyperswitch, RevenueCat) have no matching flow. They are left
  out of the payment list — each reported once in the console — rather than
  shown as a button that fails at the last step. Payment is confirmed by the
  gateway's webhook to the engine; the order shows `paymentStatus` once it lands.
- **Tax in the bag.** The engine's cart carries no tax or total; tax is computed
  when the order is placed. The bag shows subtotal − discount + delivery, and the
  order shows the real figures.
- **Facets.** The engine's search returns hits and a total, not distributions, so
  category and tag facets and the price slider are not shown.
- **Phone sign-in by code, account deletion, guest order lookup by email and
  code** are not engine features and throw.

## State kept in the browser

The engine holds a cart's lines and email; the address, phone, delivery choice
and coupon are sent with the checkout request, so they are kept in the
shopper's `localStorage` until then. So is the account session token (the
engine's identity module is bearer-only), each order's access token, and the
wishlist token. Nothing about a shopper is ever held in module scope: the
storefront renders some services from a server singleton shared by every
request.

## Development

```bash
npm install
npm run typecheck
npm test                 # builds, then runs both suites
```

`test/unit.test.mjs` covers the translation with no engine. `test/live.test.mjs`
runs the connector against a real one, seeding what it needs through the admin
API under names unique to the run:

```bash
gocommerce serve -admin-token dev-token -identity -wishlist -reviews -cms -faq -menus
GOCOMMERCE_URL=http://127.0.0.1:8080 GOCOMMERCE_ADMIN_TOKEN=dev-token npm test
```

It skips, loudly, when there is no engine. CI runs it against GoCommerce's
`main` on every push and nightly.

## Releasing

Bump `version` in `package.json`, then push a matching tag:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

The Publish workflow checks the tag against the version, builds, tests, publishes
to npm with provenance and creates the GitHub release. It needs an `NPM_TOKEN`
repository secret that can publish under `@misiki`.

## License

MIT
