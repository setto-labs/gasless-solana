use anchor_lang::prelude::*;

#[error_code]
pub enum PaymentError {
    #[msg("Program is paused")]
    Paused,

    #[msg("Program is not paused")]
    NotPaused,

    #[msg("Invalid amount: must be greater than zero")]
    InvalidAmount,

    #[msg("Unauthorized: caller is not authority")]
    Unauthorized,

    #[msg("Unauthorized: caller is not emergency admin")]
    UnauthorizedEmergencyAdmin,

    #[msg("Unauthorized: server signer is not active")]
    UnauthorizedServerSigner,

    #[msg("Invalid server signature")]
    InvalidServerSignature,

    #[msg("Payment expired: deadline passed")]
    PaymentExpired,

    #[msg("Invalid address: zero pubkey not allowed")]
    InvalidAddress,
}
