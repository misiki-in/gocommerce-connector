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
# PUBLIC_GOCOMMERCE_BASE_DOMAIN=shopnx.in             # or every store: acme.shopnx.in is store `acme`
# PUBLIC_GOCOMMERCE_LANGUAGE=fr                       # ask for this language (?lang=) on every read
```

**Leave `PUBLIC_LITEKART_API_URL` unset.** The storefront rewrites every
server-side request whose path starts with `/api` to that host, and the
engine's routes start with `/api` too.

### The engine

Start it with the modules the storefront has screens for. The flags go before
`serve`; the engine ignores any that come after it.

```bash
gocommerce -identity -wishlist -reviews -cms -faq -menus serve
```

Each is optional. Without `-identity` there is no sign-in (guest checkout
always works); without `-reviews` products show no stars; and so on. Add
`-meilisearch` (with `MEILI_HOST` and keys) for typo-tolerant search once a store
switches the Meilisearch plugin on,
`-newsletter` and `-contact` for the signup box and contact form,
`-whatsapp` for WhatsApp order updates, and `-b2b` for
business buyers (see "Beyond the storefront's screens").

### The browser and CORS

The engine sends CORS headers only to the origins listed in
`GOCOMMERCE_CORS_ORIGINS` (comma-separated, or `*` for any). Unset, a browser on
the storefront's origin cannot read a response from the engine's. Server-side
rendering is unaffected; it is the bag, sign-in and checkout — which run in the
browser — that need a route.

The simplest is to list the storefront's origin when starting the engine,
`GOCOMMERCE_CORS_ORIGINS=https://shop.example`, and leave
`PUBLIC_GOCOMMERCE_PROXY_PATH` unset. The browser then calls
`PUBLIC_GOCOMMERCE_API_URL` directly, so that has to be an address the
shopper's browser can reach.

Or proxy a path on the storefront's own origin to the engine and name it in
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

### One storefront for every store

Under `gocommerce platform` a storefront can sell for one store, named in
`PUBLIC_GOCOMMERCE_STORE`, or for all of them. Set `PUBLIC_GOCOMMERCE_BASE_DOMAIN`
to the domain the engine hands out subdomains of and point every
`<slug>.<base domain>` at the one deployment: a request for `acme.shopnx.in` is
sent to the engine with `X-Store: acme`, by the same rule the engine applies to
its own host (one label, case-insensitive, a port ignored). A host outside the
base domain falls back to `PUBLIC_GOCOMMERCE_STORE`; without one it is sent as
it is, `X-Store: chillish.in`, which the engine answers when a store has added
and verified that domain. Point a store's own domain at this deployment and it
shows that store.

The browser knows its own host. The server does not, so tell the connector where
to read it, once, from `src/hooks.server.ts`:

```ts
import { getRequestEvent } from '$app/server'
import { setRequestHost } from '@misiki/gocommerce-connector'

setRequestHost(() => getRequestEvent().url.hostname)
```

Each store renders with the name, email and phone its owner set in the panel
(`GET /api/store`); the static record's values stand only where the owner left
one empty. Store-level facts (name, plugins, currency, menus) are cached per
store, so two stores on one process never see each other's. A host under the base domain that names
a store the engine does not have makes `getStoreByIdOrDomain` throw a
`GoCommerceError` with status 404 and "store not found" in its message, which
Svelte Commerce renders as its own "Store not found" page. An engine that is
down stays best-effort: the storefront renders from its static record.

## What maps to what

