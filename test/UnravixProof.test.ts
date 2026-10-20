import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import hre from "hardhat";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { expect } from "chai";

describe("UnravixProof", function () {
  async function fixture() {
    await hre.run("task:cofhe-mocks:deploy");
    const [owner, alice, bob] = await hre.ethers.getSigners();
    const F = await hre.ethers.getContractFactory("UnravixProof");
    const proof = await F.connect(owner).deploy();
    const addr = await proof.getAddress();
    const ownerClient = await hre.cofhe.createClientWithBatteries(owner);
    const aliceClient = await hre.cofhe.createClientWithBatteries(alice);
    const bobClient = await hre.cofhe.createClientWithBatteries(bob);

    // Answer key: 5 MCQs, options 0-3. Pass mark 3/5.
    const key = [2n, 0n, 3n, 1n, 2n];
    const enc = await ownerClient.encryptInputs(key.map((k) => Encryptable.uint8(k))).setConsumingContract(addr).execute();
    const sig = enc[enc.length - 1];
    await proof.connect(owner).createQuiz("Calculus: limits", 3, enc.slice(0, -1), sig);
    return { proof, addr, owner, alice, bob, ownerClient, aliceClient, bobClient };
  }

  async function submit(proof: any, addr: string, signer: any, client: any, answers: bigint[]) {
    const enc = await client.encryptInputs(answers.map((a) => Encryptable.uint8(a))).setConsumingContract(addr).execute();
    const sig = enc[enc.length - 1];
    await proof.connect(signer).submit(1, enc.slice(0, -1), sig);
  }

  it("stores quiz publicly but key stays encrypted", async function () {
    const { proof } = await loadFixture(fixture);
    const [topic, n, pass] = await proof.quizInfo(1);
    expect(topic).to.equal("Calculus: limits");
    expect(n).to.equal(5n);
    expect(pass).to.equal(3n);
  });

  it("grades encrypted answers: student decrypts own score", async function () {
    const { proof, addr, alice, aliceClient } = await loadFixture(fixture);
    await submit(proof, addr, alice, aliceClient, [2n, 0n, 3n, 0n, 0n]); // 3 correct
    const score = await aliceClient.decryptForView(await proof.connect(alice).myScore(1), FheTypes.Uint8).execute();
    expect(score).to.equal(3n);
    const passed = await aliceClient.decryptForView(await proof.connect(alice).myPassed(1), FheTypes.Bool).execute();
    expect(passed).to.equal(true);
  });

  it("failing student: score private, cannot claim mastery", async function () {
    const { proof, addr, bob, bobClient } = await loadFixture(fixture);
    await submit(proof, addr, bob, bobClient, [1n, 1n, 1n, 1n, 1n]); // 1 correct
    const score = await bobClient.decryptForView(await proof.connect(bob).myScore(1), FheTypes.Uint8).execute();
    expect(score).to.equal(1n);
    await proof.connect(bob).requestPassReveal(1);
    const r = await bobClient.decryptForTx(await proof.connect(bob).myPassed(1)).withoutACP().execute();
    await expect(proof.connect(bob).claimMastery(1, Boolean(r.decryptedValue), r.signature)).to.be.revertedWithCustomError(proof, "NotPassed");
    expect(await proof.mastered(bob.address, 1)).to.equal(false);
  });

  it("passing student reveals only pass and earns public credential", async function () {
    const { proof, addr, alice, aliceClient } = await loadFixture(fixture);
    await submit(proof, addr, alice, aliceClient, [2n, 0n, 3n, 1n, 2n]); // 5/5
    await proof.connect(alice).requestPassReveal(1);
    const r = await aliceClient.decryptForTx(await proof.connect(alice).myPassed(1)).withoutACP().execute();
    await expect(proof.connect(alice).claimMastery(1, Boolean(r.decryptedValue), r.signature))
      .to.emit(proof, "Mastered").withArgs(1, alice.address, "Calculus: limits");
    expect(await proof.mastered(alice.address, 1)).to.equal(true);
  });

  it("blocks double submission, wrong length, and non-owner quiz creation", async function () {
    const { proof, addr, alice, aliceClient } = await loadFixture(fixture);
    await submit(proof, addr, alice, aliceClient, [0n, 0n, 0n, 0n, 0n]);
    await expect(submit(proof, addr, alice, aliceClient, [0n, 0n, 0n, 0n, 0n])).to.be.revertedWithCustomError(proof, "AlreadySubmitted");
    const enc = await aliceClient.encryptInputs([Encryptable.uint8(1n)]).setConsumingContract(addr).execute();
    await expect(proof.connect(alice).createQuiz("x", 1, enc.slice(0, -1), enc[enc.length - 1])).to.be.revertedWithCustomError(proof, "NotOwner");
  });

  it("other students cannot decrypt someone else's score", async function () {
    const { proof, addr, alice, bob, aliceClient, bobClient } = await loadFixture(fixture);
    await submit(proof, addr, alice, aliceClient, [2n, 0n, 3n, 1n, 2n]);
    const h = await proof.connect(alice).myScore(1);
    let failed = false;
    try { await bobClient.decryptForView(h, FheTypes.Uint8).execute(); } catch { failed = true; }
    expect(failed).to.equal(true);
  });
});
