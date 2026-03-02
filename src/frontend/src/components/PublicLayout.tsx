import { Link, Outlet, useLocation } from "react-router";
import { Shield, MessageSquare, Fingerprint } from "lucide-react";
import logo from "../assets/up-logo.webp";

export function PublicLayout() {
  const { pathname } = useLocation();

  const navLinks = [
    { to: "/feed", label: "Feed", icon: MessageSquare },
    { to: "/identity", label: "Identity", icon: Fingerprint },
    { to: "/credentials", label: "Credentials", icon: Shield },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-3">
            <img src={logo} alt="University of Prishtina" className="h-9 w-9" />
            <span className="text-lg font-bold text-slate-900">
              Anony<span className="text-primary-600">Proof</span>
            </span>
          </Link>

          <nav className="flex items-center gap-1">
            {navLinks.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${
                  pathname.startsWith(to)
                    ? "bg-primary-50 text-primary-700"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            ))}
            <div className="ml-2 h-6 w-px bg-slate-200" />
            <Link
              to="/admin/login"
              className="ml-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              Admin
            </Link>
          </nav>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
