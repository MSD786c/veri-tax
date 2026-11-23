# Contributing

## Branches

| Branch | Owner |
|--------|-------|
| `main` | Protected. Changes land only through a pull request with 1 approval and green CI. No force-push, no deletion. |
| `Suhayl` | Suhayl's working branch |
| `Haaziq` | Haaziq's working branch |
| `Aaron` | Aaron's working branch |

## Workflow

```bash
git checkout <YourName>
git pull origin main          # stay current with main before you start
# ...work, commit small...
git push origin <YourName>
gh pr create --base main      # ask a teammate to review
```

After your PR merges, run `git pull origin main` on your branch again before you continue.

## Commit messages

Use `type: summary`, where type is one of `feat`, `fix`, `docs`, `chore`, `test` or `refactor`. Put the rule ID in the summary when there is one, for example `feat: NR-03 construction-period check`.

## Adding a rule

1. Implement it in `app/rules.py` (`check_invoice` or `check_supplier_response`), returning `(rule_id, RuleOutcome, evidence)`.
2. Bump `RULESET_VERSION`.
3. Add an assertion to `tests/test_flow.py`, or a new `tests/test_*.py`, that fails if the rule breaks.
