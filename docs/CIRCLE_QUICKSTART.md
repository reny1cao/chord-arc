# Circle Wallets quickstart — what to procure tonight

Goal: by end of D0 (tonight) have a working Circle Dev-Controlled SCA on `ARC-TESTNET`, so the daemon can sign txs on D1.

Time required: **~30 minutes**. Most of it is waiting for sandbox approval (usually instant in dev).

## 1. Sign up at Circle Console

→ https://console.circle.com

- Choose **Sandbox** (not Production). The hackathon runs on testnet.
- Verify email; org name can be anything ("Chord Hackathon" works).
- Skip the production KYB flow — sandbox needs no docs.

## 2. Generate an Entity Secret

The Entity Secret is a 32-byte hex string that encrypts every wallet operation. Think of it as the root credential — if leaked, all your wallets are compromised.

```bash
# Generate locally
openssl rand -hex 32
```

Save the output. You'll register it with Circle and also paste it into `packages/daemon/.env` as `CIRCLE_ENTITY_SECRET`.

In the Circle Console:
1. **Developer → Configurator → Entity Secret**
2. Paste your hex secret
3. Click **Register** → Circle returns a one-time **Entity Secret Ciphertext** (used by some API calls). Save this too.

## 3. Get an API Key

In the Console:
1. **Developer → API Keys → Sandbox**
2. **Create API key**, name it "chord-daemon", give it read+write on `wallets` and `transactions`
3. Copy the key (it begins with `TEST_API_KEY:...`) — Circle shows it once

## 4. Paste into the daemon env

```bash
# packages/daemon/.env
CIRCLE_API_KEY=TEST_API_KEY:...
CIRCLE_ENTITY_SECRET=<the hex you generated>
# CIRCLE_WALLET_ID + CIRCLE_WALLET_SET_ID come from step 5
```

## 5. Create your first SCA on ARC-TESTNET

Once Stream C lands (`packages/daemon/src/bootstrap-sca.ts`), run:

```bash
node .yarn/releases/yarn-3.2.3.cjs workspace @chord/daemon \
  tsx src/bootstrap-sca.ts --name chord-daemon-react
```

Expected output:
```
[bootstrap] created wallet set: 7af3...    (ChordHackathon)
[bootstrap] created SCA: 6e9b...           (chord-daemon-react)
[bootstrap] address: 0xabc...

paste these into packages/daemon/.env:
  CIRCLE_WALLET_SET_ID=7af3...
  CIRCLE_WALLET_ID=6e9b...
  ARC_SCA_ADDRESS=0xabc...
```

Repeat with different `--name` flags to create 2–3 more SCAs for parallel agents.

## 6. Fund each SCA with testnet USDC for gas

USDC is the native gas token on Arc. Until the SCA has a USDC balance, it can't send any tx.

→ https://faucet.circle.com/

Select **Arc Testnet**, paste each SCA address, click drip. 10 USDC each.

You also need to fund the deployer wallet for the contract deploy + seed script. Same faucet.

## 7. (Optional) Verify the SCA on arcscan

```
https://testnet.arcscan.app/address/<SCA-address>
```

The Faucet tx should show as a USDC transfer in. The SCA contract code shows up after the first outgoing tx (lazy deploy).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `403 Forbidden` from the SDK | API key has wrong scope | Re-create the key with `wallets:read,wallets:write,transactions:read,transactions:write` |
| `Invalid entity secret ciphertext` | Cipher expires after 24h | Re-encrypt: see Circle docs `https://developers.circle.com/w3s/entity-secret-management` |
| SCA tx reverts with "insufficient gas" | SCA has no USDC | Drip from the faucet first |
| `Blockchain not supported` | Wrong enum value | Use the literal `ARC-TESTNET` (case-sensitive) |
| Bootstrap script hangs | API rate limit | Wait 60s and retry; sandbox has aggressive limits |

## Security note

`CIRCLE_API_KEY` and `CIRCLE_ENTITY_SECRET` together can move USDC out of every SCA you own. They are gitignored (`.env` is in `.gitignore`) but **do not paste them into Vercel env, Slack, or any shared system** during the hackathon. For the demo Vercel deployment, only `NEXT_PUBLIC_*` env vars need to be set there — Circle credentials stay on your local daemon machine.
