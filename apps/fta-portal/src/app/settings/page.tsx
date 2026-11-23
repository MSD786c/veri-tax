import Link from "next/link";
import { logoutAction } from "@/app/actions";
import Shell from "@/components/Shell";
import { Badge, Icon, PageHead } from "@/components/ui";
import { API_URL, apiGet, officerId } from "@/lib/api";
import { flat, type Params } from "@/lib/format";

export const metadata = { title: "Settings · Federal Tax Authority" };

export default async function Settings({ searchParams }: { searchParams: Promise<Params> }) {
  const f = flat(await searchParams);
  const officer = await officerId();
  const health = await apiGet<{ status: string; ruleset_version: string }>("/health").catch(() => null);
  return (
    <Shell route="settings" msg={f.msg}>
      <PageHead title="Settings" lead="Your session and the connection to the verification body." />
      <div className="report-grid">
        <section className="card"><header className="card-h"><h2>Session</h2></header>
          <dl className="kv"><div><dt>Officer</dt><dd>{officer}</dd></div><div><dt>Role</dt><dd>Verification Officer</dd></div></dl>
          <form action={logoutAction}><button className="btn ghost md" type="submit"><Icon n="logout" s={18} /><span>Sign out</span></button></form>
        </section>
        <section className="card"><header className="card-h"><h2>Verification body</h2></header>
          <dl className="kv"><div><dt>API</dt><dd className="mono">{API_URL}</dd></div><div><dt>Status</dt><dd>{health ? <Badge kind="approved">Online</Badge> : <Badge kind="rejected">Unreachable</Badge>}</dd></div><div><dt>Ruleset</dt><dd className="mono">{health?.ruleset_version ?? "—"}</dd></div></dl>
          <p className="muted small">Pages are rendered on the server from the live API. Interactions are links and forms.</p>
          <Link className="link" href="/dashboard">Back to dashboard</Link>
        </section>
      </div>
    </Shell>
  );
}
