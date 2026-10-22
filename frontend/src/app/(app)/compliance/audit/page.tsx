import { redirect } from "next/navigation";

/** The audit log moved to /admin/audit; old links land there. */
export default function OldAuditPage() {
  redirect("/admin/audit");
}
