import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Body Measure — Height, Wingspan & Standing Reach",
  description:
    "Measure your height, wingspan, and standing reach from your phone using AI-powered pose detection. No equipment needed — just a basketball for calibration.",
  keywords: ["body measurement", "height", "wingspan", "standing reach", "AI", "pose detection"],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#09090b",
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
