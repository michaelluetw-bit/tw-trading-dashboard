# EquiLens architecture

```
Browser (desktop) ─▶ EquiLens Nexus  (Node, 127.0.0.1:4330) ─▶ data sources (TWSE/TPEx, FinMind, Fugle, Twelve Data, Alpha Vantage)
                         │  .local/ (config, groups, prices, records)          ─▶ AI service (Claude, OpenAI, Gemini, OpenAI-compatible)
Phone (PWA) ─▶ Cloudflare Tunnel ─▶ EquiLens Pocket (127.0.0.1:4340) ─▶ Nexus API (Pocket never touches data files)
```

Nexus is the only process that fetches or writes market data. Pocket is a thin, password-protected proxy with its own
mobile UI and Web Push relay. There is no database and no build step: plain ES modules on Node 22+ and in the browser.

The shared `priceRuleForm` accepts an explicit `{quote, live}` context. Chart views pass their quote rather than the displayed historical fallback. The form checks the local trading window and quote date before displaying a current-price or threshold hint; historical research details remain in a waiting state. It does not change saved rules or create subscriptions.

## Nexus (`EquiLens-Nexus/`)

| Module | Role |
|---|---|
| `server.mjs` | HTTP server, API routes, schedulers (intraday monitor, close records, news push, AI report, daily update), market switching |
| `lib/config.mjs` | `.local/config.json`: market, language, enabled data sources and preferences, AI model, up/down colors, and remote access (Pocket connection mode and domains, push contact, desktop Cloudflare Access settings). Legacy installs and `remote.json` are migrated automatically |
| `lib/markets.mjs` | Market profiles: time zone, sessions (with lunch breaks), settle minutes, lot size, tick tables, price limits, symbol format, replay scales. All time / price rules come from here |
| `lib/secrets.mjs` | API keys via Windows DPAPI, macOS Keychain or Secret Service (file fallback); environment variables take priority |
| `lib/i18n.mjs` | Server-side translation with the same dictionaries as the UI; `UserError` marks messages safe to show |
| `lib/providers/` | Data sources and the capability router (see below) |
| `lib/research.mjs` | Per-stock research updates through the router (resumable, keeps old data on empty responses); bulk institutional data for sources that only offer whole-market days |
| `lib/engine.mjs` | Four-factor scoring; factors the current sources can't provide are excluded and weights renormalized |
| `lib/board-stream.mjs` | Current-session Shioaji board projection, timestamp validation and minute spark points |
| `lib/heatmap.mjs` | Sector heatmap from whole-market daily data, live snapshots or local research data |
| `lib/radar.mjs`, `lib/replay.mjs` | Intraday alerts and the per-minute time-machine recorder |
| `lib/pricealerts.mjs` | Custom alerts: user rules per stock (price above/below, % up/down, projected volume ratio), checked on every snapshot or stream row; fires on the false→true crossing, one-time rules disable themselves, repeating rules re-arm with a 5-minute cooldown. Rules in `.local/price-alerts.json`; APIs `GET/POST /api/price-alerts`, `POST /api/price-alerts/delete` |
| `lib/warrants.mjs` | Warrant tracking (Taiwan, call warrants only, pure): FinMind warrant→underlying lookup (`TaiwanStockInfoWithWarrantSummary`, reused codes resolved by listing/last-trading date), TWSE `MI_INDEX` type 0999 and TPEx `tpex_warrant_daily_quts` quote parsing (`callWarrantQuotes` in `providers/twse.mjs`), issuer from the warrant name (the issuer head office's own warrants are excluded), per-branch aggregation by underlying (net amount, share of the underlying's call-warrant turnover, streaks; big-buy and consecutive-buy signals), and the per-stock warrant list. The broker watch queries `/taiwan_stock_warrant_trading_daily_report` once per tracked branch; APIs `GET /api/warrants?id=`, `GET /api/warrants/brokers?wid=&date=`; cache `.local/warrants/` |
| `lib/chipwatch.mjs` | Chip tracking (Taiwan, FinMind Sponsor): broker-branch tracking (one by-branch request per tracked branch after 18:30, `.local/broker-watch/<date>.json`, streaks; alerts for one-day dominance — net buying as a share of the day's volume plus a minimum amount — and multi-day accumulation as a share of total shares in custody) and the big-holder concentration ranking (whole-market shareholding table per week, `.local/holders-all/<date>.json`, 1- and 4-week change). APIs `/api/chipwatch*`, `/api/holders/rank*`; `POST /api/chipwatch/query` runs in the background (202) and the pages poll `GET /api/chipwatch?date=` for progress (`busy`, `query`) |
| `lib/stream.mjs` | Live-stream client (WebSocket): auth, per-channel batched subscriptions, heartbeat check, reconnect with backoff, events flushed in batches; `createStreamPool` spreads symbols over several connections |
| `lib/daytrade.mjs` | Day-trade engine (pure): per-stock state from trades / 1-minute bars / order book (or aggregates), VWAP, same-time volume baseline from the time machine, order-book imbalance, multi-timeframe score, three long opportunities and two risk alerts, exclusions, backfill, after-close evaluation and versioned review statistics |
| `lib/daytrade-context.mjs`, `lib/daytrade-history.mjs` | 30-session adjusted daily/minute history, completed 5m/60m aggregation, time-weighted full-depth book confirmation, watchlist history queue/cache |
| `lib/daytrade-market.mjs` | Day-trade market context (pure, record-only): per-index minute series (TAIEX / TPEx) fed from snapshot rows `001`/`101` or Fugle index candles, change, 15-minute change, time-weighted intraday average, breadth; tailwind / neutral / headwind and relative-strength rules; the `market` record stored with each signal and used to group the review |
| `lib/patterns.mjs`, `lib/pattern-service.mjs` | Pattern detection and the whole-market pattern snapshot |
| `lib/grouprank.mjs` | Research-group ranking, strict stream quote conversion and scope/coverage comparison metadata |
| `public/group-rank-source.js` | Shared desktop/mobile rank source, coverage, failure clearing and 10-second request timeout |
| `lib/llm.mjs`, `lib/report.mjs` | AI providers (structured JSON output) and the after-market report |
| `lib/flows.mjs`, `lib/market-card.mjs`, `lib/insight.mjs` | Taiwan-specific modules built on FinMind datasets (institutional/options overview, report card, brokers, shareholding) |
| `lib/briefing.mjs`, `lib/newswatch.mjs`, `lib/news-health.mjs` | Today's Brief (news, economic and earnings calendars) and news push (the data source's market news plus, for Taiwan, the cnyes news list via `lib/providers/cnyes.mjs`; the same article on both sources pushes once, a newly added source is recorded silently the first time) |
| `lib/scope.mjs`, `lib/watchgroups.mjs`, `lib/access.mjs` | Research groups, watchlist groups, Cloudflare Access JWT verification |

