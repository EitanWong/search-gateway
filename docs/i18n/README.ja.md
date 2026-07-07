# agent-search-gateway 日本語

`agent-search-gateway` は AI エージェント向けの Cloudflare Worker 検索・ページ取得ゲートウェイです。

主な機能:

- `/search`: 複数検索プロバイダーの fallback/aggregate。
- `/fetch`: 本文、メタデータ、チャンク取得。
- `/batch_fetch`: 複数 URL の一括取得。
- 機械可読なエラーコードと復旧ヒント。
- CJK ranking、freshness、信頼ソース、SEO スパム抑制、domain diversity、provider consensus。
- オフライン品質 benchmark と ranking diff reporter。

```bash
npm install
npm run test:ci
```

詳細は英語版 `README.md` を参照してください。
