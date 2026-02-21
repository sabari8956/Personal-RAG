import Link from "next/link";

import { ChatWidget } from "@/components/chat-widget";

const SOCIAL_LINKS = [
  { label: "Twitter", href: "https://twitter.com/your-handle" },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/your-handle" },
  { label: "Instagram", href: "https://www.instagram.com/your-handle" },
];

export default function Home() {
  return (
    <main className="home-shell">
      <header className="top-nav">
        <span className="brand">Let&apos;s get to know Sabari</span>
        <Link href="/admin" className="link-btn">
          Admin
        </Link>
      </header>
      <section className="center-stack">
        <div className="home-center">
          <h1>Ask me anything about Sabari.</h1>
        </div>
        <ChatWidget />
      </section>
      <aside className="social-dock" aria-label="Social links">
        {SOCIAL_LINKS.map((social) => (
          <a
            key={social.label}
            href={social.href}
            target="_blank"
            rel="noreferrer"
            className="social-link"
          >
            {social.label}
          </a>
        ))}
      </aside>
    </main>
  );
}
