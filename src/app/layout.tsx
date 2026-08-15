import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "RunningHub Generator",
  description: "RunningHub generator",
  themeColor: "#0f0f12",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
