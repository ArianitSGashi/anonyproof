import { Link, Outlet, useLocation, Navigate } from "react-router";
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  FileKey2,
  ClipboardList,
  LogOut,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { Spinner } from "./ui";
import logo from "../assets/up-logo.webp";

const sidebarLinks = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/groups", label: "Groups", icon: Users },
  { to: "/admin/moderation", label: "Moderation", icon: ShieldCheck },
  { to: "/admin/credentials", label: "Credentials", icon: FileKey2 },
  { to: "/admin/audit-log", label: "Audit Log", icon: ClipboardList },
];

export function AdminLayout() {
  const { admin, isLoading, logout } = useAuth();
  const { pathname } = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!admin) {
    return <Navigate to="/admin/login" replace />;
  }

  function isActive(to: string, end?: boolean) {
    if (end) return pathname === to;
    return pathname.startsWith(to);
  }

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-slate-200 bg-white">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-5">
          <img src={logo} alt="University of Prishtina" className="h-8 w-8" />
          <span className="text-lg font-bold text-slate-900">
            Anony<span className="text-primary-600">Proof</span>
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 p-3">
          {sidebarLinks.map(({ to, label, icon: Icon, end }) => (
            <Link
              key={to}
              to={to}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
                isActive(to, end)
                  ? "bg-primary-50 text-primary-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-slate-200 p-3">
          <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2">
            <p className="text-sm font-medium text-slate-900">
              {admin.username}
            </p>
            <p className="text-xs text-slate-500 capitalize">{admin.role}</p>
          </div>
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-700 cursor-pointer"
          >
            <LogOut className="h-5 w-5" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center border-b border-slate-200 bg-white px-8">
          <h2 className="text-lg font-semibold text-slate-900">
            Admin Panel
          </h2>
          <Link
            to="/"
            className="ml-auto text-sm text-slate-500 hover:text-primary-600"
          >
            View public site
          </Link>
        </header>
        <main className="flex-1 overflow-y-auto p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
