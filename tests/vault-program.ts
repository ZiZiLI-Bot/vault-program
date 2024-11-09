import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { assert } from 'chai';
import { VaultProgram } from './../target/types/vault_program';

describe('vault-program', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.VaultProgram as Program<VaultProgram>;

  let owner: anchor.web3.Keypair;
  let statePDA: anchor.web3.PublicKey;
  let authPDA: anchor.web3.PublicKey;
  let vaultPDA: anchor.web3.PublicKey;

  // Định nghĩa các hằng số
  const INTEREST_RATE = new anchor.BN(500); // 5% interest rate
  const DEPOSIT_AMOUNT = new anchor.BN(2 * anchor.web3.LAMPORTS_PER_SOL);
  const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

  before(async () => {
    owner = anchor.web3.Keypair.generate();

    const airdropSignature = await provider.connection.requestAirdrop(
      owner.publicKey,
      20 * anchor.web3.LAMPORTS_PER_SOL,
    );

    const latestBlockHash = await provider.connection.getLatestBlockhash();

    await provider.connection.confirmTransaction({
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: airdropSignature,
    });

    // Tìm các PDAs
    [statePDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('state'), owner.publicKey.toBuffer()],
      program.programId,
    );

    [authPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('auth'), statePDA.toBuffer()],
      program.programId,
    );

    [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), authPDA.toBuffer()],
      program.programId,
    );
  });

  it('Initializes vault with interest rate', async () => {
    await program.methods
      .initialize(INTEREST_RATE)
      .accounts({
        owner: owner.publicKey,
        state: statePDA,
        auth: authPDA,
        vault: vaultPDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const stateAccount = await program.account.vault.fetch(statePDA);
    assert.equal(stateAccount.owner.toString(), owner.publicKey.toString());
    assert.equal(stateAccount.interestRate.toNumber(), INTEREST_RATE.toNumber());
    assert.equal(stateAccount.depositAmount.toNumber(), 0);
    assert.equal(stateAccount.depositTime.toNumber(), 0);
  });

  it('Deposits funds and records deposit time', async () => {
    const initialBalance = await provider.connection.getBalance(vaultPDA);

    await program.methods
      .deposit(DEPOSIT_AMOUNT)
      .accounts({
        owner: owner.publicKey,
        state: statePDA,
        auth: authPDA,
        vault: vaultPDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const finalBalance = await provider.connection.getBalance(vaultPDA);
    const stateAccount = await program.account.vault.fetch(statePDA);

    // Kiểm tra số dư
    assert.equal(
      finalBalance - initialBalance,
      DEPOSIT_AMOUNT.toNumber(),
      'Vault balance should increase by deposit amount',
    );

    // Kiểm tra số tiền gửi được ghi lại
    assert.equal(
      stateAccount.depositAmount.toNumber(),
      DEPOSIT_AMOUNT.toNumber(),
      'Deposit amount should be recorded correctly',
    );
  });

  it('Calculates interest correctly on withdrawal', async () => {
    // Đợi một khoảng thời gian để tích lũy lãi
    await new Promise((resolve) => setTimeout(resolve, 2000)); // đợi 2 giây

    const withdrawAmount = new anchor.BN(1 * anchor.web3.LAMPORTS_PER_SOL);
    const initialBalance = await provider.connection.getBalance(vaultPDA);
    const initialOwnerBalance = await provider.connection.getBalance(owner.publicKey);
    const stateBeforeWithdraw = await program.account.vault.fetch(statePDA);

    const currentTime = Math.floor(Date.now() / 1000);
    const timeElapsed = currentTime - stateBeforeWithdraw.depositTime.toNumber();
    const yearsElapsed = timeElapsed / SECONDS_PER_YEAR;

    // Tính lãi dự kiến
    const expectedInterest = Math.floor(withdrawAmount.toNumber() * (INTEREST_RATE.toNumber() / 10000) * yearsElapsed);

    await program.methods
      .withdraw(withdrawAmount)
      .accounts({
        owner: owner.publicKey,
        state: statePDA,
        auth: authPDA,
        vault: vaultPDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const finalVaultBalance = await provider.connection.getBalance(vaultPDA);
    const finalOwnerBalance = await provider.connection.getBalance(owner.publicKey);
    const stateAfterWithdraw = await program.account.vault.fetch(statePDA);

    // Kiểm tra số dư vault giảm đúng (gốc + lãi)
    const actualWithdrawn = initialBalance - finalVaultBalance;
    assert.approximately(
      actualWithdrawn,
      withdrawAmount.toNumber() + expectedInterest,
      1000000, // allow for small rounding differences
      'Withdrawn amount should include principal and interest',
    );

    // Kiểm tra số dư owner tăng đúng (gốc + lãi - phí giao dịch)
    const ownerBalanceIncrease = finalOwnerBalance - initialOwnerBalance;
    assert.approximately(
      ownerBalanceIncrease,
      withdrawAmount.toNumber() + expectedInterest - 5000, // trừ phí giao dịch ước tính
      1000000,
      'Owner balance should increase by withdrawn amount minus transaction fees',
    );

    // Kiểm tra reset state sau khi rút
    assert.equal(stateAfterWithdraw.depositAmount.toNumber(), 0, 'Deposit amount should be reset after withdrawal');
    assert.equal(stateAfterWithdraw.depositTime.toNumber(), 0, 'Deposit time should be reset after withdrawal');
  });

  it('Handles multiple deposits and withdrawals with interest', async () => {
    // Gửi lần 1
    await program.methods
      .deposit(DEPOSIT_AMOUNT)
      .accounts({
        owner: owner.publicKey,
        state: statePDA,
        auth: authPDA,
        vault: vaultPDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    // Đợi tích lũy lãi
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Rút một phần
    const partialWithdraw = DEPOSIT_AMOUNT.div(new anchor.BN(2));
    await program.methods
      .withdraw(partialWithdraw)
      .accounts({
        owner: owner.publicKey,
        state: statePDA,
        auth: authPDA,
        vault: vaultPDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    // Gửi thêm
    await program.methods
      .deposit(DEPOSIT_AMOUNT)
      .accounts({
        owner: owner.publicKey,
        state: statePDA,
        auth: authPDA,
        vault: vaultPDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const finalState = await program.account.vault.fetch(statePDA);
    assert.isTrue(finalState.depositAmount.gt(new anchor.BN(0)), 'Should have remaining deposit amount');
  });
});
