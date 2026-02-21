import { ChatWidget } from "@/components/chat-widget";

const SOCIAL_LINKS = [
  { label: "X / Twitter", href: "https://x.com/Sabari_8956" },
  { label: "Instagram", href: "https://www.instagram.com/sabari_kannan_4444/" },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/sabari8956/" },
];

export default function Home() {
  return (
    <main className="home-shell">
      <section className="social-mobile" aria-label="Social links">
        <p>Find Sabari on</p>
        <div className="social-mobile-grid">
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
        </div>
      </section>
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
