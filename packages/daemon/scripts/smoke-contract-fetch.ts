/**
 * Smoke test for the wave-2 daemon-side WorkContract fetch + verify path.
 *
 * Runs in-process with a monkey-patched fetch — no Next.js server, no chain,
 * no Circle account. Exercises:
 *
 *   1. Happy path  — valid URI, payload whose sha256 matches the hash.
 *   2. Tampering   — payload's `result` mutated; sha256 mismatch must throw.
 *   3. Bad URI     — non-`chord://` input must throw at parse time.
 *   4. Bad shape   — payload missing the `schema` tag must throw.
 *   5. HTTP error  — server returns 500; fetch must surface the failure.
 *
 * Run with: `yarn workspace @chord/daemon smoke-contract`.
 *
 * Exit code 0 on success, non-zero with a diagnostic on any failure. Output
 * format mirrors `smoke-test.ts`: single-line "ok:" / "fail:" rows so a CI log
 * scrape is easy.
 */
import {
  canonicalize,
  fetchAndVerifyContract,
  hashContract,
  parseContractURI,
  type WorkContract,
} from "../src/work-contract.js";

const FIXTURE: WorkContract = {
  schema: "chord.contract.v1",
  result: "A working /api/health endpoint that returns 200 with {ok:true}.",
  authority: "Modify packages/api/** and packages/api/tests/**. Do not touch other packages.",
  proof: "PR link + screenshot of the curl response + passing CI green-check.",
  acceptance: "Endpoint returns 200 within 50ms p95 under 100 rps load.",
  failure: "If the endpoint flakes, revert and surface the root cause within 24h.",
  createdAt: 1716624000000,
};

interface Step {
  name: string;
  run: () => Promise<void>;
}

const baseUrl = "http://example.invalid";

function makeFetch(impl: typeof fetch): typeof fetch {
  return impl;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function assertThrows(fn: () => Promise<unknown>, needle: string): Promise<void> {
  let threw = false;
  let message = "";
  try {
    await fn();
  } catch (err) {
    threw = true;
    message = err instanceof Error ? err.message : String(err);
  }
  if (!threw) throw new Error(`expected throw containing "${needle}", got success`);
  if (!message.toLowerCase().includes(needle.toLowerCase())) {
    throw new Error(`expected throw containing "${needle}", got "${message}"`);
  }
}

const steps: Step[] = [
  {
    name: "happy path — valid URI + matching hash returns parsed contract",
    run: async () => {
      const hash = hashContract(FIXTURE);
      const uri = `chord://${hash}`;
      const fetchImpl = makeFetch(async (input: RequestInfo | URL): Promise<Response> => {
        const url = typeof input === "string" ? input : input.toString();
        if (!url.endsWith(`/api/contracts/${hash}`)) {
          throw new Error(`unexpected fetch URL: ${url}`);
        }
        return jsonResponse(FIXTURE);
      });
      const result = await fetchAndVerifyContract({ uri, baseUrl, fetchImpl });
      if (result.hash !== hash) throw new Error(`hash mismatch: ${result.hash} vs ${hash}`);
      if (result.contract.result !== FIXTURE.result) throw new Error("contract.result not preserved");
      if (result.bytes !== Buffer.byteLength(canonicalize(FIXTURE), "utf8")) {
        throw new Error(`bytes mismatch: ${result.bytes}`);
      }
    },
  },
  {
    name: "tamper detection — mutated payload must fail sha256 verification",
    run: async () => {
      const hash = hashContract(FIXTURE);
      const uri = `chord://${hash}`;
      const tampered: WorkContract = { ...FIXTURE, result: FIXTURE.result + " (rugged)" };
      const fetchImpl = makeFetch(async () => jsonResponse(tampered));
      await assertThrows(
        () => fetchAndVerifyContract({ uri, baseUrl, fetchImpl }),
        "sha256 mismatch",
      );
    },
  },
  {
    name: "malformed URI — non-chord:// input throws at parse",
    run: async () => {
      const fetchImpl = makeFetch(async () => {
        throw new Error("fetch should not be called");
      });
      await assertThrows(
        () => fetchAndVerifyContract({ uri: "https://evil.example/contract", baseUrl, fetchImpl }),
        "invalid contract URI",
      );
    },
  },
  {
    name: "bad shape — payload missing schema tag rejected",
    run: async () => {
      const hash = hashContract(FIXTURE);
      const uri = `chord://${hash}`;
      const fetchImpl = makeFetch(async () =>
        jsonResponse({ ...FIXTURE, schema: "evil.contract.v0" } as unknown as WorkContract),
      );
      await assertThrows(
        () => fetchAndVerifyContract({ uri, baseUrl, fetchImpl }),
        "WorkContract shape",
      );
    },
  },
  {
    name: "HTTP 500 — surfaces failure",
    run: async () => {
      const hash = hashContract(FIXTURE);
      const uri = `chord://${hash}`;
      const fetchImpl = makeFetch(async () => new Response("boom", { status: 500, statusText: "Internal Server Error" }));
      await assertThrows(
        () => fetchAndVerifyContract({ uri, baseUrl, fetchImpl }),
        "HTTP 500",
      );
    },
  },
  {
    name: "parseContractURI — valid + invalid inputs",
    run: async () => {
      const ok = parseContractURI("chord://" + "a".repeat(64));
      if (!ok || ok.hash !== "a".repeat(64)) throw new Error("valid URI didn't parse");
      if (parseContractURI("chord://AAA") !== null) throw new Error("short hash should reject");
      if (parseContractURI("chord://" + "Z".repeat(64)) !== null) throw new Error("non-hex should reject");
      if (parseContractURI("http://foo") !== null) throw new Error("wrong scheme should reject");
    },
  },
];

async function main(): Promise<void> {
  let failed = 0;
  for (const step of steps) {
    try {
      await step.run();
      console.log(`ok:   ${step.name}`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`fail: ${step.name}\n        ${msg}`);
    }
  }
  if (failed > 0) {
    console.log(`\n${failed}/${steps.length} smoke step(s) failed`);
    process.exit(1);
  }
  console.log(`\nall ${steps.length} smoke steps passed`);
}

main().catch(err => {
  console.error("smoke-contract-fetch fatal:", err);
  process.exit(2);
});
