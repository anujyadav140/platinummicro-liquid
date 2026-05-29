# Platinum Micro — Liquid Theme

A custom Shopify Liquid theme that ports the [Platinum Micro Hydrogen storefront](https://github.com/anujyadav140/platinummicro-hydrogen) 1:1 to a classic Shopify theme. Same look, same flows, same component names — but rendered server-side by Shopify's standard `templates/*.json` + `sections/*.liquid` pipeline instead of React + Hydrogen.

Built for the **platinum-micro.myshopify.com** store (a B2B IT distributor).

> 🔗 **Live store — see it in action:** **<https://platinum-micro.myshopify.com/>**

---

## TL;DR for a new teammate

- **Styling** is split by domain into `assets/pm-*.css` files (one per area — header, product, cart, compare, …), loaded in order by `layout/theme.liquid`. Design tokens (colours, spacing, timing) are CSS variables in `pm-tokens.css`, which loads first — always reuse a `--pm-*` variable instead of hard-coding a colour. See [CSS architecture](#css-architecture) before editing.
- **Behaviour** is split into small vanilla-JS modules, one per feature, each named `assets/pm-*.js`. No framework, no build step. Every file starts with a header comment explaining what it does.
- **Markup** is Liquid: page layouts are `sections/`, reusable bits are `snippets/`, and which sections appear on which page is decided by `templates/*.json`.
- **Cross-feature wiring** is done with two patterns: `data-*` attributes (to tag a button/element) and custom DOM events (e.g. `pm:cart-changed`) so modules can talk without importing each other.
- **No build, no npm.** Edit a file → `shopify theme dev` shows it instantly.

---

## File map

```
assets/
  # CSS — split by domain, loaded IN THIS ORDER by layout/theme.liquid.
  # Order mirrors the old single-file cascade; keep tokens → base first.
  pm-tokens.css           # 1  Design tokens (--pm-* CSS variables) — loads first
  pm-base.css             # 2  Reset, base elements, .pm-container
  pm-header.css           # 3  Top bar, header, nav rail, mega menu, partner brands
  pm-home-sections.css    # 4  Hero, banner strip, card section, brand wall, promo/about
  pm-footer.css           # 5  Footer
  pm-overlays.css         # 6  Mobile nav drawer, shared buttons, quick-order, cart drawer
  pm-collection.css       # 7  Search bar, PLP, product card, facets, static info pages
  pm-account.css          # 8  Register, sign-in landing, account dashboard
  pm-product.css          # 9  PDP: gallery, buy-box, bundles, description/specs
  pm-compare.css          # 10 Floating compare bar, /pages/compare grid, toast
  pm-lists.css            # 11 Add-to-list popover, header lists button, /pages/lists
  pm-auth-misc.css        # 12 Customer auth forms, focus rings, form-field, recently-viewed

  pm-product-specs.json   # Static spec lookup table (fallback spec data by product)

  pm-header.js            # Mega-menu hover + mobile nav drawer
  pm-predictive-search.js # Header search autocomplete (Predictive Search API)
  pm-quick-order.js       # Bulk-SKU modal → /cart/add.js
  pm-cart-drawer.js       # Slide-out cart drawer (Shopify items + quote items)
  pm-add-to-cart.js       # Universal [data-pm-add] "+ Add" button handler
  pm-add-to-list.js       # "Add to list" popover (localStorage lists)
  pm-lists-page.js        # /pages/lists dashboard (grid + detail views)
  pm-quote.js             # Local "quote" cart for out-of-stock items
  pm-facets.js            # Collection/search facets — AJAX swap + dual-range slider
  pm-plp.js               # View toggle + sort + auth redirect + welcome toast
  pm-compare.js           # Product compare store + floating bar + compare page
  pm-recently-viewed.js   # Recently-viewed strip (PDP + cart drawer)
  pm-pdp-pdf.js           # "Download datasheet (PDF)" generator (jsPDF, client-side)
  pm-auth-anchor.js       # Pins Shopify's account popup under the Sign-in button

layout/
  theme.liquid            # Document shell: scripts, body data attributes, 404 head-script

sections/                 # One section = one page region (chosen by templates/*.json)
  pm-top-bar.liquid       # Trust strip + Sign in / Quick order / Phone
  pm-header.liquid        # Logo + search + actions + nav rail with mega menu + partner-brand blocks
  pm-predictive-search.liquid # Search autocomplete results (rendered via Section Rendering API)
  pm-footer.liquid        # Catalog / Programs / About columns + legal row

  pm-hero-banner.liquid   # Home hero
  pm-banner-strip.liquid  # Thin tan banner
  pm-card-section.liquid  # "Industries we serve" poster grid
  pm-brand-wall.liquid    # "Authorized partners" logo scroller
  pm-promotion-card.liquid
  pm-about-banner.liquid

  pm-collection.liquid    # PLP: breadcrumb + toolbar + facets + product grid
  pm-search.liquid        # Search results (same layout, client-side title sort)
  pm-product-detail.liquid # PDP: gallery + buy box + specs + bundle + PDF button
  pm-product-banner.liquid # Custom landing-page banner (e.g. HPE + AMD)
  pm-cart.liquid          # Full /cart page (Shopify items + quote items)
  pm-lists-page.liquid    # Server shell for the /pages/lists dashboard
  pm-static-page.liquid   # Generic /pages/<handle> renderer (delegates to snippet)
  pm-404.liquid           # 404 page + JS-promotion of static pages

  pm-customer-login.liquid           # Classic-accounts fallback template
  pm-customer-register.liquid        # Classic-accounts fallback template
  pm-customer-forgot-password.liquid # Classic-accounts fallback template

snippets/                 # Reusable markup, rendered with {% render %}
  pm-mega-card.liquid     # Single mega-menu card
  pm-product-card.liquid  # PLP product card
  pm-facets.liquid        # Brand / Price slider / Availability / Promotions
  pm-sort-menu.liquid     # Custom sort dropdown
  pm-quick-order.liquid   # Bulk-SKU modal markup
  pm-cart-drawer.liquid   # Cart drawer markup
  pm-compare-bar.liquid   # Floating compare bar
  pm-pdp-specs-build.liquid # Extracts product specs from metafields → spec rows
  pm-static-body.liquid   # All info pages (about/brands/contact/etc) + compare
  pm-form-field.liquid    # Shared form-field helper

templates/                # Maps a URL type to the section(s) that render it
  index.json    → home sections        product.json  → pm-product-detail
  collection.json → pm-collection      cart.json     → pm-cart
  search.json   → pm-search            page.json     → pm-static-page (handle-routed)
  page.lists.json → pm-lists-page      404.json      → pm-404
  customers/{login,register,reset_password}.json → classic-accounts fallback

config/   settings_schema.json, settings_data.json
locales/  en.default.json
```

---

## Feature guide (in plain words)

### Mega menu — no admin setup needed
Shopify's menu only stores the top-level links on this store. To draw the rich Hydrogen-style dropdown without forcing the merchant to rebuild the whole menu in admin, the category map is **written directly inside `pm-header.liquid`** as `Title~handle~image~blurb` strings. `pm-mega-card.liquid` draws each card, and if the merchant later creates a real matching collection, it automatically uses that live data instead.

The **"Partner brands" logo rail** inside the wider mega panels is merchant-editable: add **"Partner brand"** blocks to the header section in the theme editor (logo + name + link). If no blocks are added, a built-in default set of six brands renders so the rail is never empty.

### Predictive search — type-ahead autocomplete (`pm-predictive-search.js`)
The header search is progressively enhanced with Shopify's **Predictive Search**. As the shopper types (2+ chars, debounced), `pm-predictive-search.js` fetches `routes.predictive_search_url` with `&section_id=pm-predictive-search` and drops the rendered `pm-predictive-search.liquid` section into a dropdown — product suggestions (thumb + vendor + price), collections, query suggestions, and a "see all results" link. Results come straight from the `predictive_search` Liquid object, so pricing/formatting match the rest of the theme. With JS off, the form still submits to `/search` normally.

### Static info pages — no admin pages needed
The footer links to pages like `/pages/about`, `/pages/contact`, `/pages/compare`, etc. The merchant doesn't have to create any of these. The trick lives in `pm-404.liquid`:
1. Every known page's body is pre-rendered (hidden) into the 404 template.
2. A small script in `theme.liquid` hides the body for known `/pages/<handle>` URLs so the 404 never flashes.
3. JS matches the URL, swaps the real body in, fixes the page title, and fires `pm:static-mounted`.

If the merchant *does* create a real page with the same handle, the normal `page.json → pm-static-page → pm-static-body` path handles it (a true 200, no 404 trick).

### PLP (collection / search) — facets with AJAX swap
Modeled on Shopify Dawn. Any filter/sort change is debounced, the form is turned into a querystring, the same URL is re-fetched, and only the form + header + grid are swapped in — no full reload. The price filter is a real **dual-range slider** (two overlaid range inputs + a fill bar) synced with number boxes. Search-page title sorting is done client-side because Shopify's `/search` only sorts by relevance/price server-side.

### PDP (product page)
`pm-product-detail.liquid` renders the gallery, buy box, specs, optional bundle, and a JSON "data island" used by the PDF button. The buy-box buttons, in order: **Add to Cart → Add to List → Add to Quote → Download datasheet (PDF) → Compare**.

**Specs** come from `pm-pdp-specs-build.liquid`, which looks for product data in priority order:
1. Aggregate metafields (BigCommerce-style pipe/comma packed fields).
2. Standard Shopify category metafields (auto-filled when a product has a category).
3. Falls back to `pm-product-specs.json` / description text.

### PDF datasheet (`pm-pdp-pdf.js`)
Click **Download datasheet (PDF)** → the module reads the PDP's JSON data island, lazy-loads jsPDF from a CDN (only on first click, ~50 KB), and builds a clean, self-contained PDF: header → title + price + image → description → key features → a modern spec table → footer with the product URL and page numbers. Buyers can forward this to procurement without sharing a login. It reads from the JSON island (not the rendered HTML), so changing the page markup won't break the PDF.

### Lists (`pm-add-to-list.js` + `pm-lists-page.js`)
A "save for later" feature backed by `localStorage` (key `pm:lists:v1`, same shape as the Hydrogen store so a shared backend could read both later).
- **Add to List** button opens one shared popover to pick/create a list.
- `/pages/lists` is a dashboard: a grid of all lists, and a detail view (`#list_xxx`) for one list with qty steppers, remove, and delete-list.

### Quote (`pm-quote.js`)
Shopify refuses to add an out-of-stock "deny" item to the real cart. So those items go into a **local quote cart** (`pm:quote:v1`) instead. The cart drawer and `/cart` page merge them in alongside real items, marked with a **QUOTE** pill.

### Cart drawer (`pm-cart-drawer.js`)
Slide-out drawer that opens when anything fires `pm:cart-changed`. Quantity ± and remove are **optimistic** (the UI updates instantly, the network call runs in the background). The header cart badge counts BOTH Shopify cart lines and local quote items.

### Compare (`pm-compare.js`)
`window.PmCompare` is a `localStorage` store (key `pm-compare`, max 4 items). A checkbox on each product syncs with it, a floating bar shows thumbnails (collapsible to a pill), and `/pages/compare` shows a side-by-side spec table with a "highlight differences" toggle.

### Recently viewed (`pm-recently-viewed.js`)
Every PDP visit is logged to `localStorage` (`pm:recently-viewed:v1`) and shown as a strip on the PDP and a compact list in the cart drawer.

### Bundles
The PDP reads `pmb`-namespace metafields to render a bundle card. JS computes the bundle price and adds all lines in one `/cart/add.js` call.

### Customer accounts (`pm-auth-anchor.js` + `pm-plp.js`)
This store uses **New Customer Accounts** (Classic is gone — `/account/login` 404s). The login form is intercepted and redirected to Shopify's hosted email-link auth, returning the user to the homepage. A `sessionStorage` flag then shows a centered "Welcome back" toast. `pm-auth-anchor.js` pins Shopify's account popup neatly under the Sign-in button.

---

## Conventions (read this before editing)

**Naming** — every theme file, CSS class, and global is prefixed `pm-` / `Pm` so it never clashes with Shopify or app code.

**CSS** — split into domain files (`assets/pm-*.css`), loaded in order by `theme.liquid` (see [CSS architecture](#css-architecture)). Reuse the design tokens from `pm-tokens.css`:
| Token kind | Examples |
|---|---|
| Brand colours | `--pm-navy-deep`, `--pm-terracotta` |
| Neutral ramp | `--pm-ink-900` … `--pm-ink-100`, `--pm-paper` |
| Timing | `--pm-dur-fast`, `--pm-dur-base` |

**localStorage keys** (each owned by one module):
| Key | Owner | Holds |
|---|---|---|
| `pm:lists:v1` | pm-add-to-list / pm-lists-page | Saved lists |
| `pm:quote:v1` | pm-quote | Quote-cart items |
| `pm:recently-viewed:v1` | pm-recently-viewed | Recently viewed PDPs |
| `pm-compare` | pm-compare | Compare selection (≤4) |
| `pm:topbar-dismissed:v1` | pm-top-bar-body inline script | Dismissed top-bar **content signatures** → timestamp (30-day TTL). Keyed by content so edited/new banners re-appear. |

**Custom events** (how modules talk without importing each other):
| Event | Fired by | Listened by |
|---|---|---|
| `pm:cart-changed` | add-to-cart, quick-order, quote | cart-drawer (opens) |
| `pm:compare-changed` | pm-compare | compare bar / page |
| `pm:static-mounted` | pm-404 static-page swap | anything needing re-init after page swap |

**Hook attributes** (JS finds elements by these, never by class):
`data-pm-add`, `data-pm-add-to-list-trigger`, `data-pm-quote-add`, `data-pm-compare`, `data-pm-pdp-pdf`, `data-cart-open`, `data-cart-badge`, `data-pm-rv-track` / `-mount` / `-drawer`, `data-pm-auth-redirect`, `data-pm-search` / `data-pm-search-results`.

**Golden rules**
- Reuse a `--pm-*` token instead of a raw colour/size.
- Talk between modules with events, not direct calls.
- Tag elements with `data-*` hooks; don't make JS depend on CSS class names.
- Keep each JS/CSS file to one feature/domain, with its header comment up to date.

---

## CSS architecture

The stylesheet used to be one 6k-line `pm-theme.css`. It's now **split by domain** into 12 `assets/pm-*.css` files so a team can own a slice (header, product, cart, …) without fighting over a monolith — the same one-file-per-concern shape the JS already uses.

**Load order is significant.** `layout/theme.liquid` emits the `stylesheet_tag`s in the exact order shown in the [File map](#file-map). That order mirrors the original single-file cascade, so the rendered result is byte-for-byte the same as before the split. Two consequences:

1. `pm-tokens.css` (the `--pm-*` variables) and `pm-base.css` (reset) **must stay first** — everything else depends on them.
2. If two rules with equal specificity target the same element, the file loaded later still wins — so **don't reshuffle the order** when adding tags.

**Which file does a style go in?** Match the domain:

| You're styling… | File |
|---|---|
| A colour/spacing/timing token | `pm-tokens.css` |
| A reset / `.pm-container` / global helper | `pm-base.css` |
| Header, nav rail, mega menu, top bar | `pm-header.css` |
| A homepage section (hero, cards, brand wall) | `pm-home-sections.css` |
| Footer | `pm-footer.css` |
| Mobile nav drawer, shared `.pm-btn`, quick-order/cart drawer | `pm-overlays.css` |
| Collection/search page, product card, facets, info pages | `pm-collection.css` |
| Register / sign-in / account dashboard | `pm-account.css` |
| Product detail page (gallery, buy-box, specs, bundles) | `pm-product.css` |
| Compare bar / compare page | `pm-compare.css` |
| Lists popover / lists dashboard | `pm-lists.css` |
| Auth forms, focus rings, form-field, recently-viewed | `pm-auth-misc.css` |

**Adding a brand-new CSS file:** create `assets/pm-<thing>.css` with a header comment, then add one `{{ 'pm-<thing>.css' | asset_url | stylesheet_tag }}` line to `theme.liquid` **in the right cascade position** (append at the end unless it must override an earlier domain).

---

## Working locally

```bash
shopify theme dev --store platinum-micro   # live preview with auto-reload
shopify theme push                         # one-off push, no watch
shopify theme pull                         # pull published theme down (overwrites local — careful)
```

No build step. Edit Liquid/CSS/JS directly.

---

## Required admin setup

| Where | What |
|---|---|
| **Online Store → Navigation → Collection and search filters** | Add Vendor, Price, Availability filters so the facets sidebar has data |
| **Online Store → Files** | Hero, brand logos, industry posters, product photos live here |
| **Settings → Customer accounts** | Locked to New Customer Accounts (the theme handles this — see above) |
| **Products** | Use category tags in ALL-CAPS (`VIDEO`, `WEBCAMS`, `PERIPHERALS`, …) so the mega-menu tag search resolves to the right products |
