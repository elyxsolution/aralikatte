# Aralikatte Cafe — SEO handover & client checklist

## How the site is built now

The page source is `src/app.src.html`; **do not hand-edit the generated `index.html`, `menu/`, `our-story/`, `gallery/`, `catering/` or `contact/` files.**

```
npm install                 # once (needs a local Chrome; set CHROME_PATH if unusual)
npm run images              # only when photos in assets/ change
npm run build               # regenerates every page, sitemap.xml, robots.txt
npm run verify              # placeholders, head tags, JSON-LD, links, 9 widths x 6 pages
node scripts/make-og.mjs    # only to regenerate the social preview image
```

Commit the generated files together with the source change, then deploy as before.

## Needs owner confirmation before going further

| Item | Status |
|---|---|
| **Opening hours** | Site says **6:00 AM – 1:00 AM daily**; Google/external data says **6:30 AM – 11:00 PM**. Hours are **left out of structured data and meta descriptions** until confirmed. The visible copy is unchanged (13 mentions in `src/app.src.html`: search for `6:00 AM`, `1:00 AM`, `six in the morning`, `after midnight`, `late night`). After confirming, update the copy, add `openingHoursSpecification` in `scripts/build.mjs` (instructions are in the comment there), rebuild, and update Google Business Profile to match. |
| **Contact & catering forms** | Now connected: both forms post to `/api/contact`, which relays to the cafe's Google Apps Script mailer (see `docs/contact-backend.md`). The Vercel env vars must be set and the Apps Script must accept the shared secret. |
| **Our Story photo** | The previous image was hotlinked from a Google Maps photo URL that now returns 403. It has been replaced with the cafe exterior photo already on the site, but that file is only 516 px wide and looks soft on large screens. Please supply a high-resolution landscape photo of the cafe (interior or exterior), at least 1600 px wide. |
| **Catering hero photo** | This was the same kind of dead Google-hosted URL. It now uses the site's own breakfast-spread photo. Replace it if there is a real catering or event photo. |
| **"★★★★★ Loved by Bengaluru food lovers"** | The decorative stars are not backed by any rating data on the site, and they are hidden from screen readers. Consider removing them, or linking them to the real Google rating. |
| **Mobile bottom bar (Call / Menu / Directions)** | It exists in the code but never appeared on the live site, so it is kept **off**. To turn it on, set `showStickyMobileBar` `default` to `true` in `src/app.src.html`. |
| **Ice Creams / Juices** | These categories have no items yet. They are hidden from the full menu and appear only as "Coming soon" cards. Send the items when they are finalised. |
| **Prices** | None are published (`priceDisplay: Hide prices`). Add them to the `MENU` data if the owner wants them online. |

## Google Search Console (owner/developer)

1. Verify the **Domain property** `aralikattecafe.in` (DNS TXT record).
2. Submit `https://www.aralikattecafe.in/sitemap.xml`.
3. Use URL Inspection → Request indexing for `/`, `/menu/`, `/catering/`, `/contact/`, `/our-story/`, `/gallery/`.
4. Check Page indexing after 1–2 weeks. The old `/?page=menu`-style URLs now redirect to the clean URLs. Expect them to drop out as "Page with redirect".
5. Run the Rich Results Test and the Schema Markup Validator on `/` and `/menu/` (Restaurant + Menu).
6. In Vercel, make `www.aralikattecafe.in` the primary domain. Redirect the apex domain (also handled in `vercel.json`) and preferably `aralikatte.vercel.app` to it. Confirm HTTP→HTTPS (Vercel does this automatically).
7. Run PageSpeed Insights on mobile for `/` and `/menu/` after deploy and record the baseline. No Core Web Vitals figures have been measured yet.

## Google Business Profile checklist

| Field | Value to use |
|---|---|
| Business name | **Aralikatte Cafe** (exactly, with no keywords added) |
| Address | 75, 80 Feet Rd, Banashankari 6th Stage 1st Block, Jayanagar Housing Society Layout, Subramanyapura, Bengaluru, Karnataka 560061 |
| Phone | +91 78995 42233 |
| Hours | **Confirm first** (see above). The website, schema and GBP must all match. |
| Website | https://www.aralikattecafe.in/ |
| Menu link | https://www.aralikattecafe.in/menu/ (replaces the earlier Google Maps menu link) |
| Primary category | South Indian Restaurant *(or Vegetarian Restaurant; pick one, and use the other as a secondary category)* |
| Secondary categories | Vegetarian Restaurant / South Indian Restaurant, Cafe, Caterer, Breakfast Restaurant. Use only categories that are true. |
| Attributes | Vegetarian options / pure vegetarian, dine-in, takeaway; add delivery only if offered |
| Services | Catering for corporate events, office gatherings, family functions, celebrations, community events; breakfast gatherings; lunch / meal service |
| Menu items | Mirror the website `MENU` list. Do not list items that are not served. |
| Photos | Real photos only: exterior with signage, interior seating, counter, signature dishes (dosa, idli, meals, filter coffee), live music / Open Mic. Upload regularly. |
| Posts | Monthly: new items, events (Open Mic, Jamming), catering. |

**Reviews.** Ask real guests for reviews (for example, a QR code at the counter linking to the GBP review form), and reply to all reviews, including negative ones. Do not offer incentives, buy reviews, or post reviews on the business's behalf. Do not add review or rating markup to the website unless it shows genuine first-party reviews.

## NAP: must match everywhere

**Aralikatte Cafe**, 75, 80 Feet Rd, Banashankari 6th Stage 1st Block, Jayanagar Housing Society Layout, Subramanyapura, Bengaluru, Karnataka 560061, **+91 78995 42233**. This exact text is used in the website footer, the Home "Find Us" section, Contact, Catering, and the JSON-LD (`scripts/build.mjs` → `RESTAURANT`). Use the same text on Instagram, Facebook, Zomato, Swiggy and Justdial.
