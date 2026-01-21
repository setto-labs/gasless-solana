# Batch Process Payment

## 개요

여러 사용자의 결제를 한 트랜잭션에서 처리하는 기능입니다.
Setto Pay 상점 정산 등에 사용됩니다.

---

## Instruction 구조

```rust
pub fn batch_process_payment(
    ctx: Context<BatchProcessPayment>,
    payments: Vec<PaymentItem>,
) -> Result<()>
```

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| payer | Signer (mut) | Relayer (가스비 지불) |
| config | PDA | Config 계정 (server_signer 포함) |
| authority | PDA | Delegate 권한 보유 |
| token_program | Program | SPL Token Program |

### Remaining Accounts

결제 N건당 4개 계정:

```
[user_token, pool_token, fee_token, mint] × N
```

### PaymentItem

```rust
pub struct PaymentItem {
    pub payment_id: u64,          // 결제 ID
    pub user: Pubkey,             // from - 토큰 지출 지갑 (로깅용)
    pub pool: Pubkey,             // 토큰 수령 지갑 (로깅용)
    pub to: Pubkey,               // 정산 대상 지갑 (로깅용, pool과 동일할 수 있음)
    pub amount: u64,              // 결제 금액
    pub fee_amount: u64,          // 플랫폼 수수료 (0이면 패스)
    pub deadline: i64,            // 만료 시간 (Unix timestamp)
    pub server_signature: [u8; 64], // 서버 Ed25519 서명
}
```

### 서명 메시지 포맷

EVM `SettoPaymentV2`와 동일한 필드 구성:

```
payment_id (8 bytes, u64)
user (32 bytes, Pubkey)      // from
pool (32 bytes, Pubkey)      // 토큰 수령
to (32 bytes, Pubkey)        // 정산 대상
token_mint (32 bytes, Pubkey)
amount (8 bytes, u64)
fee_amount (8 bytes, u64)
deadline (8 bytes, i64)
```

---

## 플로우

### 1. 사전 설정 (1회)

```
사용자 ──approve(authority_pda, max_amount)──▶ SPL Token Program
```

### 2. 결제 처리

```
서버 ──결제 요청들──▶ Relayer ──batch_process_payment──▶ Solana Program
                                                         │
                                                         ▼
                                          Authority PDA가 delegate 권한으로
                                          각 사용자 토큰 → pool/fee 전송
```

---

## 검증 로직

```rust
pub fn handler(ctx: Context<BatchProcessPayment>, payments: Vec<PaymentItem>) -> Result<()> {
    // 1. Relayer 권한 확인
    require!(ctx.accounts.payer.key() == ctx.accounts.config.relayer);

    // 2. 프로그램 정지 확인
    require!(!ctx.accounts.config.paused);

    // 3. remaining_accounts 수 검증
    require!(ctx.remaining_accounts.len() == payments.len() * 4);

    let authority_seeds = &[b"authority".as_ref(), &[ctx.bumps.authority]];

    // 4. 각 결제 처리
    for (i, payment) in payments.iter().enumerate() {
        let base = i * 4;
        let user_token = &ctx.remaining_accounts[base];
        let pool_token = &ctx.remaining_accounts[base + 1];
        let fee_token = &ctx.remaining_accounts[base + 2];
        let mint = &ctx.remaining_accounts[base + 3];

        // 4.1 deadline 검증
        let clock = Clock::get()?;
        require!(clock.unix_timestamp <= payment.deadline, PaymentError::PaymentExpired);

        // 4.2 server_signature 검증 (Ed25519)
        verify_server_signature(
            &ctx.accounts.config.server_signer,
            payment,
            mint.key(),
        )?;

        // 4.3 amount 검증
        require!(payment.amount > 0, PaymentError::InvalidAmount);

        // 4.4 토큰 전송: user → pool (authority PDA 서명)
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: user_token.to_account_info(),
                    to: pool_token.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
                &[authority_seeds],
            ),
            payment.amount,
        )?;

        // 4.5 수수료 전송: user → fee (0이면 패스)
        if payment.fee_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: user_token.to_account_info(),
                        to: fee_token.to_account_info(),
                        authority: ctx.accounts.authority.to_account_info(),
                    },
                    &[authority_seeds],
                ),
                payment.fee_amount,
            )?;
        }

        // 4.6 로그 (EVM의 PaymentExecuted 이벤트 대응)
        msg!("BATCH_PAYMENT_PROCESSED");
        msg!("payment_id: {}", payment.payment_id);
        msg!("user: {}", payment.user);
        msg!("pool: {}", payment.pool);
        msg!("to: {}", payment.to);
        msg!("amount: {}", payment.amount);
        msg!("fee: {}", payment.fee_amount);
    }

    Ok(())
}
```

---

## 로그 포맷

```
Program log: BATCH_PAYMENT_PROCESSED
Program log: payment_id: 1234567890
Program log: user: 7xKpP...
Program log: pool: 3zNpQ...
Program log: to: 3zNpQ...
Program log: amount: 1000000
Program log: fee: 10000
```

---

## 에러 케이스

| 에러 | 원인 |
|------|------|
| UnauthorizedRelayer | payer가 config.relayer가 아님 |
| Paused | 프로그램 정지 상태 |
| InvalidAccountCount | remaining_accounts 수 불일치 |
| PaymentExpired | deadline 초과 |
| InvalidServerSignature | 서버 서명 검증 실패 |
| InvalidAmount | amount가 0 |
| InsufficientFunds | 사용자 잔액 부족 |
| DelegateAmountExceeded | delegate allowance 부족 |

---

## EVM vs Solana 비교

| 항목 | EVM (SettoPaymentV2) | Solana (batch_process_payment) |
|------|---------------------|-------------------------------|
| 권한 방식 | Permit2 allowance | SPL Token delegate |
| 서명 검증 | EIP-712 ECDSA | Ed25519 |
| 배치 크기 | ~100건 | **6~8건** |
| 실패 처리 | try-catch 개별 처리 | 전체 atomic |
| 로깅 | Event emit | msg!() 로그 |

---

## 보안

### 1. Server Signature 검증
- 각 PaymentItem에 `server_signature` 포함
- `config.server_signer` 공개키로 Ed25519 검증
- 결제 정보 위변조 방지

### 2. Deadline 검증
- 만료된 결제 거부
- Replay attack 방지

### 3. Relayer 제한
- Config에 등록된 relayer만 실행 가능

### 4. Atomic Transaction
- 하나라도 실패하면 전체 롤백
- 부분 실행 없음
