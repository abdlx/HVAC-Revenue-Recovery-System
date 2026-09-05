import { PostgresDashboardRepository } from "@hvac/db";
import { redirect } from "next/navigation";
import { OrganizationForm } from "./organization-form";
import { requireUser } from "@/lib/dal";
import { getDatabase } from "@/lib/database";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireUser();
  const membership = await new PostgresDashboardRepository(getDatabase().db).findTenantForUser(user.id);
  if (membership) redirect("/dashboard");
  return (
    <main className="onboarding-shell">
      <header className="onboarding-header"><div className="brand-mark small">R</div><span>Revenue Recovery</span><span className="step-count">Step 1 of 9</span></header>
      <section className="onboarding-card">
        <div className="progress-track"><span /></div>
        <p className="eyebrow">Organization</p><h1>Let’s set up your HVAC business.</h1>
        <p className="muted">This creates your secure workspace and owner membership. Phone, voice, services, and Jobber setup follow next.</p>
        <OrganizationForm />
      </section>
    </main>
  );
}
