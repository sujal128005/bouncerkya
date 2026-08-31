import { z } from "zod";

/**
 * Shared primitives. Every entity schema builds on these so that the rules
 * about identifiers, money and time are stated exactly once.
 */

/** Opaque identifier. Bouncer never generates IDs from user input. */
export const Id = z.string().min(1, "id must not be empty");

/**
 * Money is ALWAYS an integer in minor units (paise for INR).
 * Floats are never used for money anywhere in Bouncer.
 */
export const MinorUnits = z
  .number()
  .int("amounts must be integers in minor units (paise)")
  .nonnegative("amounts must not be negative");

/** Bouncer is INR-only for this build. */
export const Currency = z.literal("INR");

/**
 * Accepts an ISO-8601 string or a Date and always yields a Date.
 * Prisma hands back Date objects; JSON payloads carry ISO strings.
 */
export const Timestamp = z.coerce.date();

/** Confidence is a probability, not a percentage. */
export const Confidence = z.number().min(0).max(1);

export type Id = z.infer<typeof Id>;
export type MinorUnits = z.infer<typeof MinorUnits>;
export type Currency = z.infer<typeof Currency>;
