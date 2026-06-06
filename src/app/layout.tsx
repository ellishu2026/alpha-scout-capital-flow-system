import type { Metadata } from "next";
import { APP_TITLE } from "@/lib/version";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_TITLE,
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
