import type { Metadata } from 'next';
import { Geist, Geist_Mono, Source_Serif_4 } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });
const sourceSerif = Source_Serif_4({ variable: '--font-source-serif', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Intake Triage',
  description: 'Triage inbound project requests.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${sourceSerif.variable} font-sans antialiased`}
      >
        <header className="border-b border-line bg-card">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-4 sm:px-6">
            <Link href="/" className="font-serif text-xl tracking-tight">
              Intake Triage
            </Link>
            <nav className="hidden sm:block">
              <Link
                href="/"
                className="border-b-2 border-rust pb-1 text-sm font-medium text-ink"
              >
                Intakes
              </Link>
            </nav>
            <Link
              href="/intakes/new"
              className="ml-auto hidden rounded-md bg-ink px-4 py-2 text-sm font-semibold text-card transition-opacity hover:opacity-90 sm:block"
            >
              New intake
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
