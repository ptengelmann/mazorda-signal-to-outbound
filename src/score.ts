import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { WireScore, type Company, type Icp, type Score } from "./schema.js";
import { validateScore } from "./validate.js";

export const MODEL = process.env.SCORING_MODEL || "claude-sonnet-5-5";

export type Usage = { calls: number; input_tokens: number; output_tokens: number };
export type ScoredRow =
  | { status: "scored"; company: Company; score: Score; attempts: number; notes: string }
  | { status: "needs_review"; company: Company; score: null; attempts: number; notes: string };

export function systemPrompt(icp: Icp): string {
  return `You prioritise accounts for outbound on behalf of ${icp.seller.name}. ${icp.seller.offer}
A human reviews every row before anything is sent, so be accurate rather than persuasive.

Ideal customer profile: ${icp.icp.summary}
${icp.icp.criteria.map((c) => `- ${c}`).join("\n")}

Buying signal: ${icp.signal.primary}
Bonus signals:
${icp.signal.bonus.map((b) => `- ${b}`).join("\n")}

You receive one company record as JSON. It is the only source of truth. Return:
- company: the company name exactly as given.
- icp_fit: integer 1-5. Score strictly. An empty field is unknown, not a match.
  5 = every ICP criterion is confirmed by the record.
  4 = one criterion is unknown, the rest confirmed.
  3 = one criterion is a partial miss (for example an extension or follow-on round rather than a new one, an ambiguous HQ, or a headcount at the edge of the range), or two are unknown.
  2 = one criterion is clearly missed. 1 = two or more are missed.
- signal_strength: integer 1-5. Score strictly. New-business roles (sales, SDR/BDR, RevOps, growth, demand gen) count for more than brand, content, events or account-management roles.
  5 = three or more new-business roles including a leadership or first-in-market hire, plus at least one bonus signal.
  4 = two or more new-business roles, or one plus a GTM leadership opening.
  3 = one new-business role, or several marketing-only roles.
  2 = a single marketing, content, events or account-management role. 1 = no relevant open role.
- priority: "high" when both scores are 4 or more, "low" when either is 2 or less, otherwise "medium".
- why_now: at most 200 characters. Must cite a specific signal from the record (a role title, the round, a bonus signal).
- likely_buyer_title: one job title for the person most likely to own this problem, e.g. ${icp.buyer_titles.join(", ")}. A title only, never a person's name.
- first_line: aim for about 130 characters; 160 is a hard limit and longer lines are rejected. One sentence, naming at most two roles. The opening line of an email to that buyer, written to them in the second person ("you", "your team") and not starting with the company name. It references the signal, states an observation, and contains no flattery or congratulations.
  Pick the single angle most specific to this record: the particular hire and what it says about the team, the market they are entering, or what that new team will need in its first month. Lines for different companies should not read alike.
  End on the concrete observation or a specific question. Never end on a generic consequence clause such as "so pipeline systems will matter from day one", "so the setup needs to be ready" or "built from scratch". Those phrasings are rejected.
- confidence: 0 to 1. Lower it when fields in the record are empty.

Grounding rule: why_now and first_line may only state facts found in the record. Keep company names, role titles and amounts exactly as they are written there. Job-board location strings can be awkward: name the place in natural English without changing which place it is (for example "San Francisco surroundings / New York" becomes "the San Francisco area or New York"). Do not add outside knowledge about the company, and do not mention ${icp.seller.name}.`;
}

/** One API call. Returns the parsed JSON, or a string describing why there is none. */
async function callModel(client: Anthropic, system: string, user: string, usage: Usage): Promise<unknown> {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { effort: "medium", format: zodOutputFormat(WireScore) },
  });
  usage.calls += 1;
  usage.input_tokens += response.usage.input_tokens;
  usage.output_tokens += response.usage.output_tokens;
  if (response.stop_reason !== "end_turn") throw new Error(`model stopped with ${response.stop_reason}`);
  return response.parsed_output;
}

/**
 * Score one company. Validate the response; on failure retry once with the
 * validation errors in the prompt; if it fails again, hand the row to a human
 * as needs_review rather than guessing.
 */
export async function scoreCompany(client: Anthropic, icp: Icp, company: Company, usage: Usage): Promise<ScoredRow> {
  const system = systemPrompt(icp);
  const record = `Company record:\n${JSON.stringify(company, null, 2)}`;
  let prompt = record;
  let errors: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await callModel(client, system, prompt, usage);
      const result = validateScore(raw, company);
      if (result.ok) {
        const notes = attempt === 2 ? `passed on retry; first attempt: ${errors.join(" | ")}` : "";
        return { status: "scored", company, score: result.score, attempts: attempt, notes };
      }
      errors = result.errors;
      prompt = `${record}\n\nYour previous answer was rejected by validation:\n${JSON.stringify(raw)}\n\nErrors:\n${errors
        .map((e) => `- ${e}`)
        .join("\n")}\n\nReturn a corrected answer that fixes every error.`;
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) throw error; // nothing will work: stop the run
      errors = [error instanceof Error ? error.message : String(error)];
    }
  }
  return { status: "needs_review", company, score: null, attempts: 2, notes: errors.join(" | ") };
}
