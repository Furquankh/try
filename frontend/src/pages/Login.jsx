import React, { useState, useEffect } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { GraduationCap, BookOpen, ShieldCheck } from "lucide-react";

export default function Login() {
  const { user, login, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    if (user && user !== false) nav("/", { replace: true });
  }, [user, nav]);

  if (user && user !== false) return <Navigate to="/" replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const ok = await login(email, password);
    setLoading(false);
    if (ok) nav("/", { replace: true });
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left visual panel */}
      <div className="hidden lg:flex relative flex-col justify-between p-12 text-ivory bg-burgundy overflow-hidden">
        <div
          className="absolute inset-0 opacity-20 bg-cover bg-center mix-blend-overlay"
          style={{ backgroundImage: "url(https://images.pexels.com/photos/413260/pexels-photo-413260.jpeg)" }}
        />
        <div className="absolute inset-0" style={{
          background: "linear-gradient(180deg, rgba(99,25,43,0.85) 0%, rgba(74,17,31,0.95) 100%)"
        }} />
        <div className="relative z-10">
          <img
            src="/college-logo.png"
            alt="J.B.S.P. Sanstha logo"
            className="w-24 h-24 mb-6 drop-shadow-[0_4px_12px_rgba(0,0,0,0.35)]"
          />
          <div className="overline text-ivory/70 mb-3">Janardan Bhagat Shikshan Prasarak Sanstha's · Estd. 1992</div>
          <h1 className="font-serif text-5xl xl:text-6xl leading-[1.05] mb-4">
            Ramsheth Thakur<br />College of Commerce<br />&amp; Science
          </h1>
          <div className="text-xs text-ivory/70 mt-3 leading-relaxed">
            Plot no-1, Sector-33, Kharghar, Navi Mumbai — 410210<br />
            Affiliated to University of Mumbai · NAAC 'A' Grade · ISO 9001:2015 &amp; 14001:2015
          </div>
          <div className="ornament text-ivory/80 mt-6">
            <span>RTCCS Teachers Portal</span>
          </div>
        </div>

        <div className="relative z-10 space-y-4 mt-12 max-w-md">
          <Feature icon={GraduationCap} title="IQAC Sheet Workflow"
            text="Staff drafts move through HOD review, Coordinator validation, and Principal approval — every step recorded." />
          <Feature icon={BookOpen} title="Documentary Archive"
            text="Proof attachments, version history and PDF exports of every IQAC sheet — searchable, audit-ready." />
          <Feature icon={ShieldCheck} title="Role-based Access"
            text="Principal · Coordinator · HOD · Staff — each portal tailored to its responsibilities." />
        </div>

        <div className="relative z-10 overline text-ivory/60">
          RTCCS Teachers Portal · Departmental Documentation
        </div>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center p-8 bg-ivory">
        <div className="w-full max-w-md">
          <div className="mb-10">
            <div className="overline">Welcome</div>
            <h2 className="font-serif text-4xl text-foreground leading-tight mt-1">
              Sign in to the RTCCS Portal
            </h2>
            <p className="text-sm text-muted-foreground mt-3">
              Please use the credentials provided by the Office of the Principal.
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-5" data-testid="login-form">
            <div>
              <label className="overline block mb-2" htmlFor="email">Institutional Email</label>
              <input
                id="email"
                data-testid="login-email-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 bg-white border border-border rounded-sm focus:outline-none focus:border-burgundy focus:ring-1 focus:ring-burgundy text-foreground"
                placeholder="name@rtcollege.edu.in"
              />
            </div>
            <div>
              <label className="overline block mb-2" htmlFor="password">Password</label>
              <input
                id="password"
                data-testid="login-password-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-3 bg-white border border-border rounded-sm focus:outline-none focus:border-burgundy focus:ring-1 focus:ring-burgundy text-foreground"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div data-testid="login-error" className="text-sm text-destructive border-l-2 border-destructive pl-3 py-1">
                {error}
              </div>
            )}

            <button
              type="submit"
              data-testid="login-submit-button"
              disabled={loading}
              className="w-full bg-burgundy text-ivory px-4 py-3 rounded-sm hover:bg-burgundy-dark transition-colors disabled:opacity-60 font-medium"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="mt-12 pt-6 border-t border-border">
            <div className="overline mb-2">Demonstration account</div>
            <div className="text-sm font-mono text-muted-foreground space-y-0.5">
              <div>principal@rtcollege.edu.in</div>
              <div>Principal@2026</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Feature({ icon: Icon, title, text }) {
  return (
    <div className="flex gap-4">
      <div className="mt-1 p-2 rounded-sm bg-ivory/10 border border-ivory/20">
        <Icon size={18} strokeWidth={1.5} />
      </div>
      <div>
        <div className="font-serif text-lg leading-tight">{title}</div>
        <div className="text-sm text-ivory/75 leading-relaxed mt-1">{text}</div>
      </div>
    </div>
  );
}
