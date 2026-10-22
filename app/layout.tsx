import type { Metadata } from "next";
import Link from "next/link";
import { Sora, Geist_Mono } from "next/font/google";
import { Logo } from "@/components/brand/logo";
import { AppProviders } from "@/lib/store/providers";
import "./globals.css";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Aplify — Nigerian businesses without a website",
    template: "%s · Aplify",
  },
  description:
    "Search real Nigerian businesses with no website and a public email or phone number.",
  applicationName: "Aplify",
  keywords: ["cold outreach", "lead finder", "business email finder", "B2B prospecting"],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sora.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-canvas text-ink">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[80] focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-xs focus:text-white"
        >
          Skip to content
        </a>
        <header className="sticky top-0 z-30 border-b border-line bg-surface/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-5xl items-center gap-2.5 px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2.5">
              <Logo size={30} />
              <span className="text-[17px] font-bold tracking-[-0.02em] text-ink">Aplify</span>
            </Link>
            <span className="rounded-full bg-accent-50 px-2 py-0.5 text-[10px] font-bold tracking-wide text-accent-700">
              BETA
            </span>
            <span className="ml-auto hidden text-[12px] text-ink-muted sm:block">
              Find businesses worth emailing
            </span>
            <Link
              href="/history"
              className="ml-auto text-[12px] font-medium text-ink-muted transition-colors hover:text-accent-700 sm:ml-0"
            >
              History
            </Link>
          </div>
        </header>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
