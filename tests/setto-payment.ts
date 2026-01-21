import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";
import { SettoPayment } from "../target/types/setto_payment";

describe("setto-payment", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SettoPayment as Program<SettoPayment>;

  let mint: anchor.web3.PublicKey;
  let userTokenAccount: anchor.web3.PublicKey;
  let merchantTokenAccount: anchor.web3.PublicKey;
  let feeTokenAccount: anchor.web3.PublicKey;

  const user = anchor.web3.Keypair.generate();
  const merchant = anchor.web3.Keypair.generate();
  const feeRecipient = anchor.web3.Keypair.generate();
  const relayer = anchor.web3.Keypair.generate();

  const [configPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  before(async () => {
    // Airdrop SOL to accounts
    const airdropAmount = 10 * anchor.web3.LAMPORTS_PER_SOL;

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user.publicKey, airdropAmount)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(relayer.publicKey, airdropAmount)
    );

    // Create mint
    mint = await createMint(
      provider.connection,
      user,
      user.publicKey,
      null,
      6 // USDC decimals
    );

    // Create token accounts
    userTokenAccount = await createAccount(
      provider.connection,
      user,
      mint,
      user.publicKey
    );

    merchantTokenAccount = await createAccount(
      provider.connection,
      user,
      mint,
      merchant.publicKey
    );

    feeTokenAccount = await createAccount(
      provider.connection,
      user,
      mint,
      feeRecipient.publicKey
    );

    // Mint tokens to user
    await mintTo(
      provider.connection,
      user,
      mint,
      userTokenAccount,
      user,
      1_000_000_000 // 1000 USDC
    );
  });

  it("initializes config", async () => {
    await program.methods
      .initialize()
      .accounts({
        authority: provider.wallet.publicKey,
        config: configPda,
        feeRecipient: feeRecipient.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const config = await program.account.config.fetch(configPda);
    expect(config.authority.toString()).to.equal(
      provider.wallet.publicKey.toString()
    );
    expect(config.feeRecipient.toString()).to.equal(
      feeRecipient.publicKey.toString()
    );
    expect(config.paused).to.equal(false);
  });

  it("processes payment with fee", async () => {
    const amount = new anchor.BN(100_000_000); // 100 USDC
    const feeAmount = new anchor.BN(1_000_000); // 1 USDC (1% fee)
    const paymentId = new anchor.BN(12345);

    const userBalanceBefore = (
      await getAccount(provider.connection, userTokenAccount)
    ).amount;

    await program.methods
      .processPayment({
        amount,
        feeAmount,
        paymentId,
      })
      .accounts({
        payer: relayer.publicKey,
        user: user.publicKey,
        config: configPda,
        userTokenAccount,
        merchantTokenAccount,
        feeTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([relayer, user])
      .rpc();

    // Verify balances
    const userBalanceAfter = (
      await getAccount(provider.connection, userTokenAccount)
    ).amount;
    const merchantBalance = (
      await getAccount(provider.connection, merchantTokenAccount)
    ).amount;
    const feeBalance = (await getAccount(provider.connection, feeTokenAccount))
      .amount;

    expect(Number(userBalanceBefore) - Number(userBalanceAfter)).to.equal(
      100_000_000
    );
    expect(Number(merchantBalance)).to.equal(99_000_000); // 100 - 1 fee
    expect(Number(feeBalance)).to.equal(1_000_000); // 1 USDC fee
  });

  it("fails when paused", async () => {
    // TODO: Add pause functionality and test
  });

  it("fails with zero amount", async () => {
    try {
      await program.methods
        .processPayment({
          amount: new anchor.BN(0),
          feeAmount: new anchor.BN(0),
          paymentId: new anchor.BN(1),
        })
        .accounts({
          payer: relayer.publicKey,
          user: user.publicKey,
          config: configPda,
          userTokenAccount,
          merchantTokenAccount,
          feeTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([relayer, user])
        .rpc();

      expect.fail("Should have thrown error");
    } catch (err) {
      expect(err.toString()).to.include("InvalidAmount");
    }
  });

  it("fails when fee exceeds amount", async () => {
    try {
      await program.methods
        .processPayment({
          amount: new anchor.BN(100),
          feeAmount: new anchor.BN(200),
          paymentId: new anchor.BN(2),
        })
        .accounts({
          payer: relayer.publicKey,
          user: user.publicKey,
          config: configPda,
          userTokenAccount,
          merchantTokenAccount,
          feeTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([relayer, user])
        .rpc();

      expect.fail("Should have thrown error");
    } catch (err) {
      expect(err.toString()).to.include("FeeExceedsAmount");
    }
  });
});
