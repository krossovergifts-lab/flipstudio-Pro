# Publishing flipbooks online (free hosting)

FlipStudio Pro publishes every publication as its own web link:

```
https://<your-site>/<link-name>/        ← one flipbook (share this on WhatsApp, email, social)
https://<your-site>/                    ← bookshelf listing every published flipbook
```

How it works: when you click **Publish online**, the app uploads the flipbook
(pages, images, fonts, a link-preview image) into a folder of a GitHub
repository. A free static host connected to that repository puts each change
live, usually within a minute. You do not need a server or to run any commands.

You set this up **once**, inside the app. It takes about 2 minutes.

## Brand-free website for one catalogue (recommended for the 2027 catalogue)

For a catalogue resellers will forward, give it its **own website** with a neutral
address such as `https://promotionalgifts-catalogue-2027.pages.dev`. It is free on
Cloudflare Pages, allows commercial use and has no traffic limit. The catalogue opens
directly at that address (no folder, no GitHub or company name in the link).

In the app: **🌐 Publish → Website → + Add a website… → Its own brand-free website**.
The window walks you through four steps:

1. **Website name** – type the name you want in the link, e.g.
   `promotionalgifts-catalogue-2027` (lowercase, dashes). Click **Copy**.
2. **Create repository ↗** – a new GitHub repository for this catalogue (Private is fine).
3. **Open my keys ↗** – edit your *FlipStudio Pro publishing* key → Repository access →
   add the new repository → **Update** (no new key needed).
4. **Open Cloudflare ↗** – create a free account, then:
   1. **Workers & Pages → Create application → Pages** tab (not *Workers*) →
      **Import an existing Git repository**.
   2. Connect GitHub. On GitHub's "Install Cloudflare" page choose
      **Only select repositories**, pick the new catalogue repository → **Install & Authorize**.
   3. Pick the repository → **Begin setup**. Project name: paste the name from step 1.
      Framework preset **None**, Build command `exit 0`, Build output directory empty →
      **Save and Deploy**. Cloudflare shows the address (if the name was taken it adds a few
      letters — copy exactly what it shows).
5. Back in the app: check the address, click **Connect website**, then **Publish**.

Each later **Update online version** goes live in about a minute.

Do **not** use Cloudflare's "Add a website / domain" screen for this step — that is for
moving a domain's DNS to Cloudflare and is only needed for your own domain (below).

## Your own domain on Cloudflare (optional, about USD 10/year)

Pick a neutral name with no brand in it, e.g. `giftscatalogue2027.com`.

**A. Buy the domain**
- Easiest: Cloudflare dashboard → **Domain Registration → Register Domains** (at-cost price,
  DNS is set up automatically — skip step B).
- Or buy it at Namecheap / GoDaddy / any registrar and do step B.

**B. Only if the domain was bought elsewhere: move its DNS to Cloudflare**
1. Cloudflare dashboard → **Add a domain** (the "Add a website" screen) → type
   `giftscatalogue2027.com` → *Quick scan for DNS records* → **Continue** → choose the **Free** plan.
2. Cloudflare shows two nameservers (like `ada.ns.cloudflare.com`). At your registrar, replace
   the domain's nameservers with these two. Wait until Cloudflare emails "your domain is
   active" (minutes to a few hours).

**C. Attach the domain to the catalogue**
1. **Workers & Pages →** your catalogue project → **Custom domains → Set up a custom domain**.
2. Type `giftscatalogue2027.com` (or a sub-address such as `catalogue.giftscatalogue2027.com`)
   → **Continue → Activate domain**. Cloudflare creates the DNS record and the HTTPS
   certificate by itself; status turns **Active** within a few minutes.
   - Want `www.` too? Add `www.giftscatalogue2027.com` the same way.
   - A sub-address on a domain whose DNS is **not** on Cloudflare also works: at your DNS
     provider add a **CNAME** record `catalogue` → `<project>.pages.dev`, then activate.
3. In FlipStudio Pro: **🌐 Publish → Website → Settings**, change the website address to
   `https://giftscatalogue2027.com`, save, then **Update online version** — so links, the
   Share button and WhatsApp previews use the new domain.

The `*.pages.dev` address keeps working as well.

## Google Analytics (see who reads the catalogue)

1. Go to <https://analytics.google.com> → **Admin → Create → Property** (name it e.g. *Catalogue 2027*,
   your time zone and currency) → **Web** data stream → website address
   `https://promotionalgifts-catalogue-2027.pages.dev` (or your own domain) → **Create stream**.
2. Copy the **Measurement ID** (it starts with `G-`).
3. In FlipStudio Pro: **🎨 Design → SEO & analytics → Measurement ID**, paste it → **Apply design** →
   **Publish → Update online version**.
