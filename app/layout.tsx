import "./globals.css";
import { BUILD_INFO } from "../lib/build-info.ts";

export const metadata = {
  title: "cbio-lab",
  description: "Temporal cohort queries over cBioPortal timeline events",
  icons: { icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧪</text></svg>" }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Serif:wght@600&display=swap" />
      </head>
      <body>
        {children}
        {/* which code this deployment runs (lib/build-info.ts); also served as /api/version */}
        <footer className="build-stamp">
          build{" "}
          {BUILD_INFO.url
            ? <a className="mono" href={BUILD_INFO.url} title={BUILD_INFO.commit ?? undefined}>{BUILD_INFO.label}</a>
            : <span className="mono" title={BUILD_INFO.commit ? undefined : "this build was not told which commit it is"}>{BUILD_INFO.label}</span>}
        </footer>
      </body>
    </html>
  );
}
