import Link from "next/link";

import { AdminPanel } from "@/components/admin-panel";

export default function AdminPage() {
  return (
    <main className="page-shell">
      <header className="hero">
        <p className="eyebrow">Protected Controls</p>
        <h1>RAG Ingestion Admin</h1>
        <p>Use your admin basic credentials to upload PDFs and manage indexed documents.</p>
        <Link href="/" className="link-btn">
          Back To Chat
        </Link>
      </header>

      <AdminPanel />
    </main>
  );
}
