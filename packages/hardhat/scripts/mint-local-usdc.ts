import { ethers, deployments, network } from "hardhat";

const USDC_DECIMALS = 6;
const LOCAL_NETWORKS = new Set(["hardhat", "localhost"]);

async function resolveLocalUsdcAddress() {
  try {
    const mock = await deployments.get("MockUSDC");
    return mock.address;
  } catch {
    const escrow = await deployments.get("ChordEscrow");
    const chordEscrow = await ethers.getContractAt("ChordEscrow", escrow.address);
    return chordEscrow.usdc();
  }
}

async function main() {
  if (!LOCAL_NETWORKS.has(network.name)) {
    throw new Error(`mint-local-usdc only runs on hardhat/localhost, got "${network.name}"`);
  }

  const [deployer] = await ethers.getSigners();
  const recipient = process.env.LOCAL_USDC_TO || (await deployer.getAddress());
  const amount = process.env.LOCAL_USDC_AMOUNT || "1000";
  const parsedAmount = ethers.parseUnits(amount, USDC_DECIMALS);
  const usdcAddress = await resolveLocalUsdcAddress();
  const usdc = await ethers.getContractAt("MockUSDC", usdcAddress);

  console.log(`[mint-local-usdc] minting ${amount} USDC to ${recipient} on ${network.name}`);
  const tx = await usdc.mint(recipient, parsedAmount);
  await tx.wait();

  const balance = await usdc.balanceOf(recipient);
  const symbol = await usdc.symbol();
  console.log(`[mint-local-usdc] ${recipient} balance: ${ethers.formatUnits(balance, USDC_DECIMALS)} ${symbol}`);
  console.log(`[mint-local-usdc] token: ${usdcAddress}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
