import React from "react";

interface LogoProps {
  className?: string;
  size?: number;
}

/**
 * Chord mark — three vertical bars of varying heights ("a chord"), set into a
 * solid coral square. Single accent color, no gradient. Crisp at every size.
 */
export const Logo: React.FC<LogoProps> = ({ className = "", size = 28 }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="7" fill="currentColor" />
      <rect x="8" y="14" width="3" height="10" rx="1.5" fill="white" />
      <rect x="14.5" y="8" width="3" height="16" rx="1.5" fill="white" />
      <rect x="21" y="11" width="3" height="13" rx="1.5" fill="white" />
    </svg>
  );
};
