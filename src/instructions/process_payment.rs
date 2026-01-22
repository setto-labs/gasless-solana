use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::{
    load_current_index_checked, load_instruction_at_checked,
};

// Ed25519 program ID (official Solana precompile)
pub mod ed25519_program {
    anchor_lang::declare_id!("Ed25519SigVerify111111111111111111111111111");
}
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::errors::PaymentError;
use crate::state::{Config, Relayer, ServerSigner};

#[derive(Accounts)]
#[instruction(params: ProcessPaymentParams)]
pub struct ProcessPayment<'info> {
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

    /// User who owns the tokens (from)
    pub user: Signer<'info>,

    #[account(
        seeds = [Config::SEED],
        bump = config.bump,
        constraint = !config.paused @ PaymentError::Paused
    )]
    pub config: Account<'info, Config>,

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
    #[account(
        mut,
        constraint = user_token_account.owner == user.key(),
        constraint = user_token_account.mint == token_mint.key()
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
        constraint = fee_token_account.owner == config.fee_recipient,
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
pub struct ProcessPaymentParams {
    /// Total payment amount
    pub amount: u64,
    /// Platform fee amount (subtracted from amount)
    pub fee_amount: u64,
    /// Unique payment identifier for tracking
    pub payment_id: u64,
    /// Payment deadline (Unix timestamp)
    pub deadline: i64,
    /// Server signer pubkey (for PDA derivation)
    pub server_signer: Pubkey,
    /// Server signature (Ed25519)
    pub server_signature: [u8; 64],
}

pub fn process_payment_handler(ctx: Context<ProcessPayment>, params: ProcessPaymentParams) -> Result<()> {
    // 1. Deadline validation
    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp <= params.deadline,
        PaymentError::PaymentExpired
    );

    // 2. Server signature verification (Ed25519)
    // Message includes: payment_id, user, pool, to, token, amount, fee, deadline (same as EVM)
    // ServerSigner PDA validation ensures only authorized signers can sign
    verify_server_signature(
        &ctx.accounts.instructions_sysvar,
        &params.server_signer,
        &params,
        &ctx.accounts.user.key(),
        &ctx.accounts.pool_token_account.owner,
        &ctx.accounts.to.key(),
        &ctx.accounts.token_mint.key(),
    )?;

    // 3. Amount validation
    require!(params.amount > 0, PaymentError::InvalidAmount);

    // 4. Transfer amount to pool
    let transfer_to_pool = Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.pool_token_account.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            transfer_to_pool,
        ),
        params.amount,
    )?;

    // 5. Transfer fee to platform (same as EVM: p.fee -> feeWallet)
    if params.fee_amount > 0 {
        let transfer_to_fee = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.fee_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                transfer_to_fee,
            ),
            params.fee_amount,
        )?;
    }

    // 6. Emit payment log for tracking (same as EVM PaymentExecuted event)
    msg!("PAYMENT_PROCESSED");
    msg!("payment_id: {}", params.payment_id);
    msg!("from: {}", ctx.accounts.user.key());
    msg!("to: {}", ctx.accounts.to.key());
    msg!("pool: {}", ctx.accounts.pool_token_account.owner);
    msg!("token: {}", ctx.accounts.token_mint.key());
    msg!("amount: {}", params.amount);
    msg!("fee: {}", params.fee_amount);

    Ok(())
}

/// Verify Ed25519 server signature
/// The signature must be verified via Ed25519 program instruction before this program
fn verify_server_signature(
    instructions_sysvar: &AccountInfo,
    server_signer: &Pubkey,
    params: &ProcessPaymentParams,
    user: &Pubkey,
    pool: &Pubkey,
    to: &Pubkey,
    token_mint: &Pubkey,
) -> Result<()> {
    // Build the message that was signed (same as EVM)
    let message = build_payment_message(params, user, pool, to, token_mint);

    // Get the current instruction index
    let current_index = load_current_index_checked(instructions_sysvar)?;

    // Ed25519 verification instruction should be right before this instruction
    if current_index == 0 {
        return Err(PaymentError::InvalidServerSignature.into());
    }

    let ed25519_ix = load_instruction_at_checked((current_index - 1) as usize, instructions_sysvar)?;

    // Verify it's an Ed25519 program instruction
    if ed25519_ix.program_id != ed25519_program::ID {
        return Err(PaymentError::InvalidServerSignature.into());
    }

    // Parse Ed25519 instruction data
    // Format: num_signatures (1 byte) + padding (1 byte) + signature_offset (2 bytes) +
    //         signature_instruction_index (2 bytes) + public_key_offset (2 bytes) +
    //         public_key_instruction_index (2 bytes) + message_data_offset (2 bytes) +
    //         message_data_size (2 bytes) + message_instruction_index (2 bytes)
    //         + signature (64 bytes) + pubkey (32 bytes) + message (variable)
    let ix_data = &ed25519_ix.data;

    if ix_data.len() < 16 {
        return Err(PaymentError::InvalidServerSignature.into());
    }

    // Extract public key from instruction (at offset specified in header)
    let pubkey_offset = u16::from_le_bytes([ix_data[6], ix_data[7]]) as usize;
    if ix_data.len() < pubkey_offset + 32 {
        return Err(PaymentError::InvalidServerSignature.into());
    }
    let pubkey_in_ix = &ix_data[pubkey_offset..pubkey_offset + 32];

    // Verify the public key matches our server signer
    if pubkey_in_ix != server_signer.to_bytes() {
        return Err(PaymentError::InvalidServerSignature.into());
    }

    // Extract and verify the message
    let message_offset = u16::from_le_bytes([ix_data[10], ix_data[11]]) as usize;
    let message_size = u16::from_le_bytes([ix_data[12], ix_data[13]]) as usize;

    if ix_data.len() < message_offset + message_size {
        return Err(PaymentError::InvalidServerSignature.into());
    }
    let message_in_ix = &ix_data[message_offset..message_offset + message_size];

    // Verify message matches
    if message_in_ix != message.as_slice() {
        return Err(PaymentError::InvalidServerSignature.into());
    }

    Ok(())
}

/// Build the message to be signed by the server
/// Format matches EVM PAYMENT_TYPEHASH:
/// - payment_id (8 bytes, u64)
/// - user (32 bytes, Pubkey) - from address
/// - pool (32 bytes, Pubkey) - actual token recipient
/// - to (32 bytes, Pubkey) - settlement target (for tracking)
/// - token (32 bytes, Pubkey - mint address)
/// - amount (8 bytes, u64)
/// - fee (8 bytes, u64)
/// - deadline (8 bytes, i64)
fn build_payment_message(
    params: &ProcessPaymentParams,
    user: &Pubkey,
    pool: &Pubkey,
    to: &Pubkey,
    token_mint: &Pubkey,
) -> Vec<u8> {
    let mut message = Vec::new();
    message.extend_from_slice(&params.payment_id.to_le_bytes());
    message.extend_from_slice(user.as_ref());
    message.extend_from_slice(pool.as_ref());
    message.extend_from_slice(to.as_ref());
    message.extend_from_slice(token_mint.as_ref());
    message.extend_from_slice(&params.amount.to_le_bytes());
    message.extend_from_slice(&params.fee_amount.to_le_bytes());
    message.extend_from_slice(&params.deadline.to_le_bytes());
    message
}
