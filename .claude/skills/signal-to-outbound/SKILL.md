---
name: signal-to-outbound
description: Find companies that match an ICP and show a buying signal (e.g. hiring GTM roles after a funding round), enrich them from public sources or Clay, score them with Claude against a strict schema, and write a review sheet for a human to approve. Use when someone asks to build a target account list, find accounts showing a signal, refresh the outbound list, or run the weekly signal sweep. Never sends email or writes to a CRM.
---

# signal-to-outbound

Turns an ICP and a signal definition into a sourced, scored review sheet. The output is a CSV a human approves row by row. That is the end of this skill: sending and CRM writes are separate, deliberate steps that happen after approval.

## The approval rule

- Never send an email, a message, or a sequence enrolment.
- Never create or update CRM records.
- The only outputs are files in `output/`. If the user asks you to send or sync from this skill, say that approved rows are handed to the send/CRM step separately, and stop at the sheet.

## Inputs

| Input | Where | Notes |
|---|---|---|
| ICP and signal definition | `config/icp.json` | Who the seller is, the ICP criteria, the primary signal, bonus signals, buyer titles. Edit this to change the ICP. |
| Target count | Ask the user | Default 15. |
| Enriched companies | `data/companies.json` | Produced by steps 1 and 2. Shape is `Company` in `src/schema.ts`. |

If the user gives a new ICP in conversation, update `config/icp.json` first and show them the diff.

## Steps

### 1. Find

Search public sources for companies that match the ICP **and** show the primary signal: funding news, company careers pages, public ATS boards (Ashby, Greenhouse, Lever, Workable, Teamtailor, Personio).

- Open the careers page to confirm the roles are listed today. Search snippets are not evidence.
- Record the URL for every fact.
- Drop a company when the ICP match or the signal cannot be confirmed. Fewer solid rows beat more shaky ones.

### 2. Enrich

Fill every field of `Company` for each company: website, HQ country, employee range, last round (stage, amount, date), open GTM roles (title and link), CRM if detectable, one-line description, bonus signals, sources.

- **Clay first, if connected.** Check whether Clay is available (the Clay plugin's CLI, or a Clay MCP server). If it is, list the routines it exposes (`clay routines list`) and the cost per company of each one you plan to use (`clay routines get <id>`), then tell the user the total. **Wait for their go-ahead before spending credits.** Reading the list and the costs is free.
- **Web research otherwise.** For any field Clay cannot fill on the user's plan, research it on the web and note in your summary which fields came from where.
- Unknown stays blank. Use `""` or `[]`. Never guess a headcount, an amount or a CRM.

Write the result to `data/companies.json`.

### 3. Score, validate, write the sheet

```
npm run score
```

This scores each company with Claude using structured output, validates each response with zod, runs the grounding check, retries once with the validation errors, and marks anything that still fails as `needs_review`. It writes:

- `output/review.csv`: the review sheet, sorted by priority, with empty `decision` and `reviewer_notes` columns
- `output/clay-import.csv`: the enrichment data, ready to import into a Clay table
- `output/summary.json`: counts, tokens and estimated cost

Each company costs one API call, two if it needs a retry. The script refuses to make more than 50 calls unless run with `--yes`. Ask the user before passing `--yes`.

### 4. Report

Give the user: counts (found, enriched, scored, needs_review), the estimated cost, which rows need review and why, and the path to `output/review.csv`. Remind them that nothing has been sent.

## Data rules

- Public, company-level data only. No LinkedIn scraping.
- No names of individuals, personal emails or phone numbers. The buyer is named by job title.
- Every row carries its source URLs.

## Reference

- `docs/runbook.md`: the one-page guide for the person reviewing the sheet
- `README.md`: design decisions, limitations, setup
