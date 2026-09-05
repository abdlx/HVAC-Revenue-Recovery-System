import { PostgresDashboardRepository } from "@hvac/db";
import { redirect } from "next/navigation";
import { getOptionalUser } from "@/lib/dal";
import { getDatabase } from "@/lib/database";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getOptionalUser();
  if (!user) redirect("/sign-in");
  const tenant = await new PostgresDashboardRepository(getDatabase().db).findTenantForUser(user.id);
  redirect(tenant ? "/dashboard" : "/onboarding");
}
