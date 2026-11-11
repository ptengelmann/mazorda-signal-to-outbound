import { z } from "zod";

/** One enriched company: the only facts the scorer is allowed to use. */
export const Company = z.object({
  company: z.string().min(1),
  website: z.string(),
  hq_country: z.string(),
  hq_city: z.string().default(""),
  employee_range: z.string(),
  description: z.string(),
  last_round: z.object({
    stage: z.string(),
    amount: z.string(),
    date: z.string(),
    lead_investors: z.string().default(""),
  }),
  open_gtm_roles: z.array(z.object({ title: z.string(), url: z.string() })),
  crm: z.string(),
  crm_evidence: z.string().default(""),
  bonus_signals: z.array(z.string()),
  sources: z.array(z.string()),
});
export type Company = z.infer<typeof Company>;

/**
 * Shape sent to the API as the structured-output schema. The API guarantees
 * the response matches this shape, but JSON-schema structured output cannot
 * express ranges or string lengths, so those live in `Score` below.
 */
export const WireScore = z.object({
  company: z.string(),
  icp_fit: z.number(),
  signal_strength: z.number(),
  priority: z.enum(["high", "medium", "low"]),
  why_now: z.string(),
  likely_buyer_title: z.string(),
  first_line: z.string(),
  confidence: z.number(),
});

/** The strict contract every row must pass before it reaches the review sheet. */
export const Score = WireScore.extend({
  icp_fit: z.number().int().min(1).max(5),
  signal_strength: z.number().int().min(1).max(5),
  why_now: z.string().min(1).max(200),
  likely_buyer_title: z.string().min(1).max(80),
  first_line: z.string().min(1).max(160),
  confidence: z.number().min(0).max(1),
});
export type Score = z.infer<typeof Score>;

export const Icp = z.object({
  seller: z.object({ name: z.string(), offer: z.string() }),
  icp: z.object({ summary: z.string(), criteria: z.array(z.string()) }),
  signal: z.object({ primary: z.string(), bonus: z.array(z.string()) }),
  buyer_titles: z.array(z.string()),
});
export type Icp = z.infer<typeof Icp>;
