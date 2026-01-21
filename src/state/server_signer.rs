use anchor_lang::prelude::*;

/// Server signer account stored as PDA
/// Seeds: ["server_signer", signer_pubkey]
/// Each authorized signer has its own PDA account
#[account]
#[derive(InitSpace)]
pub struct ServerSigner {
    /// The signer's public key (Ed25519)
    pub signer: Pubkey,
    /// Whether this signer is currently active
    pub is_active: bool,
    /// Bump seed for PDA
    pub bump: u8,
}

impl ServerSigner {
    pub const SEED: &'static [u8] = b"server_signer";
}
