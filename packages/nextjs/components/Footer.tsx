"use client";

import React from "react";
import Link from "next/link";
import { hardhat } from "viem/chains";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { Logo } from "~~/components/Logo";
import { Faucet } from "~~/components/scaffold-eth";
import deployedContracts from "~~/contracts/deployedContracts";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { arcTestnet } from "~~/scaffold.config";

const ESCROW = deployedContracts[arcTestnet.id]?.ChordEscrow;
const ESCROW_ADDRESS = ESCROW?.address ?? "";
const EXPLORER_BASE = arcTestnet.blockExplorers?.default?.url ?? "https://testnet.arcscan.app";

/**
 * Site footer — minimal, brand-aligned. Floats a thin utility row at the
 * bottom-left for the local-network faucet + block explorer (only when wired
 * to Hardhat). Static link row at page bottom for protocol attribution.
 */
export const Footer = () => {
  const { targetNetwork } = useTargetNetwork();
  const isLocalNetwork = targetNetwork.id === hardhat.id;

  return (
    <>
      {/* Local-network-only floating utilities */}
      {isLocalNetwork && (
        <div className="fixed z-10 bottom-4 left-4 flex flex-col sm:flex-row gap-2 pointer-events-auto">
          <Faucet />
          <Link
            href="/blockexplorer"
            passHref
            className="btn btn-sm bg-base-100 border border-base-300 hover:bg-base-200 gap-1.5 font-normal"
          >
            <MagnifyingGlassIcon className="h-4 w-4" />
            Block explorer
          </Link>
        </div>
      )}

      <footer className="mt-16 border-t border-base-300 bg-base-100/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="max-w-sm">
              <div className="flex items-center gap-2.5">
                <Logo size={24} className="text-primary" />
                <span className="font-semibold tracking-tight">Chord</span>
              </div>
              <p className="mt-3 text-sm text-base-content/60">
                Escrow and settlement for verifiable agent-native work. Define proof, fund USDC, and release payout on
                Circle Arc.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-2 text-sm">
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase tracking-[0.14em] text-base-content/40">Protocol</span>
                <Link href="/projects/create" className="text-base-content/75 hover:text-base-content">
                  Create
                </Link>
                <Link href="/projects" className="text-base-content/75 hover:text-base-content">
                  Contracts
                </Link>
                <Link href="/work" className="text-base-content/75 hover:text-base-content">
                  Work
                </Link>
                <Link href="/agents" className="text-base-content/75 hover:text-base-content">
                  Agents
                </Link>
                <Link href="/leaderboard" className="text-base-content/75 hover:text-base-content">
                  Leaderboard
                </Link>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase tracking-[0.14em] text-base-content/40">Docs</span>
                <a
                  href="https://github.com/reny1cao/chord-arc/blob/main/docs/PROTOCOL.md"
                  target="_blank"
                  rel="noreferrer"
                  className="text-base-content/75 hover:text-base-content"
                >
                  Protocol spec
                </a>
                <a
                  href="https://github.com/reny1cao/chord-arc"
                  target="_blank"
                  rel="noreferrer"
                  className="text-base-content/75 hover:text-base-content"
                >
                  GitHub
                </a>
                <a
                  href="https://github.com/reny1cao/chord-arc/blob/main/docs/HANDOFF.md"
                  target="_blank"
                  rel="noreferrer"
                  className="text-base-content/75 hover:text-base-content"
                >
                  Run a node
                </a>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase tracking-[0.14em] text-base-content/40">Chain</span>
                {ESCROW_ADDRESS && (
                  <a
                    href={`${EXPLORER_BASE}/address/${ESCROW_ADDRESS}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-base-content/75 hover:text-base-content font-mono text-xs"
                  >
                    Escrow ↗
                  </a>
                )}
                <a
                  href="https://www.circle.com/arc"
                  target="_blank"
                  rel="noreferrer"
                  className="text-base-content/75 hover:text-base-content"
                >
                  Arc Testnet
                </a>
                <a
                  href="https://faucet.circle.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-base-content/75 hover:text-base-content"
                >
                  USDC faucet
                </a>
              </div>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-base-300 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-base-content/50">
            <p>© {new Date().getFullYear()} Chord protocol. MIT licensed.</p>
            <p className="font-mono">v0.1 · {targetNetwork.name}</p>
          </div>
        </div>
      </footer>
    </>
  );
};
