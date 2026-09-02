import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://127.0.0.1:3001'),
  title: 'Stimgraph — Stuff That Interests Me',
  description: 'A map of your X bookmarks: saved posts, people, topics, and the links between them.',
  openGraph: {
    title: 'Stimgraph — Stuff That Interests Me',
    description: 'A map of your X bookmarks: saved posts, people, topics, and the links between them.',
    type: 'website',
    images: [{ url: '/og.jpg', width: 1200, height: 630, alt: 'Stimgraph — Stuff That Interests Me' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Stimgraph — Stuff That Interests Me',
    description: 'A map of your X bookmarks: saved posts, people, topics, and the links between them.',
    images: ['/og.jpg'],
  },
};

const themeBoot = `(function(){try{var s=localStorage.getItem('stimgraph:theme');var t=s==='light'||s==='dark'?s:(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
