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

## Easy setup — free hosting on GitHub Pages (recommended)

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
     Connect to Git → `flipbooks` → preset **None**, output directory `/` → Deploy.
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
