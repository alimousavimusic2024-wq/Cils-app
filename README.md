# CILS Grammatica – Telegram Mini App ($0 stack)

| Part | Service | Why free | Limits (verify current pages) | Card? |
|---|---|---|---|---|
| Frontend | GitHub Pages (public repo) | Free static hosting | ~1 GB site, soft bandwidth cap | No |
| API + bot webhook + cron | Cloudflare Workers (Free plan) | Free plan stops at its cap, never bills | ~100k requests/day, 10 ms CPU/request | No |
| Database | Cloudflare D1 (Free plan) | Included in Workers Free | ~5 GB, daily row read/write caps | No |
| AI (bank refill only) | Google AI Studio Gemini API free tier | Free tier, no billing account | Rate/daily limits change; a 429 just skips that refill | No (never enable billing) |
| PDF | jsPDF in the browser | Open source | Latin-1 font: Persian name omitted in PDF | No |

Architecture: Mini App (GitHub Pages) -> Worker API (validates Telegram `initData` HMAC) -> D1.
Gemini is called only by the cron/admin endpoint to refill the question bank; users never trigger AI.
Quota: one exam session per (user, UTC date) enforced by a UNIQUE constraint, so refresh/localStorage/other browsers cannot reset it.
Correct answers never leave the server until the exam is completed (`/api/exam/review`).

## Setup
1. Push this folder to a **public** GitHub repo (`main`). Repo Settings -> Pages -> Source: GitHub Actions.
2. `cd backend && npm i -g wrangler && wrangler login`
3. `wrangler d1 create cils` -> paste `database_id` into `wrangler.toml`; set `ALLOWED_ORIGIN`, `WEBAPP_URL`.
4. `wrangler d1 execute cils --remote --file=../database/schema.sql`
5. Secrets: `wrangler secret put BOT_TOKEN`, `GEMINI_API_KEY`, `ADMIN_TOKEN`, `WEBHOOK_SECRET`.
6. `wrangler deploy` -> copy the `*.workers.dev` URL into `API` in `frontend/index.html`, commit, push.
7. Seed the bank: `curl -X POST https://<worker>/admin/replenish -H "X-Admin-Token: <ADMIN_TOKEN>"` (repeat a few times; cron then tops up each level every 6 h until TARGET_PER_LEVEL).
8. BotFather: `/newbot` -> token. Set webhook:
   `curl "https://api.telegram.org/bot<TOKEN>/setWebhook" -d url=https://<worker>/webhook -d secret_token=<WEBHOOK_SECRET>`
   `/setmenubutton` -> your bot -> URL = GitHub Pages URL -> title "شروع آزمون". (Optional: `/newapp`.)

## Troubleshooting
- "unauthorized": open from Telegram, not a browser; check BOT_TOKEN secret.
- CORS error: `ALLOWED_ORIGIN` must be exactly `https://USER.github.io` (no path).
- "bank not ready": run step 7 until each level has 20+ questions (`wrangler d1 execute cils --remote --command "select level,count(*) from questions group by 1"`).
- PDF does nothing: some Telegram webviews block blob downloads; use `tg.openLink` fallback or open in external browser.

## Security review
Fixed: HMAC initData check + 24 h expiry; constant-time compares; server-side scoring; answers hidden until completion; strict CORS; webhook secret; admin token; AI output validated and deduplicated by hash; no secrets in repo.
Known: no rate limit on API (Cloudflare Free caps requests instead); a user can see their own questions only; initData replay within 24 h is limited to that user's own data.

## ZERO-COST DEPLOYMENT CHECKLIST
- [ ] Create GitHub repository (public)
- [ ] Add files
- [ ] Configure secrets (wrangler secrets only; never in repo)
- [ ] Deploy frontend (Pages workflow)
- [ ] Deploy backend (`wrangler deploy`)
- [ ] Configure database (D1 + schema)
- [ ] Configure AI API (AI Studio key, free tier)
- [ ] Create Telegram bot
- [ ] Connect Mini App (menu button + webhook)
- [ ] Test Telegram authentication
- [ ] Test daily 20-question limit
- [ ] Test exam completion
- [ ] Test PDF generation

Unexpected cost risks: upgrading Workers to Paid, enabling Google Cloud billing on the Gemini project, adding paid add-ons. Prevent: never add a card to Cloudflare/Google; the Free plans hard-stop at their limits instead of billing.
