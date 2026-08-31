import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { open } from "@/lib/privacy/at-rest";
import { isRevealableField, type RevealableField } from "@/lib/privacy/redact";

/**
 * Reveals one redacted field for one request.
 *
 * The console renders credential material truncated, and the full value is not
 * in the page at all. This is where a reviewer who genuinely needs it — to
 * match a signature against a log line while auditing a disputed decision —
 * asks for it explicitly.
 *
 * WHAT THIS IS AND IS NOT
 *
 * It is an allow-listed read of four named fields, keyed by purchase request
 * id. It is not a generic "read column X of row Y" endpoint, because that is a
 * database read primitive in a costume: the field name is checked against a
 * fixed list before it is used, so a crafted request cannot walk out of it.
 *
 * It is NOT access control. This deployment has no authentication of any kind,
 * so anyone who can reach the console can also call this. What redaction buys
 * here is that the values are absent from the HTML, the React payload, the
 * view-source, every screenshot and every scrape — which is most of how such
 * values actually escape — and that revealing one is a deliberate act rather
 * than a side effect of loading a page. A real deployment would put authz in
 * front of this route; /privacy says so rather than implying the redaction is
 * doing more than it is.
 */

export const dynamic = "force-dynamic";

type Body = { requestId?: unknown; field?: unknown };

export async function POST(request: Request): Promise<NextResponse> {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json(
      { error: "bad_request", detail: "Body must be JSON." },
      { status: 400 },
    );
  }

  const { requestId, field } = body;
  if (typeof requestId !== "string" || requestId.length === 0) {
    return NextResponse.json(
      { error: "bad_request", detail: "requestId must be a non-empty string." },
      { status: 400 },
    );
  }
  if (!isRevealableField(field)) {
    return NextResponse.json(
      {
        error: "bad_request",
        // Naming the allow-list is not a disclosure: it is on the /privacy
        // page and in the source. Silently refusing would just make a
        // legitimate integration harder to debug.
        detail: "field must be one of signature, nonce, keyRef, merchantId.",
      },
      { status: 400 },
    );
  }

  const row = await prisma.purchaseRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      sessionStructuredFields: true,
      mandate: { select: { nonce: true, signature: true } },
      agent: { select: { publicKeyRef: true } },
    },
  });

  if (!row) {
    return NextResponse.json(
      { error: "not_found", detail: "No such request." },
      { status: 404 },
    );
  }

  const value = await resolve(field, row);
  if (value === null) {
    return NextResponse.json(
      { error: "not_available", detail: "That field is not set on this request." },
      { status: 404 },
    );
  }

  return NextResponse.json({ field, value });
}

type Row = {
  id: string;
  sessionStructuredFields: string;
  mandate: { nonce: string; signature: string };
  agent: { publicKeyRef: string };
};

async function resolve(field: RevealableField, row: Row): Promise<string | null> {
  switch (field) {
    case "signature":
      return row.mandate.signature;
    case "nonce":
      return row.mandate.nonce;
    case "keyRef":
      return row.agent.publicKeyRef;
    case "merchantId": {
      // This column is sealed at rest, so it has to be opened before it can be
      // handed back. The AAD binds it to this row, so a ciphertext that had
      // been moved here from another request would fail rather than resolve.
      const json = open(
        "PurchaseRequest",
        "sessionStructuredFields",
        row.id,
        row.sessionStructuredFields,
      );
      if (json === null) return null;
      const parsed: unknown = JSON.parse(json);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      const merchantId = (parsed as Record<string, unknown>).merchantId;
      return typeof merchantId === "string" ? merchantId : null;
    }
  }
}
