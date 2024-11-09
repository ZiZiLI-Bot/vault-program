use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("4oR8fjhKmZrfbYaDKYTXo7f94hFugbWW3gz7X8Yu6etX");

#[program]
pub mod vault_program {
    use super::*;
    pub fn initialize(ctx: Context<InitializeContext>, interest_rate: u64) -> Result<()> {
        ctx.accounts.state.owner = ctx.accounts.owner.key();
        ctx.accounts.state.state_bump = ctx.bumps.state;
        ctx.accounts.state.auth_bump = ctx.bumps.auth;
        ctx.accounts.state.vault_bump = ctx.bumps.vault;
        ctx.accounts.state.deposit_amount = 0;
        ctx.accounts.state.deposit_time = 0;
        ctx.accounts.state.interest_rate = interest_rate; // Tỷ lệ lãi suất (ví dụ: 500 = 5%)
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

        // Cập nhật thông tin về số tiền gửi và thời gian
        ctx.accounts.state.deposit_amount = amount;
        ctx.accounts.state.deposit_time = Clock::get()?.unix_timestamp;

        Ok(())
    }

    pub fn withdraw(ctx: Context<WithdrawContext>, amount: u64) -> Result<()> {
        // Tính toán lãi suất
        let current_time = Clock::get()?.unix_timestamp;
        let time_elapsed = current_time - ctx.accounts.state.deposit_time;

        // Chuyển đổi thời gian từ giây sang năm (approximate)
        let years_elapsed = time_elapsed as f64 / (365.0 * 24.0 * 60.0 * 60.0);

        // Tính số tiền lãi (interest_rate * 100)
        let interest_rate = ctx.accounts.state.interest_rate as f64 / 10000.0; // Convert to decimal
        let interest_amount =
            (ctx.accounts.state.deposit_amount as f64 * interest_rate * years_elapsed) as u64;

        // Tổng số tiền cần rút (gốc + lãi)
        let total_withdrawal = amount
            .checked_add(interest_amount)
            .ok_or(ErrorCode::NumberOverflow)?;

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

        // Kiểm tra số dư trong vault
        require!(
            ctx.accounts.vault.lamports() >= total_withdrawal,
            ErrorCode::InsufficientFunds
        );

        transfer(cpi_ctx, total_withdrawal)?;

        // Reset deposit information
        ctx.accounts.state.deposit_amount = 0;
        ctx.accounts.state.deposit_time = 0;

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
    #[account(mut, seeds = [b"state", owner.key().as_ref()], bump = state.state_bump)]
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
    #[account(mut, seeds = [b"state", owner.key().as_ref()], bump = state.state_bump)]
    pub state: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub state_bump: u8,
    pub auth_bump: u8,
    pub vault_bump: u8,
    pub deposit_amount: u64, // Số tiền gửi
    pub deposit_time: i64,   // Thời điểm gửi tiền
    pub interest_rate: u64,  // Tỷ lệ lãi suất (500 = 5%)
}

impl Vault {
    const MAX_SIZE: usize = 8 + 32 + 1 + 1 + 1 + 8 + 8 + 8;
}

#[error_code]
pub enum ErrorCode {
    #[msg("Insufficient funds in vault")]
    InsufficientFunds,
    #[msg("Number overflow occurred")]
    NumberOverflow,
}
