import React from "react";
import { Navigate, Route, Routes, BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import Login from "@/pages/Login";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Reports from "@/pages/Reports";
import ReportForm from "@/pages/ReportForm";
import ReportDetail from "@/pages/ReportDetail";
import Users from "@/pages/Users";
import Departments from "@/pages/Departments";
import Announcements from "@/pages/Announcements";
import Analytics from "@/pages/Analytics";
import AuditLogs from "@/pages/AuditLogs";
import Settings from "@/pages/Settings";
import Committees from "@/pages/Committees";
import Notices from "@/pages/Notices";
import NoticeForm from "@/pages/NoticeForm";
import NoticeDetail from "@/pages/NoticeDetail";
import Timetables from "@/pages/Timetables";
import TimetableForm from "@/pages/TimetableForm";
import TimetableDetail from "@/pages/TimetableDetail";
import DailyTimetables from "@/pages/DailyTimetables";
import DailyTimetableForm from "@/pages/DailyTimetableForm";
import DailyTimetableDetail from "@/pages/DailyTimetableDetail";
import { AIProvider } from "@/ai/AIContext";
import AIButton from "@/ai/AIButton";
import AIPanel from "@/ai/AIPanel";

function Protected({ children, roles }) {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-burgundy font-serif text-xl">
        <span className="ornament">Loading IQAC Portal</span>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="reports" element={<Reports />} />
        <Route path="reports/new" element={<ReportForm />} />
        <Route path="reports/:id" element={<ReportDetail />} />
        <Route path="reports/:id/edit" element={<ReportForm />} />
        <Route path="notices" element={<Notices />} />
        <Route path="notices/new" element={<NoticeForm />} />
        <Route path="notices/:id" element={<NoticeDetail />} />
        <Route path="notices/:id/edit" element={<NoticeForm />} />
        <Route path="timetables" element={<Timetables />} />
        <Route path="timetables/new" element={<TimetableForm />} />
        <Route path="timetables/:id" element={<TimetableDetail />} />
        <Route path="timetables/:id/edit" element={<TimetableForm />} />
        <Route path="daily-timetables" element={<DailyTimetables />} />
        <Route path="daily-timetables/new" element={<DailyTimetableForm />} />
        <Route path="daily-timetables/:id" element={<DailyTimetableDetail />} />
        <Route path="daily-timetables/:id/edit" element={<DailyTimetableForm />} />
        <Route path="announcements" element={<Announcements />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="users" element={<Protected roles={["admin"]}><Users /></Protected>} />
        <Route path="departments" element={<Protected roles={["admin"]}><Departments /></Protected>} />
        <Route path="committees" element={<Protected roles={["admin"]}><Committees /></Protected>} />
        <Route path="audit-logs" element={<Protected roles={["admin","coordinator"]}><AuditLogs /></Protected>} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AIProvider>
          <AppRoutes />
          <AIButton />
          <AIPanel />
          <Toaster position="top-right" richColors closeButton />
        </AIProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}
