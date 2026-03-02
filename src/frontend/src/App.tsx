import { BrowserRouter, Routes, Route } from "react-router";
import { AuthProvider } from "./lib/auth";
import { PublicLayout } from "./components/PublicLayout";
import { AdminLayout } from "./components/AdminLayout";
import { Landing } from "./pages/Landing";
import { Feed } from "./pages/Feed";
import { PostDetail } from "./pages/PostDetail";
import { CreatePost } from "./pages/CreatePost";
import { Identity } from "./pages/Identity";
import { CredentialFlow } from "./pages/CredentialFlow";
import { AdminLogin } from "./pages/admin/Login";
import { AdminDashboard } from "./pages/admin/Dashboard";
import { AdminGroups } from "./pages/admin/Groups";
import { AdminModeration } from "./pages/admin/Moderation";
import { AdminCredentials } from "./pages/admin/Credentials";
import { AdminAuditLog } from "./pages/admin/AuditLog";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Landing — full-page layout */}
          <Route path="/" element={<Landing />} />

          {/* Public routes */}
          <Route element={<PublicLayout />}>
            <Route path="/feed" element={<Feed />} />
            <Route path="/post/:id" element={<PostDetail />} />
            <Route path="/create" element={<CreatePost />} />
            <Route path="/identity" element={<Identity />} />
            <Route path="/credentials" element={<CredentialFlow />} />
          </Route>

          {/* Admin login — standalone */}
          <Route path="/admin/login" element={<AdminLogin />} />

          {/* Admin routes — protected layout */}
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="groups" element={<AdminGroups />} />
            <Route path="moderation" element={<AdminModeration />} />
            <Route path="credentials" element={<AdminCredentials />} />
            <Route path="audit-log" element={<AdminAuditLog />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
