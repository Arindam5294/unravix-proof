# Unravix Proof

Confidential quizzes and private learning credentials for [Unravix](https://unravix.tech), built on Fhenix CoFHE (FHE on EVM).

- **Encrypted answer key**: stored onchain as `euint8[]`, readable only by the contract. Nobody can copy answers.
- **Encrypted grading**: student answers are encrypted client-side and graded with `FHE.eq` + `FHE.select` (no branching on secrets).
- **Private scores**: only the student can decrypt their own score.
- **Selective disclosure**: a student can reveal *only* pass/fail via the Threshold Network decrypt flow, minting a public `mastered[student][quizId]` credential. The score stays private.

## Run
```
pnpm install
npx hardhat test test/UnravixProof.test.ts   # 6 tests on CoFHE mocks
PRIVATE_KEY=... pnpm arb-sepolia:deploy        # testnet
```
Status: testnet MVP. Mocks don't reflect real gas/latency; verify the full encrypt → grade → decrypt round trip on Arbitrum Sepolia.
