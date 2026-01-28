use anchor_lang::prelude::*;

use crate::errors::PaymentError;
use crate::state::{Config, Relayer, ServerSigner};

// ============================================
// Pause / Unpause (Emergency Admin Only)
// ============================================

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(
        constraint = emergency_admin.key() == config.emergency_admin @ PaymentError::UnauthorizedEmergencyAdmin
    )]
    pub emergency_admin: Signer<'info>,

    #[account(
        mut,
        seeds = [Config::SEED],
        bump = config.bump,
        constraint = !config.paused @ PaymentError::Paused
    )]
    pub config: Account<'info, Config>,
}

pub fn pause_handler(ctx: Context<Pause>) -> Result<()> {
    ctx.accounts.config.paused = true;
    msg!("Program paused by {}", ctx.accounts.emergency_admin.key());
    Ok(())
}

#[derive(Accounts)]
pub struct Unpause<'info> {
    #[account(
        constraint = emergency_admin.key() == config.emergency_admin @ PaymentError::UnauthorizedEmergencyAdmin
    )]
    pub emergency_admin: Signer<'info>,

    #[account(
        mut,
        seeds = [Config::SEED],
        bump = config.bump,
        constraint = config.paused @ PaymentError::NotPaused
    )]
    pub config: Account<'info, Config>,
}

pub fn unpause_handler(ctx: Context<Unpause>) -> Result<()> {
    ctx.accounts.config.paused = false;
    msg!("Program unpaused by {}", ctx.accounts.emergency_admin.key());
    Ok(())
}

// ============================================
// Set Emergency Admin (Authority Only)
// ============================================

#[derive(Accounts)]
pub struct SetEmergencyAdmin<'info> {
    #[account(
        constraint = authority.key() == config.authority @ PaymentError::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [Config::SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    /// New emergency admin address
    /// CHECK: Just storing the address, validated in handler
    pub new_emergency_admin: UncheckedAccount<'info>,
}

pub fn set_emergency_admin_handler(ctx: Context<SetEmergencyAdmin>) -> Result<()> {
    require!(
        ctx.accounts.new_emergency_admin.key() != Pubkey::default(),
        PaymentError::InvalidAddress
    );

    let old_admin = ctx.accounts.config.emergency_admin;
    ctx.accounts.config.emergency_admin = ctx.accounts.new_emergency_admin.key();

    msg!("Emergency admin changed: {} -> {}", old_admin, ctx.accounts.new_emergency_admin.key());
    Ok(())
}

// ============================================
// Add Server Signer (Authority Only)
// ============================================

#[derive(Accounts)]
pub struct AddServerSigner<'info> {
    #[account(
        mut,
        constraint = authority.key() == config.authority @ PaymentError::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(
        seeds = [Config::SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    /// New server signer address
    /// CHECK: Just storing the address, validated in handler
    pub new_server_signer: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + ServerSigner::INIT_SPACE,
        seeds = [ServerSigner::SEED, new_server_signer.key().as_ref()],
        bump
    )]
    pub server_signer_account: Account<'info, ServerSigner>,

    pub system_program: Program<'info, System>,
}

pub fn add_server_signer_handler(ctx: Context<AddServerSigner>) -> Result<()> {
    require!(
        ctx.accounts.new_server_signer.key() != Pubkey::default(),
        PaymentError::InvalidAddress
    );

    let server_signer = &mut ctx.accounts.server_signer_account;
    server_signer.signer = ctx.accounts.new_server_signer.key();
    server_signer.is_active = true;
    server_signer.bump = ctx.bumps.server_signer_account;

    msg!("Server signer added: {}", ctx.accounts.new_server_signer.key());
    Ok(())
}

// ============================================
// Remove Server Signer (Authority Only)
// ============================================

#[derive(Accounts)]
pub struct RemoveServerSigner<'info> {
    #[account(
        mut,
        constraint = authority.key() == config.authority @ PaymentError::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(
        seeds = [Config::SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    /// Server signer to remove
    /// CHECK: Used for PDA derivation
    pub server_signer_to_remove: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [ServerSigner::SEED, server_signer_to_remove.key().as_ref()],
        bump = server_signer_account.bump,
        close = authority
    )]
    pub server_signer_account: Account<'info, ServerSigner>,
}

