import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { FileText, FileCheck2, Clock, AlertTriangle, ArrowRight } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [announcements, setAnnouncements] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const [s, r, a] = await Promise.all([
          api.get("/stats/overview"),
          api.get("/reports", { params: { } }),
          api.get("/announcements"),
        ]);
        setStats(s.data);
        setRecent(r.data.slice(0, 5));
        setAnnouncements(a.data.slice(0, 3));
      } catch {}
    })();
  }, []);

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  })();

  return (
    <div className="space-y-10">
      {/* Institute Letterhead — logo fixed on the left; header text centered
          across the full width so the logo never shifts/offsets the text. */}
      <div className="paper p-6 border-t-4 border-t-burgundy relative" data-testid="letterhead">
        <img
          src="/college-logo.png"
          alt="J.B.S.P. Sanstha"
          className="w-20 h-20 absolute left-6 top-6 flex-shrink-0"
        />
        <div className="text-center">
          <div className="italic text-sm text-muted-foreground">Janardan Bhagat Shikshan Prasarak Sanstha's</div>
          <h2 className="font-serif text-2xl md:text-3xl text-burgundy leading-tight mt-1">
            RAMSHETH THAKUR COLLEGE OF COMMERCE &amp; SCIENCE
          </h2>
          <div className="text-xs text-muted-foreground mt-2 leading-relaxed">
            Plot no-1, Sector-33, Kharghar, Navi Mumbai — 410210 ·
            Affiliated to University of Mumbai · NAAC 'A' Grade · ISO 9001:2015 &amp; 14001:2015
          </div>
        </div>
      </div>
      <div className="bg-burgundy text-ivory text-center py-2 -mt-6">
        <div className="font-serif text-lg tracking-wide">RTCCS Teachers Portal</div>
      </div>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="overline mb-1">{user.role.replace("_", " ")} dashboard</div>
          <h1 className="font-serif text-4xl sm:text-5xl text-foreground leading-tight">
            {greeting}, <span className="text-burgundy">{user.name}</span>.
          </h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
            Departmental Documentation — IQAC Sheet management at a glance.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Sheets" value={stats?.total ?? "—"} icon={FileText} testid="stat-total" />
        <StatCard label="Pending Review" value={stats?.pending ?? "—"} icon={Clock} testid="stat-pending" />
        <StatCard label="Approved" value={stats?.approved ?? "—"} icon={FileCheck2} testid="stat-approved" />
        <StatCard label="Rejected" value={stats?.rejected ?? "—"} icon={AlertTriangle} testid="stat-rejected" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 paper p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="overline">Recent</div>
              <h2 className="font-serif text-2xl text-foreground">Latest IQAC Sheets</h2>
            </div>
            <Link to="/reports" className="text-sm text-burgundy hover:underline inline-flex items-center gap-1">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          {recent.length === 0 ? (
            <EmptyState text="No IQAC sheets yet. Create your first sheet to get started." />
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((r) => (
                <li key={r.id} className="py-3" data-testid={`recent-report-${r.id}`}>
                  <Link to={`/reports/${r.id}`} className="flex items-center justify-between gap-4 group">
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate group-hover:text-burgundy transition-colors">
                        {r.title}
                      </div>
                      <div className="overline mt-1 text-[10px]">
                        {r.activity_type} · {r.date_of_activity || "Date TBD"}
                      </div>
                    </div>
                    <StatusBadge status={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="paper p-6">
          <div className="overline">Notice Board</div>
          <h2 className="font-serif text-2xl text-foreground mb-4">Announcements</h2>
          {announcements.length === 0 ? (
            <EmptyState text="No announcements." />
          ) : (
            <ul className="space-y-4">
              {announcements.map((a) => (
                <li key={a.id} className="side-rule">
                  <div className="overline text-[10px]">{a.priority}</div>
                  <div className="font-serif text-lg text-foreground leading-tight">{a.title}</div>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{a.body}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, testid }) {
  return (
    <div data-testid={testid} className="paper p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="overline">{label}</div>
        <Icon size={16} className="text-muted-foreground" strokeWidth={1.5} />
      </div>
      <div className="serif-numerals text-4xl text-burgundy leading-none">{value}</div>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="py-8 text-center text-sm text-muted-foreground italic">{text}</div>
  );
}
