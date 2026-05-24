import { defineChain } from "viem";
import * as chains from "viem/chains";

export const CHORD_NETWORKS = ["arc", "localhost"] as const;
export type ChordNetwork = (typeof CHORD_NETWORKS)[number];

const normalizeChordNetwork = (network?: string): ChordNetwork => (network === "localhost" ? "localhost" : "arc");

/**
 * Frontend chain selector. Defaults to Arc so production deploys stay pointed
 * at the live protocol unless local E2E explicitly opts into localhost.
 */
export const chordNetwork = normalizeChordNetwork(process.env.NEXT_PUBLIC_CHORD_NETWORK);

// Circle Arc Testnet — USDC-native L1. Gas is paid in USDC.
// The gas-accounting view uses 18 decimals; the ERC-20 interface at ARC_USDC_ADDRESS
// returns 6 decimals — use that everywhere in app code (amounts, displays, parseUnits).
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "USDC",
    symbol: "USDC",
  },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network"],
    },
  },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

/** Canonical USDC ERC-20 address on Arc Testnet (system contract, 6 decimals). */
export const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
export const localhost = chains.hardhat;

const targetNetworks = chordNetwork === "localhost" ? ([localhost] as const) : ([arcTestnet] as const);

export type BaseConfig = {
  targetNetworks: readonly chains.Chain[];
  pollingInterval: number;
  alchemyApiKey: string;
  rpcOverrides?: Record<number, string>;
  walletConnectProjectId: string;
  onlyLocalBurnerWallet: boolean;
};

export type ScaffoldConfig = BaseConfig;

export const DEFAULT_ALCHEMY_API_KEY = "cR4WnXePioePZ5fFrnSiR";

const scaffoldConfig = {
  // The networks on which your DApp is live
  targetNetworks,
  // The interval at which your front-end polls the RPC servers for new data (it has no effect if you only target the local network (default is 4000))
  pollingInterval: 30000,
  // This is ours Alchemy's default API key.
  // You can get your own at https://dashboard.alchemyapi.io
  // It's recommended to store it in an env variable:
  // .env.local for local testing, and in the Vercel/system env config for live apps.
  alchemyApiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || DEFAULT_ALCHEMY_API_KEY,
  // If you want to use a different RPC for a specific network, you can add it here.
  // The key is the chain ID, and the value is the HTTP RPC URL
  rpcOverrides: {
    [arcTestnet.id]: process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network",
    [localhost.id]: process.env.NEXT_PUBLIC_LOCALHOST_RPC_URL || "http://127.0.0.1:8545",
  },
  // This is ours WalletConnect's default project ID.
  // You can get your own at https://cloud.walletconnect.com
  // It's recommended to store it in an env variable:
  // .env.local for local testing, and in the Vercel/system env config for live apps.
  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID || "3a8170812b534d0ff9d794f19a901d64",
  onlyLocalBurnerWallet: chordNetwork === "localhost",
} as const satisfies ScaffoldConfig;

export default scaffoldConfig;
