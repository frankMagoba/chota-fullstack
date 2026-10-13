import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Chota Ops', description: 'Live bookings, trucks and experiments' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