Front end (`public/`): `app.js` (shell and pages), `setup.js` (setup wizard and system settings), `market.js`
(client-side market clock, colors and units), `i18n.js` (translation), plus page modules. `i18n.js`, `market.js`,
`insight-ui.js`, `report-card.js`, `flow-cards.js`, `save-image.js` and `intraday.js` are shared with Pocket as identical copies;
a test fails if they drift apart.

### Data source router

Every provider module (`lib/providers/*.mjs`) exports an object:

```js
{
  id, name, site, docs,
  markets: ['TW', ...],              // markets it covers
  key: 'required' | 'none', keyEnv,  // key requirement and environment-variable override
  interval,                          // minimum milliseconds between requests
  caps: { daily: 1, snapshot: 'paid', universe: ['US'], institutional: 'bulk', ... },
  snapshotMode: 'market' | 'symbols',// whole-market snapshot or per-symbol quotes
  stream: { url, plans, plan(info, setting), channels: { full, lite }, auth(key), subscribe(symbols, channel), batch, parse(msg, market) }, // optional live stream
  streamBackfill(id, ctx),           // REST catch-up after a reconnect (quote + 1-minute bars)
  async validate(key) { return { plan, tier: 'free' | 'paid' | 'sponsor', ... } },
  daily(id, from, to, ctx), snapshot(ids, ctx), ...   // one function per capability
}
```

