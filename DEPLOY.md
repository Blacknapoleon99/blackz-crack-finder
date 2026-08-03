# Deploy

The site is plain static files. There is no build step — the repo root **is** the site.

## Option A — GitHub Pages (free, already wired up)

`.github/workflows/pages.yml` deploys on every push to `main` that passes the tests.
It needs Pages switched on **once**, because creating a Pages site requires the
`administration` scope and the workflow's default `GITHUB_TOKEN` does not have it.

```bash
# one time
gh api -X POST repos/Blacknapoleon99/blackz-crack-finder/pages -f build_type=workflow

# then kick off a deploy (or just push anything to main)
gh workflow run deploy --repo Blacknapoleon99/blackz-crack-finder
gh run watch --repo Blacknapoleon99/blackz-crack-finder
```

Equivalent by hand: **Settings → Pages → Source: GitHub Actions**.

Live at: `https://blacknapoleon99.github.io/blackz-crack-finder/`

## Option B — Cloudflare Pages (recommended for a custom domain)

Cloudflare is the better primary host for one concrete reason: it honours the
`_headers` file, so the Content-Security-Policy, HSTS, and `frame-ancestors 'none'`
become **real response headers**. GitHub Pages cannot set custom headers at all, so
there the CSP only exists as a `<meta>` tag.

```bash
git clone https://github.com/Blacknapoleon99/blackz-crack-finder.git
cd blackz-crack-finder
wrangler pages deploy . --project-name blackz-crack-finder
```

Live at: `https://blackz-crack-finder.pages.dev`

To attach `shadow-lancer.com` (or a subdomain like `scan.shadow-lancer.com`):
Cloudflare dashboard → Workers & Pages → blackz-crack-finder → Custom domains.

Verify the headers actually landed:

```bash
curl -sI https://blackz-crack-finder.pages.dev | grep -i -E 'content-security|strict-transport|x-content-type'
```

## Verifying a deploy

1. Open the URL. The header terminal should show the ASCII banner and the
   flickering portrait on the right.
2. Open DevTools → Console. It must be **empty** — any CSP violation would log here.
3. Scan `octocat/Hello-World`. The pipeline should walk all 7 steps and the network
   trace should list the real `api.github.com` and `raw.githubusercontent.com` calls.

## Rollback

Every deploy is a commit. To roll back:

```bash
git revert <bad-sha> && git push        # GitHub Pages redeploys automatically
wrangler pages deployment list --project-name blackz-crack-finder   # Cloudflare: promote an older one
```
