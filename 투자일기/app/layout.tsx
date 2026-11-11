import type { Metadata } from "next";
import "./globals.css";
import "./theme.css";

export const metadata: Metadata = {
  title: "온기 — 함께 쓰는 투자 일기",
  description: "나의 투자 생각을 기록하고, 다른 투자자들의 마음을 이해하는 공간.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
