use anchor_lang::prelude::*;

#[error_code]
pub enum PaymentError {
    #[msg("Paused")]
    Paused,

    #[msg("Not paused")]
    NotPaused,

    #[msg("Invalid amount")]
    InvalidAmount,

    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Unauthorized emergency admin")]
    UnauthorizedEmergencyAdmin,

    #[msg("Unauthorized server signer")]
    UnauthorizedServerSigner,

    #[msg("Invalid signature")]
    InvalidServerSignature,

    #[msg("Payment expired")]
    PaymentExpired,

    #[msg("Invalid address")]
    InvalidAddress,

    #[msg("Unauthorized relayer")]
    UnauthorizedRelayer,

    #[msg("Delegate not set")]
    DelegateNotSet,

    #[msg("Invalid delegate")]
    InvalidDelegate,

    #[msg("Insufficient delegated amount")]
    InsufficientDelegatedAmount,

    #[msg("Invalid fee recipient")]
    InvalidFeeRecipient,
}
