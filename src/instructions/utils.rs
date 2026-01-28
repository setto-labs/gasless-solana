use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::{
    load_current_index_checked, load_instruction_at_checked,
};

use crate::errors::PaymentError;

/// Ed25519 program ID (official Solana precompile)
pub mod ed25519_program {
    anchor_lang::declare_id!("Ed25519SigVerify111111111111111111111111111");
}

/// Common payment parameters for signature verification
/// Note: fee_recipient is NOT included - it's passed as instruction param
/// and protected by relayer TX signature (same as EVM pattern)
pub struct PaymentMessageParams {
    pub payment_id: u64,
    pub amount: u64,
    pub fee_amount: u64,
    pub deadline: i64,
}

/// Verify Ed25519 server signature
/// The signature must be verified via Ed25519 program instruction before this program
pub fn verify_server_signature(
    instructions_sysvar: &AccountInfo,
    server_signer: &Pubkey,
    params: &PaymentMessageParams,
    user: &Pubkey,
    pool: &Pubkey,
    to: &Pubkey,
    token_mint: &Pubkey,
) -> Result<()> {
    let message = build_payment_message(params, user, pool, to, token_mint);

    let current_index = load_current_index_checked(instructions_sysvar)?;

    if current_index == 0 {
        return Err(PaymentError::InvalidServerSignature.into());
    }

    let ed25519_ix = load_instruction_at_checked((current_index - 1) as usize, instructions_sysvar)?;

    if ed25519_ix.program_id != ed25519_program::ID {
        return Err(PaymentError::InvalidServerSignature.into());
    }

    let ix_data = &ed25519_ix.data;

    if ix_data.len() < 16 {
        return Err(PaymentError::InvalidServerSignature.into());
    }

    // Extract public key
    let pubkey_offset = u16::from_le_bytes([ix_data[6], ix_data[7]]) as usize;
    if ix_data.len() < pubkey_offset + 32 {
        return Err(PaymentError::InvalidServerSignature.into());
    }
    let pubkey_in_ix = &ix_data[pubkey_offset..pubkey_offset + 32];

    if pubkey_in_ix != server_signer.to_bytes() {
        return Err(PaymentError::InvalidServerSignature.into());
    }

    // Extract and verify message
    let message_offset = u16::from_le_bytes([ix_data[10], ix_data[11]]) as usize;
    let message_size = u16::from_le_bytes([ix_data[12], ix_data[13]]) as usize;

    if ix_data.len() < message_offset + message_size {
        return Err(PaymentError::InvalidServerSignature.into());
    }
    let message_in_ix = &ix_data[message_offset..message_offset + message_size];

    if message_in_ix != message.as_slice() {
        return Err(PaymentError::InvalidServerSignature.into());
    }

    Ok(())
}

/// Build the message to be signed by the server
/// Format (same as EVM - fee_recipient NOT included):
/// - payment_id (8 bytes, u64)
/// - user (32 bytes, Pubkey)
/// - pool (32 bytes, Pubkey)
/// - to (32 bytes, Pubkey)
/// - token (32 bytes, Pubkey)
/// - amount (8 bytes, u64)
/// - fee_amount (8 bytes, u64)
/// - deadline (8 bytes, i64)
/// Total: 160 bytes
pub fn build_payment_message(
    params: &PaymentMessageParams,
    user: &Pubkey,
    pool: &Pubkey,
    to: &Pubkey,
    token_mint: &Pubkey,
) -> Vec<u8> {
    // 8 + 32 + 32 + 32 + 32 + 8 + 8 + 8 = 160 bytes
    let mut message = Vec::with_capacity(160);
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
