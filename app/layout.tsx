import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Apex — Measure like the combine does.",
  description:
    "Measure your height using AI pose detection calibrated against a Size 7 basketball. Combine-style accuracy from your phone camera.",
  keywords: ["height measurement", "body measurement", "combine", "basketball", "AI", "pose detection"],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#141110",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans bg-zinc-950 text-white">
        {children}
      </body>
    </html>
  );
}
