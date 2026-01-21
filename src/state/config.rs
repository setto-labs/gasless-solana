use anchor_lang::prelude::*;

/// Program configuration stored as PDA
/// Seeds: ["config"]
#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Authority that can update config (master wallet / multisig)
    /// Can: add/remove_server_signer, transfer-authority, set-emergency-admin
    pub authority: Pubkey,
    /// Emergency admin for pause/unpause (operational wallet)
    /// Can: pause, unpause, emergency_add/remove_server_signer
    pub emergency_admin: Pubkey,
    /// Fee recipient address (receives platform fees)
    pub fee_recipient: Pubkey,
    /// Emergency pause flag
    pub paused: bool,
    /// Bump seed for PDA
    pub bump: u8,
}

impl Config {
    pub const SEED: &'static [u8] = b"config";
}
