# search-gateway Deutsch

`search-gateway` ist ein Cloudflare-Worker-Gateway für Suche und Webseitenabruf durch KI-Agenten.

Funktionen:

- `/search`: Fallback/Aggregation über mehrere Suchanbieter.
- `/fetch`: Text-, Metadaten- und Chunk-Extraktion.
- `/batch_fetch`: Batch-Abruf mehrerer URLs.
- Maschinenlesbare Fehlercodes und empfohlene Aktionen.
- CJK-Ranking, Aktualität, glaubwürdige Quellen, SEO-Spam-Abwertung, Domain-Diversität und Provider-Konsens.
- Offline-Suchqualitätsbenchmark und Ranking-Diff-Reporter.

```bash
npm install
npm run test:ci
```

Die englische `README.md` ist die maßgebliche technische Dokumentation.