| Storefront | Engine |
| --- | --- |
| product page, listings, search | `/api/products`, `/api/products/slug/{slug}` (an id or SKU also works) |
| category pages and tree | `/api/categories`, `/api/categories/{slug}` — a category sells its descendants |
| the filter rail's categories | the counts from `/api/products?facets=1`, each with its ancestors from `/api/categories?flat=1`, in tree order and with its `depth`. A parent counts its whole subtree |
| collections | `/api/collections`, `/api/collections/{slug}` |
| featured / trending shelves | the collection with slug `featured` / `trending`; newest products when there is none |
| product page extras | on the product from `/api/products/slug/{slug}` (D134): `highlights` and `freeGift` from the product's own metadata, `soldAtLeast` when the shop shows sold counts (null otherwise, never zero), and the product's videos after its pictures in `images` (and alone in `videos`), so the gallery plays them |
| bag | `/api/carts…`, `/api/carts/{token}/discount`. When the engine answers an add with `cart_not_found` or `cart_checked_out`, the line goes to a fresh cart. An older engine without those codes is read by its words |
| Complete the set (add-ons) | `/api/add-ons?product_id=` — `productService.listAddOns({ product })`, each at the price ticking it adds (`price`) beside its own (`regularPrice`); `cartService.addAddOn({ addOnId })` after the product is in the bag. The engine keeps the offer price only while the product is in the bag, one for each |
| product customizer (D162) | `/x/customizer/products/{id}` — `customizerService.setup(productId)`: the product's design editor (mockup, overlay, print area and print size, tools, fonts, stickers, smallest sharp photo, consent line), with every picture through the proxy path so a canvas that draws it can still be exported. Null while ext/customizer is off (read from `/api/plugins`, so no request is made per product), for a product that cannot be designed, and on any failure. `/x/customizer/uploads` — `customizerService.upload(file)`: a photo, preview or print file, sent as the multipart field `file`; a refusal (413, 415, 422, 429, 501) is thrown with the engine's message. `/x/customizer/designs` — `customizerService.saveDesign({ productId, variantId, previewUploadId, printUploadId, document })`, with the version 1 document sent as the engine keeps it on the order. `cartService.addToCart({ variantId, designId })` puts the design in the bag on a line of its own; cart and order lines carry `designId` and `designPreview`, both null on a line sold as it is, and an `orderService.buyAgain()` line carries its `designId` and its product's `designable`. Every product, in a listing and a search hit too, carries `designable`: true when it is sold only made to a design (open the editor, offer no quick add), false for a plain product (skip `setup`), and undefined when the engine does not say, from an older engine or a search index built before GoCommerce #215 (ask `setup`). For a plain line of a designable product, `cartService.addToCart` throws a `GoCommerceError` with `code` `design_required` and status 409, and a bag that is still open stays as it was |
| You may also like | `/api/cross-sells?product_id=` — `productService.listCrossSells({ product })`, curated only; the bag's `/api/carts/{token}/cross-sells` — `cartService.listCrossSells()`, which includes the collection the shop chose for every basket (D134), falling back to the first item's related products |
| the bag's offers and free delivery | `/api/carts/{token}/offers` — `cartService.getOffers()` and the coupon drawer's `couponService.listCoupons()`: only the codes the shop chose to show; `/api/carts/{token}/free-shipping` — `cartService.getFreeShipping()`, from the store's own rates, null when it cannot say |
| delivery options | `/api/checkout/rates` |
| payment methods | `/api/checkout` — cash on delivery, Razorpay, and the first hosted-page gateway (see below) |
| place order | `POST /api/checkout/{code}` with an `Idempotency-Key` |
| order lookup | `/api/orders/{number}?token=` (guest), `/x/identity/me/orders` (account) |
| sign-in, sign-up, profile, password reset | `/x/identity/*` |
| address book | `/x/identity/me/addresses`, with its `label` (Home, Work, Other) |
| PIN code autofill | `/api/postcodes/IN/{pin}` — `addressService.lookupPostcode({ country, postcode })`: city and state, or null when the engine has no directory or the PIN is unknown (D134) |
| wishlist | `/x/wishlist` |
| reviews | `/x/reviews` |
| Google reviews | `/x/google-reviews/place` — `googleReviewService.place()`: the store's Google rating, rating count and up to five Google reviews with their authors' names, photos and profile links, read live on every call because Google's terms forbid keeping them (call it when the section is in view; each call is billed to the store's Google key). Null while ext/google-reviews or its `show_place` switch is off, when the place has no ratings, when the day's lookups are spent (429) or Google refuses (502). `/x/google-reviews/survey/{number}` — `googleReviewService.survey(number)`: Google Customer Reviews' opt-in fields, built by the engine from an order placed in this browser, read with its access token; null for any other order or while `customer_reviews` is off |
| content pages (`/p/…`, legal pages) | `/x/cms/pages` |
| FAQ | `/x/faq` |
| composed home page | `/x/layouts/home` (`?preview=` for a draft) — `layoutService.getHomeLayout()`, null when the store has none; carries `themeSettings` and each collection list's `collections` |
| product and collection templates | `/x/layouts/product`, `/x/layouts/collection` (`?preview=` for a draft) — `layoutService.getProductLayout()` and `getCollectionLayout()`, the sections the shop arranged around the page's core (`main-product`, `main-collection`); null when none is published, and the page draws as before |
| header and footer | `/x/layouts/header`, `/x/layouts/footer` (`?preview=` for a draft) — `layoutService.getHeader()` and `getFooter()`: the announcement strip and header menu, the footer's columns menu, words, newsletter switch, social links and copyright line, with the named menu read live from `/x/navigation/menus/{handle}`; null when none is published or on any failure, and the storefront keeps its own. The store's `header` and `footer` menus (`menuService.engineMenus()`, the store record's `menu`) are the ones those name |
| theme settings | `/x/layouts/theme` (`?preview=` for a draft) — `layoutService.getThemeSettings()`, the store's colours, fonts and rounding for every page; null when there are none |
| menus | `/x/navigation/menus/{header,footer}`, laid over `store.menu`; any menu by handle |
| product specs table | the product's category attribute answers |
| attribute filters (`?attributes.color=Red`) | `/api/products?attr=color:Red` |
| newsletter box | `/x/newsletter/subscribe` |
| WhatsApp order updates at checkout | `/x/notify-whatsapp/consent` — `whatsappService.consentOffer()`: `{ enabled, marketing }`, whether to show the order-updates box and the offers-and-reminders box; both false when ext/notify-whatsapp is not in the engine or does not answer, so checkout never waits on it. `whatsappService.setConsent({ cartId, phone, orderUpdates, marketing })` (PUT) records both answers for the phone, an unticked box as `false`; with `marketing` the engine keeps the phone on the bag for basket reminders. It throws the engine's 400 (`validation_failed`) when the phone is not a WhatsApp number for the store's country |
| contact form, product enquiries | `/x/contact/messages`, with the form's hidden `website` honeypot passed on so the engine drops what a bot filled in |
| search words, type-ahead (plugin on) | `/x/meilisearch/search`, falling back to the engine's own search when it is off or down |
| store record | the storefront's own config, with the engine's currency, menus and module switches over it; the store's own logo, dark logo and icon (`logo_url`, `logo_dark_url`, `icon_url` from `/api/store`, D148) replace `logo`, `logoDark` and `favicon` when it has them; for the contact page (D156), the address once the store shows it (as `address: { street, city, state, pincode, country }`), `mapLocation` and `openingHours` when set, `businessCountry` (the store's ISO country, for the phone's country code), the `whatsapp-chat` plugin's number as `plugins.whatsappChatButton`, and Google Customer Reviews (ext/google-reviews) as `plugins.googleReviewsOptIn` (`active` while the survey is on), `plugins.googleStoreWidget` (`{ active, position: 'RIGHT_BOTTOM' \| 'LEFT_BOTTOM' }`, off without the survey), and the `criteo` plugin's account as `plugins.criteo: { active, accountId }` (the engine decides, never the static record) |
| store closed, or behind a password (D170) | `store-close` in `/api/plugins`: the store record's `closed` is `{ message, password }` while it is on, `password` saying whether the store has one (never what it is), and absent while the store is open, whatever the static record says and even when the rest of the record fails. `POST /api/store/password` — `storeService.unlockStore(password, { clientAddress })` trims what was typed and answers `{ outcome: 'unlocked', pass: { token, expiresAt } }`, or an `outcome` of `wrong`, `throttled` (the engine allows 20 tries an hour), `open` (the store takes no password now) or `unavailable`, and never throws. It sends `clientAddress`, the shopper's, as `X-Forwarded-For`, so shoppers behind one storefront do not share those tries; the engine believes it only from a server in its `GOCOMMERCE_TRUSTED_PROXIES`. `storeService.checkStorePass(token)` checks a pass without spending a try: the pass, or null when it is wrong, expired or ended by a new password, and it throws the `GoCommerceError` when the engine cannot answer |
| resized product pictures | `/images/{store}/cdn-cgi/image/width=…/…` — the store record's `plugins.imageCdn` is turned on with provider `cloudflare` and the engine's `images_path` (from `/api/store`, D139) after `PUBLIC_GOCOMMERCE_API_URL`, so the storefront's srcset asks the engine for each width; an engine without it leaves the static record's setting |

Blogs, banners, reels, chat, warranties, deals and uploads have no engine
equivalent. Their lists answer empty and anything that would write or open one
record throws `NotSupportedError`, naming the service and the method — a silent
success would tell a shopper their message was sent when nothing left the
browser.

## Beyond the storefront's screens

Every shopper-facing route the engine serves is reachable through this package —
CI fails when the engine gains one that is not (`scripts/route-coverage.mjs`). The
routes Svelte Commerce has no screen for are reached through services named for
what they do. These answer the engine's own shapes — numeric ids, money as
`{ amount_minor, currency }` — where the family's services answer Litekart's.

| Service | Covers |
| --- | --- |
| `b2bService` (ext/b2b) | the company, roles and credit (`me`); members and roles; invitations; a quick order by SKU (`addLines`) and a repeat order (`reorder`); checkout on account with a PO number and partial lines, or an approval request; approve, reject, withdraw; quotes requested, read, accepted, declined; the public dealer form (`submitLead`) and a dealer's leads |
| `checkoutService.checkout(code)` | any payment method the engine has switched on, answering a client secret, a redirect URL or nothing to do; `listMethods()` names them all |
| `variantService` | a product's variants, one variant, and the marketplace's offers on it |
| `newsletterService` | subscribe and unsubscribe |
| `userService` | `requestEmailVerification()`, `refreshSession()`, and `claimOrder({ number })` — files a guest order under the account, explicitly: never at sign-in, where a shared computer would file one person's orders under the next |
| `menuService` | `listMenus()` and `getMenu(handle)` beyond the header and footer |
| `wishlistService` | `setEmail()` for back-in-stock mail |

The admin API is deliberately not here. It takes an operator's token, and a
storefront package runs in every shopper's browser.

```ts
import { b2bService } from '@misiki/gocommerce-connector'

const { role, credit } = await b2bService.me()
const { cart, rejected } = await b2bService.addLines({ lines: [{ sku: 'TEE-M', quantity: 24 }] })
const placed = await b2bService.checkout({ poNumber: 'PO-1042' })
if (placed.kind === 'approval') console.log('waiting for an approver', placed.approval.id)
```

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
- **Payment.** The storefront drives a fixed list of gateway flows and passes
  none of them the gateway the shopper chose. Cash on delivery and Razorpay's
  modal match engine gateways directly. The storefront's redirect flow (which it
  reaches by the code `PAYPAL`) carries the store's first hosted-page gateway —
  Adyen, Paddle, Lemon Squeezy, Creem, Hyperswitch or RevenueCat — under that
  gateway's own name and a neutral card icon; a second one cannot be told apart
  from the first and is not offered. GoCommerce's Stripe is a Payment Element (a
  client secret), which this storefront does not mount. Every method left off is
  reported once in the console, and every one is reachable through
  `checkoutService.checkout(code)` for a storefront that drives its own payment
  UI. Payment is confirmed by the gateway's webhook to the engine; the order
  shows `paymentStatus` once it lands.
