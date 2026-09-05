import { SignOutButton } from "./sign-out-button";
import { requireDashboard } from "@/lib/dal";

export const dynamic = "force-dynamic";

function money(value: number | null) {
  if (value === null) return "Not available";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}
function duration(seconds: number | null) {
  if (seconds === null) return "—";
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default async function DashboardPage() {
  const { user, dashboard } = await requireDashboard();
  const metrics = [
    ["Calls caught", dashboard.metrics.callsCaught, "Missed + after-hours"],
    ["Qualified leads", dashboard.metrics.qualifiedLeads, "Last 30 days"],
    ["AI bookings", dashboard.metrics.confirmedBookings, "Confirmed"],
    ["Follow-up wins", dashboard.metrics.followUpRecoveredBookings, "Recovered"],
    ["Estimated booked value", money(dashboard.metrics.estimatedBookedValue), "Estimate, not collected"],
    ["Realized recovered revenue", money(dashboard.metrics.realizedRecoveredRevenue), "Awaiting CRM reconciliation"],
  ] as const;

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark small">R</div><span>Revenue<br />Recovery</span></div>
        <nav>{["Overview", "Calls", "Leads", "Bookings", "Revenue"].map((item, index) => (
          <a className={index === 0 ? "active" : ""} href={index === 0 ? "/dashboard" : `#${item.toLowerCase()}`} key={item}><span>{index === 0 ? "◉" : "○"}</span>{item}</a>
        ))}</nav>
        <div className="sidebar-bottom"><a href="#configuration">Configuration</a><a href="#integrations">Integrations</a><a href="#team">Team</a><SignOutButton /></div>
      </aside>
      <section className="dashboard-main">
        <header className="dashboard-header">
          <div><p className="eyebrow">Owner dashboard · 30 days</p><h1>{dashboard.organization.name}</h1></div>
          <div className="account-chip"><span>{(user.name || user.email).slice(0, 1).toUpperCase()}</span><div><strong>{user.name || "Account owner"}</strong><small>{dashboard.role}</small></div></div>
        </header>
        <section className="coverage-banner"><div><i /><strong>Recovery coverage is being configured</strong></div><p>Finish phone routing, Jobber, and voice setup before activating live traffic.</p><button type="button">Continue setup →</button></section>
        <section className="metric-grid">{metrics.map(([label, value, note]) => (
          <article className="metric-card" key={label}><p>{label}</p><strong>{value}</strong><span>{note}</span></article>
        ))}</section>
        <div className="dashboard-grid">
          <section className="data-card recent-card">
            <div className="section-title"><div><p className="eyebrow">Activity</p><h2>Recent calls</h2></div><span>Caller numbers masked</span></div>
            {dashboard.recentCalls.length ? <div className="table-wrap"><table>
              <thead><tr><th>Time</th><th>Caller</th><th>Source</th><th>Reason</th><th>Outcome</th><th>Duration</th></tr></thead>
              <tbody>{dashboard.recentCalls.map((call) => <tr key={call.id}>
                <td>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: dashboard.organization.timezone }).format(call.startedAt)}</td>
                <td>{call.caller}</td><td>{call.source?.replaceAll("_", " ") ?? "Direct"}</td><td>{call.reason ?? "—"}</td>
                <td><span className="status-pill">{call.outcome.replaceAll("_", " ")}</span></td><td>{duration(call.durationSeconds)}</td>
              </tr>)}</tbody>
            </table></div> : <div className="empty-state"><strong>No calls yet</strong><p>Calls will appear here after your recovery number is connected.</p></div>}
          </section>
          {dashboard.reliability ? <section className="data-card reliability-card">
            <div className="section-title"><div><p className="eyebrow">Owner only</p><h2>Reliability</h2></div></div>
            <dl>
              <div><dt>Jobber</dt><dd className={dashboard.reliability.crmStatus === "ACTIVE" ? "ok" : ""}>{dashboard.reliability.crmStatus ?? "Not connected"}</dd></div>
              <div><dt>Voice agent</dt><dd className={dashboard.reliability.voiceStatus === "ACTIVE" ? "ok" : ""}>{dashboard.reliability.voiceStatus ?? "Not provisioned"}</dd></div>
              <div><dt>Phone route</dt><dd className={dashboard.reliability.phoneStatus === "ACTIVE" ? "ok" : ""}>{dashboard.reliability.phoneStatus ?? "Not configured"}</dd></div>
              <div><dt>Failed bookings</dt><dd className={dashboard.reliability.failedBookings === 0 ? "ok" : "warn"}>{dashboard.reliability.failedBookings}</dd></div>
            </dl>
          </section> : null}
        </div>
      </section>
    </main>
  );
}
