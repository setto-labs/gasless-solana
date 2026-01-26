use anchor_lang::prelude::*;

/// Delegate PDA for gasless token transfers
/// This PDA is authorized to transfer tokens on behalf of users who have approved it
/// Seeds: ["delegate"]
#[account]
#[derive(InitSpace)]
pub struct Delegate {
    /// Bump seed for PDA
    pub bump: u8,
}

impl Delegate {
    pub const SEED: &'static [u8] = b"delegate";
}