Capability values: `1` available, `'paid'` / `'sponsor'` only when the verified tier allows it, an array limits it to
some markets, `'bulk'` (institutional) means research updates use whole-market days. `providers/index.mjs` picks a
provider per capability (preferred source first, then the enabled order), injects the key, interval and market into
`ctx`, and exposes `data.<capability>()` to the rest of the app. `capabilityMap()` tells the UI which features exist.

Capabilities: `universe, calendar, daily, adjusted, dailyAll, snapshot, stream, dayTrade, intraday, news, marketNews,
valuation, revenue, institutional, institutionalAll, brokers, holders, flows, futures, margin`.

`planStream()` in `lib/stream.mjs` turns the provider's `stream` spec into the subscription plan (mode, channels,
symbols, connection groups, order-book recorder extras); a spec with `channels.book: []` gets no extras, and the
day-trade history loader only runs when the provider has `streamHistory`.

SinoPac Shioaji (`lib/providers/shioaji.mjs`, caps `stream` only) connects to the local quote bridge
`ws://127.0.0.1:4350` (`sj-quote-bridge` in the separate sj-trading project, which logs in with a quote-only key and
cannot trade). It speaks the same protocol as Fugle's aggregates channel: `auth` → `authenticated`, `subscribe` →
one `subscribed` entry per accepted symbol (rejected symbols come back as `error` and are not counted), `data`, and
`heartbeat`. Plan `bridge`: 200 subscriptions, 1 connection, lite mode only. When the broker session drops, the bridge
closes the WebSocket and refuses new handshakes (HTTP 503) until it recovers, so the client reports the outage and
reconnects with its normal backoff. See [features/shioaji-bridge.md](features/shioaji-bridge.md).

`stream` (Fugle WebSocket or the Shioaji bridge) drives the intraday radar. During the session `server.mjs` opens it for
the watchlist first, then the research list, up to `stream.limit` for the verified plan, and refreshes the list when it
changes. Stream rows use the live-snapshot format plus `volume_at_bid` / `volume_at_ask`; the radar takes stream rows
for subscribed stocks and snapshot rows for the rest, and other providers use whichever row is newer. Shioaji quote consumers, reminder metadata and provisional daily chart bars all use the same current-day/current-session/subscribed/healthy board projection; they never fall back to a stale snapshot. Daily OHLCV supplementation requires complete valid fields and is response-only; it does not write price history or synthesize minute bars. The Shioaji live board uses the same current-session subscription cache as the heatmap. Other board providers retain their snapshot/replay behavior. Client polling coalesces same-group requests, isolates newer group intent and clears quotes after a 10-second API timeout. Snapshot errors are a separate monitor field and notice. Stream minutes reset on day/session changes; no REST backfill is added. The Shioaji heatmap reads the existing stream cache and subscription set via `buildStreamHeatmap`; it returns research scope, quote time and feed status. Unhealthy connections and empty current-day quotes return no chart. Reopening a stream immediately reports disconnection and clears buffered events. The heatmap distinguishes confirmed subscriptions from the planned scope; client request generations prevent late history/live responses from changing a newer selection, and delayed prior-day live payloads are discarded. Other heatmap sources and time-machine recording keep using snapshots. The key is sent only in the auth message, never in the URL.

