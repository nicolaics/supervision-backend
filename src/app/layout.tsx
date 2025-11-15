import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Backend API",
  description: "CSV Processing API",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