- **Filters on an older engine.** Listing filters and their counts (tags,
  vendor, product type, category attributes, price) need an engine that counts
  them (`GET /api/products?facets=1`, D130). Against an older one the filter
  rail is empty and a category page's attribute filters are not applied.
- **Category counts in a large shop.** The engine counts a listing's products
  in at most 100 categories, the ones with the most products. The connector adds
  those counts up to each parent, so in a shop with more categories a parent's
  count misses the products of the categories the engine left out.
- **Tax in the bag.** The engine's cart carries no tax or total; tax is computed
  when the order is placed. The bag shows subtotal − discount + delivery, and the
  order shows the real figures.
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

`test/unit.test.mjs` covers the translation with no engine. The live suites,
`test/live.test.mjs` and `test/live-more.test.mjs`, run the connector against a
real one, seeding what they need through the admin API under names unique to
the run:

```bash
gocommerce -admin-token dev-token -identity -wishlist -reviews -cms -faq -menus -newsletter -contact -b2b serve
GOCOMMERCE_URL=http://127.0.0.1:8080 GOCOMMERCE_ADMIN_TOKEN=dev-token \
GOCOMMERCE_TEST_DB=postgres://…/the-stores-database npm test
```

`GOCOMMERCE_TEST_DB` lets the b2b suite mark its test accounts' emails
confirmed — the engine confirms one only from a link it mails — and without it
those tests skip. Use a throwaway store. The suites skip, loudly, when there is
no engine. CI runs them against GoCommerce's `main` on every push and nightly,
along with the route-coverage check.

## Releasing

Bump `version` in `package.json` and push it to `main`. The Publish workflow
sees a version npm does not have yet, builds, tests, publishes it with
provenance, and creates the matching `v<version>` tag and GitHub release. It
needs an `NPM_TOKEN` secret in the repository's `npm-publish` environment, able
to publish under `@misiki`.

## License

MIT
