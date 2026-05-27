# Platinum Micro — Liquid Theme

A custom Shopify Liquid theme that ports the [Platinum Micro Hydrogen storefront](https://github.com/anujyadav140/platinummicro-hydrogen) 1:1 to a classic Shopify theme. Same visual design, same UX flows, same component vocabulary — just rendered server-side by Shopify's standard `templates/*.json` + `sections/*.liquid` pipeline instead of React + Hydrogen.

Built for the **platinum-micro.myshopify.com** store.

---

## What's in here

```
assets/
  pm-theme.css            # Single CSS file — design tokens + every component
  pm-header.js            # Mega-menu hover + mobile nav drawer
  pm-quick-order.js       # Bulk-SKU modal → /cart/add.js
  pm-cart-drawer.js       # Slide-out cart drawer (optimistic remove)
  pm-add-to-cart.js       # Universal [data-pm-add] handler
  pm-facets.js            # Collection / search facets — AJAX swap + dual-range slider
  pm-plp.js               # View toggle + sort menu + client-side sort + auth redirect + welcome toast
  pm-compare.js           # Product compare store + bar + page

layout/
  theme.liquid            # Document shell, scripts, body data attributes, 404 head-script

sections/
  pm-top-bar.liquid       # Trust strip + Sign in / Quick order / Phone
  pm-header.liquid        # Logo + search + actions + nav rail with mega menu (data inlined)
  pm-hero-banner.liquid   # Home hero
  pm-banner-strip.liquid  # Tan thin banner
  pm-card-section.liquid  # "Industries we serve" 3×2 poster grid
  pm-brand-wall.liquid    # "Authorized partners" horizontal logo scroller w/ chevrons
  pm-promotion-card.liquid
  pm-about-banner.liquid
  pm-footer.liquid        # Catalog / Programs / About columns + legal row

  pm-collection.liquid    # PLP: breadcrumb + toolbar + facets + product grid
  pm-search.liquid        # Search results: same layout, client-side sort
  pm-product-detail.liquid # PDP: gallery + info + AJAX +Add + compare checkbox
  pm-cart.liquid          # Full /cart page
  pm-customer-login.liquid     # legacy Classic accounts (kept for reference)
  pm-customer-register.liquid  # legacy Classic accounts (kept for reference)
  pm-customer-forgot-password.liquid # legacy Classic accounts
  pm-static-page.liquid   # Generic /pages/<handle> renderer (delegates to snippet)
  pm-page.liquid          # legacy generic page (kept for reference)
  pm-collection-header.liquid  # legacy (replaced by pm-collection)
  pm-product-grid.liquid       # legacy (replaced by pm-collection)
  pm-404.liquid           # 404 + JS-promotion of static pages from hidden pool

snippets/
  pm-static-body.liquid   # All seven info pages (about/brands/contact/etc) + compare + sign-in + register
  pm-mega-card.liquid     # Single mega-menu card
  pm-mega-data.liquid     # (Documentation; data is inlined in pm-header.liquid)
  pm-product-card.liquid  # PLP product card
  pm-facets.liquid        # Brand / Price (dual-range slider) / Availability / Promotions
  pm-sort-menu.liquid     # Custom Hydrogen-style sort dropdown
  pm-quick-order.liquid   # Bulk SKU modal markup
  pm-cart-drawer.liquid   # Cart drawer markup
  pm-compare-bar.liquid   # Floating compare bar (expanded + collapsed pill)
  pm-form-field.liquid    # Shared form-field helper

templates/
  index.json              # Home page sections
  collection.json         # → pm-collection
  search.json             # → pm-search
  product.json            # → pm-product-detail
  cart.json               # → pm-cart
  page.json               # → pm-static-page (handle-routed)
  404.json                # → pm-404
  customers/login.json    # Classic accounts template (no-op under New Customer Accounts)
  customers/register.json # Classic accounts template (no-op under New Customer Accounts)
  customers/reset_password.json # Classic accounts template (no-op)

config/
  settings_schema.json
  settings_data.json

locales/
  en.default.json
```

---

## Key architectural decisions

### Mega menu — inline data, no admin setup required
Shopify's `linklists` only carries top-level menu items on this store. To render the rich Hydrogen-style mega menu without forcing the merchant to rebuild the entire menu hierarchy in admin, the category map is **inlined directly in `pm-header.liquid`** as `Title~handle~image~blurb` strings, keyed by the top-level link's handleized title. The card renderer (`snippets/pm-mega-card.liquid`) accepts explicit `col_image_url` / `col_blurb` overrides AND falls back to live `collections[handle]` data when the merchant later creates the matching Shopify collection.

### Static info pages — no admin pages required
The footer links to seven info pages (`/pages/about`, `/pages/brands`, `/pages/contact`, `/pages/shipping-returns`, `/pages/site-map`, `/pages/social-responsibility`, `/pages/order-verification`) plus `/pages/compare`, `/pages/sign-in`, `/pages/register`. The merchant doesn't have to create any of these in Shopify admin — the theme handles them via **`sections/pm-404.liquid`**:

1. Every known handle's static body is pre-rendered (hidden) into the 404 template.
2. On load, the head script in `theme.liquid` sets `html[data-pm-static-pending]` for any known `/pages/<handle>` URL so the 404 placeholder never paints.
3. JS reads `window.location.pathname`, matches the handle against the hidden pool, promotes the matching body out, removes the 404 + pool, updates `document.title`, and fires `pm:static-mounted` for downstream components to re-init.

If the merchant *does* create a real page with the same handle in admin, the standard `templates/page.json` → `pm-static-page` → `pm-static-body` chain handles it (HTTP 200, no 404 routing).

### Collection / search PLP — Dawn-style facets, AJAX swap
Modeled on Shopify Dawn's facets pattern: every input/select change is debounced, current form data serialized to a querystring, `fetch()` the same URL, parse the response, swap the `#pm-facets-form`, `#pm-plp-header`, and `#pm-plp-grid-wrap` `innerHTML`. The dual-range price slider is built with two overlaid `<input type="range">` elements + a fill bar — fully draggable, syncs both directions with the number inputs.

For search-page sort: Shopify's `/search` endpoint only honors `relevance` / `price-ascending` / `price-descending` server-side. Title-asc / title-desc are post-sorted client-side from the visible page after every PLP update.

### Quick Order + Cart Drawer
- Quick Order modal collects `{sku, qty}` rows. SKU lookup is a two-step against Shopify: predictive `/search/suggest.json?fields=sku` → fetch each candidate `/products/{handle}.js` → match `variants[].sku` case-insensitively. Multi-add via `POST /cart/add.js {items: [...]}`. Fires `pm:cart-changed` on success.
- Cart drawer listens for `pm:cart-changed` and slides in. Quantity ± / remove are **optimistic** — DOM update + header badge happen immediately, network request fires in parallel with no debounce on remove.

### Compare
- `window.PmCompare` — localStorage store, capped at 4. Add/remove/clear, fires `pm:compare-changed`.
- Checkbox on every `[data-pm-compare]` element auto-syncs with the store on load + after AJAX swaps.
- Floating bar (`snippets/pm-compare-bar.liquid`) shows thumbs + count, with a collapse-to-pill (`COMPARE 2 ⌃`) for unobtrusive mode.
- `/pages/compare` renders a side-by-side spec table with a Highlight Differences toggle.

### New Customer Accounts
Shopify removed Classic accounts for this store — `/account/login` and `/account/register` are 404s. The `[data-pm-auth-redirect]` form interceptor in `pm-plp.js` redirects to `/account?return_to=<storefront origin>/&email=<typed>` so users land back on the homepage after Shopify's hosted email-link auth. A `sessionStorage` flag flips to a centered welcome toast (`"Signed in, <Name>. Welcome back to Platinum Micro."`) on the next page load.

---

## Working locally

```bash
# Sync the local theme to a dev preview
shopify theme dev --store platinum-micro

# One-off push without watch mode
shopify theme push

# Pull the published theme back down (overwrites local — careful)
shopify theme pull
```

---

## Required admin setup

| Where | What |
|---|---|
| **Online Store → Navigation → Collection and search filters** | Add Vendor, Price, Availability filters so the facets sidebar gets data |
| **Online Store → Files** | Hero, brand logos, industry posters, and product photos already live here |
| **Settings → Customer accounts** | Cannot switch back to Classic — already locked to New Customer Accounts (handled by the theme as described above) |
| **Products** | Use category tags in ALL-CAPS (`VIDEO`, `WEBCAMS`, `PERIPHERALS`, `EXTERNAL HARD DRIVES`) so the mega menu's tag-based search redirect resolves to the right products |
