use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use super::utils::{verify_server_signature, PaymentMessageParams};
use crate::errors::PaymentError;
use crate::state::{Config, Delegate, Relayer, ServerSigner};

#[derive(Accounts)]
#[instruction(params: ProcessPaymentDelegatedParams)]
pub struct ProcessPaymentDelegated<'info> {
    /// Payer for transaction fees (must be authorized relayer)
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Relayer PDA - validates payer is an authorized relayer
    #[account(
        seeds = [Relayer::SEED, payer.key().as_ref()],
        bump = relayer_account.bump,
        constraint = relayer_account.is_active @ PaymentError::UnauthorizedRelayer
    )]
    pub relayer_account: Account<'info, Relayer>,

    /// User who owns the tokens (NOT a signer - delegate handles transfer)
    /// CHECK: User doesn't need to sign, delegate PDA has transfer authority
    pub user: AccountInfo<'info>,

    #[account(
        seeds = [Config::SEED],
        bump = config.bump,
        constraint = !config.paused @ PaymentError::Paused
    )]
    pub config: Account<'info, Config>,

    /// Delegate PDA - has authority to transfer tokens on behalf of users
    #[account(
        seeds = [Delegate::SEED],
        bump = delegate.bump,
    )]
    pub delegate: Account<'info, Delegate>,

    /// Server signer PDA - validates the signature came from an authorized signer
    #[account(
        seeds = [ServerSigner::SEED, params.server_signer.as_ref()],
        bump = server_signer_account.bump,
        constraint = server_signer_account.is_active @ PaymentError::UnauthorizedServerSigner
    )]
    pub server_signer_account: Account<'info, ServerSigner>,

    /// Token mint (for signature verification binding)
    pub token_mint: Account<'info, Mint>,

    /// User's token account (source)
    /// Must have delegate set to our Delegate PDA with sufficient delegated_amount
    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.mint == token_mint.key(),
        constraint = user_token_account.delegate.is_some() @ PaymentError::DelegateNotSet,
        constraint = user_token_account.delegate.unwrap() == delegate.key() @ PaymentError::InvalidDelegate,
        constraint = user_token_account.delegated_amount >= params.amount + params.fee_amount @ PaymentError::InsufficientDelegatedAmount
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// Pool's token account (receives payment amount)
    #[account(
        mut,
        constraint = pool_token_account.mint == token_mint.key()
    )]
    pub pool_token_account: Account<'info, TokenAccount>,

    /// Fee recipient's token account (receives fee)
    #[account(
        mut,
        constraint = fee_token_account.owner == params.fee_recipient @ PaymentError::InvalidFeeRecipient,
        constraint = fee_token_account.mint == token_mint.key()
    )]
    pub fee_token_account: Account<'info, TokenAccount>,

    /// Settlement target address (to) - for event memo/tracking only
    /// CHECK: Only used in signature verification and event logging, no token transfer
    pub to: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,

    /// Instructions sysvar for Ed25519 signature verification
    /// CHECK: Validated by address constraint
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProcessPaymentDelegatedParams {
    pub amount: u64,
    pub fee_amount: u64,
    pub fee_recipient: Pubkey,
    pub payment_id: u64,
    pub deadline: i64,
    pub server_signer: Pubkey,
    pub server_signature: [u8; 64],
}

pub fn process_payment_delegated_handler(
    ctx: Context<ProcessPaymentDelegated>,
    params: ProcessPaymentDelegatedParams,
) -> Result<()> {
    // 1. Deadline validation
    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp <= params.deadline,
        PaymentError::PaymentExpired
    );

    // 2. Server signature verification (Ed25519)
    // Note: fee_recipient is NOT in server signature (same as EVM)
    // It's passed as instruction param and protected by relayer TX signature
    let msg_params = PaymentMessageParams {
        payment_id: params.payment_id,
        amount: params.amount,
        fee_amount: params.fee_amount,
        deadline: params.deadline,
    };
    verify_server_signature(
        &ctx.accounts.instructions_sysvar,
        &params.server_signer,
        &msg_params,
        &ctx.accounts.user.key(),
        &ctx.accounts.pool_token_account.owner,
        &ctx.accounts.to.key(),
        &ctx.accounts.token_mint.key(),
    )?;

    // 3. Amount validation
    require!(params.amount > 0, PaymentError::InvalidAmount);

    // 4. Transfer amount to pool using Delegate PDA
    let delegate_seeds = &[Delegate::SEED, &[ctx.accounts.delegate.bump]];
    let signer_seeds = &[&delegate_seeds[..]];

    let transfer_to_pool = Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.pool_token_account.to_account_info(),
        authority: ctx.accounts.delegate.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            transfer_to_pool,
            signer_seeds,
        ),
        params.amount,
    )?;

    // 5. Transfer fee to platform
    if params.fee_amount > 0 {
        let transfer_to_fee = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.fee_token_account.to_account_info(),
            authority: ctx.accounts.delegate.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                transfer_to_fee,
                signer_seeds,
            ),
            params.fee_amount,
        )?;
    }

    // 6. Emit payment log
    msg!("PAYMENT_PROCESSED_DELEGATED");
    msg!("payment_id: {}", params.payment_id);
    msg!("from: {}", ctx.accounts.user.key());
    msg!("to: {}", ctx.accounts.to.key());
    msg!("pool: {}", ctx.accounts.pool_token_account.owner);
    msg!("token: {}", ctx.accounts.token_mint.key());
    msg!("amount: {}", params.amount);
    msg!("fee: {}", params.fee_amount);
    msg!("fee_recipient: {}", params.fee_recipient);

    Ok(())
}
