import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://127.0.0.1:3001'),
  title: 'Stimgraph — Stuff That Interests Me',
  description: 'Turn your saved ideas into an explorable map of topics, people, and connections.',
  openGraph: {
    title: 'Stimgraph — Stuff That Interests Me',
    description: 'Turn your saved ideas into an explorable map of topics, people, and connections.',
    type: 'website',
    images: [{ url: '/og.jpg', width: 1200, height: 630, alt: 'Stimgraph — Stuff That Interests Me' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Stimgraph — Stuff That Interests Me',
    description: 'Turn your saved ideas into an explorable map of topics, people, and connections.',
    images: ['/og.jpg'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
