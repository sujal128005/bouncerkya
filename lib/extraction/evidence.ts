import { z } from "zod";

import type { Mandate, PurchaseRequest } from "@/schemas";

import { scanForInjectionMarkers } from "./injection";
import { normalizeCategories, normalizeCategory } from "./taxonomy";

/**
 * ExtractedEvidence is what the Intent-Cart Engine reasons over: the mandate
 * and the cart reduced to comparable, normalised fields, plus the untrusted
 * free text kept byte-for-byte intact (it gets delimiter-wrapped later, never
 * edited — rewriting evidence to make it safer would destroy the thing we are
 * asking the model to judge).
 *
 * Everything here is deterministic. No model is involved in producing it.
 *
 * The Zod schema lives beside the extractor rather than in /schemas because
 * this is an internal pipeline artifact, not a domain entity that crosses the
 * API or the database.
 */

const NormalizedCategorySchema = z.object({
  raw: z.string(),
  path: z.string().nullable(),
  recognized: z.boolean(),
});

export const ExtractedEvidence = z.object({
  purchaseRequestId: z.string().min(1),
  mandateId: z.string().min(1),

  mandateScope: z.object({
    categories: z.array(NormalizedCategorySchema),
    spendCapMinor: z.number().int().nonnegative(),
    currency: z.literal("INR"),
  }),

  cart: z.object({
    lines: z.array(
      z.object({
        name: z.string(),
        category: NormalizedCategorySchema,
        quantity: z.number().int().positive(),
        unitPriceMinor: z.number().int().nonnegative(),
        lineTotalMinor: z.number().int().nonnegative(),
        sourceListingId: z.string(),
      }),
    ),
    totalMinor: z.number().int().nonnegative(),
  }),

  budget: z.object({
    capMinor: z.number().int().nonnegative(),
    totalMinor: z.number().int().nonnegative(),
    overageMinor: z.number().int(),
    utilisationPercent: z.number().int().nonnegative(),
    overCap: z.boolean(),
  }),

  /** Untrusted merchant/listing copy, unmodified. */
  untrustedFreeText: z.string().nullable(),
  injectionMarkerDetected: z.boolean(),
  injectionMarkerIds: z.array(z.string()),

  /** Raw category strings that are not in the taxonomy, from either side. */
  unrecognizedCategories: z.array(z.string()),
});

export type ExtractedEvidence = z.infer<typeof ExtractedEvidence>;

export function extractEvidence({
  mandate,
  request,
}: {
  mandate: Mandate;
  request: PurchaseRequest;
}): ExtractedEvidence {
  const mandateCategories = normalizeCategories(mandate.categoryScope);

  const lines = request.items.map((item) => ({
    name: item.name,
    category: normalizeCategory(item.category),
    quantity: item.quantity,
    unitPriceMinor: item.unitPriceMinor,
    lineTotalMinor: item.unitPriceMinor * item.quantity,
    sourceListingId: item.sourceListingId,
  }));

  const scan = scanForInjectionMarkers(request.sessionContext.freeText);

  const unrecognizedCategories = [
    ...mandateCategories,
    ...lines.map((line) => line.category),
  ]
    .filter((category) => !category.recognized)
    .map((category) => category.raw);

  const capMinor = mandate.spendCapMinor;
  const totalMinor = request.totalMinor;

  return ExtractedEvidence.parse({
    purchaseRequestId: request.id,
    mandateId: mandate.id,
    mandateScope: {
      categories: mandateCategories,
      spendCapMinor: capMinor,
      currency: mandate.currency,
    },
    cart: { lines, totalMinor },
    budget: {
      capMinor,
      totalMinor,
      overageMinor: totalMinor - capMinor,
      utilisationPercent:
        capMinor === 0 ? 0 : Math.round((totalMinor / capMinor) * 100),
      overCap: totalMinor > capMinor,
    },
    untrustedFreeText: request.sessionContext.freeText,
    injectionMarkerDetected: scan.detected,
    injectionMarkerIds: scan.markerIds,
    unrecognizedCategories: [...new Set(unrecognizedCategories)],
  });
}
