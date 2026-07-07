# search-gateway Español

`search-gateway` es una pasarela de búsqueda y extracción web en Cloudflare Workers para agentes de IA.

Funciones principales:

- `/search`: búsqueda con fallback/aggregate entre proveedores.
- `/fetch`: extracción de texto, metadatos y fragmentos.
- `/batch_fetch`: extracción por lotes.
- Errores legibles por máquina y acciones sugeridas.
- Ranking CJK, freshness, fuentes confiables, reducción de spam SEO, diversidad de dominio y consenso entre proveedores.
- Benchmark offline de calidad de búsqueda y ranking diff reporter.

```bash
npm install
npm run test:ci
```

La documentación técnica autoritativa está en `README.md`.
