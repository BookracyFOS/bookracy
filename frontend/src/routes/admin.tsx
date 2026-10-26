import { createFileRoute } from "@tanstack/react-router";
import { AdminDashboard } from "@/components/community/admin-dashboard";

// Hidden moderation route — not linked in the sidebar. Gated by the ADMIN_KEY
// (entered once, kept in localStorage); the backend rejects anything else.
export const Route = createFileRoute("/admin")({
  component: AdminDashboard,
});
