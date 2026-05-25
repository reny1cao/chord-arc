/**
 * Seed plausible demo projects on Arc Testnet (or any network with a deployed ChordEscrow).
 *
 * Usage:
 *   node .yarn/releases/yarn-3.2.3.cjs workspace @chord/hardhat \
 *     hardhat run scripts/seed-demo.ts --network arcTestnet
 *
 * Environment:
 *   CHORD_ESCROW_ADDRESS  required — the deployed escrow address
 *   ARC_USDC_ADDRESS      optional — defaults to 0x3600...0000 on Arc Testnet
 *   ARC_SCA_ADDRESSES     comma-separated SCA addresses to assign milestones to
 *                         (e.g. "0xaaa,0xbbb,0xccc"). If absent, milestones are
 *                         created without initial assignees.
 *
 * The deployer wallet must hold enough USDC to fund every project AND
 * have already `approve`d the escrow for the total (the script does the approve).
 */
import { ethers } from "hardhat";

type Project = {
  pm: string;            // address(0) means no PM
  pmFeeBps: number;
  milestones: {
    description: string;
    amountUsdc: number;  // human units; converted to 1e6
    assigneeIdx?: number; // index into ARC_SCA_ADDRESSES
  }[];
};

const DEMO_PROJECTS: Project[] = [
  {
    pm: ethers.ZeroAddress,
    pmFeeBps: 0,
    milestones: [
      { description: "Write a 300-word landing-page hero copy for a privacy-focused note app", amountUsdc: 2, assigneeIdx: 0 },
    ],
  },
  {
    pm: ethers.ZeroAddress,
    pmFeeBps: 0,
    milestones: [
      { description: "Generate a Tailwind landing page (single file) for a productivity tool", amountUsdc: 3, assigneeIdx: 0 },
      { description: "Add a pricing section with 3 tiers to the landing page", amountUsdc: 2, assigneeIdx: 1 },
    ],
  },
  {
    pm: ethers.ZeroAddress,
    pmFeeBps: 0,
    milestones: [
      { description: "Audit this README.md for typos and inconsistent voice; output a unified diff", amountUsdc: 1, assigneeIdx: 2 },
    ],
  },
  {
    pm: ethers.ZeroAddress,
    pmFeeBps: 0,
    milestones: [
      { description: "Write a Python script that fetches the latest 10 ETH USD prices from Coingecko and prints them", amountUsdc: 2, assigneeIdx: 0 },
      { description: "Add a CLI flag --csv to that script that outputs CSV instead of pretty-print", amountUsdc: 2, assigneeIdx: 1 },
    ],
  },
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
];

async function main() {
  const escrowAddress = process.env.CHORD_ESCROW_ADDRESS;
  if (!escrowAddress) throw new Error("CHORD_ESCROW_ADDRESS not set");

  const usdcAddress = process.env.ARC_USDC_ADDRESS || "0x3600000000000000000000000000000000000000";

  const scaList = (process.env.ARC_SCA_ADDRESSES || "")
    .split(",")
    .map(s => s.trim())
    .filter(s => s.startsWith("0x"));
  if (scaList.length === 0) {
    console.log("[seed] no ARC_SCA_ADDRESSES — milestones will be created with no assignees (you can assign later from the UI)");
  } else {
    console.log(`[seed] assigning milestones to ${scaList.length} SCAs: ${scaList.join(", ")}`);
  }

  const [deployer] = await ethers.getSigners();
  console.log(`[seed] deployer: ${deployer.address}`);

  const escrow = await ethers.getContractAt("ChordEscrow", escrowAddress, deployer);
  const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, deployer);

  // Total to spend
  const totalUsdcHuman = DEMO_PROJECTS.reduce(
    (acc, p) => acc + p.milestones.reduce((a, m) => a + m.amountUsdc, 0),
    0,
  );
  const totalUsdc = ethers.parseUnits(totalUsdcHuman.toString(), 6);

  const balance: bigint = await usdc.balanceOf(deployer.address);
  console.log(`[seed] deployer USDC: ${ethers.formatUnits(balance, 6)}  / need: ${totalUsdcHuman}`);
  if (balance < totalUsdc) {
    throw new Error(
      `Insufficient USDC. Top up via faucet.circle.com or send from another wallet, then re-run.`,
    );
  }

  // Single bulk approval for the whole batch
  const allowance: bigint = await usdc.allowance(deployer.address, escrowAddress);
  if (allowance < totalUsdc) {
    console.log(`[seed] approving escrow for ${totalUsdcHuman} USDC...`);
    const tx = await usdc.approve(escrowAddress, totalUsdc);
    await tx.wait();
    console.log(`[seed] approval tx: ${tx.hash}`);
  }

  // Create each project
  for (let i = 0; i < DEMO_PROJECTS.length; i++) {
    const p = DEMO_PROJECTS[i];
    const descriptions = p.milestones.map(m => m.description);
    const amounts = p.milestones.map(m => ethers.parseUnits(m.amountUsdc.toString(), 6));
    const assignees = p.milestones.map(m => {
      if (m.assigneeIdx === undefined || scaList.length === 0) return ethers.ZeroAddress;
      return scaList[m.assigneeIdx % scaList.length];
    });

    console.log(
      `[seed] project ${i}: ${p.milestones.length} milestone(s), ${p.milestones.reduce((a, m) => a + m.amountUsdc, 0)} USDC`,
    );
    const tx = await escrow.createProject("", p.pm, p.pmFeeBps, descriptions, amounts, assignees);
    const receipt = await tx.wait();
    console.log(`  tx: ${tx.hash}  (block ${receipt?.blockNumber})`);
  }

  const count = await escrow.projectCount();
  console.log(`\n[seed] done. ChordEscrow now has ${count} projects total.`);
  console.log(`[seed] view on arcscan: https://testnet.arcscan.app/address/${escrowAddress}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
