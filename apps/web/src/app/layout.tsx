import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Cloud Triage Agent',
  description: 'Compare baseline vs. agent workflows for cloud incident triage',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