pub fn remove_server_signer_handler(ctx: Context<RemoveServerSigner>) -> Result<()> {
    msg!("Server signer removed: {}", ctx.accounts.server_signer_to_remove.key());
    Ok(())
}

// ============================================
// Emergency Add Server Signer (Emergency Admin Only)
// ============================================

#[derive(Accounts)]
pub struct EmergencyAddServerSigner<'info> {
    #[account(
        mut,
        constraint = emergency_admin.key() == config.emergency_admin @ PaymentError::UnauthorizedEmergencyAdmin
    )]
    pub emergency_admin: Signer<'info>,

    #[account(
        seeds = [Config::SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    /// New server signer address
    /// CHECK: Just storing the address, validated in handler
    pub new_server_signer: UncheckedAccount<'info>,

    #[account(
        init,
        payer = emergency_admin,
        space = 8 + ServerSigner::INIT_SPACE,
        seeds = [ServerSigner::SEED, new_server_signer.key().as_ref()],
        bump
    )]
    pub server_signer_account: Account<'info, ServerSigner>,

    pub system_program: Program<'info, System>,
}

pub fn emergency_add_server_signer_handler(ctx: Context<EmergencyAddServerSigner>) -> Result<()> {
    require!(
        ctx.accounts.new_server_signer.key() != Pubkey::default(),
        PaymentError::InvalidAddress
    );

    let server_signer = &mut ctx.accounts.server_signer_account;
    server_signer.signer = ctx.accounts.new_server_signer.key();
    server_signer.is_active = true;
    server_signer.bump = ctx.bumps.server_signer_account;

    msg!("EMERGENCY: Server signer added by {}: {}",
         ctx.accounts.emergency_admin.key(),
         ctx.accounts.new_server_signer.key());
    Ok(())
}

// ============================================
// Emergency Remove Server Signer (Emergency Admin Only)
// ============================================

#[derive(Accounts)]
pub struct EmergencyRemoveServerSigner<'info> {
    #[account(
        mut,
        constraint = emergency_admin.key() == config.emergency_admin @ PaymentError::UnauthorizedEmergencyAdmin
    )]
    pub emergency_admin: Signer<'info>,

    #[account(
        seeds = [Config::SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    /// Server signer to remove
    /// CHECK: Used for PDA derivation
    pub server_signer_to_remove: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [ServerSigner::SEED, server_signer_to_remove.key().as_ref()],
        bump = server_signer_account.bump,
        close = emergency_admin
    )]
    pub server_signer_account: Account<'info, ServerSigner>,
}

pub fn emergency_remove_server_signer_handler(ctx: Context<EmergencyRemoveServerSigner>) -> Result<()> {
    msg!("EMERGENCY: Server signer removed by {}: {}",
         ctx.accounts.emergency_admin.key(),
         ctx.accounts.server_signer_to_remove.key());
    Ok(())
}

// ============================================
// Transfer Authority
// ============================================

#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    #[account(
        constraint = authority.key() == config.authority @ PaymentError::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [Config::SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    /// New authority address
    /// CHECK: Just storing the address, validated in handler
    pub new_authority: UncheckedAccount<'info>,
}

pub fn transfer_authority_handler(ctx: Context<TransferAuthority>) -> Result<()> {
    require!(
        ctx.accounts.new_authority.key() != Pubkey::default(),
        PaymentError::InvalidAddress
    );

    let old_authority = ctx.accounts.config.authority;
    ctx.accounts.config.authority = ctx.accounts.new_authority.key();

    msg!("Authority transferred: {} -> {}", old_authority, ctx.accounts.new_authority.key());
    Ok(())
}

// ============================================
// Add Relayer (Authority Only)
// ============================================

#[derive(Accounts)]
pub struct AddRelayer<'info> {
    #[account(
        mut,
        constraint = authority.key() == config.authority @ PaymentError::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(
        seeds = [Config::SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    /// New relayer address
    /// CHECK: Just storing the address, validated in handler
    pub new_relayer: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Relayer::INIT_SPACE,
        seeds = [Relayer::SEED, new_relayer.key().as_ref()],
        bump
    )]
    pub relayer_account: Account<'info, Relayer>,

    pub system_program: Program<'info, System>,
}

