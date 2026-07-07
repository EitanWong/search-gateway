# agent-search-gateway Português do Brasil

`agent-search-gateway` é um gateway Cloudflare Worker de busca e captura de páginas para agentes de IA.

Recursos principais:

- `/search`: fallback/aggregate entre provedores de busca.
- `/fetch`: extração de texto, metadados e chunks.
- `/batch_fetch`: captura em lote.
- Códigos de erro legíveis por máquina e ações sugeridas.
- Ranking CJK, freshness, fontes confiáveis, redução de spam SEO, diversidade de domínio e consenso entre provedores.
- Benchmark offline de qualidade de busca e ranking diff reporter.

```bash
npm install
npm run test:ci
```

A documentação técnica principal está em `README.md`.
