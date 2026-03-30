use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use super::utils::{build_pool_payment_message, emit_memo, verify_server_signature};
use crate::errors::PaymentError;
use crate::state::{Config, ServerSigner};

#[derive(Accounts)]
#[instruction(params: PoolPaymentParams)]
pub struct ProcessPoolPayment<'info> {
    /// Payer for transaction fees (anyone — no relayer constraint in V2)
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Token owner (sender)
    pub sender: Signer<'info>,

    #[account(
        seeds = [Config::SEED],
        bump = config.bump,
        constraint = !config.paused @ PaymentError::Paused
    )]
    pub config: Account<'info, Config>,

    /// Server signer PDA — validates the signature came from an authorized signer
    #[account(
        seeds = [ServerSigner::SEED, params.server_signer.as_ref()],
        bump = server_signer_account.bump,
        constraint = server_signer_account.is_active @ PaymentError::UnauthorizedServerSigner
    )]
    pub server_signer_account: Account<'info, ServerSigner>,

    /// Token mint (SPL Token or Token-2022)
    pub token_mint: InterfaceAccount<'info, Mint>,

    /// Sender's token account (source)
    #[account(
        mut,
        constraint = sender_token_account.owner == sender.key(),
        constraint = sender_token_account.mint == token_mint.key()
    )]
    pub sender_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Pool's token account (receives totalAmount — single transfer)
    #[account(
        mut,
        constraint = pool_token_account.mint == token_mint.key()
    )]
    pub pool_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Memo program for permanent on-chain logging
    /// CHECK: Validated by address constraint
    #[account(address = spl_memo::ID)]
    pub memo_program: AccountInfo<'info>,

    /// Token program (SPL Token or Token-2022, auto-validated by Interface)
    pub token_program: Interface<'info, TokenInterface>,

    /// Instructions sysvar for Ed25519 signature verification
    /// CHECK: Validated by address constraint
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PoolPaymentParams {
    pub payment_id: [u8; 32],
    pub total_amount: u64,
    pub amount: u64,
    pub service_fee: u64,
    /// Recipient address for tracking (EVM 20B zero-padded or SVM 32B)
    /// Not an on-chain account — stored in memo only
    pub recipient: [u8; 32],
    pub deadline: i64,
    pub server_signer: Pubkey,
    pub server_signature: [u8; 64],
}

pub fn process_pool_payment_handler(
    ctx: Context<ProcessPoolPayment>,
    params: PoolPaymentParams,
) -> Result<()> {
    // 1. Deadline validation
    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp <= params.deadline,
        PaymentError::PaymentExpired
    );

    // 2. Amount validation (checked_add — overflow-safe)
    let expected_total = params
        .amount
        .checked_add(params.service_fee)
        .ok_or(PaymentError::AmountMismatch)?;
    require!(params.total_amount == expected_total, PaymentError::AmountMismatch);
    require!(params.amount > 0, PaymentError::InvalidAmount);

    // 3. Server signature verification (Ed25519)
    let message = build_pool_payment_message(
        &params.payment_id,
        &ctx.accounts.sender.key(),
        &ctx.accounts.pool_token_account.owner,
        &params.recipient,
        &ctx.accounts.token_mint.key(),
        params.total_amount,
        params.amount,
        params.service_fee,
        params.deadline,
    );
    verify_server_signature(
        &ctx.accounts.instructions_sysvar,
        &params.server_signer,
        &message,
    )?;

    // 4. Single transfer: sender → pool (totalAmount)
    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.sender_token_account.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                to: ctx.accounts.pool_token_account.to_account_info(),
                authority: ctx.accounts.sender.to_account_info(),
            },
        ),
        params.total_amount,
        ctx.accounts.token_mint.decimals,
    )?;

    // 5. Emit permanent on-chain memo
    let payment_id_hex = params
        .payment_id
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<String>();
    let recipient_hex = params
        .recipient
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<String>();
    let memo = format!(
        "POOL_PAYMENT|{}|{}|{}|{}|{}|{}|{}",
        payment_id_hex,
        ctx.accounts.sender.key(),
        ctx.accounts.pool_token_account.owner,
        recipient_hex,
        params.total_amount,
        params.amount,
        params.service_fee,
    );
    emit_memo(&ctx.accounts.memo_program, &memo)?;

    Ok(())
}
