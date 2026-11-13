## What changes

<!-- what a reader of the result sees differently, and why -->

## The rule, case by case

<!-- For a change that computes something a reader sees (docs/TESTING.md, "Writing the tests for a
change"). For parity, every branch of the legacy function, with its source line, plus the edge
inputs: none, one, all equal, mixed types, missing, unparseable, ties, limits. Delete this section
for a change that computes nothing. -->

| Case | Input | Expected | Source | Test |
|---|---|---|---|---|
| | | | | |

## How the tests were made to bite

- [ ] Each row above is a test, seen failing on the code before this change where behaviour changes
- [ ] Tests written without the implementation in view (who or which agent wrote them)
- [ ] The warehouse asked which value shapes occur; any the table lacked are added (the query)
- [ ] Logic in SQL is run against the fixture study, not matched as text
- [ ] Planted bugs in `scripts/check-mutants.ts`, each caught (their ids)

## Verified

<!-- what was looked at and measured beyond the tests: screenshots, counts against cbioportal.org -->
