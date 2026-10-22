import { redirect } from "next/navigation";

/** The audit log lives at /audit (not /admin, which the edge proxy sends to Django admin); old links land here. */
export default function OldAuditPage() {
  redirect("/audit");
}
