import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/ide/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pavan Full Stack App Builder — Autonomous Software Engineering Platform",
  description:
    "A fully autonomous software engineering platform that designs, implements, tests, debugs, packages, deploys, and maintains any software project from natural-language requirements.",
  keywords: [
    "Pavan",
    "autonomous software engineering",
    "multi-agent",
    "WinUI 3",
    "WPF",
    "Tauri",
    "Electron",
    "Android",
    "full stack",
    "AI agents",
  ],
  authors: [{ name: "Pavan Labs" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Pavan Full Stack App Builder",
    description: "Autonomous software engineering from natural-language requirements.",
    siteName: "Pavan",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground overflow-hidden`}
      >
        <ThemeProvider>{children}</ThemeProvider>
        <Toaster />
      </body>
    </html>
  );
}
