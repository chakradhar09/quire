import type { Metadata } from "next";
import { Literata, Public_Sans, Red_Hat_Mono } from "next/font/google";
import { Providers } from "@/components/overlays";
import { PendingDeletes } from "./pending-deletes";
import "./globals.css";

const publicSans = Public_Sans({ variable: "--font-public", subsets: ["latin"] });
const literata = Literata({ variable: "--font-literata", subsets: ["latin"] });
const redHatMono = Red_Hat_Mono({ variable: "--font-redhat-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Quire",
  description: "Check your own drafts for matching sources and AI-like writing.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${publicSans.variable} ${literata.variable} ${redHatMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Providers><PendingDeletes>{children}</PendingDeletes></Providers>
      </body>
    </html>
  );
}
