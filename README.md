# Huawei AppGallery Auto-Publish

**Upload an APK — we handle everything else.**

Upload an Android APK (or AAB) and the app fully automates publishing it to the
Huawei AppGallery: it parses the binary, generates the store description and
screenshots with AI, resizes the icon to 512px if it's smaller, and then uploads
and submits everything through a **proven Fastlane plugin** —
[`shr3jn/fastlane-plugin-huawei_appgallery_connect`](https://github.com/shr3jn/fastlane-plugin-huawei_appgallery_connect).

The Huawei publishing API is **never hand-rolled** — every AppGallery Connect
interaction is delegated to the Fastlane plugin (see `fastlane_runner/` and
`src/lib/fastlane.ts`).

## Stack
- **Next.js 15** (App Router, React 19, TypeScript) + API routes
- **PostgreSQL** via **Prisma**
- **Background worker** (DB-polling queue) for long-running jobs (parse, AI, publish, download)
- **Ruby + Fastlane** running the `huawei_appgallery_connect` plugin (the publishing engine)
- **AI**: OpenAI (text + `gpt-image`), Google Gemini (`gemini-2.5-flash-image` "nano banana"), DeepSeek (text) — all configurable in Settings
- **appgallerycli** ([`gnuvalerie/appgallerycli`](https://github.com/gnuvalerie/appgallerycli)) for the APK download feature
- next-intl (English + Arabic dashboard UI, RTL-aware)

## Pipeline
1. **Upload** APK/AAB → parse package name, app name, version, permissions, icon. Icon is upscaled to 512×512 if smaller.
2. **Resolve app_id** via the plugin's `huawei_appgallery_connect_get_app_id` action (from the package name).
3. **AI metadata**: an LLM writes the description, brief introduction, and release notes (with an optional user "steering" prompt), translated into 10 locales and written into the `fastlane/metadata/huawei/<locale>/` files the plugin expects.
4. **AI screenshots**: 4–5 store screenshots via OpenAI `gpt-image`, Gemini `gemini-2.5-flash-image`, or a real-device emulator (VMOS / Appetize), with an editable custom prompt for the AI modes. Falls back to template mockups.
5. **Review**: a *Pending review* card lets you edit any locale or screenshot.
6. **Publish**: on approval the worker pushes localized metadata via `huawei_appgallery_connect_update_app_localization`, then uploads + submits via the `huawei_appgallery_connect` action.

> **Console-only prerequisites:** the target app's category, content-rating
> questionnaire, age rating, and distribution countries must already be
> configured in AppGallery Connect — these are not exposed by the plugin's API.

## APK download + analyzer
Paste one or many public AppGallery links or **C-codes** (bulk). For each, the
app downloads the APK with `appgallerycli <Cid>` and runs the built-in analyzer:
package, version, APK size, permissions, native ABIs, file count, and detected
third-party SDKs (Unity, HMS, AdMob, Firebase, ad networks, …), with a button to
download the binary. APKs not retrieved within ~2 days are auto-deleted (the
metadata row is kept).

## Settings — AI model management
Choose the text provider/model and image provider/model, and store per-provider
API keys (OpenAI, DeepSeek, Gemini). Keys persist in the DB and override the
environment variables. DeepSeek and Gemini are reached via their
OpenAI-compatible endpoints.

## Prerequisites
- **Node.js** ≥ 20
- **Ruby** ≥ 3.1 + **Bundler** (for Fastlane)
- **PostgreSQL**
- A C compiler (`gcc`) to build `appgallerycli`

## Environment
See [`.env.example`](./.env.example). Key vars:

| Var | Where to get it |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `HUAWEI_AGC_CLIENT_ID` / `HUAWEI_AGC_CLIENT_SECRET` | Huawei console → Users and permissions → Connect API |
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys (or set in Settings) |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey (optional; or set in Settings) |
| `DEEPSEEK_API_KEY` | https://platform.deepseek.com (optional; or set in Settings) |
| `PRIVACY_POLICY_URL` | Optional URL attached to the uploaded version |

## Run locally
```bash
# 1. Node deps
npm install
cp .env.example .env   # fill in values

# 2. Database
npm run db:push

# 3. Fastlane plugin (Ruby) — installs fastlane + the Huawei plugin
cd fastlane_runner && bundle config set --local path 'vendor/bundle' && bundle install && cd ..

# 4. Compile the appgallerycli downloader
gcc -O2 -o native/appgallerycli/appgallerycli native/appgallerycli/appgallerycli.c

# 5. Run (two terminals)
npm run worker     # background jobs (parse, AI, publish, download)
npm run dev        # web UI at http://localhost:3000
```

The web process and the worker are **both required** — long-running jobs
(parsing, AI generation, publishing) run only in the worker.

## Deploy (Docker / Fly.io)
`Dockerfile` builds a single image containing Node, Ruby+Fastlane (with the
plugin bundled), and the compiled `appgallerycli`. `supervisord` runs the web
and worker processes together.

```bash
fly launch --copy-config --no-deploy
fly secrets set HUAWEI_AGC_CLIENT_ID=... HUAWEI_AGC_CLIENT_SECRET=... OPENAI_API_KEY=...
fly postgres create && fly postgres attach <db-name>
fly deploy
```

## How publishing maps to the Fastlane plugin
| Pipeline step | Plugin action |
| --- | --- |
| Resolve app_id | `huawei_appgallery_connect_get_app_id` |
| Push localized metadata | `huawei_appgallery_connect_update_app_localization` |
| Upload APK/AAB + submit | `huawei_appgallery_connect` (`is_aab`, `submit_for_review`, `privacy_policy_url`, `changelog_path`, phased rollout, open testing) |
| Submit later | `huawei_appgallery_connect_submit_for_review` |
| Read app info/status | `huawei_appgallery_connect_get_app_info` |
| Declare GMS dependency | `huawei_appgallery_connect_set_gms_dependency` |

The lanes live in [`fastlane_runner/fastlane/Fastfile`](./fastlane_runner/fastlane/Fastfile);
the Node side shells out to them in [`src/lib/fastlane.ts`](./src/lib/fastlane.ts);
the pipeline is orchestrated in [`src/lib/workflow.ts`](./src/lib/workflow.ts).

## Notes / limitations
- The dashboard has no auth in v1 — put it behind a reverse-proxy auth policy before exposing publicly.
- Screenshot **upload** to the store is not part of the plugin's API (AppGallery exposes it only in the console). Generated screenshots are produced, previewed, and stored; metadata + binary submission is fully automated.
- Huawei may require the server's egress IP to be whitelisted for the Connect API.