pub fn add_relayer_handler(ctx: Context<AddRelayer>) -> Result<()> {
    require!(
        ctx.accounts.new_relayer.key() != Pubkey::default(),
        PaymentError::InvalidAddress
    );

    let relayer = &mut ctx.accounts.relayer_account;
    relayer.relayer = ctx.accounts.new_relayer.key();
    relayer.is_active = true;
    relayer.bump = ctx.bumps.relayer_account;

    msg!("Relayer added: {}", ctx.accounts.new_relayer.key());
    Ok(())
}

// ============================================
// Remove Relayer (Authority Only)
// ============================================

#[derive(Accounts)]
pub struct RemoveRelayer<'info> {
    #[account(
        mut,
        constraint = authority.key() == config.authority @ PaymentError::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(
        seeds = [Config::SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    /// Relayer to remove
    /// CHECK: Used for PDA derivation
    pub relayer_to_remove: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [Relayer::SEED, relayer_to_remove.key().as_ref()],
        bump = relayer_account.bump,
        close = authority
    )]
    pub relayer_account: Account<'info, Relayer>,
}

pub fn remove_relayer_handler(ctx: Context<RemoveRelayer>) -> Result<()> {
    msg!("Relayer removed: {}", ctx.accounts.relayer_to_remove.key());
    Ok(())
}

// ============================================
// Emergency Add Relayer (Emergency Admin Only)
// ============================================

#[derive(Accounts)]
pub struct EmergencyAddRelayer<'info> {
    #[account(
        mut,
        constraint = emergency_admin.key() == config.emergency_admin @ PaymentError::UnauthorizedEmergencyAdmin
    )]
    pub emergency_admin: Signer<'info>,

    #[account(
        seeds = [Config::SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    /// New relayer address
    /// CHECK: Just storing the address, validated in handler
    pub new_relayer: UncheckedAccount<'info>,

    #[account(
        init,
        payer = emergency_admin,
        space = 8 + Relayer::INIT_SPACE,
        seeds = [Relayer::SEED, new_relayer.key().as_ref()],
        bump
    )]
    pub relayer_account: Account<'info, Relayer>,

    pub system_program: Program<'info, System>,
}

pub fn emergency_add_relayer_handler(ctx: Context<EmergencyAddRelayer>) -> Result<()> {
    require!(
        ctx.accounts.new_relayer.key() != Pubkey::default(),
        PaymentError::InvalidAddress
    );

    let relayer = &mut ctx.accounts.relayer_account;
    relayer.relayer = ctx.accounts.new_relayer.key();
    relayer.is_active = true;
    relayer.bump = ctx.bumps.relayer_account;

    msg!("EMERGENCY: Relayer added by {}: {}",
         ctx.accounts.emergency_admin.key(),
         ctx.accounts.new_relayer.key());
    Ok(())
}

// ============================================
// Emergency Remove Relayer (Emergency Admin Only)
// ============================================

#[derive(Accounts)]
pub struct EmergencyRemoveRelayer<'info> {
    #[account(
        mut,
        constraint = emergency_admin.key() == config.emergency_admin @ PaymentError::UnauthorizedEmergencyAdmin
    )]
    pub emergency_admin: Signer<'info>,

    #[account(
        seeds = [Config::SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    /// Relayer to remove
    /// CHECK: Used for PDA derivation
    pub relayer_to_remove: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [Relayer::SEED, relayer_to_remove.key().as_ref()],
        bump = relayer_account.bump,
        close = emergency_admin
    )]
    pub relayer_account: Account<'info, Relayer>,
}

pub fn emergency_remove_relayer_handler(ctx: Context<EmergencyRemoveRelayer>) -> Result<()> {
    msg!("EMERGENCY: Relayer removed by {}: {}",
         ctx.accounts.emergency_admin.key(),
         ctx.accounts.relayer_to_remove.key());
    Ok(())
}
