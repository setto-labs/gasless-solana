use anchor_lang::prelude::*;
use solana_security_txt::security_txt;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

// Program ID - auto-updated by deploy script (npm run deploy)
declare_id!("DXxCKeaee3YD1HeA1UcBxTiHGZYFDZQ34Q2bjY87Nyoc");

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "Setto",
    project_url: "https://setto.page",
    contacts: "email:security@setto.page",
    policy: "https://setto.page/security",
    source_code: "https://github.com/setto-labs/gasless-solana"
}

#[program]
pub mod setto_payment {
    use super::*;

    // ============================================
    // Core Functions — Direct Payment
    // ============================================

    /// Process a direct payment (user signs)
    /// sender → recipient (amount) + sender → feeWallet (protocolFee)
    pub fn process_direct_payment(
        ctx: Context<ProcessDirectPayment>,
        params: DirectPaymentParams,
    ) -> Result<()> {
        instructions::direct_payment::process_direct_payment_handler(ctx, params)
    }

    /// Process a direct payment via delegate (gasless, user doesn't sign)
    /// Delegate PDA transfers on behalf of user
    pub fn process_direct_payment_delegated(
        ctx: Context<ProcessDirectPaymentDelegated>,
        params: DirectPaymentDelegatedParams,
    ) -> Result<()> {
        instructions::direct_payment_delegated::process_direct_payment_delegated_handler(
            ctx, params,
        )
    }

    // ============================================
    // Core Functions — Pool Payment
    // ============================================

    /// Process a pool payment (user signs)
    /// sender → pool (totalAmount), single transfer, no fee split on-chain
    pub fn process_pool_payment(
        ctx: Context<ProcessPoolPayment>,
        params: PoolPaymentParams,
    ) -> Result<()> {
        instructions::pool_payment::process_pool_payment_handler(ctx, params)
    }

    /// Process a pool payment via delegate (gasless, user doesn't sign)
    /// Delegate PDA transfers on behalf of user
    pub fn process_pool_payment_delegated(
        ctx: Context<ProcessPoolPaymentDelegated>,
        params: PoolPaymentDelegatedParams,
    ) -> Result<()> {
        instructions::pool_payment_delegated::process_pool_payment_delegated_handler(ctx, params)
    }

    // ============================================
    // Initialize
    // ============================================

    /// Initialize program config
    /// Only called once by deployer
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::initialize_handler(ctx)
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

    /// Transfer authority to new address
    pub fn transfer_authority(ctx: Context<TransferAuthority>) -> Result<()> {
        instructions::admin::transfer_authority_handler(ctx)
    }
}
