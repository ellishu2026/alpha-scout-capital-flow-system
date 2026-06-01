import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AlphaScout Capital Flow System V1.6.7.2",
  description: "Capital-flow-driven US stock selection dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
