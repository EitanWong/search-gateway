# Bocha pricing and rate limits

This page summarizes the Bocha pricing and quota details used by the optional Bocha providers in this gateway.

> Prices and limits can change. Treat this as a deployment planning reference and verify current terms in the Bocha console before production use.

## Latency and capacity claims

Bocha positions the service at roughly one third of comparable overseas products, with about `0.15s` response latency and up to `1000–2000 QPS` on approved high-volume tiers.

## Pay-as-you-go pricing

| API | Code | Gateway surface | Result type | List price |
|---|---|---|---|---:|
| Web Search API | `bocha-web-search` | `provider: "bocha"` | Web pages, titles, links, snippets, summaries, site names/icons, publish time, images | ¥0.036/call |
| AI Search API | `bocha-ai-search` | `provider: "bocha_ai"` | Web pages, images, modal cards, optional answer/follow-up questions | ¥0.060/call |
| Agent Search API | `bocha-agent-search` | not integrated | Agent-oriented search | Internal beta ended |
| Semantic Reranker API | `bocha-semantic-reranker-cn` | `/rerank` only if model access is enabled | Chinese semantic rerank | Internal beta quota full |
| Semantic Reranker API | `bocha-semantic-reranker-en` | `/rerank` only if model access is enabled | English semantic rerank | Internal beta quota full |
| Semantic Reranker API | `gte-rerank` | `/rerank` default model | General rerank | ¥0.005/call; billed starting 2025-11-01 |

Notes:

- `bocha` maps to `https://api.bochaai.com/v1/web-search`.
- `bocha_ai` maps to `https://api.bocha.cn/v1/ai-search`.
- `/rerank` maps to `https://api.bocha.cn/v1/rerank` and defaults to `gte-rerank`.
- `/balance` with `provider=bocha` maps to `https://api.bocha.cn/v1/fund/remaining` and can be used to monitor remaining account balance.

## Resource packages

### Web Search API

| Package | Calls | Price | Effective unit price | Validity |
|---|---:|---:|---:|---|
| Free trial | 1,000 | ¥0 | — | 3 months |
| Trial pack | 1,000 | ¥3.6 | ¥3.6 / 1k calls | 3 months |
| Standard pack | 1,000 | ¥36 | ¥36 / 1k calls | 1 year |
| Package 1 | 10,000 | ¥320 | ¥32 / 1k calls | 1 year |
| Package 2 | 100,000 | ¥3,000 | ¥30 / 1k calls | 1 year |
| Package 3 | 1,000,000 | ¥28,000 | ¥28 / 1k calls | 1 year |
| Package 4 | 10,000,000 | ¥250,000 | ¥25 / 1k calls | 1 year |

After package usage is exhausted, Web Search falls back to pay-as-you-go at `¥0.036/call`.

### AI Search API

| Package | Calls | Price | Effective unit price | Validity |
|---|---:|---:|---:|---|
| Standard pack | 1,000 | ¥60 | ¥60 / 1k calls | 1 year |
| Package 1 | 10,000 | ¥600 | ¥60 / 1k calls | 1 year |
| Package 2 | 100,000 | ¥6,000 | ¥60 / 1k calls | 1 year |
| Package 3 | 1,000,000 | ¥60,000 | ¥60 / 1k calls | 1 year |

After package usage is exhausted, AI Search falls back to pay-as-you-go at `¥0.060/call`.

## Account-based rate limits

Bocha rate limits are based on cumulative recharge amount.

| Tier | Cumulative recharge | QPS | QPM | QPD |
|---|---:|---:|---:|---:|
| Tier 0 | ¥0 | 1 | 30 | 1,000 |
| Tier 1 | ¥10 | 5 | 200 | 10,000 |
| Tier 2 | ¥100 | 10 | 500 | 100,000 |
| Tier 3 | ¥500 | 30 | 2,000 | 1,000,000 |
| Tier 4 | ¥5,000 | Contact support; up to 2,000 QPS | unlimited | unlimited |
| Tier 5 | ¥20,000 | Contact support | unlimited | unlimited |
| Tier 6 | ¥100,000 | Contact support | unlimited | unlimited |

For Tier 4–Tier 6, higher QPS can be requested for free when the previous week's single-day call volume reaches the required scale:

| QPS target | Required daily call volume |
|---:|---:|
| 60 QPS | 1,000,000 ≤ daily calls < 1,500,000 |
| 100 QPS | 1,500,000 ≤ daily calls < 3,000,000 |
| 200 QPS | 3,000,000 ≤ daily calls < 10,000,000 |
| 500 QPS | 10,000,000 ≤ daily calls < 30,000,000 |
| 1000 QPS | 30,000,000 ≤ daily calls < 60,000,000 |
| 2000 QPS | 60,000,000 ≤ daily calls < 100,000,000 |

## Temporary QPS extension packages

| Extension | Price |
|---:|---:|
| 1 QPS | ¥600/month |
| 10 QPS | ¥6,000/month |
| 50 QPS | ¥28,000/month |

Extensions can be stacked.

## Gateway deployment guidance

- Use `SEARCH_RATE_LIMIT_PER_MINUTE` and Cloudflare WAF/rate limiting to stay below the Bocha account tier.
- For Tier 0 accounts, keep gateway public exposure low: Bocha allows only `1 QPS`, `30 QPM`, `1000 QPD`.
- Prefer `provider: "bocha"` for normal search: it is cheaper than `bocha_ai` and returns the web result structure directly.
- Use `provider: "bocha_ai"` only when modal-card coverage or Bocha's AI-search pipeline is valuable.
- Use `/rerank` selectively after a first-stage search; reranking every query/result set adds cost and latency.
- Use `/balance?provider=bocha` in private deployments to monitor remaining balance before large batches.
