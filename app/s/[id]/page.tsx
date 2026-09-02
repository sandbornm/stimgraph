import type { Metadata } from 'next';
import Home from '../../page';
import { loadShare } from '@/db/storage';

export const dynamic = 'force-dynamic';

type ShareParams = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: ShareParams): Promise<Metadata> {
  const { id } = await params;
  try {
    const share = await loadShare(id);
    if (!share) return { title: 'Stimgraph — missing map' };
    return {
      title: `${share.capsule.name} — Stimgraph`,
      description: 'A shared neighborhood of people and topics. Bookmark text is not included.',
      openGraph: {
        title: `${share.capsule.name} — Stimgraph`,
        description: 'Explore this Stimgraph. People, topics, and links — no bookmark text.',
        type: 'website',
        images: [{ url: '/og.jpg', width: 1200, height: 630, alt: share.capsule.name }],
      },
      twitter: {
        card: 'summary_large_image',
        title: `${share.capsule.name} — Stimgraph`,
        description: 'Explore this Stimgraph. People, topics, and links — no bookmark text.',
        images: ['/og.jpg'],
      },
    };
  } catch {
    return { title: 'Stimgraph' };
  }
}

export default function SharedMapPage() {
  return <Home />;
}
