import { z } from "zod";
import { Id } from "./primitives";

/** The human who granted an agent its spending authority. */
export const Principal = z.object({
  id: Id,
  displayName: z.string().min(1),
});

/** The AI agent presenting a mandate at checkout. */
export const Agent = z.object({
  id: Id,
  operatorName: z.string().min(1),
  platform: z.string().min(1),
  /** Key reference only. STEALTH never stores private key material. */
  publicKeyRef: z.string().min(1),
});

export type Principal = z.infer<typeof Principal>;
export type Agent = z.infer<typeof Agent>;
