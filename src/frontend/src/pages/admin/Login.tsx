import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Shield } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { Button, Input, Card } from "../../components/ui";
import { ApiRequestError } from "../../lib/api";
import logo from "../../assets/up-logo.webp";

export function AdminLogin() {
  const { login, admin } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Already logged in
  if (admin) {
    navigate("/admin", { replace: true });
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      navigate("/admin", { replace: true });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center text-center">
          <img
            src={logo}
            alt="University of Prishtina"
            className="mb-4 h-20 w-20"
          />
          <h1 className="text-2xl font-bold text-slate-900">
            Admin Portal
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Sign in to the AnonyProof admin panel
          </p>
        </div>

        {/* Login Card */}
        <Card>
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <Input
              label="Username"
              type="text"
              placeholder="admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
            <Input
              label="Password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />

            <Button
              type="submit"
              loading={loading}
              className="w-full"
              size="lg"
            >
              <Shield className="h-4 w-4" />
              Sign in
            </Button>
          </form>
        </Card>

        <p className="mt-6 text-center text-xs text-slate-400">
          University of Prishtina &middot; AnonyProof Admin
        </p>
      </div>
    </div>
  );
}
