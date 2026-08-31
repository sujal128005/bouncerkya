/**
 * Bouncer domain schemas.
 *
 * Grouped by bounded concept rather than one file per entity: a DiffClause is
 * meaningless without its AuthorizationDiff, and a CartItem without its
 * PurchaseRequest, so those live together. Everything is re-exported here so
 * callers can `import { Mandate } from "@/schemas"`.
 */
export * from "./primitives";
export * from "./identity";
export * from "./mandate";
export * from "./purchase";
export * from "./diff";
export * from "./decision";
