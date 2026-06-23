# BigCommerce → Shopify 301 redirect map

Generated from the live sitemaps of the old BigCommerce site
(`www.platinummicro.com/xmlsitemap.php`) and the new Shopify store
(`platinum-micro.myshopify.com/sitemap.xml`). **Read-only** to produce — it
creates no redirects by itself.

## Files
- **`redirects.csv`** — 2,333 high-confidence redirects, in Shopify's
  URL-redirect import format (`Redirect from`, `Redirect to`). Paths only.
- **`redirects_unmatched.csv`** — 179 old URLs with no clean target (mostly
  brand pages that have no Shopify collection), each with a `suggested_to`
  fallback for manual review. **Not** auto-applied.
- **`build-redirects.mjs`** — the generator. Re-run anytime as the catalog
  changes: `NODE_TLS_REJECT_UNAUTHORIZED=0 node build-redirects.mjs`.

## Coverage
| Type | Old URLs | Mapped | Notes |
|------|----------|--------|-------|
| Products | 2,229 | **2,229 (100%)** | Handles preserved 1:1 in migration |
| Categories | 139 | 91 | Subcategories fall back to parent collection |
| Brands | 141 | 12 | Only brands with a Shopify collection; rest → `suggested_to` |
| Pages | 4 | 1 | Rest in unmatched |

## How to apply (Shopify admin — store-level, not the theme)
1. **Online Store → Navigation → "View URL redirects"** (or Search & filter →
   URL redirects).
2. **Import → Add file →** upload `redirects.csv` → **Upload and continue**.
3. Review the preview, confirm.
4. Then triage `redirects_unmatched.csv` — keep, edit, or drop each suggested
   fallback, and import the keepers.

## Important
- These are **URL redirects**, a store-level setting — **not** part of the
  theme. There is nothing to `shopify theme push`.
- Apply only at/after cutover (when `platinummicro.com` points at Shopify).
- Coordinate with whoever owns the migration before importing, to avoid
  duplicating redirects already created.
