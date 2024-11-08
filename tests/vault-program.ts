import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { VaultProgram } from '../target/types/vault_program';
import { assert } from 'chai';

describe('vault-program', () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.VaultProgram as Program<VaultProgram>;

  let owner: anchor.web3.Keypair;
  let statePDA: anchor.web3.PublicKey;
  let authPDA: anchor.web3.PublicKey;
  let vaultPDA: anchor.web3.PublicKey;

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

  it('Initializes vault for user (Owner)', async () => {
    await program.methods
      .initialize()
      .accounts({
        owner: owner.publicKey,
        state: statePDA, // Ensure 'state' is a valid property in the accounts object
        auth: authPDA, // Ensure 'auth' is a valid property in the accounts object
        vault: vaultPDA, // Ensure 'vault' is a valid property in the accounts object
        system_program: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const stateAccount = await program.account.vault.fetch(statePDA);
    assert.equal(stateAccount.owner.toString(), owner.publicKey.toString());
    assert.equal(stateAccount.balance.toNumber(), 0);
  });

  it('Deposits funds into the vault', async () => {
    const amount = new anchor.BN(2 * anchor.web3.LAMPORTS_PER_SOL);

    const initialBalance = await provider.connection.getBalance(vaultPDA);

    await program.methods
      .deposit(amount)
      .accounts({
        owner: owner.publicKey,
        state: statePDA,
        auth: authPDA,
        vault: vaultPDA,
        system_program: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const finalBalance = await provider.connection.getBalance(vaultPDA);

    assert.equal(finalBalance - initialBalance, amount.toNumber(), 'Vault balance should increase by deposit amount');
  });

  it('Withdraws funds from the vault', async () => {
    const amount = new anchor.BN(0.5 * anchor.web3.LAMPORTS_PER_SOL);

    const initialBalance = await provider.connection.getBalance(vaultPDA);

    await program.methods
      .withdraw(amount)
      .accounts({
        owner: owner.publicKey,
        state: statePDA,
        auth: authPDA,
        vault: vaultPDA,
        system_program: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const finalBalance = await provider.connection.getBalance(vaultPDA);
    assert.equal(initialBalance - finalBalance, amount.toNumber(), 'Vault balance should decrease by withdraw amount');
  });
});
