import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { ChordEscrow, MockUSDC } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * ChordEscrow tests — USDC milestone escrow on Circle Arc.
 *
 * Notes on adaptation from the upstream ProjectEscrow tests:
 *   - Value layer is IERC20 (USDC, 6 decimals), not native ETH. We use MockUSDC for
 *     local testing; the client must approve the escrow before createProject pulls
 *     the funds via safeTransferFrom.
 *   - Balance assertions use `changeTokenBalances` instead of provider.getBalance to
 *     dodge gas-cost accounting.
 *   - Realistic amounts are USDC(100) / USDC(250) — well above the 1 USDC minimum.
 */
describe("ChordEscrow", function () {
  // 6-decimal USDC helper
  const usdc = (n: number | bigint) => ethers.parseUnits(n.toString(), 6);

  const PM_FEE_BPS = 500n; // 5%
  const BPS_DENOMINATOR = 10000n;
  const DAY = 24 * 60 * 60;
  const TIMEOUT_PERIOD = 14 * DAY;
  const ASSIGNMENT_TIMEOUT = 7 * DAY;
  const EMERGENCY_TIMEOUT = TIMEOUT_PERIOD * 2; // 28 days from createdAt

  // Standard milestone amounts used in many tests
  const M1 = usdc(100);
  const M2 = usdc(250);
  const TOTAL = M1 + M2;

  // ─────────────────────────────────────────────────────────────────────────────
  // Fixtures
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Base fixture: deploy MockUSDC + ChordEscrow, mint a fat USDC bag to client
   * and client2 (so we have a second funded client for multi-project tests).
   */
  async function deployFixture() {
    const [deployer, client, client2, worker1, worker2, pm, other] = await ethers.getSigners();

    const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
    const mockUsdc = (await MockUSDCFactory.deploy("Mock USDC", "USDC", 6)) as unknown as MockUSDC;
    await mockUsdc.waitForDeployment();

    const ChordEscrowFactory = await ethers.getContractFactory("ChordEscrow");
    const escrow = (await ChordEscrowFactory.deploy(await mockUsdc.getAddress())) as unknown as ChordEscrow;
    await escrow.waitForDeployment();

    // Mint 1,000,000 USDC to both clients for headroom across the suite.
    const bag = usdc(1_000_000);
    await mockUsdc.mint(client.address, bag);
    await mockUsdc.mint(client2.address, bag);

    return { deployer, client, client2, worker1, worker2, pm, other, mockUsdc, escrow };
  }

  /** Fixture with one already-created project: 2 milestones, no initial assignees, PM @ 5% fee. */
  async function createdProjectFixture() {
    const base = await deployFixture();
    const { client, pm, mockUsdc, escrow } = base;

    await mockUsdc.connect(client).approve(await escrow.getAddress(), TOTAL);
    await escrow
      .connect(client)
      .createProject("", pm.address, PM_FEE_BPS, ["Design", "Build"], [M1, M2], []);

    return base;
  }

  /** Fixture: project with 1 milestone, initial assignee = worker1, accepted state. */
  async function acceptedMilestoneFixture() {
    const base = await deployFixture();
    const { client, worker1, pm, mockUsdc, escrow } = base;

    await mockUsdc.connect(client).approve(await escrow.getAddress(), M1);
    await escrow
      .connect(client)
      .createProject("", pm.address, PM_FEE_BPS, ["Task 1"], [M1], [worker1.address]);
    await escrow.connect(worker1).acceptMilestone(0, 0);

    return base;
  }

  /** Fixture: project with 1 milestone, worker1 has submitted work. */
  async function submittedMilestoneFixture() {
    const base = await acceptedMilestoneFixture();
    await base.escrow.connect(base.worker1).submitMilestone(0, 0, "ipfs://deliverable");
    return base;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Deployment / Setup
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("Should initialize with zero project count", async function () {
      const { escrow } = await loadFixture(deployFixture);
      expect(await escrow.projectCount()).to.equal(0);
    });

    it("Should expose the USDC token address", async function () {
      const { escrow, mockUsdc } = await loadFixture(deployFixture);
      expect(await escrow.usdc()).to.equal(await mockUsdc.getAddress());
    });

    it("Should have correct constants", async function () {
      const { escrow } = await loadFixture(deployFixture);
      expect(await escrow.MAX_PM_FEE_BPS()).to.equal(2000);
      expect(await escrow.ASSIGNMENT_TIMEOUT()).to.equal(ASSIGNMENT_TIMEOUT);
      expect(await escrow.TIMEOUT_PERIOD()).to.equal(TIMEOUT_PERIOD);
      expect(await escrow.MIN_MILESTONE_AMOUNT()).to.equal(usdc(1));
      expect(await escrow.BPS_DENOMINATOR()).to.equal(BPS_DENOMINATOR);
    });

    it("Should reject deployment with zero USDC address", async function () {
      const ChordEscrowFactory = await ethers.getContractFactory("ChordEscrow");
      await expect(ChordEscrowFactory.deploy(ethers.ZeroAddress)).to.be.revertedWith(
        "USDC address required",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. createProject — happy path
  // ─────────────────────────────────────────────────────────────────────────────

  describe("createProject — happy path", function () {
    it("Should pull USDC from client and credit the escrow", async function () {
      const { client, pm, mockUsdc, escrow } = await loadFixture(deployFixture);
      await mockUsdc.connect(client).approve(await escrow.getAddress(), TOTAL);

      await expect(
        escrow.connect(client).createProject("", pm.address, PM_FEE_BPS, ["A", "B"], [M1, M2], []),
      ).to.changeTokenBalances(mockUsdc, [client, escrow], [-TOTAL, TOTAL]);
    });

    it("Should emit ProjectCreated with the correct args", async function () {
      const { client, pm, mockUsdc, escrow } = await loadFixture(deployFixture);
      await mockUsdc.connect(client).approve(await escrow.getAddress(), TOTAL);

      await expect(
        escrow.connect(client).createProject("", pm.address, PM_FEE_BPS, ["A", "B"], [M1, M2], []),
      )
        .to.emit(escrow, "ProjectCreated")
        .withArgs(0, client.address, pm.address, PM_FEE_BPS, TOTAL, 2, "");
    });

    it("Should increment projectCount and store project state", async function () {
      const { escrow, client, pm } = await loadFixture(createdProjectFixture);
      expect(await escrow.projectCount()).to.equal(1);

      const project = await escrow.getProject(0);
      expect(project.client).to.equal(client.address);
      expect(project.pm).to.equal(pm.address);
      expect(project.pmFeeBps).to.equal(PM_FEE_BPS);
      expect(project.totalAmount).to.equal(TOTAL);
      expect(project.active).to.equal(true);
      expect(project.milestoneCount).to.equal(2);
    });

    it("Should create project with initial assignees and emit per-milestone events", async function () {
      const { client, pm, worker1, worker2, mockUsdc, escrow } = await loadFixture(deployFixture);
      await mockUsdc.connect(client).approve(await escrow.getAddress(), TOTAL);

      const tx = escrow
        .connect(client)
        .createProject(
          "",
          pm.address,
          PM_FEE_BPS,
          ["A", "B"],
          [M1, M2],
          [worker1.address, worker2.address],
        );

      await expect(tx)
        .to.emit(escrow, "MilestoneAssigned")
        .withArgs(0, 0, worker1.address, client.address)
        .and.to.emit(escrow, "MilestoneAssigned")
        .withArgs(0, 1, worker2.address, client.address);

      const m0 = await escrow.getMilestone(0, 0);
      const m1 = await escrow.getMilestone(0, 1);
      expect(m0.assignee).to.equal(worker1.address);
      expect(m0.status).to.equal(1); // Assigned
      expect(m1.assignee).to.equal(worker2.address);
      expect(m1.status).to.equal(1); // Assigned
    });

    it("Should allow project with no PM (pmFeeBps must be 0)", async function () {
      const { client, mockUsdc, escrow } = await loadFixture(deployFixture);
      await mockUsdc.connect(client).approve(await escrow.getAddress(), M1);
      await escrow.connect(client).createProject("", ethers.ZeroAddress, 0, ["Solo"], [M1], []);

      const project = await escrow.getProject(0);
      expect(project.pm).to.equal(ethers.ZeroAddress);
      expect(project.pmFeeBps).to.equal(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. createProject — reverts
  // ─────────────────────────────────────────────────────────────────────────────

  describe("createProject — reverts", function () {
    it("Should revert when client has not approved escrow", async function () {
      const { client, pm, escrow } = await loadFixture(deployFixture);
      // OZ v5 SafeERC20 wraps the underlying ERC20InsufficientAllowance custom error.
      await expect(
        escrow.connect(client).createProject("", pm.address, PM_FEE_BPS, ["A"], [M1], []),
      ).to.be.reverted;
    });

    it("Should revert when allowance is too small", async function () {
      const { client, pm, mockUsdc, escrow } = await loadFixture(deployFixture);
      await mockUsdc.connect(client).approve(await escrow.getAddress(), M1 - 1n);
      await expect(
        escrow.connect(client).createProject("", pm.address, PM_FEE_BPS, ["A"], [M1], []),
      ).to.be.reverted;
    });

    it("Should revert on array length mismatch (descriptions vs amounts)", async function () {
      const { client, pm, mockUsdc, escrow } = await loadFixture(deployFixture);
      await mockUsdc.connect(client).approve(await escrow.getAddress(), TOTAL);
      await expect(
        escrow.connect(client).createProject("", pm.address, PM_FEE_BPS, ["A", "B"], [M1], []),
      ).to.be.revertedWith("Array length mismatch");
    });

    it("Should revert on initial assignees length mismatch", async function () {
      const { client, pm, worker1, mockUsdc, escrow } = await loadFixture(deployFixture);
      await mockUsdc.connect(client).approve(await escrow.getAddress(), TOTAL);
      await expect(
        escrow
          .connect(client)
          .createProject("", pm.address, PM_FEE_BPS, ["A", "B"], [M1, M2], [worker1.address]),
      ).to.be.revertedWith("Assignees array length mismatch");
    });

    it("Should revert on empty milestones", async function () {
      const { client, pm, mockUsdc, escrow } = await loadFixture(deployFixture);
      await mockUsdc.connect(client).approve(await escrow.getAddress(), TOTAL);
      await expect(
        escrow.connect(client).createProject("", pm.address, PM_FEE_BPS, [], [], []),
      ).to.be.revertedWith("Need at least one milestone");
    });

    it("Should revert when amount < MIN_MILESTONE_AMOUNT (1 USDC)", async function () {
      const { client, pm, mockUsdc, escrow } = await loadFixture(deployFixture);
      const tiny = usdc(1) - 1n; // 0.999999 USDC — one wei under min
      await mockUsdc.connect(client).approve(await escrow.getAddress(), tiny);
      await expect(
        escrow.connect(client).createProject("", pm.address, PM_FEE_BPS, ["A"], [tiny], []),
      ).to.be.revertedWith("Amount too small");
    });

    it("Should revert when pmFeeBps > MAX_PM_FEE_BPS (2000 = 20%)", async function () {
      const { client, pm, mockUsdc, escrow } = await loadFixture(deployFixture);
      await mockUsdc.connect(client).approve(await escrow.getAddress(), M1);
      await expect(
        escrow.connect(client).createProject("", pm.address, 2001, ["A"], [M1], []),
      ).to.be.revertedWith("PM fee too high");
    });

    it("Should revert when client is also the PM", async function () {
      const { client, mockUsdc, escrow } = await loadFixture(deployFixture);
      await mockUsdc.connect(client).approve(await escrow.getAddress(), M1);
      await expect(
        escrow.connect(client).createProject("", client.address, PM_FEE_BPS, ["A"], [M1], []),
      ).to.be.revertedWith("Client cannot be PM");
    });

    it("Should revert when client is also an initial assignee", async function () {
      const { client, pm, mockUsdc, escrow } = await loadFixture(deployFixture);
      await mockUsdc.connect(client).approve(await escrow.getAddress(), M1);
      await expect(
        escrow
          .connect(client)
          .createProject("", pm.address, PM_FEE_BPS, ["A"], [M1], [client.address]),
      ).to.be.revertedWith("Client cannot be assignee");
    });

    it("Should revert when PM is set as an initial assignee", async function () {
      const { client, pm, mockUsdc, escrow } = await loadFixture(deployFixture);
      await mockUsdc.connect(client).approve(await escrow.getAddress(), M1);
      await expect(
        escrow
          .connect(client)
          .createProject("", pm.address, PM_FEE_BPS, ["A"], [M1], [pm.address]),
      ).to.be.revertedWith("PM cannot be assignee");
    });

    it("Should revert on empty description", async function () {
      const { client, pm, mockUsdc, escrow } = await loadFixture(deployFixture);
      await mockUsdc.connect(client).approve(await escrow.getAddress(), M1);
      await expect(
        escrow.connect(client).createProject("", pm.address, PM_FEE_BPS, [""], [M1], []),
      ).to.be.revertedWith("Description required");
    });

    it("Should revert when description > 500 chars", async function () {
      const { client, pm, mockUsdc, escrow } = await loadFixture(deployFixture);
      await mockUsdc.connect(client).approve(await escrow.getAddress(), M1);
      const tooLong = "x".repeat(501);
      await expect(
        escrow.connect(client).createProject("", pm.address, PM_FEE_BPS, [tooLong], [M1], []),
      ).to.be.revertedWith("Description too long");
    });

    it("Should revert when fee set without PM", async function () {
      const { client, mockUsdc, escrow } = await loadFixture(deployFixture);
      await mockUsdc.connect(client).approve(await escrow.getAddress(), M1);
      await expect(
        escrow
          .connect(client)
          .createProject("", ethers.ZeroAddress, PM_FEE_BPS, ["A"], [M1], []),
      ).to.be.revertedWith("Cannot set fee without PM");
    });

    it("Should revert when contractURI > 256 bytes", async function () {
      const { client, pm, mockUsdc, escrow } = await loadFixture(deployFixture);
      await mockUsdc.connect(client).approve(await escrow.getAddress(), M1);
      const tooLongURI = "x".repeat(257);
      await expect(
        escrow.connect(client).createProject(tooLongURI, pm.address, PM_FEE_BPS, ["A"], [M1], []),
      ).to.be.revertedWith("URI too long");
    });

    it("Should accept and store a valid contractURI", async function () {
      const { client, pm, mockUsdc, escrow } = await loadFixture(deployFixture);
      await mockUsdc.connect(client).approve(await escrow.getAddress(), M1);
      const uri = "chord://" + "a".repeat(64);
      await expect(
        escrow.connect(client).createProject(uri, pm.address, PM_FEE_BPS, ["A"], [M1], []),
      )
        .to.emit(escrow, "ProjectCreated")
        .withArgs(0, client.address, pm.address, PM_FEE_BPS, M1, 1, uri);

      const project = await escrow.getProject(0);
      expect(project.contractURI).to.equal(uri);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Assignment lifecycle
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Assignment lifecycle", function () {
    it("Should allow client to assign a Created milestone", async function () {
      const { client, worker1, escrow } = await loadFixture(createdProjectFixture);
      await expect(escrow.connect(client).assignMilestone(0, 0, worker1.address))
        .to.emit(escrow, "MilestoneAssigned")
        .withArgs(0, 0, worker1.address, client.address);

      const m = await escrow.getMilestone(0, 0);
      expect(m.assignee).to.equal(worker1.address);
      expect(m.status).to.equal(1); // Assigned
    });

    it("Should allow PM to assign a Created milestone", async function () {
      const { pm, worker1, escrow } = await loadFixture(createdProjectFixture);
      await expect(escrow.connect(pm).assignMilestone(0, 0, worker1.address))
        .to.emit(escrow, "MilestoneAssigned")
        .withArgs(0, 0, worker1.address, pm.address);
    });

    it("Should reject assignment by a third party (not client or PM)", async function () {
      const { other, worker1, escrow } = await loadFixture(createdProjectFixture);
      await expect(
        escrow.connect(other).assignMilestone(0, 0, worker1.address),
      ).to.be.revertedWith("Only client or PM");
    });

    it("Should let assignee accept and stamp acceptedAt", async function () {
      const { client, worker1, escrow } = await loadFixture(createdProjectFixture);
      await escrow.connect(client).assignMilestone(0, 0, worker1.address);

      await expect(escrow.connect(worker1).acceptMilestone(0, 0))
        .to.emit(escrow, "MilestoneAccepted")
        .withArgs(0, 0, worker1.address);

      const ts = await escrow.getMilestoneTimestamps(0, 0);
      expect(ts.acceptedAt).to.be.gt(0);
    });

    it("Should let assignee decline and reset to Created", async function () {
      const { client, worker1, escrow } = await loadFixture(createdProjectFixture);
      await escrow.connect(client).assignMilestone(0, 0, worker1.address);

      await expect(escrow.connect(worker1).declineMilestone(0, 0, "Conflict"))
        .to.emit(escrow, "MilestoneDeclined")
        .withArgs(0, 0, worker1.address, "Conflict");

      const m = await escrow.getMilestone(0, 0);
      expect(m.assignee).to.equal(ethers.ZeroAddress);
      expect(m.status).to.equal(0); // Created
    });

    it("Should let client unassign from Assigned status", async function () {
      const { client, worker1, escrow } = await loadFixture(createdProjectFixture);
      await escrow.connect(client).assignMilestone(0, 0, worker1.address);

      await expect(escrow.connect(client).unassignMilestone(0, 0))
        .to.emit(escrow, "MilestoneUnassigned")
        .withArgs(0, 0, worker1.address);

      const m = await escrow.getMilestone(0, 0);
      expect(m.status).to.equal(0);
    });

    it("Should reject unassign once the assignee has accepted", async function () {
      const { client, worker1, escrow } = await loadFixture(createdProjectFixture);
      await escrow.connect(client).assignMilestone(0, 0, worker1.address);
      await escrow.connect(worker1).acceptMilestone(0, 0);

      await expect(escrow.connect(client).unassignMilestone(0, 0)).to.be.revertedWith(
        "Can only unassign from Assigned status",
      );
    });

    it("Should allow anyone to expireAssignment after ASSIGNMENT_TIMEOUT (7 days)", async function () {
      const { client, worker1, other, escrow } = await loadFixture(createdProjectFixture);
      await escrow.connect(client).assignMilestone(0, 0, worker1.address);

      // Just before — should fail
      await time.increase(ASSIGNMENT_TIMEOUT - 60);
      await expect(escrow.connect(other).expireAssignment(0, 0)).to.be.revertedWith(
        "Assignment not expired",
      );

      // Cross the threshold — should succeed for an arbitrary caller
      await time.increase(120);
      await expect(escrow.connect(other).expireAssignment(0, 0))
        .to.emit(escrow, "MilestoneUnassigned")
        .withArgs(0, 0, worker1.address);

      const m = await escrow.getMilestone(0, 0);
      expect(m.status).to.equal(0);
      expect(m.assignee).to.equal(ethers.ZeroAddress);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Work flow
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Work flow", function () {
    it("Should transition Accepted → InProgress via startMilestone", async function () {
      const { worker1, escrow } = await loadFixture(acceptedMilestoneFixture);
      await expect(escrow.connect(worker1).startMilestone(0, 0))
        .to.emit(escrow, "MilestoneStarted")
        .withArgs(0, 0);

      const m = await escrow.getMilestone(0, 0);
      expect(m.status).to.equal(3); // InProgress
    });

    it("Should allow submit directly from Accepted (skipping InProgress)", async function () {
      const { worker1, escrow } = await loadFixture(acceptedMilestoneFixture);
      await expect(escrow.connect(worker1).submitMilestone(0, 0, "ipfs://abc"))
        .to.emit(escrow, "MilestoneSubmitted")
        .withArgs(0, 0, "ipfs://abc");

      const m = await escrow.getMilestone(0, 0);
      expect(m.status).to.equal(4); // Submitted
      expect(m.submissionNote).to.equal("ipfs://abc");
    });

    it("Should allow submit from InProgress and store the note", async function () {
      const { worker1, escrow } = await loadFixture(acceptedMilestoneFixture);
      await escrow.connect(worker1).startMilestone(0, 0);
      await escrow.connect(worker1).submitMilestone(0, 0, "arweave://xyz");

      const m = await escrow.getMilestone(0, 0);
      expect(m.status).to.equal(4); // Submitted
      expect(m.submissionNote).to.equal("arweave://xyz");
    });

    it("Should reject submit from non-assignee", async function () {
      const { worker2, escrow } = await loadFixture(acceptedMilestoneFixture);
      await expect(escrow.connect(worker2).submitMilestone(0, 0, "x")).to.be.revertedWith(
        "Only assignee",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. Approval + payout
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Approval and payout", function () {
    it("Should pay assignee (95%) and PM (5%) in USDC and mark Paid", async function () {
      const { client, worker1, pm, mockUsdc, escrow } = await loadFixture(submittedMilestoneFixture);

      const pmFee = (M1 * PM_FEE_BPS) / BPS_DENOMINATOR;
      const assigneeAmount = M1 - pmFee;

      await expect(escrow.connect(client).approveMilestone(0, 0)).to.changeTokenBalances(
        mockUsdc,
        [escrow, worker1, pm],
        [-M1, assigneeAmount, pmFee],
      );

      const m = await escrow.getMilestone(0, 0);
      expect(m.status).to.equal(6); // Paid
    });

    it("Should emit MilestoneApproved and MilestonePaid (autoReleased=false) with correct args", async function () {
      const { client, escrow } = await loadFixture(submittedMilestoneFixture);

      const pmFee = (M1 * PM_FEE_BPS) / BPS_DENOMINATOR;
      const assigneeAmount = M1 - pmFee;

      const tx = escrow.connect(client).approveMilestone(0, 0);
      await expect(tx)
        .to.emit(escrow, "MilestoneApproved")
        .withArgs(0, 0, assigneeAmount, pmFee)
        .and.to.emit(escrow, "MilestonePaid")
        .withArgs(0, 0, M1, false);
    });

    it("Should update totalPaid and totalPmFees on the project", async function () {
      const { client, escrow } = await loadFixture(submittedMilestoneFixture);
      await escrow.connect(client).approveMilestone(0, 0);

      const project = await escrow.getProject(0);
      expect(project.totalPaid).to.equal(M1);
      expect(project.totalPmFees).to.equal((M1 * PM_FEE_BPS) / BPS_DENOMINATOR);
    });

    it("Should reject approval from a non-client (PM or stranger)", async function () {
      const { pm, other, escrow } = await loadFixture(submittedMilestoneFixture);
      await expect(escrow.connect(pm).approveMilestone(0, 0)).to.be.revertedWith("Only client");
      await expect(escrow.connect(other).approveMilestone(0, 0)).to.be.revertedWith("Only client");
    });

    it("Should pay entire amount to assignee when there is no PM", async function () {
      const { client, worker1, mockUsdc, escrow } = await loadFixture(deployFixture);
      await mockUsdc.connect(client).approve(await escrow.getAddress(), M1);
      await escrow
        .connect(client)
        .createProject("", ethers.ZeroAddress, 0, ["Solo"], [M1], [worker1.address]);
      await escrow.connect(worker1).acceptMilestone(0, 0);
      await escrow.connect(worker1).submitMilestone(0, 0, "done");

      await expect(escrow.connect(client).approveMilestone(0, 0)).to.changeTokenBalances(
        mockUsdc,
        [escrow, worker1],
        [-M1, M1],
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. Rejection
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Rejection and resubmission", function () {
    it("Should send Submitted back to InProgress and clear the note", async function () {
      const { client, escrow } = await loadFixture(submittedMilestoneFixture);

      await expect(escrow.connect(client).rejectMilestone(0, 0, "Needs polish"))
        .to.emit(escrow, "MilestoneRejected")
        .withArgs(0, 0, "Needs polish");

      const m = await escrow.getMilestone(0, 0);
      expect(m.status).to.equal(3); // InProgress
      expect(m.submissionNote).to.equal("");
      const ts = await escrow.getMilestoneTimestamps(0, 0);
      expect(ts.submittedAt).to.equal(0);
    });

    it("Should allow resubmission after rejection and a second approve to settle", async function () {
      const { client, worker1, mockUsdc, escrow, pm } = await loadFixture(submittedMilestoneFixture);

      await escrow.connect(client).rejectMilestone(0, 0, "Fix it");
      await escrow.connect(worker1).submitMilestone(0, 0, "ipfs://v2");

      const pmFee = (M1 * PM_FEE_BPS) / BPS_DENOMINATOR;
      const assigneeAmount = M1 - pmFee;

      await expect(escrow.connect(client).approveMilestone(0, 0)).to.changeTokenBalances(
        mockUsdc,
        [worker1, pm],
        [assigneeAmount, pmFee],
      );

      const m = await escrow.getMilestone(0, 0);
      expect(m.status).to.equal(6); // Paid
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. Auto-release
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Auto-release after TIMEOUT_PERIOD", function () {
    it("Should reject release before TIMEOUT_PERIOD has elapsed", async function () {
      const { other, escrow } = await loadFixture(submittedMilestoneFixture);
      await time.increase(TIMEOUT_PERIOD - 60);
      await expect(escrow.connect(other).releaseMilestone(0, 0)).to.be.revertedWith(
        "Not ready to auto-release",
      );
    });

    it("Should let any caller release once TIMEOUT_PERIOD passes and pay both parties", async function () {
      const { other, worker1, pm, mockUsdc, escrow } = await loadFixture(submittedMilestoneFixture);
      await time.increase(TIMEOUT_PERIOD + 1);

      const pmFee = (M1 * PM_FEE_BPS) / BPS_DENOMINATOR;
      const assigneeAmount = M1 - pmFee;

      await expect(escrow.connect(other).releaseMilestone(0, 0)).to.changeTokenBalances(
        mockUsdc,
        [escrow, worker1, pm],
        [-M1, assigneeAmount, pmFee],
      );
    });

    it("Should emit MilestonePaid with autoReleased=true", async function () {
      const { other, escrow } = await loadFixture(submittedMilestoneFixture);
      await time.increase(TIMEOUT_PERIOD + 1);

      await expect(escrow.connect(other).releaseMilestone(0, 0))
        .to.emit(escrow, "MilestonePaid")
        .withArgs(0, 0, M1, true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. Cancel project
  // ─────────────────────────────────────────────────────────────────────────────

  describe("cancelProject", function () {
    it("Should refund all unstarted milestones to the client", async function () {
      const { client, mockUsdc, escrow } = await loadFixture(createdProjectFixture);
      // All milestones are still Created — full refund expected.
      // Note: changeTokenBalances cannot be chained after emit (hardhat-chai-matchers
      // disallows chaining two async matchers), so assert them separately on two calls.
      await expect(escrow.connect(client).cancelProject(0)).to.changeTokenBalances(
        mockUsdc,
        [escrow, client],
        [-TOTAL, TOTAL],
      );

      const project = await escrow.getProject(0);
      expect(project.active).to.equal(false);
    });

    it("Should emit ProjectCancelled with the refund amount", async function () {
      const { client, escrow } = await loadFixture(createdProjectFixture);
      await expect(escrow.connect(client).cancelProject(0))
        .to.emit(escrow, "ProjectCancelled")
        .withArgs(0, TOTAL);
    });

    it("Should revert cancel when any milestone is Submitted", async function () {
      const { client, worker1, escrow } = await loadFixture(createdProjectFixture);
      // Assign + accept + submit milestone 0 to lock the project from cancellation.
      await escrow.connect(client).assignMilestone(0, 0, worker1.address);
      await escrow.connect(worker1).acceptMilestone(0, 0);
      await escrow.connect(worker1).submitMilestone(0, 0, "done");

      await expect(escrow.connect(client).cancelProject(0)).to.be.revertedWith(
        "Cannot cancel with submitted or approved milestones",
      );
    });

    it("Should reject cancel from non-client", async function () {
      const { other, escrow } = await loadFixture(createdProjectFixture);
      await expect(escrow.connect(other).cancelProject(0)).to.be.revertedWith("Only client");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 10. Emergency reclaim
  // ─────────────────────────────────────────────────────────────────────────────

  describe("emergencyReclaim", function () {
    it("Should refund a Created milestone to client after 28 days from createdAt", async function () {
      const { client, mockUsdc, escrow } = await loadFixture(createdProjectFixture);

      await time.increase(EMERGENCY_TIMEOUT + 1);
      await expect(escrow.connect(client).emergencyReclaim(0, 0)).to.changeTokenBalances(
        mockUsdc,
        [escrow, client],
        [-M1, M1],
      );

      const m = await escrow.getMilestone(0, 0);
      expect(m.status).to.equal(6); // Paid (used as terminal flag)
    });

    it("Should refund an Accepted milestone too (still pre-Submitted)", async function () {
      const { client, mockUsdc, escrow } = await loadFixture(acceptedMilestoneFixture);

      await time.increase(EMERGENCY_TIMEOUT + 1);
      await expect(escrow.connect(client).emergencyReclaim(0, 0)).to.changeTokenBalances(
        mockUsdc,
        [escrow, client],
        [-M1, M1],
      );
    });

    it("Should reject reclaim before the emergency timeout", async function () {
      const { client, escrow } = await loadFixture(createdProjectFixture);
      await time.increase(EMERGENCY_TIMEOUT - 60);
      await expect(escrow.connect(client).emergencyReclaim(0, 0)).to.be.revertedWith(
        "Emergency timeout not reached",
      );
    });

    it("Should reject reclaim of a Submitted milestone (worker has delivered)", async function () {
      const { client, escrow } = await loadFixture(submittedMilestoneFixture);
      await time.increase(EMERGENCY_TIMEOUT + 1);
      await expect(escrow.connect(client).emergencyReclaim(0, 0)).to.be.revertedWith(
        "Cannot reclaim approved or submitted milestone",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 11. Views
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Views", function () {
    it("getAllMilestones should return parallel arrays for each milestone", async function () {
      const { escrow } = await loadFixture(createdProjectFixture);
      const all = await escrow.getAllMilestones(0);
      expect(all.descriptions.length).to.equal(2);
      expect(all.descriptions[0]).to.equal("Design");
      expect(all.descriptions[1]).to.equal("Build");
      expect(all.amounts[0]).to.equal(M1);
      expect(all.amounts[1]).to.equal(M2);
      expect(all.assignees[0]).to.equal(ethers.ZeroAddress);
      expect(all.statuses[0]).to.equal(0); // Created
    });

    it("getProjectStats should reflect assigned, accepted, and paid counts as work progresses", async function () {
      const { client, worker1, worker2, escrow } = await loadFixture(createdProjectFixture);

      // Both milestones still Created
      let stats = await escrow.getProjectStats(0);
      expect(stats.totalMilestones).to.equal(2);
      expect(stats.assignedMilestones).to.equal(0);
      expect(stats.acceptedMilestones).to.equal(0);
      expect(stats.paidMilestones).to.equal(0);
      expect(stats.remainingAmount).to.equal(TOTAL);

      // Assign both, accept one
      await escrow.connect(client).assignMilestone(0, 0, worker1.address);
      await escrow.connect(client).assignMilestone(0, 1, worker2.address);
      await escrow.connect(worker1).acceptMilestone(0, 0);

      stats = await escrow.getProjectStats(0);
      // Note: assignedMilestones in the contract only counts milestones currently in
      // Assigned status — once worker1 accepted, m0 leaves Assigned bucket.
      expect(stats.assignedMilestones).to.equal(1);
      expect(stats.acceptedMilestones).to.equal(1);
    });

    it("getAddressRole should surface client / PM / assignee membership", async function () {
      const { client, pm, worker1, other, mockUsdc, escrow } = await loadFixture(deployFixture);

      await mockUsdc.connect(client).approve(await escrow.getAddress(), TOTAL);
      await escrow
        .connect(client)
        .createProject(
          "",
          pm.address,
          PM_FEE_BPS,
          ["A", "B"],
          [M1, M2],
          [worker1.address, worker1.address],
        );

      const clientRole = await escrow.getAddressRole(0, client.address);
      expect(clientRole.isClient).to.equal(true);
      expect(clientRole.isPM).to.equal(false);
      expect(clientRole.assignedMilestones.length).to.equal(0);

      const pmRole = await escrow.getAddressRole(0, pm.address);
      expect(pmRole.isPM).to.equal(true);

      const workerRole = await escrow.getAddressRole(0, worker1.address);
      expect(workerRole.isClient).to.equal(false);
      expect(workerRole.isPM).to.equal(false);
      expect(workerRole.assignedMilestones.length).to.equal(2);
      expect(workerRole.assignedMilestones[0]).to.equal(0);
      expect(workerRole.assignedMilestones[1]).to.equal(1);

      const strangerRole = await escrow.getAddressRole(0, other.address);
      expect(strangerRole.isClient).to.equal(false);
      expect(strangerRole.isPM).to.equal(false);
      expect(strangerRole.assignedMilestones.length).to.equal(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Bonus: full end-to-end integration
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Full workflow integration", function () {
    it("Should run two milestones to settlement with different workers", async function () {
      const { client, pm, worker1, worker2, mockUsdc, escrow } = await loadFixture(deployFixture);

      await mockUsdc.connect(client).approve(await escrow.getAddress(), TOTAL);
      await escrow
        .connect(client)
        .createProject(
          "",
          pm.address,
          PM_FEE_BPS,
          ["Design", "Build"],
          [M1, M2],
          [worker1.address, worker2.address],
        );

      // Worker1 closes M0
      await escrow.connect(worker1).acceptMilestone(0, 0);
      await escrow.connect(worker1).submitMilestone(0, 0, "ipfs://design");
      await escrow.connect(client).approveMilestone(0, 0);

      // Worker2 closes M1
      await escrow.connect(worker2).acceptMilestone(0, 1);
      await escrow.connect(worker2).startMilestone(0, 1);
      await escrow.connect(worker2).submitMilestone(0, 1, "ipfs://build");
      await escrow.connect(client).approveMilestone(0, 1);

      const project = await escrow.getProject(0);
      expect(project.totalPaid).to.equal(TOTAL);
      expect(project.totalPmFees).to.equal((TOTAL * PM_FEE_BPS) / BPS_DENOMINATOR);

      // Escrow should be drained of this project's funds.
      expect(await mockUsdc.balanceOf(await escrow.getAddress())).to.equal(0);
    });
  });
});