Day-trade monitoring (Taiwan): with day-trade monitoring on and enough subscriptions (e.g. Fugle Advanced), the stream
runs in full mode — trades, 1-minute bars and order book per stock, split over two connections by sorted symbol — and
`lib/daytrade.mjs` turns the events into snapshot rows (so the radar and board keep working) plus scores and signals.
Otherwise it runs in lite mode (aggregates). `auto` plan tries full mode and falls back to lite for the day when the
subscriptions come up short. Pre-market data comes from the `dayTrade` capability (FinMind: day-trade list,
suspensions, sell-first bans, reference prices) and TWSE/TPEx disposition lists. After a reconnect (or a mid-session
start) every stock is backfilled through `streamBackfill` before it can signal again. Signals go to the radar
(`dt-*` alert types) and push; after the close they are evaluated against 1-minute bars and stored in
`.local/daytrade/<date>.json`. APIs: `GET /api/daytrade`, `GET /api/daytrade/review`, `POST /api/daytrade/settings`.
V2 scans all research groups plus the watchlist by default (`scope: watchlist` limits it to the watchlist). Full mode prioritizes the watchlist; missing history, incomplete candles, stale books or failed backfill pause entry alerts. Risk alerts bypass entry scores and continue until 13:25. See the linked guide for exact defaults and limitations.
Market context (record only): every signal stores a `market` record for its own index — TAIEX for listed stocks, TPEx
for OTC stocks — taken from the snapshot index rows every 10 seconds (no extra requests); when the snapshot has no index
rows for 90 seconds, or a mid-session start misses the open, the server polls Fugle index quote + 1-minute candles at most
once a minute per index. `GET /api/daytrade` returns the current `market` state; `GET /api/daytrade/review` groups v2 long
signals by regime and relative strength. Scores, thresholds and alerts do not use it.
Details and formulas: [DAYTRADE.zh-TW.md](DAYTRADE.zh-TW.md), [features/daytrade-market.md](features/daytrade-market.md).

All providers return the internal row format (FinMind field names, so scoring and patterns work unchanged):

| Data | Row |
|---|---|
| Daily bar | `{ date, stock_id, open, max, min, close, Trading_Volume (shares), Trading_money, spread }` |
| Live snapshot | `{ stock_id, date 'YYYY-MM-DD HH:MM:SS' (market time), open, high, low, close, change_price, total_volume (display units), total_amount, yesterday_volume, buy_price, sell_price }` |
| Minute bar | `[HH:MM (start), open, high, low, close, volume (display units)]` |
| News | `{ date, stock_id, title, link, source }` |
| Valuation / revenue | `{ date, PER, PBR, dividend_yield }` / `{ date, revenue_year, revenue_month or revenue_quarter, revenue }` |

Errors are `DataError` with `code` `auth`, `quota` or `plan`, which the schedulers use to pause automatic requests.

### Storage

`EquiLens-Nexus/.local/` (or `EQUITY_DATA_DIR`): `config.json`, `settings.json`, `groups.json`, `watchlist.json`,
`universe.json`, `stocks/<symbol>.json`, `heatmap-*.json`, `replay/`, `alerts-*.json`, `reports/`, key files
(`*.dpapi` etc.). When the market is switched, the market-specific files move to `.local/markets/<MARKET>/` and the
target market's files move back.

## Pocket (`EquiLens-Pocket/`)

