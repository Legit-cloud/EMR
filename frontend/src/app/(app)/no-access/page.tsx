import { NoAccess } from "@/components/auth/no-access";

/** Where the app sends people who open a screen their role cannot use. */
export default function NoAccessPage() {
  return <NoAccess asPage />;
}
