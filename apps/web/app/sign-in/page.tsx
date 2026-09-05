import { redirect } from "next/navigation";
import { SignInForm } from "./sign-in-form";
import { getOptionalUser } from "@/lib/dal";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  if (await getOptionalUser()) redirect("/");
  return (
    <main className="auth-shell">
      <section className="auth-story">
        <div className="brand-mark">R</div>
        <p className="eyebrow">Revenue Recovery</p>
        <h1>Turn the calls you miss into jobs you can measure.</h1>
        <p>Catch after-hours HVAC demand, book qualified work, and see exactly what the system recovered.</p>
        <div className="signal-card"><span>Coverage status</span><strong><i /> Ready for the next call</strong></div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <p className="eyebrow">Contractor portal</p>
          <h2>Welcome back</h2>
          <p className="muted">Sign in to your owner dashboard or create your first workspace.</p>
          <SignInForm />
          <p className="fine-print">Protected by Neon Auth. Your tenant is resolved on the server.</p>
        </div>
      </section>
    </main>
  );
}
