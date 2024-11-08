use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
declare_id!("74FbzEDeyH5Mkf4Mhp5m3bxGrWSkao7R7uyt3VXAQ1L8");

#[program]
pub mod vault_program {
    use super::*;
    pub fn initialize(ctx: Context<InitializeContext>) -> Result<()> {
        ctx.accounts.state.owner = ctx.accounts.owner.key();
        ctx.accounts.state.state_bump = ctx.bumps.state;
        ctx.accounts.state.auth_bump = ctx.bumps.auth;
        ctx.accounts.state.vault_bump = ctx.bumps.vault;
        ctx.accounts.state.balance = 0;
        Ok(())
    }

    pub fn deposit(ctx: Context<DepositContext>, amount: u64) -> Result<()> {
        let transfer_accounts = Transfer {
            from: ctx.accounts.owner.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            transfer_accounts,
        );
        transfer(cpi_ctx, amount)?;

        ctx.accounts.state.balance += amount;
        Ok(())
    }

    pub fn withdraw(ctx: Context<WithdrawContext>, amount: u64) -> Result<()> {
        let transfer_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.owner.to_account_info(),
        };
        let seeds = &[
            b"vault",
            ctx.accounts.auth.to_account_info().key.as_ref(),
            &[ctx.accounts.state.vault_bump],
        ];
        let pda_signer = &[&seeds[..]];
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            transfer_accounts,
            pda_signer,
        );
        transfer(cpi_ctx, amount)?;

        ctx.accounts.state.balance -= amount;
        Ok(())
    }
}
#[derive(Accounts)]
pub struct InitializeContext<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = Vault::MAX_SIZE,
        seeds = [b"state",
        owner.key().as_ref()],
        bump,
    )]
    pub state: Account<'info, Vault>,
    #[account(seeds = [b"auth", state.key().as_ref()], bump)]
    /// CHECK: This acc is safe
    pub auth: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"vault", auth.key().as_ref()], bump)]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositContext<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"auth", state.key().as_ref()], bump = state.auth_bump)]
    /// CHECK: This acc is safe
    pub auth: UncheckedAccount<'info>,
    #[account(seeds = [b"state", owner.key().as_ref()], bump = state.state_bump)]
    pub state: Account<'info, Vault>,
    #[account(mut, seeds = [b"vault", auth.key().as_ref()], bump = state.vault_bump)]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawContext<'info> {
    #[account(mut, seeds = [b"vault", auth.key().as_ref()], bump = state.vault_bump)]
    pub vault: SystemAccount<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"auth", state.key().as_ref()], bump = state.auth_bump)]
    /// CHECK: This acc is safe
    pub auth: UncheckedAccount<'info>,
    #[account(seeds = [b"state", owner.key().as_ref()], bump = state.state_bump)]
    pub state: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub balance: u64,
    pub state_bump: u8,
    pub auth_bump: u8,
    pub vault_bump: u8,
}

impl Vault {
    const MAX_SIZE: usize = 8 + 32 + 2 + 32 + 32 + 1 + 1;
}
