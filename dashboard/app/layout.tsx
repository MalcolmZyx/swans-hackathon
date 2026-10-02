import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SourceViewerProvider } from "@/components/SourceViewer";
import "./globals.css";

// The lawyer app uses the system SF Pro stack; the doctor page uses Inter (DESIGN.md §7.3).
const inter = Inter({ variable: "--font-inter-face", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: "ROSS",
  description: "A 90-second case brief for personal-injury attorneys, and a curated page for the doctors treating their client.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full flex flex-col font-sans">
        <SourceViewerProvider>{children}</SourceViewerProvider>
      </body>
    </html>
  );
}
