use anchor_lang::prelude::*;

/// Relayer account stored as PDA
/// Seeds: ["relayer", relayer_pubkey]
/// Each authorized relayer has its own PDA account
#[account]
#[derive(InitSpace)]
pub struct Relayer {
    /// The relayer's public key
    pub relayer: Pubkey,
    /// Whether this relayer is currently active
    pub is_active: bool,
    /// Bump seed for PDA
    pub bump: u8,
}

impl Relayer {
    pub const SEED: &'static [u8] = b"relayer";
}
