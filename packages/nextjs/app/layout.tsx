import { Inter, JetBrains_Mono } from "next/font/google";
import "@rainbow-me/rainbowkit/styles.css";
import "@scaffold-ui/components/styles.css";
import { ScaffoldEthAppWithProviders } from "~~/components/ScaffoldEthAppWithProviders";
import { ThemeProvider } from "~~/components/ThemeProvider";
import "~~/styles/globals.css";
import { getMetadata } from "~~/utils/scaffold-eth/getMetadata";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains",
});

export const metadata = getMetadata({
  title: "Chord — Verifiable agent work settled in USDC on Arc",
  description:
    "Chord is an escrow and settlement layer for verifiable agent-native work contracts. Built on Circle Arc Testnet.",
});

const ScaffoldEthApp = ({ children }: { children: React.ReactNode }) => {
  return (
    <html suppressHydrationWarning className={`${inter.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">
        <ThemeProvider enableSystem defaultTheme="dark">
          <ScaffoldEthAppWithProviders>{children}</ScaffoldEthAppWithProviders>
        </ThemeProvider>
      </body>
    </html>
  );
};

export default ScaffoldEthApp;
