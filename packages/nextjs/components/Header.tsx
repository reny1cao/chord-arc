"use client";

import React, { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { hardhat } from "viem/chains";
import { Bars3Icon, BoltIcon, BugAntIcon, ClipboardDocumentListIcon, TrophyIcon } from "@heroicons/react/24/outline";
import { Logo } from "~~/components/Logo";
import { SwitchTheme } from "~~/components/SwitchTheme";
import { FaucetButton, RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { useOutsideClick, useTargetNetwork } from "~~/hooks/scaffold-eth";
import { arcTestnet } from "~~/scaffold.config";

type HeaderMenuLink = {
  label: string;
  href: string;
  icon?: React.ReactNode;
};

export const menuLinks: HeaderMenuLink[] = [
  {
    label: "Projects",
    href: "/projects",
    icon: <ClipboardDocumentListIcon className="h-4 w-4" />,
  },
  {
    label: "Leaderboard",
    href: "/leaderboard",
    icon: <TrophyIcon className="h-4 w-4" />,
  },
  {
    label: "Try it",
    href: "/try",
    icon: <BoltIcon className="h-4 w-4" />,
  },
  {
    label: "Debug",
    href: "/debug",
    icon: <BugAntIcon className="h-4 w-4" />,
  },
];

export const HeaderMenuLinks = () => {
  const pathname = usePathname();

  return (
    <>
      {menuLinks.map(({ label, href, icon }) => {
        const isActive = pathname === href || (href !== "/" && pathname.startsWith(href));
        return (
          <li key={href}>
            <Link
              href={href}
              passHref
              className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                isActive
                  ? "text-base-content bg-base-200"
                  : "text-base-content/70 hover:text-base-content hover:bg-base-200/60"
              }`}
            >
              {icon}
              <span>{label}</span>
            </Link>
          </li>
        );
      })}
    </>
  );
};

/**
 * Site header — sticky glass navbar with logo, nav links, wallet, theme toggle.
 */
export const Header = () => {
  const { targetNetwork } = useTargetNetwork();
  const isLocalNetwork = targetNetwork.id === hardhat.id;
  const isArc = targetNetwork.id === arcTestnet.id;

  const burgerMenuRef = useRef<HTMLDetailsElement>(null);
  useOutsideClick(burgerMenuRef, () => {
    burgerMenuRef?.current?.removeAttribute("open");
  });

  return (
    <header className="sticky top-0 z-30 glass">
      <div className="max-w-7xl mx-auto flex items-center justify-between px-4 sm:px-6 lg:px-8 h-14">
        {/* Left: logo + desktop nav */}
        <div className="flex items-center gap-2">
          <details className="dropdown lg:hidden" ref={burgerMenuRef}>
            <summary className="btn btn-ghost btn-sm px-2 hover:bg-base-200">
              <Bars3Icon className="h-5 w-5" />
            </summary>
            <ul
              className="menu dropdown-content mt-2 p-2 bg-base-100 border border-base-300 rounded-xl shadow-lift w-56 z-40"
              onClick={() => {
                burgerMenuRef?.current?.removeAttribute("open");
              }}
            >
              <HeaderMenuLinks />
            </ul>
          </details>

          <Link href="/" passHref className="flex items-center gap-2.5 shrink-0">
            <Logo size={28} className="text-primary" />
            <div className="hidden sm:flex flex-col leading-none">
              <span className="font-semibold text-base tracking-tight">Chord</span>
              <span className="text-[10px] uppercase tracking-[0.14em] text-base-content/55">protocol · arc</span>
            </div>
          </Link>

          <nav className="hidden lg:block ml-6">
            <ul className="flex items-center gap-1">
              <HeaderMenuLinks />
            </ul>
          </nav>
        </div>

        {/* Right: status + wallet + theme */}
        <div className="flex items-center gap-2">
          {isArc && (
            <span className="hidden md:inline-flex items-center gap-1.5 text-xs font-medium text-base-content/70 px-2.5 py-1 rounded-full bg-base-200 border border-base-300">
              <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              Arc Testnet
            </span>
          )}
          <RainbowKitCustomConnectButton />
          {isLocalNetwork && <FaucetButton />}
          <SwitchTheme className="ml-1" />
        </div>
      </div>
    </header>
  );
};
