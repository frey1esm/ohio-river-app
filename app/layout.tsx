import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// The mockups (mockups/helm-v1-cyan.png, mockups/helm-v3-chart.png) use a
// clean, open, non-condensed sans throughout — not the legacy site's
// condensed Oswald display font this app used before the redesign.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Ohio River · Conditions",
  description: "Ohio River stage, flow, mean velocity, and water temperature at Cincinnati.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
