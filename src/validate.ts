import { z } from "zod";
import { Score, type Company } from "./schema.js";

// GTM vocabulary that is fine to use without appearing in the company record.
const GENERIC = new Set(["gtm", "revops", "sdr", "sdrs", "bdr", "bdrs", "crm", "b2b", "saas", "ae", "aes", "ops", "icp"]);
const FLATTERY = /\b(congrat\w*|impressive|amazing|awesome|incredible|love|loved|excited|exciting|kudos|great|fantastic)\b/i;
// Stock closers that make every opening line read the same. The line should end on the specific observation.
const STOCK_CLOSER =
  /\b(from day one|from scratch|will matter|matters? (early|now)|keeping pace|(need|needs|needed|have|has) to be (ready|working|in place|set up)|(pipeline|gtm) (systems?|setup|set-up|tooling|processes|infrastructure))\b/i;
const MONTHS =["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
const wordsOf = (s: string) => fold(s).match(/[a-z]+/g) ?? [];
const numbersOf = (s: string) => s.match(/\d+/g) ?? [];

/** Every word and number in the company record: the facts a claim may draw on. */
export function sourceFacts(company: Company) {
  const text = JSON.stringify(company);
  const words = new Set(wordsOf(text));
  const numbers = new Set(numbersOf(text));
  // A date like 2026-09 also licenses "September" / "Sept".
  const month = Number(company.last_round.date.split("-")[1]);
  if (month >= 1 && month <= 12) {
    const name = MONTHS[month - 1]!;
    [name, name.slice(0, 3), name.slice(0, 4)].forEach((m) => words.add(m));
  }
  return { words, numbers };
}

function isGrounded(word: string, words: Set<string>): boolean {
  if (word.length < 2 || GENERIC.has(word) || words.has(word)) return true;
  // Tolerate simple inflections: German/Germany, HubSpot/HubSpots.
  if (word.length < 4) return false;
  for (const w of words) if (w.length >= 4 && (w.startsWith(word) || word.startsWith(w))) return true;
  return false;
}

/**
 * Simple grounding check. "Key nouns" are numbers and capitalised words that
 * are not the first word of a sentence (i.e. proper nouns). Each must appear
 * in the company record. Returns the terms that do not.
 */
export function ungroundedTerms(text: string, facts: ReturnType<typeof sourceFacts>): string[] {
  const missing = new Set<string>();
  for (const sentence of text.split(/(?<=[.!?:;])\s+/)) {
    const tokens = sentence.match(/[\p{L}\p{N}][\p{L}\p{N}'’.,/&-]*/gu) ?? [];
    tokens.forEach((token, i) => {
      if (numbersOf(token).some((n) => !facts.numbers.has(n))) missing.add(token);
      const isProperNoun = i > 0 && /^\p{Lu}/u.test(token);
      if (isProperNoun && wordsOf(token).some((w) => !isGrounded(w, facts.words))) missing.add(token);
    });
  }
  return [...missing];
}

export type Validation = { ok: true; score: Score } | { ok: false; errors: string[] };

/** Schema check (zod) first; if the shape is valid, grounding and tone checks, reported together. */
export function validateScore(raw: unknown, company: Company): Validation {
  const parsed = Score.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: [z.prettifyError(parsed.error)] };

  const score = parsed.data;
  const errors: string[] = [];
  const facts = sourceFacts(company);

  if (fold(score.company) !== fold(company.company)) {
    errors.push(`company must be exactly "${company.company}", got "${score.company}"`);
  }
  for (const field of ["why_now", "first_line"] as const) {
    const missing = ungroundedTerms(score[field], facts);
    if (missing.length) errors.push(`${field} mentions facts not in the company record: ${missing.join(", ")}`);
  }
  const flattery = score.first_line.match(FLATTERY);
  if (flattery) errors.push(`first_line contains flattery ("${flattery[0]}")`);
  const closer = score.first_line.match(STOCK_CLOSER);
  if (closer) errors.push(`first_line uses a stock phrase ("${closer[0]}"); end on the specific observation, not a generic consequence`);

  return errors.length ? { ok: false, errors } : { ok: true, score };
}
