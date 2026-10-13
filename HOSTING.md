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

You set this up **once**.

## 1. Create the repository (GitHub)

1. Sign in at https://github.com (a free account is enough).
2. Go to https://github.com/new
   - Repository name: for example `flipbooks`
   - **Private** is fine with Vercel or Cloudflare Pages. (GitHub Pages on a free account needs **Public**.)
   - Leave "Add a README" unticked — the app creates the first files.
3. Click **Create repository**.

## 2. Create an access token for the app

1. Open https://github.com/settings/personal-access-tokens/new (Fine-grained token).
2. Token name: `FlipStudio Pro`. Expiration: up to 1 year (set a reminder to renew).
3. **Repository access → Only select repositories →** `flipbooks`.
4. **Permissions → Repository permissions → Contents → Read and write.** Nothing else is needed.
5. **Generate token** and copy it (it starts with `github_pat_`). You will not see it again.

The token is stored only on your computer (not in projects, exports or the
website). It can only change that one repository.

## 3. Connect a free host

Pick one. All three serve the same files.

### Option A — Vercel (simplest)
1. https://vercel.com → **Add New… → Project** → **Import** the `flipbooks` repository
   (give Vercel access to it when asked).
2. Framework Preset: **Other**. Build command: leave empty. Output directory: leave empty (the repository root).
3. **Deploy.** Your address looks like `https://flipbooks-xxxx.vercel.app`.

Note: Vercel's free Hobby plan is for personal, non-commercial use. For
company catalogues use a Pro team (Krossover already has one) or Cloudflare Pages.

### Option B — Cloudflare Pages (free, commercial use allowed)
1. https://dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git** → choose `flipbooks`.
2. Framework preset: **None**. Build command: empty. Build output directory: `/`.
3. **Save and Deploy.** Your address looks like `https://flipbooks.pages.dev`.

### Option C — GitHub Pages (repository must be public on a free account)
1. In the repository: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save**.
2. Your address is `https://<your-github-name>.github.io/flipbooks`.

### Your own domain (optional)
Add e.g. `books.krossover.net` in the host's **Domains** settings and create the
DNS record it shows (usually a CNAME). Then put that address in the app's
publishing settings and republish so share previews use it.

## 4. Fill in the app's publishing settings

Library → a publication's **🌐 Publish** button (or **Publish online** in the editor):

| Field | Example |
|---|---|
| GitHub owner | `krossover` (your user or organisation name) |
| Repository | `flipbooks` |
| Branch | `main` |
| Access token | `github_pat_…` |
| Website address | `https://flipbooks.pages.dev` |
| Bookshelf title | `Krossover Catalogues` |

Click **Test connection**, then **Save settings**.

## 5. Publish, share, update, unpublish

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
