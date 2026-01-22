use anchor_lang::prelude::*;

use crate::errors::PaymentError;
use crate::state::{Config, Relayer, ServerSigner};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [Config::SEED],
        bump
    )]
    pub config: Account<'info, Config>,

    /// Emergency admin for pause/unpause
    /// CHECK: Just storing the address, validated in handler
    pub emergency_admin: UncheckedAccount<'info>,

    /// Initial server signer for payment verification
    /// CHECK: Just storing the address, validated in handler
    pub server_signer: UncheckedAccount<'info>,

    /// Server signer PDA account (created during initialization)
    #[account(
        init,
        payer = authority,
        space = 8 + ServerSigner::INIT_SPACE,
        seeds = [ServerSigner::SEED, server_signer.key().as_ref()],
        bump
    )]
    pub server_signer_account: Account<'info, ServerSigner>,

    /// Fee recipient account (receives platform fees)
    /// CHECK: Just storing the address, validated in handler
    pub fee_recipient: UncheckedAccount<'info>,

    /// Initial relayer for gasless transactions
    /// CHECK: Just storing the address, validated in handler
    pub relayer: UncheckedAccount<'info>,

    /// Relayer PDA account (created during initialization)
    #[account(
        init,
        payer = authority,
        space = 8 + Relayer::INIT_SPACE,
        seeds = [Relayer::SEED, relayer.key().as_ref()],
        bump
    )]
    pub relayer_account: Account<'info, Relayer>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_handler(ctx: Context<Initialize>) -> Result<()> {
    // Zero address validation
    require!(
        ctx.accounts.emergency_admin.key() != Pubkey::default(),
        PaymentError::InvalidAddress
    );
    require!(
        ctx.accounts.server_signer.key() != Pubkey::default(),
        PaymentError::InvalidAddress
    );
    require!(
        ctx.accounts.fee_recipient.key() != Pubkey::default(),
        PaymentError::InvalidAddress
    );
    require!(
        ctx.accounts.relayer.key() != Pubkey::default(),
        PaymentError::InvalidAddress
    );

    // Initialize config
    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.emergency_admin = ctx.accounts.emergency_admin.key();
    config.fee_recipient = ctx.accounts.fee_recipient.key();
    config.paused = false;
    config.bump = ctx.bumps.config;

    // Initialize first server signer PDA
    let server_signer = &mut ctx.accounts.server_signer_account;
    server_signer.signer = ctx.accounts.server_signer.key();
    server_signer.is_active = true;
    server_signer.bump = ctx.bumps.server_signer_account;

    // Initialize first relayer PDA
    let relayer = &mut ctx.accounts.relayer_account;
    relayer.relayer = ctx.accounts.relayer.key();
    relayer.is_active = true;
    relayer.bump = ctx.bumps.relayer_account;

    msg!("Config initialized");
    msg!("Authority: {}", config.authority);
    msg!("Emergency admin: {}", config.emergency_admin);
    msg!("Fee recipient: {}", config.fee_recipient);
    msg!("Initial server signer: {}", server_signer.signer);
    msg!("Initial relayer: {}", relayer.relayer);

    Ok(())
}
