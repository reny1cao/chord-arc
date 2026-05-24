# Local E2E

Use localhost for release-blocking workflow checks. It keeps the Solidity ABI
unchanged, deploys `MockUSDC + ChordEscrow`, and points the frontend at the
Hardhat chain through `NEXT_PUBLIC_CHORD_NETWORK=localhost`.

## Fast Contract Lifecycle

```bash
node .yarn/releases/yarn-3.2.3.cjs local:e2e
```

This runs the daemon smoke test:

1. Start a Hardhat node.
2. Deploy `MockUSDC + ChordEscrow` on localhost.
3. Mint MockUSDC to the deterministic client wallet.
4. Create a funded work contract.
5. Assign a deterministic worker wallet.
6. Accept, start, submit proof, approve, and assert the worker USDC balance.

## Browser Surface

In one terminal:

```bash
node .yarn/releases/yarn-3.2.3.cjs chain
```

In a second terminal:

```bash
node .yarn/releases/yarn-3.2.3.cjs local:deploy
```

Optional, after deploy, fund a browser wallet with local USDC:

```bash
LOCAL_USDC_TO=0xYourWallet LOCAL_USDC_AMOUNT=1000 node .yarn/releases/yarn-3.2.3.cjs local:mint-usdc
```

In a third terminal:

```bash
node .yarn/releases/yarn-3.2.3.cjs local:start
```

Then open `http://localhost:3000`. `externalContracts.ts` supplies the deterministic
localhost escrow address, and `CreateProjectForm` resolves USDC from generated
`MockUSDC` metadata when present or from `ChordEscrow.usdc()`.

The `/work` view is intentionally discovery-only for unassigned work in v1.
Workers copy their address and ask the client or PM to assign them until the
protocol adds self-claim or bidding.
