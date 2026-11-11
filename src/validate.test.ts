import assert from "node:assert/strict";
import { test } from "node:test";
import type { Company } from "./schema.js";
import { validateScore } from "./validate.js";

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

const good = {
  company: "Acme Analytics",
  icp_fit: 5,
  signal_strength: 4,
  priority: "high",
  why_now: "Raised a €20M Series A in September and is hiring a Revenue Operations Manager.",
  likely_buyer_title: "VP Sales",
  first_line: "Saw the Revenue Operations Manager opening: is pipeline reporting in HubSpot ready for the new hire?",
  confidence: 0.8,
};

const errorsOf = (raw: unknown) => {
  const result = validateScore(raw, company);
  return result.ok ? [] : result.errors;
};

test("accepts a grounded, in-range score", () => {
  assert.deepEqual(errorsOf(good), []);
});

test("rejects out-of-range scores and over-long lines (zod)", () => {
  assert.equal(errorsOf({ ...good, icp_fit: 7 }).length, 1);
  assert.equal(errorsOf({ ...good, first_line: "x".repeat(161) }).length, 1);
});

test("rejects facts that are not in the company record", () => {
  const [error] = errorsOf({ ...good, why_now: "Raised €35M from Sequoia and is opening a New York office." });
  assert.match(error!, /35M/);
  assert.match(error!, /Sequoia/);
  assert.match(error!, /York/);
});

test("rejects flattery in the first line", () => {
  assert.match(errorsOf({ ...good, first_line: "Congrats on the Series A, impressive growth." })[0]!, /flattery/);
});
