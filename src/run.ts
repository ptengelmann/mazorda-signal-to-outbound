import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { stringify } from "csv-stringify/sync";
import { z } from "zod";
import { Company, Icp } from "./schema.js";
import { MODEL, scoreCompany, type ScoredRow, type Usage } from "./score.js";

// USD per million tokens for the default model (claude-sonnet-5-5). Update if you change SCORING_MODEL.
const PRICE = { input: 2, output: 10 };
const MAX_CALLS_WITHOUT_CONFIRM = 50;
const CONCURRENCY = 3;

const { values: args } = parseArgs({
  options: {
    input: { type: "string", default: "data/companies.json" },
    icp: { type: "string", default: "config/icp.json" },
    out: { type: "string", default: "output" },
    limit: { type: "string" },
    yes: { type: "boolean", default: false },
  },
});

try {
  process.loadEnvFile(".env");
} catch {
  // no .env file: rely on the environment
}

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const icp = Icp.parse(readJson(args.icp));
let companies = z.array(Company).parse(readJson(args.input));
if (args.limit) companies = companies.slice(0, Number(args.limit));

const isEnriched = (c: Company) => Boolean(c.website && c.last_round.stage && c.open_gtm_roles.length);
const roles = (c: Company) => c.open_gtm_roles.map((r) => `${r.title} (${r.url})`).join("\n");

mkdirSync(args.out, { recursive: true });

// 1. Clay import file: enrichment only, no API needed.
writeFileSync(
  `${args.out}/clay-import.csv`,
  stringify(
    companies.map((c) => ({
      "Company Name": c.company,
      Website: c.website,
      "HQ Country": c.hq_country,
      "HQ City": c.hq_city,
      "Employee Range": c.employee_range,
      Description: c.description,
      "Last Round Stage": c.last_round.stage,
      "Last Round Amount": c.last_round.amount,
      "Last Round Date": c.last_round.date,
      "Open GTM Roles": c.open_gtm_roles.map((r) => r.title).join("; "),
      "GTM Role URLs": c.open_gtm_roles.map((r) => r.url).join("; "),
      CRM: c.crm,
      "Bonus Signals": c.bonus_signals.join("; "),
      "Source URLs": c.sources.join("; "),
    })),
    { header: true },
  ),
);

// 2. Guard: ask before a large run (each company costs 1 call, 2 if it needs a retry).
const worstCaseCalls = companies.length * 2;
if (worstCaseCalls > MAX_CALLS_WITHOUT_CONFIRM && !args.yes) {
  console.error(`This run could make up to ${worstCaseCalls} API calls. Re-run with --yes to confirm, or use --limit.`);
  process.exit(1);
}

// 3. Score with a small worker pool.
const client = new Anthropic();
const usage: Usage = { calls: 0, input_tokens: 0, output_tokens: 0 };
const rows: ScoredRow[] = new Array(companies.length);
let next = 0;
async function worker() {
  while (next < companies.length) {
    const i = next++;
    const company = companies[i]!;
    rows[i] = await scoreCompany(client, icp, company, usage);
    const row = rows[i]!;
    console.log(`  ${row.status === "scored" ? row.score.priority.padEnd(6) : "REVIEW"}  ${company.company}${row.attempts > 1 ? "  (retried)" : ""}`);
  }
}
console.log(`Scoring ${companies.length} companies with ${MODEL}...`);
try {
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
} catch (error) {
  if (error instanceof Anthropic.AuthenticationError) {
    console.error("\nAnthropic API key missing or invalid. Copy .env.example to .env and set ANTHROPIC_API_KEY.");
    process.exit(1);
  }
  throw error;
}

// 4. Review sheet, sorted by priority. Rows that failed validation go last, clearly flagged.
const rank = (r: ScoredRow) => (r.score ? { high: 0, medium: 1, low: 2 }[r.score.priority] : 3);
rows.sort((a, b) => rank(a) - rank(b) || (b.score?.signal_strength ?? 0) - (a.score?.signal_strength ?? 0));

writeFileSync(
  `${args.out}/review.csv`,
  stringify(
    rows.map(({ company: c, score: s, status, notes }) => ({
      decision: "",
      reviewer_notes: "",
      priority: s?.priority ?? "",
      status,
      company: c.company,
      website: c.website,
      hq_country: c.hq_country,
      employee_range: c.employee_range,
      last_round: [c.last_round.stage, c.last_round.amount, c.last_round.date].filter(Boolean).join(", "),
      open_gtm_roles: roles(c),
      crm: c.crm,
      bonus_signals: c.bonus_signals.join("\n"),
      icp_fit: s?.icp_fit ?? "",
      signal_strength: s?.signal_strength ?? "",
      why_now: s?.why_now ?? "",
      likely_buyer_title: s?.likely_buyer_title ?? "",
      first_line: s?.first_line ?? "",
      confidence: s?.confidence ?? "",
      validation_notes: notes,
      description: c.description,
      source_urls: c.sources.join("\n"),
    })),
    { header: true },
  ),
);

// 5. Summary.
const cost = (usage.input_tokens * PRICE.input + usage.output_tokens * PRICE.output) / 1_000_000;
const summary = {
  run_at: new Date().toISOString(),
  model: MODEL,
  found: companies.length,
  enriched: companies.filter(isEnriched).length,
  scored: rows.filter((r) => r.status === "scored").length,
  needs_review: rows.filter((r) => r.status === "needs_review").length,
  retried: rows.filter((r) => r.attempts > 1).length,
  by_priority: Object.fromEntries(["high", "medium", "low"].map((p) => [p, rows.filter((r) => r.score?.priority === p).length])),
  api_calls: usage.calls,
  input_tokens: usage.input_tokens,
  output_tokens: usage.output_tokens,
  estimated_cost_usd: Number(cost.toFixed(4)),
};
writeFileSync(`${args.out}/summary.json`, JSON.stringify(summary, null, 2));

console.log(`
Summary
  found         ${summary.found}
  enriched      ${summary.enriched}
  scored        ${summary.scored}  (high ${summary.by_priority.high}, medium ${summary.by_priority.medium}, low ${summary.by_priority.low})
  needs_review  ${summary.needs_review}
  API calls     ${summary.api_calls}  (${summary.retried} retried)
  tokens        ${summary.input_tokens} in / ${summary.output_tokens} out
  est. cost     $${summary.estimated_cost_usd.toFixed(4)}

Review sheet:  ${args.out}/review.csv   <- nothing has been sent; a human decides each row
Clay import:   ${args.out}/clay-import.csv`);
