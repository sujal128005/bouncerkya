import { redirect } from "next/navigation";

/**
 * `/console` moved.
 *
 * The single console page became `/requests` (the list) and `/requests/[id]`
 * (one decision, walked through the pipeline). This redirect stays because
 * `/console?request=req_A7F31C` is the URL shape that appears in the README,
 * in DEMO.md, and in any link already shared — breaking those to save a file
 * is a bad trade.
 */

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ConsoleRedirect({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { request } = await searchParams;
  const key = typeof request === "string" ? request : null;
  redirect(key ? `/requests/${key}` : "/requests");
}
