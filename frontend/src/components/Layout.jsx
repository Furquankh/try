import React, { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  LayoutDashboard, FileText, Megaphone, BarChart3, Users as UsersIcon,
  Building2, ScrollText, LogOut, Menu, X, Settings as SettingsIcon,
  Bell, CalendarDays, CalendarClock, ShieldCheck
} from "lucide-react";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, testid: "nav-dashboard" },
  { to: "/reports", label: "IQAC Sheets", icon: FileText, testid: "nav-reports" },
  { to: "/notices", label: "Notices", icon: Bell, testid: "nav-notices" },
  { to: "/timetables", label: "Time Tables", icon: CalendarDays, testid: "nav-timetables" },
  { to: "/daily-timetables", label: "Daily Time Table", icon: CalendarClock, testid: "nav-daily-timetables" },
  { to: "/announcements", label: "Announcements", icon: Megaphone, testid: "nav-announcements" },
  { to: "/analytics", label: "Analytics", icon: BarChart3, testid: "nav-analytics" },
  { to: "/users", label: "Users", icon: UsersIcon, roles: ["admin"], testid: "nav-users" },
  { to: "/departments", label: "Departments", icon: Building2, roles: ["admin"], testid: "nav-departments" },
  { to: "/committees", label: "Committees", icon: ShieldCheck, roles: ["admin"], testid: "nav-committees" },
  { to: "/audit-logs", label: "Audit Logs", icon: ScrollText, roles: ["admin","coordinator"], testid: "nav-audit" },
  { to: "/settings", label: "PDF Settings", icon: SettingsIcon, testid: "nav-settings" },
];

const ROLE_LABEL = {
  admin: "Principal — Administrator",
  coordinator: "IQAC Coordinator",
  hod: "Head of Department",
  staff: "Faculty / Staff",
};

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);

  const items = NAV.filter((n) => !n.roles || n.roles.includes(user.role));

  return (
    <div className="min-h-screen flex bg-ivory">
      {/* Sidebar */}
      <aside
        data-testid="sidebar"
        className={`fixed lg:static inset-y-0 left-0 z-40 w-72 transform lg:translate-x-0 transition-transform
          ${open ? "translate-x-0" : "-translate-x-full"}
          bg-ivory-surface border-r border-border flex flex-col`}
      >
        <div className="p-6 border-b border-border">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <img
                src="/college-logo.png"
                alt="College logo"
                className="w-14 h-14 flex-shrink-0 mt-0.5"
              />
              <div className="min-w-0">
                <div className="overline mb-1 text-[9px]">RTCCS Teachers Portal</div>
                <h1 className="font-serif text-xl leading-tight text-burgundy">
                  Ramsheth Thakur<br />College
                </h1>
                <div className="overline mt-1.5 text-[9px]">Commerce &amp; Science · Est. 1992</div>
              </div>
            </div>
            <button
              data-testid="sidebar-close"
              className="lg:hidden p-1 text-muted-foreground"
              onClick={() => setOpen(false)}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <nav className="flex-1 p-3 overflow-y-auto">
          <div className="overline px-3 mb-2">Navigation</div>
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              data-testid={it.testid}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 my-0.5 text-sm transition-colors rounded-sm
                ${isActive
                  ? "bg-burgundy text-ivory border-l-2 border-burgundy"
                  : "text-foreground hover:bg-ivory-alt border-l-2 border-transparent"}`
              }
            >
              <it.icon size={17} strokeWidth={1.6} />
              <span>{it.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-sm bg-burgundy text-ivory flex items-center justify-center font-serif text-lg">
              {(user.name || user.email || "U").slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate" data-testid="current-user-name">{user.name}</div>
              <div className="overline text-[10px]" data-testid="current-user-role">
                {ROLE_LABEL[user.role] || user.role}
              </div>
            </div>
          </div>
          <button
            data-testid="logout-button"
            onClick={async () => { await logout(); nav("/login"); }}
            className="w-full flex items-center justify-center gap-2 text-sm px-3 py-2 border border-border rounded-sm hover:bg-ivory-alt transition-colors"
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-ivory-surface">
          <button data-testid="sidebar-open" onClick={() => setOpen(true)}>
            <Menu size={22} />
          </button>
          <div className="font-serif text-lg text-burgundy">IQAC Portal</div>
          <div className="w-6" />
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-6 py-8 fade-up">
            <Outlet />
          </div>
        </main>
        <footer className="border-t border-border px-6 py-3 text-center overline text-[10px]">
          Ramsheth Thakur College · RTCCS Teachers Portal
        </footer>
      </div>
    </div>
  );
}
