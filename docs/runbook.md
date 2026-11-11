# Runbook: signal-to-outbound

For the person who runs the weekly list and reviews it. No coding needed.

## What this does

It finds companies that fit your ideal customer profile and are showing a buying signal right now, scores each one, drafts an opening line, and puts everything in a spreadsheet for you to approve.

**It does not send anything.** No emails go out and nothing is written to your CRM until you have approved a row and handed it to the next step.

## Run it

1. Open the project folder in Claude Code.
2. Type: `/signal-to-outbound` (or just say "run the signal sweep for 15 companies").
3. Claude will tell you what it plans to do. If Clay is connected, it will ask before spending Clay credits. Answer yes or no.
4. Wait a few minutes. When it finishes you get a short summary and a file: `output/review.csv`.

If the company list is already up to date and you only want to re-score it, run `npm run score` in the terminal.

## Review the sheet

Open `output/review.csv` in Google Sheets or Excel. The most promising companies are at the top.

For each row:

1. Read `why_now` and `first_line`.
2. Click one or two links in `source_urls` and `open_gtm_roles` to check the facts are still true. Job ads close.
3. Fill in the `decision` column:

| decision | Use it when |
|---|---|
| `approve` | The company fits and the opening line is accurate. |
| `edit` | The company fits but you changed the line. Put your version in `reviewer_notes`. |
| `reject` | Wrong fit, stale signal, or an existing customer. Say why in `reviewer_notes`. |

### What the columns mean

| Column | Meaning |
|---|---|
| `priority` | high, medium or low. High means a strong fit and a strong signal. |
| `icp_fit` | 1 to 5. How closely the company matches your profile. |
| `signal_strength` | 1 to 5. How strong the buying signal is. |
| `confidence` | 0 to 1. Lower when information about the company was missing. |
| `status` | `scored`, or `needs_review` (see below). |
| `validation_notes` | Why a row was retried or flagged. |

### Rows marked `needs_review`

These are at the bottom. The AI's answer failed a quality check twice (for example, it mentioned something that was not in the research), so the system left the scoring blank instead of guessing. Read `validation_notes`, look at the sources, and decide yourself.

## After review

Send the sheet back to whoever owns outbound. Only rows marked `approve` or `edit` move on.

## Change who you are targeting

Ask Claude: "change the ICP to ..." and it will update `config/icp.json` and show you the change. Then run the skill again.

## If something goes wrong

| What you see | What to do |
|---|---|
| "Anthropic API key missing or invalid" | The key in the `.env` file is missing or expired. Ask your admin for a new one. |
| "This run could make up to N API calls" | The list is larger than usual. Confirm with your admin, then re-run with `--yes`. |
| Many rows are `needs_review` | The research data is probably thin. Ask Claude to re-run the enrichment step. |
| A link in the sheet is dead | The job ad closed or the page moved. Reject the row or check the company's careers page. |