4. Open your catalogue, then in Google Analytics **Reports → Realtime** you see yourself within a minute.

What you will see in Analytics: page views per page (*Reports → Engagement → Pages and screens*,
titles like "Catalogue · Pages 12–13", so you know which products are read most), and events
(*Engagement → Events*): `search` (with the words searched), `click` (links / WhatsApp),
`view_item` (product pop-ups), `share`, `file_download`, `bookmark_page`, `auto_flip`,
`video_start`, `video_complete`, `select_content` (Contents). Turn on **Ask visitors first** if you
need a cookie notice (EU visitors).

## Google search (SEO)

Every published catalogue already includes: the title and description you set in **Design → SEO &
analytics**, the text of every page (readable by Google), bookmarks as chapters, product links,
structured data, link previews, `sitemap.xml` and `robots.txt`.

To get into Google faster:
1. Open <https://search.google.com/search-console> → **Add property → URL prefix** → your catalogue
   address → verify with **Google Analytics** (works automatically once step 3 above is done) or with
   **HTML tag / DNS** (for your own domain on Cloudflare choose **Domain** and Cloudflare adds the record).
2. **Sitemaps** → enter `sitemap.xml` → **Submit**.
3. **URL inspection** → paste the address → **Request indexing**.

Links can open on a page: `https://…/#page=12`. Use these in emails or WhatsApp to send a customer
straight to a product page (the reader's **Share → Open at page N** creates them).

## Bookshelf on GitHub Pages (many publications on one site)

Click **🌐 Publish** (library card or editor). The setup window has three steps:

1. **Create repository ↗** — opens GitHub with the name `flipbooks` and *Public*
   already filled in. Click **Create repository**.
2. **Create access key ↗** — opens GitHub's token page with the right permissions
   already selected (*Contents* and *Pages*: read and write, 1-year expiry).
   Under **Repository access** choose **Only select repositories → flipbooks**,
   click **Generate token** and copy it.
3. **Paste the key**, type your bookshelf title and click **Connect**.

The app then switches on GitHub Pages by itself and fills in the website address,
for example `https://krossovergifts-lab.github.io/flipbooks/`. Nothing to set up on
Vercel or anywhere else.

Notes
- The `flipbooks` repository is public (GitHub Pages is free for public
  repositories). It only contains the published flipbooks, which are public anyway —
  never the app's code or your editable projects.
- Do **not** import the app's code repository (`flipstudio-Pro`) into Vercel. It is a
  desktop app, not a website.
- The key expires after a year: create a new one with the same button and click Connect again.

## Other hosts (optional): Vercel, Cloudflare Pages, your own domain

In the setup window click **Use Vercel, Cloudflare or my own domain**.

1. Create the `flipbooks` repository (Private is fine here) and a key as above.
2. Connect **that** repository to the host:
   - **Vercel**: Add New → Project → import `flipbooks` → Framework preset **Other**, no build command → Deploy.
     The free Hobby plan is non-commercial; use a Pro team for company catalogues.
   - **Cloudflare Pages** (free, commercial use allowed): Workers & Pages → Create → Pages →
     Pages tab → Import an existing Git repository → `flipbooks` → preset **None**,
     Build command `exit 0`, output directory empty → Save and Deploy.
3. Fill in owner, repository, branch (`main`), key and the address the host gives you, click
   **Test connection**, then **Save settings**.

For a custom domain such as `books.krossover.net`, add it in the host's (or GitHub Pages')
domain settings, create the DNS record it shows, then put that address in the advanced
settings and republish so link previews use it.

## Publish, share, update, unpublish

- **Publish**: choose the link name (e.g. `promotional-gifts-2027`) → **Publish**. Copy the link, open it, or share on WhatsApp.
- **Update**: edit the publication, then **Publish online → Update online version**. Only changed files are uploaded; the link stays the same.
- **Unpublish**: **Publish online → Unpublish**. The link stops working; the publication stays in your library.
- Library cards show **● Live** and the link with a **Copy link** button.

What goes online: pages, objects, animations, links, pop-ups, fonts in use, the
selectable/searchable text layer, a 1200×630 preview image and link-preview tags
(WhatsApp, Facebook, LinkedIn, X). The editable project file is **not** uploaded.

## Troubleshooting

| Message | Fix |
|---|---|
| "GitHub rejected the access token" | Token mistyped, expired or revoked → create a new one, paste it in Publishing settings. |
| "Repository … was not found" | Check owner/repository names, and that the token's *Repository access* includes it. |
| "not allowed to write" | Token needs *Contents: Read and write*. |
| Link shows "not found" right after publishing | The host is still deploying; wait a minute and refresh. Check the host dashboard for the deployment. |
| WhatsApp shows an old preview | WhatsApp caches previews; it refreshes after a while, or share the link with `?v=2` at the end. |
