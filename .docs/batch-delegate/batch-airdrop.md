# Batch Airdrop

## 개요

하나의 소스 지갑에서 여러 수신자에게 토큰을 전송하는 기능입니다.
토큰 에어드랍, 마케팅 배포 등에 사용됩니다.

---

## batch_process_payment vs batch_airdrop

| 항목 | batch_process_payment | batch_airdrop |
|------|----------------------|---------------|
| 방향 | N users → N pools | **1 source → N recipients** |
| 용도 | 결제 정산 | 에어드랍 |
| from 계정 | 매번 다름 | **동일** |
| 수수료 | 있음 (0이면 패스) | 없음 |

---

## Instruction 구조

```rust
pub fn batch_airdrop(
    ctx: Context<BatchAirdrop>,
    recipients: Vec<AirdropItem>,
) -> Result<()>
```

### Accounts

| Account | Type | Description |
|---------|------|-------------|
| payer | Signer (mut) | Relayer (가스비 지불) |
| config | PDA | Config 계정 (server_signer 포함) |
| authority | PDA | Delegate 권한 보유 |
| source_token_account | TokenAccount (mut) | 에어드랍 소스 토큰 계정 |
| token_mint | Mint | 토큰 Mint |
| token_program | Program | SPL Token Program |

### Remaining Accounts

수신자 N명당 1개 계정:

```
[recipient_token_account] × N
```

### AirdropItem

```rust
pub struct AirdropItem {
    pub airdrop_id: u64,          // 에어드랍 ID
    pub recipient: Pubkey,        // 수신자 주소 (로깅용)
    pub amount: u64,              // 에어드랍 금액
    pub deadline: i64,            // 만료 시간 (Unix timestamp)
    pub server_signature: [u8; 64], // 서버 Ed25519 서명
}
```

### 서명 메시지 포맷

```
airdrop_id (8 bytes, u64)
source (32 bytes, Pubkey)    // 에어드랍 소스 지갑
recipient (32 bytes, Pubkey) // 수신자
token_mint (32 bytes, Pubkey)
amount (8 bytes, u64)
deadline (8 bytes, i64)
```

---

## 플로우

### 1. 에어드랍 생성

```
에어드랍 생성 ──▶ 서버에서 토큰 지갑 생성 (KMS 암호화)
                        │
                        ▼
                   에어드랍 지갑 주소 반환
```

### 2. 토큰 입금 + Delegate 설정

```
사용자 ──토큰 입금──▶ 에어드랍 지갑
       ──approve(authority_pda, total_amount)──▶ SPL Token Program
```

### 3. 에어드랍 실행

```
에어드랍 서버 ──수신자 목록──▶ Relayer ──batch_airdrop──▶ Solana Program
                                                          │
                                                          ▼
                                          Authority PDA가 delegate 권한으로
                                          에어드랍 지갑 → 각 수신자 전송
```

---

## 검증 로직

```rust
pub fn handler(ctx: Context<BatchAirdrop>, recipients: Vec<AirdropItem>) -> Result<()> {
    // 1. Relayer 권한 확인
    require!(ctx.accounts.payer.key() == ctx.accounts.config.relayer);

    // 2. 프로그램 정지 확인
    require!(!ctx.accounts.config.paused);

    // 3. remaining_accounts 수 검증
    require!(ctx.remaining_accounts.len() == recipients.len());

    // 4. 소스 토큰 계정 검증
    require!(ctx.accounts.source_token_account.mint == ctx.accounts.token_mint.key());

    let authority_seeds = &[b"authority".as_ref(), &[ctx.bumps.authority]];
    let source_owner = ctx.accounts.source_token_account.owner;

    // 5. 각 수신자에게 전송
    for (i, item) in recipients.iter().enumerate() {
        let recipient_token = &ctx.remaining_accounts[i];

        // 5.1 deadline 검증
        let clock = Clock::get()?;
        require!(clock.unix_timestamp <= item.deadline, PaymentError::PaymentExpired);

        // 5.2 server_signature 검증 (Ed25519)
        verify_airdrop_signature(
            &ctx.accounts.config.server_signer,
            item,
            &source_owner,
            &ctx.accounts.token_mint.key(),
        )?;

        // 5.3 amount 검증
        require!(item.amount > 0, PaymentError::InvalidAmount);

        // 5.4 토큰 전송 (authority PDA 서명)
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.source_token_account.to_account_info(),
                    to: recipient_token.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
                &[authority_seeds],
            ),
            item.amount,
        )?;

        // 5.5 로그
        msg!("AIRDROP_SENT");
        msg!("airdrop_id: {}", item.airdrop_id);
        msg!("recipient: {}", item.recipient);
        msg!("amount: {}", item.amount);
    }

    Ok(())
}
```

---

## 로그 포맷

```
Program log: AIRDROP_SENT
Program log: airdrop_id: 1
Program log: recipient: 9yMqR...
Program log: amount: 1000000
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
| InsufficientFunds | 소스 지갑 잔액 부족 |
| DelegateAmountExceeded | delegate allowance 부족 |

---

## ATA (Associated Token Account) 생성

수신자가 해당 토큰의 ATA를 가지고 있지 않으면 전송이 실패합니다.

### 옵션 1: 사전 생성
에어드랍 전에 수신자 ATA를 미리 생성

### 옵션 2: 프로그램에서 생성
`init_if_needed` 사용 (추가 가스비 필요)

```rust
#[account(
    init_if_needed,
    payer = payer,
    associated_token::mint = token_mint,
    associated_token::authority = recipient,
)]
pub recipient_token_account: Account<'info, TokenAccount>,
```

---

## 배치 크기 계산

| 항목 | 값 |
|------|-----|
| 트랜잭션 크기 | 1,232 bytes |
| 고정 계정 | ~6개 (payer, config, authority, source, mint, token_program) |
| 수신자당 계정 | 1개 |
| remaining_accounts 최대 | ~58개 |
| AirdropItem 크기 | ~120 bytes (server_signature 포함) |
| **예상 배치 크기** | **8~10명/tx** |

---

## EVM Disperse.app과 비교

| 항목 | Disperse.app | batch_airdrop |
|------|-------------|---------------|
| 컨트랙트 | 공용 (모든 체인 동일 주소) | Setto 전용 |
| 호출 방식 | 에어드랍 지갑이 직접 호출 | Relayer가 호출 |
| 가스비 | 에어드랍 지갑 지불 | **Relayer 대납** |
| 서버 서명 | 없음 | **필수** |
| 배치 크기 | ~100명 | **8~10명** |

---

## 보안

### 1. Server Signature 검증
- 각 AirdropItem에 `server_signature` 포함
- `config.server_signer` 공개키로 Ed25519 검증
- 에어드랍 정보 위변조 방지

### 2. Deadline 검증
- 만료된 에어드랍 거부
- Replay attack 방지

### 3. Relayer 제한
- Config에 등록된 relayer만 실행 가능

### 4. Atomic Transaction
- 하나라도 실패하면 전체 롤백
- 부분 실행 없음
