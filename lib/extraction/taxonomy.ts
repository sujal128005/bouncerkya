/**
 * A small, deliberately closed category taxonomy.
 *
 * This is not a general classification system and is not meant to grow into
 * one. Its only job is to give the reasoning step a fixed vocabulary: both the
 * mandate scope and the cart lines are normalised against this list before the
 * model sees them, and anything outside it is flagged as unrecognised rather
 * than quietly passed through. Fewer free-form strings in the prompt means
 * fewer opportunities for the model to invent a category relationship.
 */

export const CATEGORY_TAXONOMY = [
  "footwear/running-shoes",
  "footwear/casual",
  "footwear/formal",
  "apparel/activewear",
  "apparel/outerwear",
  "home/kitchen-equipment",
  "home/commercial-kitchen",
  "home/cleaning-supplies",
  "home/furniture",
  "electronics/audio",
  "electronics/computing",
  "electronics/mobile",
  "electronics/accessories",
  "gift-cards/prepaid",
  "gift-cards/retail",
  "groceries/staples",
  "groceries/fresh",
  "personal-care/skincare",
  "books/print",
] as const;

export type CategoryPath = (typeof CATEGORY_TAXONOMY)[number];

const TAXONOMY_LOOKUP = new Map<string, CategoryPath>(
  CATEGORY_TAXONOMY.map((path) => [path, path]),
);

export type NormalizedCategory = {
  /** Exactly what the mandate or the cart line said. */
  raw: string;
  /** The taxonomy path, or null when the raw value is not in the taxonomy. */
  path: CategoryPath | null;
  recognized: boolean;
};

/** Lower-cases, trims, and collapses separator noise. No fuzzy matching. */
function canonicalise(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "");
}

export function normalizeCategory(raw: string): NormalizedCategory {
  const path = TAXONOMY_LOOKUP.get(canonicalise(raw)) ?? null;
  return { raw, path, recognized: path !== null };
}

export function normalizeCategories(raws: string[]): NormalizedCategory[] {
  return raws.map(normalizeCategory);
}
