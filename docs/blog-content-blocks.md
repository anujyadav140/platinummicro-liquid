# Blog content blocks — staff playbook (2026)

How to write high-performing posts for the Platinum Micro blog, and copy-paste
blocks for the formats that work. No coding needed — paste a block into the post
editor's **HTML view** (the `</>` button in the toolbar) and edit the text.

---

## What actually works in 2026 (from verified research)

The honest, fact-checked version — we ran adversarial research and threw out the hype:

- **Google AI Overviews cut organic clicks ~61%.** The one proven defense is making
  content **quotable**: lead with a clear answer, use **key-takeaway summaries**, and
  put facts in **comparison tables** so Google's AI lifts *your* sentence.
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

**Format priority (build posts in this order):** Key Takeaways → clear Q&A headings →
comparison table → procurement/compliance callout → (optional) video/chart → FAQ →
"Shop these products."

> Charts and video are supported and easy to add, but be honest: the data did **not**
> show they boost rankings by themselves. Use them when they genuinely help a reader
> decide — not as an SEO trick.

---

## The easy way — most posts need zero HTML

Use the editor **toolbar**, not code. The theme now auto-styles everything the toolbar produces:

| Click in the toolbar | You get (auto-styled, on-brand) |
|---|---|
| Heading dropdown | Section headings |
| Bold / italic | Emphasis |
| Bulleted / numbered list | Lists with proper bullets |
| **Table** | A polished comparison / spec table |
| **Image** | Full-width image (add a caption line underneath) |
| **Insert video** | A responsive 16:9 video |
| **Quote** | A navy callout box |

So for most posts you just **type your text and pick a format** — no HTML at all. You only
need the snippets below for three fancy blocks: **Key takeaways**, the **FAQ accordion**, and **Pros/Cons**.

## Preview before you publish

Shopify shows you the real thing before it goes live:
1. In the post, set **Visibility → Hidden**.
2. Click **View** (top-right of the editor) — it opens the post in the live theme so you see exactly how it looks.
3. Happy with it? Set **Visibility → Visible** and **Save**.

## Writing checklist (every post)

- [ ] First sentence answers the title directly (quotable).
- [ ] A **Key Takeaways** box near the top.
- [ ] H2 headings phrased as the questions buyers actually search ("Is NVMe worth it for a school server?").
- [ ] At least one **comparison table** with real specs/prices.
- [ ] One **procurement/compliance** note for public-sector buyers (contract vehicles, TCO, warranty).
- [ ] First **tag** = the category label shown on the card (e.g. `Buying Guide`).
- [ ] A **featured image** set in the sidebar.
- [ ] Links to 2–4 relevant products ("Shop these products").

---

## Copy-paste blocks (only for the 3 fancy formats)

For **Key takeaways**, the **FAQ accordion**, and **Pros/Cons**, paste into the editor's
**HTML view** (`</>`) and edit the words. Everything else uses the toolbar above — no code.

### Key takeaways (use near the top)
```html
<div class="pm-takeaways">
  <p class="pm-takeaways__title">Key takeaways</p>
  <ul>
    <li>NVMe is the better buy for most new server and workstation builds in 2026.</li>
    <li>SATA still wins for bulk, budget, and legacy systems.</li>
    <li>For schools and labs on a budget, a Pi 4 4GB is still capable.</li>
  </ul>
</div>
```

### Comparison / spec table
```html
<div class="pm-table-wrap">
  <table>
    <thead><tr><th>Feature</th><th>Option A</th><th>Option B</th></tr></thead>
    <tbody>
      <tr><td>Interface</td><td>NVMe (PCIe 4.0)</td><td>SATA III</td></tr>
      <tr><td>Real-world speed</td><td>Up to 7,000 MB/s</td><td>~550 MB/s</td></tr>
      <tr><td>Best for</td><td>Databases, virtualization</td><td>Bulk / archive</td></tr>
    </tbody>
  </table>
</div>
```
*(The editor's built-in Table button also works and is auto-styled.)*

### Procurement / public-sector callout
```html
<div class="pm-callout pm-callout--gov">
  <p class="pm-callout__title">For schools &amp; government buyers</p>
  Available through OMNIA Partners cooperative purchasing — no separate bid required.
  Volume pricing, NET-30 terms, and full manufacturer warranty included. Ask about TCO
  over a 5-year refresh cycle.
</div>
```

### Note / callout (general)
```html
<div class="pm-callout">
  <p class="pm-callout__title">Good to know</p>
  Check your motherboard or server backplane for free M.2 / U.2 slots before buying NVMe.
</div>
```

### FAQ (visible accordion)
```html
<div class="pm-faq">
  <details><summary>Is NVMe worth it for a school file server?</summary>
    <p>Yes if the server runs databases or many users at once; SATA is fine for backups.</p>
  </details>
  <details><summary>Will NVMe work in my existing server?</summary>
    <p>Only if it has M.2 or U.2 bays and free PCIe lanes. Check the spec sheet first.</p>
  </details>
</div>
```

### Pros / cons
```html
<div class="pm-proscons">
  <div class="pm-proscons__col pm-proscons__col--pro">
    <p class="pm-proscons__title">Pros</p>
    <ul><li>Much faster</li><li>Lower latency</li></ul>
  </div>
  <div class="pm-proscons__col pm-proscons__col--con">
    <p class="pm-proscons__title">Cons</p>
    <ul><li>Costs more per TB</li><li>Needs M.2 / U.2 slots</li></ul>
  </div>
</div>
```

### Video (auto-responsive)
Use the editor's **Insert video** button, or paste a YouTube embed:
```html
<div class="pm-video">
  <iframe src="https://www.youtube.com/embed/VIDEO_ID" title="How to install an NVMe SSD" allowfullscreen></iframe>
</div>
```

### Chart / diagram with caption
Upload the image with the editor's image button, or:
```html
<figure>
  <img src="IMAGE_URL" alt="Describe the chart in plain words for SEO and screen readers">
  <figcaption>NVMe vs SATA sequential read speeds, 2026 enterprise drives.</figcaption>
</figure>
```

### Shop these products (links to product pages)
```html
<div class="pm-products">
  <a href="/products/PRODUCT-HANDLE">WD Blue SN5000 4TB NVMe<span class="price">$199.00</span></a>
  <a href="/products/PRODUCT-HANDLE">Seagate Nytro SATA SSD<span class="price">$149.00</span></a>
</div>
```

---

## Don't
- Don't paste unedited AI text or repeat keywords — Google demotes both.
- Don't add FAQ schema for "rich results" — that feature is gone.
- Don't write thin 200-word posts — depth + real expertise is what ranks now.
