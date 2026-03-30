use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::{
    load_current_index_checked, load_instruction_at_checked,
};

use crate::errors::PaymentError;

/// Ed25519 program ID (official Solana precompile)
pub mod ed25519_program {
    anchor_lang::declare_id!("Ed25519SigVerify111111111111111111111111111");
}

/// Verify Ed25519 server signature from the preceding instruction.
///
/// Security model: In V2, server signature is the ONLY authorization mechanism
/// (relayer constraint removed). If this function has a bug, the entire program
/// is compromised. The caller builds the message and passes it as `&[u8]`.
///
/// V2 security fixes over V1:
/// - [S1] instruction_index fields validated == u16::MAX (prevents Wrong Offset attack)
/// - [S2] num_signatures == 1 validated (prevents multi-signature confusion)
pub fn verify_server_signature(
    instructions_sysvar: &AccountInfo,
    server_signer: &Pubkey,
    message: &[u8],
) -> Result<()> {
    let current_index = load_current_index_checked(instructions_sysvar)?;

    if current_index == 0 {
        return Err(PaymentError::InvalidServerSignature.into());
    }

    let ed25519_ix =
        load_instruction_at_checked((current_index - 1) as usize, instructions_sysvar)?;

    if ed25519_ix.program_id != ed25519_program::ID {
        return Err(PaymentError::InvalidServerSignature.into());
    }

    let ix_data = &ed25519_ix.data;

    // Ed25519SignatureOffsets layout (anza-xyz/solana-sdk):
    // [0]      num_signatures (u8)
    // [1]      padding (u8)
    // [2..4]   signature_offset (u16 LE)
    // [4..6]   signature_instruction_index (u16 LE)
    // [6..8]   public_key_offset (u16 LE)
    // [8..10]  public_key_instruction_index (u16 LE)
    // [10..12] message_data_offset (u16 LE)
    // [12..14] message_data_size (u16 LE)
    // [14..16] message_instruction_index (u16 LE)

    if ix_data.len() < 16 {
        return Err(PaymentError::InvalidServerSignature.into());
    }

    // [S2] Exactly one signature must be present
    if ix_data[0] != 1 {
        return Err(PaymentError::InvalidServerSignature.into());
    }

    // [S1] CRITICAL: All instruction_index fields must be u16::MAX.
    // u16::MAX means "read data from THIS instruction's data buffer".
    // Any other value means "read from a DIFFERENT instruction" — an attacker
    // could craft a transaction where Ed25519 precompile verifies their own key
    // from instruction[N], while our code reads the legitimate server_signer
    // from the Ed25519 instruction's data at pubkey_offset. This mismatch
    // allows signature verification bypass.
    // Reference: Asymmetric Research "Wrong Offset: Bypassing Signature Verification in Relay"
    let sig_ix_index = u16::from_le_bytes([ix_data[4], ix_data[5]]);
    let pubkey_ix_index = u16::from_le_bytes([ix_data[8], ix_data[9]]);
    let msg_ix_index = u16::from_le_bytes([ix_data[14], ix_data[15]]);

    if sig_ix_index != u16::MAX {
        return Err(PaymentError::InvalidServerSignature.into());
    }
    if pubkey_ix_index != u16::MAX {
        return Err(PaymentError::InvalidServerSignature.into());
    }
    if msg_ix_index != u16::MAX {
        return Err(PaymentError::InvalidServerSignature.into());
    }

    // Extract and verify public key
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

    if message_in_ix != message {
        return Err(PaymentError::InvalidServerSignature.into());
    }

    Ok(())
}

/// Build the Direct payment message to be signed by the server.
///
/// Format (192 bytes, all little-endian):
/// [0-31]     paymentId ([u8; 32])
/// [32-63]    sender (Pubkey)
/// [64-95]    recipient (Pubkey)
/// [96-127]   feeWallet (Pubkey) — V2: included in signature (V1 excluded → tampering risk)
/// [128-159]  token (Pubkey)
/// [160-167]  totalAmount (u64)
/// [168-175]  amount (u64)
/// [176-183]  protocolFee (u64)
/// [184-191]  deadline (i64)
pub fn build_direct_payment_message(
    payment_id: &[u8; 32],
    sender: &Pubkey,
    recipient: &Pubkey,
    fee_wallet: &Pubkey,
    token_mint: &Pubkey,
    total_amount: u64,
    amount: u64,
    protocol_fee: u64,
    deadline: i64,
) -> Vec<u8> {
    let mut message = Vec::with_capacity(192);
    message.extend_from_slice(payment_id);
    message.extend_from_slice(sender.as_ref());
    message.extend_from_slice(recipient.as_ref());
    message.extend_from_slice(fee_wallet.as_ref());
    message.extend_from_slice(token_mint.as_ref());
    message.extend_from_slice(&total_amount.to_le_bytes());
    message.extend_from_slice(&amount.to_le_bytes());
    message.extend_from_slice(&protocol_fee.to_le_bytes());
    message.extend_from_slice(&deadline.to_le_bytes());
    message
}

/// Build the Pool payment message to be signed by the server.
///
/// Format (192 bytes, all little-endian):
/// [0-31]     paymentId ([u8; 32])
/// [32-63]    sender (Pubkey)
/// [64-95]    pool (Pubkey)
/// [96-127]   recipient ([u8; 32]) — tracking only, EVM/SVM address
/// [128-159]  token (Pubkey)
/// [160-167]  totalAmount (u64)
/// [168-175]  amount (u64)
/// [176-183]  serviceFee (u64)
/// [184-191]  deadline (i64)
pub fn build_pool_payment_message(
    payment_id: &[u8; 32],
    sender: &Pubkey,
    pool: &Pubkey,
    recipient: &[u8; 32],
    token_mint: &Pubkey,
    total_amount: u64,
    amount: u64,
    service_fee: u64,
    deadline: i64,
) -> Vec<u8> {
    let mut message = Vec::with_capacity(192);
    message.extend_from_slice(payment_id);
    message.extend_from_slice(sender.as_ref());
    message.extend_from_slice(pool.as_ref());
    message.extend_from_slice(recipient);
    message.extend_from_slice(token_mint.as_ref());
    message.extend_from_slice(&total_amount.to_le_bytes());
    message.extend_from_slice(&amount.to_le_bytes());
    message.extend_from_slice(&service_fee.to_le_bytes());
    message.extend_from_slice(&deadline.to_le_bytes());
    message
}

/// Emit a memo via the Memo Program CPI (permanent on-chain record).
/// Replaces msg! which is prunable by nodes.
pub fn emit_memo(memo_program: &AccountInfo, memo: &str) -> Result<()> {
    anchor_lang::solana_program::program::invoke(
        &spl_memo::build_memo(memo.as_bytes(), &[]),
        &[memo_program.clone()],
    )?;
    Ok(())
}