`server.mjs` serves the PWA and proxies `/m/api/*` to Nexus after password login (`lib/auth.mjs`). It relays new radar,
news and report events as Web Push notifications (`lib/push.mjs`, RFC 8291/8292 with Node's crypto). The interface
language, market profile, colors and remote-access settings come from Nexus `/api/profile`; translations are served from
Nexus `/locales/`.

Remote access (`lib/remote.mjs`): Pocket binds to `127.0.0.1`, so every external request arrives through a local tunnel or
reverse proxy. The connection mode chosen in Nexus (`auto`, `cloudflare-quick`, `cloudflare-named`, `custom`, `off`) decides
which hosts are allowed (the domains entered in Nexus, plus `*.trycloudflare.com` only for quick tunnels) and which headers
are trusted for the client IP and HTTPS (`CF-Connecting-IP` / `CF-Visitor` for Cloudflare, `X-Real-IP` or the last
`X-Forwarded-For` entry / `X-Forwarded-Proto` for a self-managed proxy). The latest settings are cached in
`.local/remote-cache.json`; an unknown host triggers at most one settings refresh every 15 seconds. The start scripts read
the same mode to decide whether to run `cloudflared`.

## Extending

**Add a data source** – create `lib/providers/<id>.mjs` following the shape above, register it in `PROVIDERS` in
`lib/providers/index.mjs`, add a description in `public/setup.js` (`PROVIDER_NOTES`), add tests with mocked responses,
and translate any new strings.

**Add a market** – add an entry to `MARKETS` in `lib/markets.mjs` (time zone, sessions, lot, ticks, limits, symbol
regex, replay scales, liquidity threshold), map it in the providers that cover it (e.g. Twelve Data `VENUE`), and
optionally add `data/templates/<MARKET>.json` sample groups.

**Add an AI service** – add it to `LLM_INFO`, `generateJSON` and `listModels` in `lib/llm.mjs`, and to
`LLM_PROVIDERS` in `lib/config.mjs`.

**Add a language** – add `public/locales/<lang>.json` (keys are the Traditional Chinese source strings, `{name}` /
`{0}` placeholders must match), add the code to `LANGUAGES` in `lib/config.mjs` and the language pickers in
`public/setup.js`, then run `node tools/i18n-keys.mjs --missing <lang>` until it reports 0. The UI translates text
nodes and `placeholder` / `title` / `aria-label` automatically; mark user data with `translate="no"`.

README screenshots live in `docs/images/` and are regenerated with `EquiLens-Nexus/tools/screenshots/` (synthetic sample data, a fixed clock and no outbound requests; see its README).

## Tests

`npm test` in each component. Nexus tests cover scoring, patterns, heatmap, radar, replay, providers' row handling,
market rules, the setup and market-switch APIs (on a temporary data folder and port), secrets and translations.

Shioaji group-ranking queries project `shioajiBoard()` rows through the existing ranking formula. Both query and cached GET responses recheck the current feed instead of returning a stale ten-second computation. This path opens no connections or REST calls. New records carry deterministic membership and quoted-symbol signatures; moves require matching signatures and ranking rules. Legacy history is sanitized for display without rewriting files. Closing capture retains its existing source order and 80% coverage threshold. Desktop and Pocket share identical `group-rank-source.js` files and continue polling every 30 seconds until the Shioaji live state transitions to a closing record.

News source health is persisted inside `news-seen.json.health` without replacing dedup keys. Each provider owns its last attempt/success/new-article time, error and pause. A successful empty scan leaves last-new unchanged. New-article time means deduplicated research-scope discovery, before the notification watchlist filter and excluding seeding. Failed/paused sources cannot be marked healthy by another source. Total outages persist health without advancing dedup scan time. Market/provider generations discard in-flight results from an obsolete configuration. Desktop/Pocket share `news-source.js`; chart failures remove transient quotes and provisional bars while retaining stored history. Source health is visible in news settings, refreshed every ten seconds while that settings view is open.

## FinMind access lifecycle

`finmind-access.mjs` persists only sanitized credential state, request generations, cooldowns and operation observations. Unknown entitlement never becomes an inferred tier. `finmind-lifecycle.mjs` serializes validation and OS secret changes; failed persistence disables access. The existing daily queue and independent snapshot channel share generation checks and abort signals. Explicit provider configuration can clear operation pauses, but never global auth/quota gates. Settings exports exclude this local security state. Other providers, cache formats and scoring remain unchanged. See [access behavior](features/finmind-access.md).

Source retries use the same credential lifecycle queue as secret save/remove. Only an absent state file triggers migration; existing non-object JSON fails closed. Daily throttling timestamps actual fetch dispatch after secret lookup; snapshots do not update that clock.

## Fixed RSS news sources

`lib/providers/rss-news.mjs` reads only the two fixed publisher feeds through fast-xml-parser 5.11.2 (MIT). It rejects DTD/entity declarations, redirects, unsafe article domains, malformed dates and feeds above 1 MiB; at most 100 items are inspected. Titles, publisher categories and plain summaries are matched against the local listed/OTC catalog intersected with research scope. Descriptions and article bodies are never persisted.

`lib/news-poll.mjs` reserves each source attempt in the existing `news-seen.json.health` before network I/O. RSS waits five minutes after every attempt, including empty responses and failures; cnyes retains its roughly one-minute interval and does not wait on RSS. Responses from an obsolete market, news setting or research-scope generation are discarded. Successful sources enter the existing newswatch deduplication separately, so one failure cannot mask another success; new RSS/cnyes sources seed their first non-empty batch. Each polling batch captures the first/resume seed decision before I/O and retains it in per-source completion callbacks, so a fast empty source cannot release a slow source from old-news suppression; subsequent healthy polls remain independent. No FinMind access state, quote transport, notification delivery or scheduler outside news changes.
