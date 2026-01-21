use anchor_lang::prelude::*;
use solana_security_txt::security_txt;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

// Program ID - auto-updated by deploy script (npm run deploy)
declare_id!("5iZ49Z39KrQ8MLDq8gUWtAMmSJ5mTcUSvPvjau8NvNVB");

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "Setto Payment",
    project_url: "https://settopay.com",
    contacts: "email:security@settopay.com",
    policy: "https://settopay.com/security",
    source_code: "https://github.com/settopay-cripto/setto-pay-solana"
}

#[program]
pub mod setto_payment {
    use super::*;

    // ============================================
    // Core Functions
    // ============================================

    /// Initialize program config
    /// Only called once by deployer
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::initialize_handler(ctx)
    }

    /// Process a single payment
    /// - Verifies server signature (Ed25519) from authorized signer
    /// - Checks deadline
    /// - Transfers amount to pool
    /// - Transfers fee to platform fee recipient
    /// - Logs payment info for tracking
    pub fn process_payment(
        ctx: Context<ProcessPayment>,
        params: ProcessPaymentParams,
    ) -> Result<()> {
        instructions::process_payment::process_payment_handler(ctx, params)
    }

    // ============================================
    // Emergency Admin Functions
    // ============================================

    /// Pause the program (emergency stop)
    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        instructions::admin::pause_handler(ctx)
    }

    /// Unpause the program
    pub fn unpause(ctx: Context<Unpause>) -> Result<()> {
        instructions::admin::unpause_handler(ctx)
    }

    /// Emergency add server signer (when key rotation needed urgently)
    pub fn emergency_add_server_signer(ctx: Context<EmergencyAddServerSigner>) -> Result<()> {
        instructions::admin::emergency_add_server_signer_handler(ctx)
    }

    /// Emergency remove server signer (when key leaked)
    pub fn emergency_remove_server_signer(ctx: Context<EmergencyRemoveServerSigner>) -> Result<()> {
        instructions::admin::emergency_remove_server_signer_handler(ctx)
    }

    // ============================================
    // Authority Functions
    // ============================================

    /// Update emergency admin address
    pub fn set_emergency_admin(ctx: Context<SetEmergencyAdmin>) -> Result<()> {
        instructions::admin::set_emergency_admin_handler(ctx)
    }

    /// Add a new server signer
    pub fn add_server_signer(ctx: Context<AddServerSigner>) -> Result<()> {
        instructions::admin::add_server_signer_handler(ctx)
    }

    /// Remove a server signer
    pub fn remove_server_signer(ctx: Context<RemoveServerSigner>) -> Result<()> {
        instructions::admin::remove_server_signer_handler(ctx)
    }

    /// Update fee recipient address
    pub fn set_fee_recipient(ctx: Context<SetFeeRecipient>) -> Result<()> {
        instructions::admin::set_fee_recipient_handler(ctx)
    }

    /// Transfer authority to new address
    pub fn transfer_authority(ctx: Context<TransferAuthority>) -> Result<()> {
        instructions::admin::transfer_authority_handler(ctx)
    }

}
