import { redirect } from "next/navigation";

/**
 * `/inbox` moved to `/approvals`.
 *
 * "Inbox" describes a mailbox; this page is a queue of checkouts waiting on a
 * human decision, and the name should say so. The old path is kept because it
 * appears in DEMO.md and in links already shared.
 */
export default function InboxRedirect() {
  redirect("/approvals");
}
