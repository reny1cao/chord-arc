// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ChordEscrow
 * @notice USDC milestone escrow on Circle Arc — per-milestone assignee + explicit accept.
 * @dev Direct port of ProjectEscrow with the value layer swapped from native to IERC20.
 *      USDC on Arc Testnet lives at 0x3600000000000000000000000000000000000000 (6 decimals).
 *
 * State machine (unchanged):
 *   Created → Assigned → Accepted → InProgress → Submitted → Approved → Paid
 *                     ↘ Declined (returns to Created, clears assignee)
 */
contract ChordEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum MilestoneStatus {
        Created,
        Assigned,
        Accepted,
        InProgress,
        Submitted,
        Approved,
        Paid
    }

    struct Milestone {
        string description;
        uint256 amount;
        address assignee;
        uint256 createdAt;
        uint256 assignedAt;
        uint256 acceptedAt;
        uint256 submittedAt;
        MilestoneStatus status;
        string submissionNote;
    }

    struct Project {
        address client;
        address pm;
        uint256 pmFeeBps;
        uint256 totalAmount;
        uint256 totalPaid;
        uint256 totalPmFees;
        bool active;
        string contractURI;
        Milestone[] milestones;
    }

    IERC20 public immutable usdc;

    uint256 public projectCount;
    mapping(uint256 => Project) public projects;

    uint256 public constant TIMEOUT_PERIOD = 14 days;
    uint256 public constant ASSIGNMENT_TIMEOUT = 7 days;
    uint256 public constant MIN_MILESTONE_AMOUNT = 1e6; // 1 USDC (6 decimals)
    uint256 public constant MAX_PM_FEE_BPS = 2000;      // 20%
    uint256 public constant BPS_DENOMINATOR = 10000;

    event ProjectCreated(
        uint256 indexed projectId,
        address indexed client,
        address pm,
        uint256 pmFeeBps,
        uint256 totalAmount,
        uint256 milestoneCount,
        string contractURI
    );

    event MilestoneAssigned(
        uint256 indexed projectId,
        uint256 milestoneIndex,
        address indexed assignee,
        address indexed assignedBy
    );

    event MilestoneAccepted(uint256 indexed projectId, uint256 milestoneIndex, address indexed assignee);
    event MilestoneDeclined(uint256 indexed projectId, uint256 milestoneIndex, address indexed assignee, string reason);
    event MilestoneUnassigned(uint256 indexed projectId, uint256 milestoneIndex, address indexed previousAssignee);
    event MilestoneStarted(uint256 indexed projectId, uint256 milestoneIndex);
    event MilestoneSubmitted(uint256 indexed projectId, uint256 milestoneIndex, string note);
    event MilestoneApproved(uint256 indexed projectId, uint256 milestoneIndex, uint256 assigneeAmount, uint256 pmFee);
    event MilestoneRejected(uint256 indexed projectId, uint256 milestoneIndex, string reason);
    event MilestonePaid(uint256 indexed projectId, uint256 milestoneIndex, uint256 amount, bool autoReleased);
    event ProjectCancelled(uint256 indexed projectId, uint256 refundAmount);

    modifier onlyClient(uint256 projectId) {
        require(msg.sender == projects[projectId].client, "Only client");
        _;
    }

    modifier onlyClientOrPM(uint256 projectId) {
        Project storage project = projects[projectId];
        require(
            msg.sender == project.client || (project.pm != address(0) && msg.sender == project.pm),
            "Only client or PM"
        );
        _;
    }

    modifier onlyAssignee(uint256 projectId, uint256 milestoneIndex) {
        require(msg.sender == projects[projectId].milestones[milestoneIndex].assignee, "Only assignee");
        _;
    }

    modifier projectActive(uint256 projectId) {
        require(projects[projectId].active, "Project not active");
        _;
    }

    modifier validMilestoneIndex(uint256 projectId, uint256 milestoneIndex) {
        require(milestoneIndex < projects[projectId].milestones.length, "Invalid milestone index");
        _;
    }

    constructor(address usdcToken) {
        require(usdcToken != address(0), "USDC address required");
        usdc = IERC20(usdcToken);
    }

    /**
     * @notice Create a project funded with USDC. Caller must `approve` this contract for `total` first.
     */
    function createProject(
        string memory contractURI,
        address pm,
        uint256 pmFeeBps,
        string[] memory descriptions,
        uint256[] memory amounts,
        address[] memory initialAssignees
    ) external returns (uint256) {
        require(bytes(contractURI).length <= 256, "URI too long");
        require(descriptions.length == amounts.length, "Array length mismatch");
        require(descriptions.length > 0, "Need at least one milestone");
        require(descriptions.length <= 50, "Too many milestones");
        require(pmFeeBps <= MAX_PM_FEE_BPS, "PM fee too high");
        require(
            initialAssignees.length == 0 || initialAssignees.length == descriptions.length,
            "Assignees array length mismatch"
        );

        if (pm != address(0)) {
            require(pm != msg.sender, "Client cannot be PM");
        } else {
            require(pmFeeBps == 0, "Cannot set fee without PM");
        }

        uint256 total = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            require(amounts[i] >= MIN_MILESTONE_AMOUNT, "Amount too small");
            require(bytes(descriptions[i]).length > 0, "Description required");
            require(bytes(descriptions[i]).length <= 500, "Description too long");

            if (initialAssignees.length > 0 && initialAssignees[i] != address(0)) {
                require(initialAssignees[i] != msg.sender, "Client cannot be assignee");
                require(initialAssignees[i] != pm, "PM cannot be assignee");
            }

            total += amounts[i];
        }

        // Pull USDC from client. Reverts if approval missing or balance insufficient.
        usdc.safeTransferFrom(msg.sender, address(this), total);

        uint256 projectId = projectCount++;
        Project storage project = projects[projectId];
        project.client = msg.sender;
        project.pm = pm;
        project.pmFeeBps = pmFeeBps;
        project.totalAmount = total;
        project.active = true;
        project.contractURI = contractURI;

        _emitProjectCreated(projectId, pm, pmFeeBps, total, descriptions.length, contractURI);

        for (uint256 i = 0; i < descriptions.length; i++) {
            address assignee = initialAssignees.length > 0 ? initialAssignees[i] : address(0);
            MilestoneStatus initialStatus = assignee != address(0)
                ? MilestoneStatus.Assigned
                : MilestoneStatus.Created;

            project.milestones.push(
                Milestone({
                    description: descriptions[i],
                    amount: amounts[i],
                    assignee: assignee,
                    createdAt: block.timestamp,
                    assignedAt: assignee != address(0) ? block.timestamp : 0,
                    acceptedAt: 0,
                    submittedAt: 0,
                    status: initialStatus,
                    submissionNote: ""
                })
            );

            if (assignee != address(0)) {
                emit MilestoneAssigned(projectId, i, assignee, msg.sender);
            }
        }

        return projectId;
    }

    /// @dev Isolated to keep `createProject`'s local frame shallow enough for the
    ///      non-via-IR Solidity stack limit.
    function _emitProjectCreated(
        uint256 projectId,
        address pm,
        uint256 pmFeeBps,
        uint256 total,
        uint256 milestoneCount,
        string memory contractURI
    ) internal {
        emit ProjectCreated(projectId, msg.sender, pm, pmFeeBps, total, milestoneCount, contractURI);
    }

    // ============ Assignment ============

    function assignMilestone(uint256 projectId, uint256 milestoneIndex, address assignee)
        external
        onlyClientOrPM(projectId)
        projectActive(projectId)
        validMilestoneIndex(projectId, milestoneIndex)
    {
        Project storage project = projects[projectId];
        Milestone storage milestone = project.milestones[milestoneIndex];

        require(milestone.status == MilestoneStatus.Created, "Milestone not in Created status");
        require(assignee != address(0), "Invalid assignee address");
        require(assignee != project.client, "Client cannot be assignee");
        require(assignee != project.pm, "PM cannot be assignee");

        milestone.assignee = assignee;
        milestone.assignedAt = block.timestamp;
        milestone.status = MilestoneStatus.Assigned;

        emit MilestoneAssigned(projectId, milestoneIndex, assignee, msg.sender);
    }

    function acceptMilestone(uint256 projectId, uint256 milestoneIndex)
        external
        onlyAssignee(projectId, milestoneIndex)
        projectActive(projectId)
        validMilestoneIndex(projectId, milestoneIndex)
    {
        Milestone storage milestone = projects[projectId].milestones[milestoneIndex];
        require(milestone.status == MilestoneStatus.Assigned, "Milestone not in Assigned status");

        milestone.acceptedAt = block.timestamp;
        milestone.status = MilestoneStatus.Accepted;

        emit MilestoneAccepted(projectId, milestoneIndex, msg.sender);
    }

    function declineMilestone(uint256 projectId, uint256 milestoneIndex, string memory reason)
        external
        onlyAssignee(projectId, milestoneIndex)
        projectActive(projectId)
        validMilestoneIndex(projectId, milestoneIndex)
    {
        Milestone storage milestone = projects[projectId].milestones[milestoneIndex];
        require(milestone.status == MilestoneStatus.Assigned, "Milestone not in Assigned status");

        address previousAssignee = milestone.assignee;
        milestone.assignee = address(0);
        milestone.assignedAt = 0;
        milestone.status = MilestoneStatus.Created;

        emit MilestoneDeclined(projectId, milestoneIndex, previousAssignee, reason);
    }

    function unassignMilestone(uint256 projectId, uint256 milestoneIndex)
        external
        onlyClientOrPM(projectId)
        projectActive(projectId)
        validMilestoneIndex(projectId, milestoneIndex)
    {
        Milestone storage milestone = projects[projectId].milestones[milestoneIndex];
        require(milestone.status == MilestoneStatus.Assigned, "Can only unassign from Assigned status");

        address previousAssignee = milestone.assignee;
        milestone.assignee = address(0);
        milestone.assignedAt = 0;
        milestone.status = MilestoneStatus.Created;

        emit MilestoneUnassigned(projectId, milestoneIndex, previousAssignee);
    }

    function expireAssignment(uint256 projectId, uint256 milestoneIndex)
        external
        projectActive(projectId)
        validMilestoneIndex(projectId, milestoneIndex)
    {
        Milestone storage milestone = projects[projectId].milestones[milestoneIndex];
        require(milestone.status == MilestoneStatus.Assigned, "Not in Assigned status");
        require(block.timestamp >= milestone.assignedAt + ASSIGNMENT_TIMEOUT, "Assignment not expired");

        address previousAssignee = milestone.assignee;
        milestone.assignee = address(0);
        milestone.assignedAt = 0;
        milestone.status = MilestoneStatus.Created;

        emit MilestoneUnassigned(projectId, milestoneIndex, previousAssignee);
    }

    // ============ Work ============

    function startMilestone(uint256 projectId, uint256 milestoneIndex)
        external
        onlyAssignee(projectId, milestoneIndex)
        projectActive(projectId)
        validMilestoneIndex(projectId, milestoneIndex)
    {
        Milestone storage milestone = projects[projectId].milestones[milestoneIndex];
        require(milestone.status == MilestoneStatus.Accepted, "Milestone not in Accepted status");

        milestone.status = MilestoneStatus.InProgress;
        emit MilestoneStarted(projectId, milestoneIndex);
    }

    /**
     * @notice Submit completed work. Daemon convention: put `ipfs://<cid>` or `arweave://<id>`
     *         (or any URI) in `note` pointing to the deliverable.
     */
    function submitMilestone(uint256 projectId, uint256 milestoneIndex, string memory note)
        external
        onlyAssignee(projectId, milestoneIndex)
        projectActive(projectId)
        validMilestoneIndex(projectId, milestoneIndex)
    {
        Milestone storage milestone = projects[projectId].milestones[milestoneIndex];
        require(
            milestone.status == MilestoneStatus.Accepted || milestone.status == MilestoneStatus.InProgress,
            "Cannot submit from current status"
        );

        milestone.status = MilestoneStatus.Submitted;
        milestone.submittedAt = block.timestamp;
        milestone.submissionNote = note;

        emit MilestoneSubmitted(projectId, milestoneIndex, note);
    }

    // ============ Approval & Payout ============

    function approveMilestone(uint256 projectId, uint256 milestoneIndex)
        external
        nonReentrant
        onlyClient(projectId)
        projectActive(projectId)
        validMilestoneIndex(projectId, milestoneIndex)
    {
        Project storage project = projects[projectId];
        Milestone storage milestone = project.milestones[milestoneIndex];
        require(milestone.status == MilestoneStatus.Submitted, "Milestone not submitted");

        uint256 pmFee = (milestone.amount * project.pmFeeBps) / BPS_DENOMINATOR;
        uint256 assigneeAmount = milestone.amount - pmFee;

        milestone.status = MilestoneStatus.Paid;
        project.totalPaid += milestone.amount;
        project.totalPmFees += pmFee;

        usdc.safeTransfer(milestone.assignee, assigneeAmount);
        if (project.pm != address(0) && pmFee > 0) {
            usdc.safeTransfer(project.pm, pmFee);
        }

        emit MilestoneApproved(projectId, milestoneIndex, assigneeAmount, pmFee);
        emit MilestonePaid(projectId, milestoneIndex, milestone.amount, false);
    }

    function rejectMilestone(uint256 projectId, uint256 milestoneIndex, string memory reason)
        external
        onlyClient(projectId)
        projectActive(projectId)
        validMilestoneIndex(projectId, milestoneIndex)
    {
        Milestone storage milestone = projects[projectId].milestones[milestoneIndex];
        require(milestone.status == MilestoneStatus.Submitted, "Milestone not submitted");

        milestone.status = MilestoneStatus.InProgress;
        milestone.submittedAt = 0;
        milestone.submissionNote = "";

        emit MilestoneRejected(projectId, milestoneIndex, reason);
    }

    /**
     * @notice Anyone can call to auto-release a Submitted milestone after TIMEOUT_PERIOD —
     *         protects workers from silent client ghosting.
     */
    function releaseMilestone(uint256 projectId, uint256 milestoneIndex)
        external
        nonReentrant
        validMilestoneIndex(projectId, milestoneIndex)
    {
        Project storage project = projects[projectId];
        require(project.active, "Project not active");

        Milestone storage milestone = project.milestones[milestoneIndex];
        require(milestone.status != MilestoneStatus.Paid, "Already paid");
        require(milestone.assignee != address(0), "No assignee");
        require(
            milestone.status == MilestoneStatus.Submitted &&
                milestone.submittedAt > 0 &&
                block.timestamp >= milestone.submittedAt + TIMEOUT_PERIOD,
            "Not ready to auto-release"
        );

        uint256 pmFee = (milestone.amount * project.pmFeeBps) / BPS_DENOMINATOR;
        uint256 assigneeAmount = milestone.amount - pmFee;

        milestone.status = MilestoneStatus.Paid;
        project.totalPaid += milestone.amount;
        project.totalPmFees += pmFee;

        usdc.safeTransfer(milestone.assignee, assigneeAmount);
        if (project.pm != address(0) && pmFee > 0) {
            usdc.safeTransfer(project.pm, pmFee);
        }

        emit MilestonePaid(projectId, milestoneIndex, milestone.amount, true);
    }

    function cancelProject(uint256 projectId)
        external
        nonReentrant
        onlyClient(projectId)
        projectActive(projectId)
    {
        Project storage project = projects[projectId];

        uint256 refundAmount = 0;
        bool hasActiveWork = false;

        for (uint256 i = 0; i < project.milestones.length; i++) {
            MilestoneStatus status = project.milestones[i].status;
            if (status == MilestoneStatus.Submitted || status == MilestoneStatus.Approved) {
                hasActiveWork = true;
                break;
            }
            if (status != MilestoneStatus.Paid) {
                refundAmount += project.milestones[i].amount;
            }
        }

        require(!hasActiveWork, "Cannot cancel with submitted or approved milestones");
        require(refundAmount > 0, "No funds to refund");

        project.active = false;
        for (uint256 i = 0; i < project.milestones.length; i++) {
            if (project.milestones[i].status != MilestoneStatus.Paid) {
                project.milestones[i].status = MilestoneStatus.Paid;
            }
        }

        usdc.safeTransfer(project.client, refundAmount);
        emit ProjectCancelled(projectId, refundAmount);
    }

    function emergencyReclaim(uint256 projectId, uint256 milestoneIndex)
        external
        nonReentrant
        onlyClient(projectId)
        projectActive(projectId)
        validMilestoneIndex(projectId, milestoneIndex)
    {
        Project storage project = projects[projectId];
        Milestone storage milestone = project.milestones[milestoneIndex];

        require(milestone.status != MilestoneStatus.Paid, "Already paid");
        require(
            milestone.status != MilestoneStatus.Approved && milestone.status != MilestoneStatus.Submitted,
            "Cannot reclaim approved or submitted milestone"
        );

        uint256 emergencyTimeout = milestone.createdAt + (TIMEOUT_PERIOD * 2);
        require(block.timestamp >= emergencyTimeout, "Emergency timeout not reached");

        milestone.status = MilestoneStatus.Paid;
        usdc.safeTransfer(project.client, milestone.amount);
        emit MilestonePaid(projectId, milestoneIndex, milestone.amount, true);
    }

    // ============ Views ============

    function getProject(uint256 projectId)
        external
        view
        returns (
            address client,
            address pm,
            uint256 pmFeeBps,
            uint256 totalAmount,
            uint256 totalPaid,
            uint256 totalPmFees,
            bool active,
            uint256 milestoneCount,
            string memory contractURI
        )
    {
        Project storage project = projects[projectId];
        return (
            project.client,
            project.pm,
            project.pmFeeBps,
            project.totalAmount,
            project.totalPaid,
            project.totalPmFees,
            project.active,
            project.milestones.length,
            project.contractURI
        );
    }

    function getMilestone(uint256 projectId, uint256 milestoneIndex)
        external
        view
        validMilestoneIndex(projectId, milestoneIndex)
        returns (
            string memory description,
            uint256 amount,
            address assignee,
            MilestoneStatus status,
            uint256 createdAt,
            uint256 submittedAt,
            string memory submissionNote
        )
    {
        Milestone storage m = projects[projectId].milestones[milestoneIndex];
        return (m.description, m.amount, m.assignee, m.status, m.createdAt, m.submittedAt, m.submissionNote);
    }

    function getMilestoneTimestamps(uint256 projectId, uint256 milestoneIndex)
        external
        view
        validMilestoneIndex(projectId, milestoneIndex)
        returns (uint256 createdAt, uint256 assignedAt, uint256 acceptedAt, uint256 submittedAt, bool canAutoRelease)
    {
        Milestone storage m = projects[projectId].milestones[milestoneIndex];
        bool autoRelease = m.status == MilestoneStatus.Submitted &&
            m.submittedAt > 0 &&
            block.timestamp >= m.submittedAt + TIMEOUT_PERIOD;
        return (m.createdAt, m.assignedAt, m.acceptedAt, m.submittedAt, autoRelease);
    }

    function getAllMilestones(uint256 projectId)
        external
        view
        returns (
            string[] memory descriptions,
            uint256[] memory amounts,
            address[] memory assignees,
            MilestoneStatus[] memory statuses,
            uint256[] memory submittedAts,
            string[] memory submissionNotes
        )
    {
        Project storage project = projects[projectId];
        uint256 length = project.milestones.length;

        descriptions = new string[](length);
        amounts = new uint256[](length);
        assignees = new address[](length);
        statuses = new MilestoneStatus[](length);
        submittedAts = new uint256[](length);
        submissionNotes = new string[](length);

        for (uint256 i = 0; i < length; i++) {
            Milestone storage milestone = project.milestones[i];
            descriptions[i] = milestone.description;
            amounts[i] = milestone.amount;
            assignees[i] = milestone.assignee;
            statuses[i] = milestone.status;
            submittedAts[i] = milestone.submittedAt;
            submissionNotes[i] = milestone.submissionNote;
        }
    }

    function getProjectStats(uint256 projectId)
        external
        view
        returns (
            uint256 totalMilestones,
            uint256 completedMilestones,
            uint256 paidMilestones,
            uint256 remainingAmount,
            uint256 assignedMilestones,
            uint256 acceptedMilestones
        )
    {
        Project storage project = projects[projectId];
        uint256 completed = 0;
        uint256 paid = 0;
        uint256 assigned = 0;
        uint256 accepted = 0;

        for (uint256 i = 0; i < project.milestones.length; i++) {
            MilestoneStatus status = project.milestones[i].status;

            if (status == MilestoneStatus.Assigned) assigned++;
            if (
                status == MilestoneStatus.Accepted ||
                status == MilestoneStatus.InProgress ||
                status == MilestoneStatus.Submitted ||
                status == MilestoneStatus.Approved ||
                status == MilestoneStatus.Paid
            ) accepted++;
            if (status == MilestoneStatus.Approved || status == MilestoneStatus.Paid) completed++;
            if (status == MilestoneStatus.Paid) paid++;
        }

        return (
            project.milestones.length,
            completed,
            paid,
            project.totalAmount - project.totalPaid,
            assigned,
            accepted
        );
    }

    function getAddressRole(uint256 projectId, address addr)
        external
        view
        returns (bool isClient, bool isPM, uint256[] memory assignedMilestones)
    {
        Project storage project = projects[projectId];

        isClient = project.client == addr;
        isPM = project.pm == addr;

        uint256 count = 0;
        for (uint256 i = 0; i < project.milestones.length; i++) {
            if (project.milestones[i].assignee == addr) count++;
        }

        assignedMilestones = new uint256[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < project.milestones.length; i++) {
            if (project.milestones[i].assignee == addr) {
                assignedMilestones[j++] = i;
            }
        }
    }
}
