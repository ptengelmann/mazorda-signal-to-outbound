import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import type { Company, Icp } from "./schema.js";
import { scoreCompany, type Usage } from "./score.js";

// Offline tests for the retry and needs_review paths. No API calls: the client is a stub
// that replays canned model answers and records the prompts it was sent.

const icp: Icp = {
  seller: { name: "Seller", offer: "Builds GTM systems." },
  icp: { summary: "B2B SaaS, Series A-C.", criteria: ["B2B SaaS"] },
  signal: { primary: "Hiring GTM roles.", bonus: [] },
  buyer_titles: ["VP Sales"],
};

const company: Company = {
  company: "Acme Analytics",
  website: "https://acme.example",
  hq_country: "Germany",
  hq_city: "Berlin",
  employee_range: "51-200",
  description: "Revenue analytics for B2B SaaS finance teams",
  last_round: { stage: "Series A", amount: "€20M", date: "2026-09", lead_investors: "" },
  open_gtm_roles: [{ title: "Revenue Operations Manager", url: "https://acme.example/jobs/1" }],
  crm: "HubSpot",
  crm_evidence: "",
  bonus_signals: [],
  sources: ["https://news.example/acme-series-a"],
};

const valid = {
  company: "Acme Analytics",
  icp_fit: 5,
  signal_strength: 3,
  priority: "medium",
  why_now: "Raised a €20M Series A and is hiring a Revenue Operations Manager.",
  likely_buyer_title: "VP Sales",
  first_line: "You're hiring a Revenue Operations Manager: is reporting in HubSpot ready for them?",
  confidence: 0.8,
};

/** Fixture that deliberately fails validation: why_now cites an amount, an investor and a city that are not in the record. */
const invalid = {
  ...valid,
  why_now: "Raised €35M from Sequoia and is opening a New York office.",
};

function stubClient(answers: unknown[]) {
  const prompts: string[] = [];
  const client = {
    messages: {
      parse: async (params: { messages: { content: string }[] }) => {
        prompts.push(params.messages[0]!.content);
        return { parsed_output: answers[prompts.length - 1], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 } };
      },
    },
  } as unknown as Anthropic;
  return { client, prompts };
}

const newUsage = (): Usage => ({ calls: 0, input_tokens: 0, output_tokens: 0 });

test("a row that fails validation twice becomes needs_review with blank scores", async () => {
  const { client, prompts } = stubClient([invalid, invalid]);
  const usage = newUsage();
  const row = await scoreCompany(client, icp, company, usage);

  assert.equal(row.status, "needs_review");
  assert.equal(row.score, null);
  assert.equal(usage.calls, 2, "one attempt plus exactly one retry");
  assert.match(row.notes, /Sequoia/);
  assert.match(row.notes, /35M/);
  assert.match(prompts[1]!, /rejected by validation/, "the retry prompt carries the validation errors");
  assert.match(prompts[1]!, /Sequoia/);
});

test("a row that fails once and passes on retry is scored, with the first failure noted", async () => {
  const { client } = stubClient([invalid, valid]);
  const row = await scoreCompany(client, icp, company, newUsage());

  assert.equal(row.status, "scored");
  assert.equal(row.attempts, 2);
  assert.match(row.notes, /passed on retry/);
});

test("a valid first answer is scored in one call", async () => {
  const { client } = stubClient([valid]);
  const usage = newUsage();
  const row = await scoreCompany(client, icp, company, usage);

  assert.equal(row.status, "scored");
  assert.equal(usage.calls, 1);
});
