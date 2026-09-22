import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "时间环记",
  description: "以入睡为起点，记录一天真实发生的时间。",
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
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
