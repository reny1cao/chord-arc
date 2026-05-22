import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * Known USDC token addresses per chain. Arc Testnet's USDC is at the system address
 * 0x3600...0000 — verified standard ERC-20 (6 decimals).
 *
 * For any other chain, pass `USDC_ADDRESS` via env to override.
 *   USDC_ADDRESS=0x... yarn deploy --network <name>
 */
const KNOWN_USDC: Record<string, string> = {
  arcTestnet: "0x3600000000000000000000000000000000000000",
  // Base Sepolia (Circle official testnet USDC)
  baseSepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  // Arbitrum Sepolia
  arbitrumSepolia: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
};

const deployChordEscrow: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;
  const network = hre.network.name;

  // Local network: deploy a MockUSDC so the contract can be exercised end-to-end.
  let usdcAddress = process.env.USDC_ADDRESS || KNOWN_USDC[network];

  if (!usdcAddress) {
    if (network === "hardhat" || network === "localhost") {
      console.log("[deploy] No known USDC for", network, "— deploying MockUSDC for local testing");
      const mock = await deploy("MockUSDC", {
        from: deployer,
        contract: "MockUSDC",
        args: ["Mock USDC", "USDC", 6],
        log: true,
        autoMine: true,
      });
      usdcAddress = mock.address;
    } else {
      throw new Error(
        `No USDC address known for network "${network}". Set USDC_ADDRESS env var or add to KNOWN_USDC.`,
      );
    }
  }

  console.log(`[deploy] Deploying ChordEscrow with USDC = ${usdcAddress} on ${network}`);

  await deploy("ChordEscrow", {
    from: deployer,
    args: [usdcAddress],
    log: true,
    autoMine: true,
  });

  const chordEscrow = await hre.ethers.getContract<any>("ChordEscrow", deployer);
  console.log("[deploy] ChordEscrow deployed at:", await chordEscrow.getAddress());
};

export default deployChordEscrow;
deployChordEscrow.tags = ["ChordEscrow"];
