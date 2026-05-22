import which from "which";

export type DiscoveredAgent = {
  name: string;
  path: string;
};

/**
 * Scan PATH for the first available coding-agent CLI, in preference order.
 * Inspired by Open Design's daemon, which auto-detects 16 CLIs on boot.
 *
 * @param opts.override absolute path that bypasses PATH discovery
 * @param opts.candidates preference-ordered list of binary names to look for
 */
export async function discoverAgentCli(opts: {
  override?: string;
  candidates: readonly string[];
}): Promise<DiscoveredAgent | null> {
  if (opts.override) {
    return { name: opts.override.split("/").pop() || "custom", path: opts.override };
  }
  for (const name of opts.candidates) {
    const found = await which(name, { nothrow: true });
    if (found) return { name, path: found };
  }
  return null;
}
