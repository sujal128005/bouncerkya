/**
 * Deterministic prompt-injection marker scan.
 *
 * Pattern matching only — no model, no network. This is the cheap first pass;
 * it catches the loud, well-known shapes of injected instructions and says
 * nothing at all about subtle, conversational manipulation. A false here is
 * not evidence of safety, which is exactly why its result is passed to the
 * Intent-Cart Engine as one labelled signal rather than as a verdict.
 */

export type InjectionMarker = {
  id: string;
  description: string;
  pattern: RegExp;
};

export const INJECTION_MARKERS: InjectionMarker[] = [
  {
    id: "role_header",
    description: "A system/assistant role header embedded in listing copy",
    pattern:
      /(^|[^a-z])(system|assistant|developer)\s*(notice|message|prompt)?\s*[:\]]/i,
  },
  {
    id: "instruction_override",
    description: "Instructs the reader to ignore or discard earlier rules",
    pattern:
      /\b(ignore|disregard|forget|override|bypass)\b[^.!?\n]{0,40}\b(previous|prior|earlier|above|all|any|existing)\b[^.!?\n]{0,40}\b(instruction|constraint|rule|direction|limit|restriction|guideline|polic)/i,
  },
  {
    id: "new_instructions",
    description: "Announces replacement instructions",
    pattern: /\b(new|updated|revised|additional)\s+(instructions?|directives?|rules?)\b/i,
  },
  {
    id: "persona_reassignment",
    description: "Attempts to reassign the agent's role",
    pattern: /\b(you\s+are\s+now|act\s+as|pretend\s+to\s+be|from\s+now\s+on,?\s+you)\b/i,
  },
  {
    id: "confirmation_suppression",
    description: "Tells the agent not to seek human confirmation",
    pattern:
      /\b(without|skip|no\s+need\s+for|do\s+not\s+(ask|request|seek|require))\b[^.!?\n]{0,40}\b(confirm|approval|authoris|authoriz|permission|verification)/i,
  },
  {
    id: "authority_claim",
    description: "Claims a raised budget or pre-approval inside untrusted text",
    // Either order: "raised your budget" and "the budget has been raised".
    pattern:
      /(?:\b(?:pre-?approved|authoris(?:ed|es)|authoriz(?:ed|es)|raised|increased|lifted|waived|removed)\b[^.!?\n]{0,40}\b(?:budget|limit|cap|spend(?:ing)?|allowance)\b|\b(?:budget|limit|cap|spending\s+limit|allowance)\b[^.!?\n]{0,40}\b(?:pre-?approved|authoris(?:ed|es)|authoriz(?:ed|es)|raised|increased|lifted|waived|removed)\b)/i,
  },
  {
    id: "prompt_delimiter",
    description: "Chat-template or prompt delimiters in product copy",
    pattern: /(<\|im_(start|end)\|>|\[\/?INST\]|<\/?(system|assistant|human)>|###\s*(system|instruction))/i,
  },
  {
    id: "ai_addressed",
    description: "Copy addressed to an AI agent rather than a shopper",
    pattern:
      /\b(as\s+an\s+ai|to\s+the\s+(ai|agent|assistant)|if\s+you\s+are\s+an\s+(ai|agent|assistant)|dear\s+(ai|agent|assistant))\b/i,
  },
];

export type InjectionScan = {
  detected: boolean;
  /** Ids of every marker that fired, for the audit record and the console. */
  markerIds: string[];
};

export function scanForInjectionMarkers(freeText: string | null): InjectionScan {
  if (!freeText) return { detected: false, markerIds: [] };

  const markerIds = INJECTION_MARKERS.filter((marker) =>
    marker.pattern.test(freeText),
  ).map((marker) => marker.id);

  return { detected: markerIds.length > 0, markerIds };
}

/** The boolean form the PurchaseRequest record stores. */
export function detectInjectionMarkers(freeText: string): boolean {
  return scanForInjectionMarkers(freeText).detected;
}
