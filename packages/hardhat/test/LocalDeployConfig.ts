import { expect } from "chai";
import { deployments, ethers, network } from "hardhat";

describe("Local deploy config", function () {
  let previousUsdcAddress: string | undefined;

  before(function () {
    if (network.name !== "hardhat" && network.name !== "localhost") {
      this.skip();
    }

    previousUsdcAddress = process.env.USDC_ADDRESS;
    delete process.env.USDC_ADDRESS;
  });

  after(function () {
    if (previousUsdcAddress) {
      process.env.USDC_ADDRESS = previousUsdcAddress;
    } else {
      delete process.env.USDC_ADDRESS;
    }
  });

  beforeEach(async function () {
    await deployments.fixture(["ChordEscrow"]);
  });

  it("deploys MockUSDC and wires ChordEscrow.usdc() to it", async function () {
    const mockUsdcDeployment = await deployments.get("MockUSDC");
    const escrowDeployment = await deployments.get("ChordEscrow");
    const mockUsdc = await ethers.getContractAt("MockUSDC", mockUsdcDeployment.address);
    const escrow = await ethers.getContractAt("ChordEscrow", escrowDeployment.address);

    expect(await mockUsdc.decimals()).to.equal(6);
    expect(await escrow.usdc()).to.equal(mockUsdcDeployment.address);
  });
});
