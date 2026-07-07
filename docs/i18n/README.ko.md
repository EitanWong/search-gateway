# search-gateway 한국어

`search-gateway`는 AI Agent를 위한 Cloudflare Worker 검색/웹 페이지 가져오기 게이트웨이입니다.

주요 기능:

- `/search`: 여러 검색 provider fallback/aggregate.
- `/fetch`: 본문, 메타데이터, chunk 추출.
- `/batch_fetch`: 여러 URL 일괄 fetch.
- 기계가 읽을 수 있는 오류 코드와 복구 제안.
- CJK ranking, freshness, 신뢰 소스, SEO spam demotion, domain diversity, provider consensus.
- 오프라인 검색 품질 benchmark와 ranking diff reporter.

```bash
npm install
npm run test:ci
```

자세한 API는 영어 `README.md`를 기준으로 합니다.
