# Testing

## Fast checks

```bash
npm run check
npm test
npm run test:search-quality
```

## Ranking diff workflow

```bash
npm run ranking:diff -- --write-baseline /tmp/search-ranking-baseline.json
# change ranking logic
npm run ranking:diff -- --baseline /tmp/search-ranking-baseline.json --top 3
npm run test:search-quality
```

## Full local CI gate

```bash
npm run test:ci
```

`npm run test:live` is intentionally not part of default CI because it depends on a deployed gateway URL/token and live network behavior.
