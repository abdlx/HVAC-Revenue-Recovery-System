import "server-only";
import { PostgresDashboardRepository } from "@hvac/db";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getAuth } from "@/lib/auth/server";
import { getDatabase } from "@/lib/database";

export const requireUser = cache(async () => {
  const { data: session } = await getAuth().getSession();
  if (!session?.user) redirect("/sign-in");
  return session.user;
});

export const getOptionalUser = cache(async () => {
  const { data: session } = await getAuth().getSession();
  return session?.user ?? null;
});

export const requireDashboard = cache(async () => {
  const user = await requireUser();
  const dashboard = await new PostgresDashboardRepository(getDatabase().db).loadForUser(user.id);
  if (!dashboard) redirect("/onboarding");
  return { user, dashboard };
});
