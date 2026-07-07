## Summary

- 

## Test plan

- [ ] `npm run test:ci`
- [ ] If search ranking changed: `npm run ranking:diff -- --baseline <baseline.json> --top 3`
- [ ] If deployment behavior changed: `npm run dry-run`

## Notes

- No secrets or real `.dev.vars` values are included.
- Ranking changes should include benchmark/diff evidence.
