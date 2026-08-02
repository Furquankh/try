import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";

const COLORS = ["#63192B", "#1F4A38", "#D97706", "#2563EB", "#9333EA", "#6B7280"];

export default function Analytics() {
  const [s, setS] = useState(null);
  useEffect(() => { api.get("/stats/overview").then((r) => setS(r.data)); }, []);

  if (!s) return <div className="text-muted-foreground italic">Loading analytics…</div>;

  const byStatusData = Object.entries(s.by_status).map(([k, v]) => ({ name: k.replace("_", " "), value: v }));
  const byTypeData = Object.entries(s.by_type).map(([k, v]) => ({ name: k, value: v }));

  return (
    <div className="space-y-8">
      <div>
        <div className="overline">Quality Metrics</div>
        <h1 className="font-serif text-4xl">Analytics &amp; Compliance</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
          Submission trends, departmental performance and activity-type distribution across the academic year.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Total Reports" value={s.total} />
        <Stat label="Approved" value={s.approved} />
        <Stat label="Pending Review" value={s.pending} />
        <Stat label="Rejected" value={s.rejected} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="paper p-6">
          <div className="overline">Trend</div>
          <h2 className="font-serif text-2xl mb-4">Monthly Submissions</h2>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={s.trend}>
              <CartesianGrid stroke="#E5E1D8" strokeDasharray="3 3" />
              <XAxis dataKey="month" stroke="#5C5F62" fontSize={11} />
              <YAxis stroke="#5C5F62" fontSize={11} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "#FCFBF9", border: "1px solid #E5E1D8", fontFamily: "IBM Plex Sans" }} />
              <Line type="monotone" dataKey="count" stroke="#63192B" strokeWidth={2} dot={{ fill: "#63192B" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="paper p-6">
          <div className="overline">Composition</div>
          <h2 className="font-serif text-2xl mb-4">By Status</h2>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={byStatusData} cx="50%" cy="50%" innerRadius={50} outerRadius={90} dataKey="value">
                {byStatusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: "#FCFBF9", border: "1px solid #E5E1D8" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="paper p-6 lg:col-span-2">
          <div className="overline">Distribution</div>
          <h2 className="font-serif text-2xl mb-4">By Activity Type</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byTypeData}>
              <CartesianGrid stroke="#E5E1D8" strokeDasharray="3 3" />
              <XAxis dataKey="name" stroke="#5C5F62" fontSize={11} />
              <YAxis stroke="#5C5F62" fontSize={11} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "#FCFBF9", border: "1px solid #E5E1D8" }} />
              <Bar dataKey="value" fill="#63192B" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {s.by_department && s.by_department.length > 0 && (
          <div className="paper p-6 lg:col-span-2">
            <div className="overline">Departmental</div>
            <h2 className="font-serif text-2xl mb-4">Department-wise Quality</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={s.by_department}>
                <CartesianGrid stroke="#E5E1D8" strokeDasharray="3 3" />
                <XAxis dataKey="department" stroke="#5C5F62" fontSize={11} />
                <YAxis stroke="#5C5F62" fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#FCFBF9", border: "1px solid #E5E1D8" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="total" fill="#63192B" name="Total Reports" />
                <Bar dataKey="approved" fill="#1F4A38" name="Approved" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="paper p-5">
      <div className="overline">{label}</div>
      <div className="serif-numerals text-4xl text-burgundy mt-2 leading-none">{value ?? 0}</div>
    </div>
  );
}
