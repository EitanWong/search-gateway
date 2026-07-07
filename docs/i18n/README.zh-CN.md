# search-gateway 简体中文

`search-gateway` 是面向 AI Agent 的 Cloudflare Worker 搜索/网页抓取网关。

核心能力：

- `/search`：聚合多个搜索 provider，支持 fallback/aggregate。
- `/fetch`：抓取网页正文、元数据和分块文本。
- `/batch_fetch`：批量抓取 URL。
- 机器可读错误码和恢复建议。
- 中文/CJK ranking、freshness、权威源、反 SEO 垃圾、domain diversity、provider consensus。
- 离线搜索质量 benchmark 和 ranking diff reporter。

快速验证：

```bash
npm install
npm run test:ci
```

详细 API 以仓库根目录 `README.md` 为准。
