import { redirect } from "next/navigation";

/** Old links to an invoice open it in the billing screen's drawer. */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/billing?invoice=${encodeURIComponent(id)}`);
}
