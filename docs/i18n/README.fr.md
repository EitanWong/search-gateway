# search-gateway Français

`search-gateway` est une passerelle Cloudflare Worker de recherche et de récupération web pour agents IA.

Fonctionnalités:

- `/search`: fallback/aggregate entre fournisseurs de recherche.
- `/fetch`: extraction de texte, métadonnées et chunks.
- `/batch_fetch`: récupération par lot.
- Codes d'erreur lisibles par machine et actions suggérées.
- Ranking CJK, fraîcheur, sources crédibles, anti-spam SEO, diversité de domaines et consensus fournisseurs.
- Benchmark hors ligne et rapport de diff de ranking.

```bash
npm install
npm run test:ci
```

Le `README.md` anglais reste la référence.
