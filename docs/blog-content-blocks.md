# Blog content blocks — staff playbook (2026)

How to write high-performing posts for the Platinum Micro blog. **No HTML, no code.**
You build a post by adding **blocks**: pick a format from a dropdown, type plain text
into labelled fields, and the theme styles it on-brand automatically.

---

## What actually works in 2026 (from verified research)

The honest, fact-checked version — we ran adversarial research and threw out the hype:

- **Google AI Overviews cut organic clicks ~61%.** The one proven defense is making
  content **quotable**: lead with a clear answer, use a **Key takeaways** block, and
  put facts in a **Comparison table** so Google's AI lifts *your* sentence.
- **"AI/answer-engine optimization" is just good SEO.** Google's own 2026 guidance:
  no magic schema, no special files. Win with **unique, expert content** a competitor
  can't copy (real spec comparisons, real procurement guidance, real numbers).
- **FAQ rich snippets were removed (May 2026).** A visible FAQ still helps readers and
  long-tail search, but don't expect the old Google "FAQ dropdown." (Our template adds
  **no** FAQ schema — it earns nothing now.)
- **Serve the committee.** Public-sector IT buys involve **~14 internal people** plus
  10+ outside. One post should answer the **technical**, **budget/TCO**, and
  **compliance/procurement** angles.
- **Never** paste raw AI-generated filler or stuff keywords — both are Google spam
  violations and get pages demoted. Use AI to draft, then add real expertise.

**Block order (build posts in this order):** Key takeaways → Rich text intro →
Comparison table → Procurement note → (optional) Image/Video → FAQ items →
Shop these products.

---

## How to write a post (no HTML)

1. **Content → Blog posts → Add blog post.** Give it a **Title** and pick the **Blog**.
2. Leave the big **Content** box empty — we build the body from blocks instead.
3. Set the first **Tag** to the category label shown on the card (e.g. `Buying Guide`).
   That tag also becomes the eyebrow above the title.
4. Add a **featured image** in the sidebar (this is the card/hero image).
5. In **Metafields → Content blocks**, click the field, then **Add new entry**.
   A "Add Blog block" panel opens. **Pick a Block type** from the dropdown and fill the
   fields it needs (see the cheat sheet below). Click **Save**.
6. Repeat **Add new entry** for each block. **Drag the chips** to reorder blocks.
7. Preview, then publish (see below).

That's it — you never touch HTML. The dropdown decides the format; you just type.

### Cheat sheet — which fields each Block type uses

| Block type | Fill these fields |
|---|---|
| **Rich text** | **Body** (toolbar: bold, italic, links, lists) — for normal paragraphs |
| **Key takeaways** | **List items** (one bullet each). *Heading* optional (defaults to "Key takeaways") |
| **Callout** | **Heading** (the box title) + **Body** |
| **Procurement note** | **Body** (+ optional **Heading**; defaults to "For schools & government buyers") |
| **Comparison table** | **Table data** — one row per line, columns separated by `|`. **First row = headers.** *Heading* = optional caption |
| **Pros and cons** | **List items** = pros · **List items B** = cons |
| **FAQ item** | **Heading** = the question · **Body** = the answer. *Add several in a row — they merge into one accordion.* |
| **Image** | **Image** (pick a file). *Heading* = optional caption |
| **Video** | **Video URL** (paste a YouTube link). *Heading* = optional title |
| **Shop these products** | **Products** (pick real products — title/price/link pull in automatically) |

> **Comparison table example** — type this into the *Table data* field:
> ```
> Factor | Refurbished | New
> Acquisition cost | 50-70% lower | Full list price
> Warranty | 1-3 yr, reseller-backed | 3-5 yr manufacturer
> ```
> It renders as a polished table with a navy header and zebra rows.

### Editing / reusing blocks
- Blocks are saved entries. Click a chip to **edit** it; the change shows on every post
  that uses it. To tweak one post only, make a new entry instead of editing a shared one.
- See all blocks under **Content → Metaobjects → Blog block**.

## Preview before you publish

1. In the post, set **Visibility → Hidden**.
2. Click **View** (top-right) — it opens the post in the live theme so you see exactly
   how the blocks look.
3. Happy with it? Set **Visibility → Visible** and **Save**.

## Writing checklist (every post)

- [ ] First **Key takeaways** block near the top, answering the title directly (quotable).
- [ ] An H2-style **Rich text** lead phrased as the question buyers search.
- [ ] At least one **Comparison table** with real specs/prices.
- [ ] One **Procurement note** for public-sector buyers (contract vehicles, TCO, warranty).
- [ ] First **tag** = the category label (e.g. `Buying Guide`).
- [ ] A **featured image** set in the sidebar.
- [ ] A **Shop these products** block linking 2–4 relevant products.

---

## How it works under the hood (for devs)

- Metaobject definition **`blog_block`** (Settings → Custom data) holds the fields:
  `block_type` (a choice list), `heading`, `body`, `table_data`, `list_items`,
  `list_items_b`, `image`, `video_url`, `products`.
- Article metafield **`custom.content_blocks`** is a *list of `blog_block` references*
  (pinned, Storefront API on).
- `sections/pm-article.liquid` renders `article.metafields.custom.content_blocks` via
  `snippets/pm-article-blocks.liquid`. If a post has **no** blocks, it falls back to the
  classic rich-text **Content** body — so older posts keep working untouched.
- Styling lives in `assets/pm-blog.css` (`.pm-takeaways`, `.pm-callout`, `.pm-table-wrap`,
  `.pm-faq`, `.pm-proscons`, `.pm-products`, …).

## Don't
- Don't paste unedited AI text or repeat keywords — Google demotes both.
- Don't add FAQ schema for "rich results" — that feature is gone.
- Don't write thin 200-word posts — depth + real expertise is what ranks now.
