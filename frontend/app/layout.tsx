import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Interview Prep Kit", description: "Turn a job description into a personalised interview prep kit." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
        <div id="main">{children}</div>
      </body>
    </html>
  );
}
