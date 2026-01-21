# SettoPayment Solana Program

> Solana Program 명세서
> Version 2.0 | 2025년 1월 | Anchor + Fee Payer + Ed25519 검증

---

## 1. 개요

SettoPayment는 Solana 기반 가스비 대납 결제 프로그램이다. Relayer가 사용자 대신 트랜잭션 수수료를 지불하고, 사용자는 서명만으로 결제를 실행한다.

### 1.1 핵심 특징

| 항목 | 설명 |
|------|------|
| **표준** | SPL Token + Ed25519 + Fee Payer |
| **결제 방식** | `process_payment` (단일 결제, atomic) |
| **가스비 대납** | 네이티브 Fee Payer (프로토콜 레벨) |
| **권한 분리** | Authority + Emergency Admin 2단계 |

### 1.2 Solana 네이티브 장점

1. **Atomic TX**: 1 TX에 여러 instruction 포함 (별도 approve 단계 불필요)
2. **Fee Payer**: 프로토콜 레벨 가스비 대납 (wrapper 컨트랙트 불필요)
3. **병렬 실행**: nonce 경합 없이 높은 TPS

---

## 2. 적용 표준

### 2.1 사용 표준

| 표준 | 용도 | 참조 |
|------|------|------|
| **SPL Token** | 토큰 전송 (USDC, USDT) | [Solana SPL Token](https://spl.solana.com/token) |
| **Ed25519** | 서버 서명 검증 | Solana 네이티브 precompile |
| **Fee Payer Model** | 가스비 대납 | [Solana TX 구조](https://solana.com/docs/core/transactions) |
| **Anchor Framework** | 프로그램 개발 | [Anchor](https://www.anchor-lang.com/) |
| **PDA (Program Derived Address)** | Config 저장 | Solana 표준 |

### 2.2 보안 감사 완료 참조 프로젝트

| 프로토콜 | 감사 상태 | 참조 내용 |
|----------|----------|----------|
| **Kora** (Solana Foundation) | Runtime Verification | Fee Payer 아키텍처 |
| **Token Extensions** | Halborn, Zellic, NCC, Trail of Bits, OtterSec (5회) | SPL Token 패턴 |
| **Squads V4** | OtterSec, Neodyme, Trail of Bits, Certora + Formal Verification | Multisig 패턴 |

---

## 3. Program 권한 구조

### 3.1 Config PDA

```rust
#[account]
pub struct Config {
    pub authority: Pubkey,        // Config 관리자 (마스터)
    pub emergency_admin: Pubkey,  // 긴급 정지 전용
    pub relayer: Pubkey,          // 가스비 지불자, TX 제출자
    pub server_signer: Pubkey,    // 결제 서명 검증용 공개키
    pub fee_recipient: Pubkey,    // 플랫폼 수수료 수령자
    pub paused: bool,             // 긴급 정지
    pub bump: u8,                 // PDA bump seed
}

Seeds: ["config"]
```

### 3.2 역할 정의

| 역할 | 설명 | 권한 |
|------|------|------|
| **authority** | Config 관리자 (Multisig 권장) | 모든 설정 변경 |
| **emergency_admin** | 긴급 정지 전용 | pause/unpause만 |
| **relayer** | 서버 지갑 | TX 제출, 가스비 지불 |
| **server_signer** | 서버 서명 키 | 결제 서명 생성 |
| **fee_recipient** | 수수료 지갑 | 플랫폼 수수료 수령 |

### 3.3 권한 다이어그램

```
┌─────────────────────────────────────┐
│  Upgrade Authority (Solana 시스템)   │
│  → 프로그램 업그레이드 권한            │
│  → Program keypair로 제어            │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   Authority (Multisig/Squads)       │
│   → Config 설정 변경                 │
│   → set_relayer, set_server_signer  │
│   → set_fee_recipient               │
│   → set_emergency_admin             │
│   → transfer_authority              │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   Emergency Admin (운영팀)           │
│   → pause / unpause만 가능           │
│   → 24/7 긴급 대응용                  │
└─────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│       SettoPayment Program          │
│                                     │
│   Config PDA:                       │
│   ├─ authority = Multisig           │
│   ├─ emergency_admin = 운영팀       │
│   ├─ relayer = 서버 지갑             │
│   ├─ server_signer = 서명 키         │
│   └─ fee_recipient = 수수료 지갑     │
└─────────────────────────────────────┘
               ▲
               │ relayer (fee payer)
┌─────────────────────────────────────┐
│   Relayer 서버                       │
│   → TX 생성                          │
│   → 가스비 지불 (SOL)                │
│   → 서명 수집                        │
└─────────────────────────────────────┘
```

---

## 4. 결제 플로우

### 4.1 전체 플로우

```
1. User: 결제 요청                    ← App/SDK
2. Server: payment_id 생성 + Ed25519 서명
3. Server: TX 구성 (Ed25519 IX + process_payment IX)
4. User: 토큰 전송 승인 서명            ← 지갑에서 서명
5. Relayer: TX 제출 (fee payer)        ← 가스비 지불
6. Program: 검증 + 토큰 전송           ← On-chain
```

### 4.2 서명 플로우

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│     App      │     │    Server    │     │   Program    │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │ 1. 결제 요청       │                    │
       │───────────────────>│                    │
       │                    │                    │
       │                    │ 2. payment_id 생성 │
       │                    │ 3. Ed25519 서명   │
       │                    │                    │
       │ 4. TX 데이터       │                    │
       │<───────────────────│                    │
       │                    │                    │
       │ 5. 사용자 서명      │                    │
       │ (토큰 전송 승인)     │                    │
       │───────────────────>│                    │
       │                    │                    │
       │                    │ 6. Relayer 서명   │
       │                    │ (fee payer)        │
       │                    │───────────────────>│
       │                    │                    │
       │                    │                    │ 7. Ed25519 검증
       │                    │                    │ 8. 토큰 전송
       │                    │                    │    - user → pool
       │                    │                    │    - user → fee
       │                    │                    │
       │                    │<───────────────────│
       │<───────────────────│   결제 완료        │
```

### 4.3 사용자 비용

| 항목 | 비용 부담 |
|------|----------|
| 토큰 전송 서명 | 무료 (off-chain) |
| 가스비 (SOL) | **Relayer 부담** |

---

## 5. 서명 검증

### 5.1 서버 서명 메시지 (Ed25519)

```rust
struct PaymentMessage {
    payment_id: u64,   // 8 bytes - 결제 ID
    user: Pubkey,      // 32 bytes - 결제자
    pool: Pubkey,      // 32 bytes - 수령 Pool (token account owner)
    to: Pubkey,        // 32 bytes - 정산 대상 (상점)
    token: Pubkey,     // 32 bytes - 토큰 mint
    amount: u64,       // 8 bytes - 결제 금액
    fee_amount: u64,   // 8 bytes - 수수료
    deadline: i64,   // 8 bytes - 만료 시간
}
// 총: 136 bytes
```

### 5.2 검증 프로세스

```rust
// Solana precompile을 통한 Ed25519 검증
fn verify_server_signature(
    instructions_sysvar: &AccountInfo,
    server_signer: &Pubkey,
    params: &ProcessPaymentParams,
    user: &Pubkey,
    pool: &Pubkey,
    to: &Pubkey,
    token_mint: &Pubkey,
) -> Result<()> {
    // 1. 예상 메시지 구성
    let message = build_payment_message(params, user, pool, to, token_mint);

    // 2. 이전 instruction에서 Ed25519 검증 로드
    let ed25519_ix = load_instruction_at_checked(
        current_index - 1,
        instructions_sysvar
    )?;

    // 3. program ID 검증
    require!(ed25519_ix.program_id == ed25519_program::ID);

    // 4. 공개키가 server_signer와 일치하는지 검증
    let pubkey_in_ix = &ix_data[pubkey_offset..pubkey_offset + 32];
    require!(pubkey_in_ix == server_signer.to_bytes());

    // 5. 메시지가 예상 값과 일치하는지 검증
    require!(message_in_ix == message.as_slice());

    Ok(())
}
```

---

## 6. 보안

### 6.1 보안 레이어

| 레이어 | 검증 | 실패 시 |
|--------|------|---------|
| 1. Pause 검증 | `!config.paused` | TX 거부 |
| 2. Relayer 검증 | `payer == config.relayer` | TX 거부 |
| 3. Deadline | `clock.unix_timestamp <= deadline` | 결제 거부 |
| 4. 서버 서명 | Ed25519 검증 | 결제 거부 |
| 5. 금액 | `amount > 0` | 결제 거부 |
| 6. 잔액 | SPL Token 잔액 | TX 실패 |

### 6.2 공격 방어

| 공격 | 방어 |
|------|------|
| 무단 TX 제출 | Relayer 제약 |
| 결제 위조 | 서버 서명 검증 |
| 재생 공격 | payment_id 유일성 (서버 DB) |
| 만료된 결제 | deadline 검증 |
| Pool 변조 | pool owner가 서명 메시지에 포함 |
| 잔액 조작 | Atomic TX (부분 상태 없음) |

### 6.3 키 유출 영향

| 유출된 키 | 영향 | 완화 |
|----------|------|------|
| Relayer만 | 결제 위조 불가 | 서버 서명 필요 |
| Server signer만 | TX 제출 불가 | Relayer 키 필요 |
| Relayer + Server signer | **결제 실행 가능** | Pause + 키 교체 |
| Emergency Admin | 정지만 가능 | 설정 변경 불가 |
| Authority | 설정 변경 가능 | Multisig로 보호 |

---

## 7. 이벤트 로깅

### 7.1 로그 메시지

```rust
// 결제 성공
msg!("PAYMENT_PROCESSED");
msg!("payment_id: {}", payment_id);
msg!("from: {}", user);
msg!("to: {}", to);
msg!("pool: {}", pool);
msg!("token: {}", token_mint);
msg!("amount: {}", amount);
msg!("fee: {}", fee_amount);
```

---

## 8. 체인 및 토큰

| 체인 | Cluster | 토큰 표준 | 블록 타임 |
|------|---------|----------|----------|
| Solana Mainnet | mainnet-beta | SPL Token | ~400ms |
| Solana Devnet | devnet | SPL Token | ~400ms |

**지원 토큰 (Mainnet):**
- USDC: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- USDT: `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`

---

## 9. 배포 및 관리

### 9.1 배포 스크립트

```bash
npm run deploy      # Interactive 배포
npm run verify      # 배포 검증
npm run status      # 상태 확인
```

### 9.2 관리 스크립트

```bash
# Authority 전용
npm run authority:set-emergency-admin
npm run authority:set-relayer
npm run authority:set-server-signer
npm run authority:set-fee-recipient
npm run authority:transfer

# Emergency Admin 전용
npm run emergency:pause
npm run emergency:unpause
```

---

## 10. 아키텍처 요약

### 10.1 명칭

**"SPL Token + Fee Payer + Ed25519 Payment"**

사용 표준:
- SPL Token Program (토큰 전송)
- Solana Fee Payer Model (가스비 대납)
- Ed25519 Precompile (서명 검증)
- Anchor Framework (프로그램 개발)

### 10.2 지갑 제공자(Phantom 등) 문서화용

> SettoPayment는 표준 Solana 패턴을 사용:
> - **SPL Token Program**: 토큰 전송
> - **Ed25519 Precompile**: 서버 서명 검증
> - **Fee Payer Model**: 가스비 대납 트랜잭션
> - **Anchor Framework**: 프로그램 개발
>
> 커스텀 토큰 표준이나 비표준 확장 불필요.

---

## 11. 참조

### 11.1 공식 문서
- [Solana SPL Token](https://spl.solana.com/token)
- [Solana Fee Payer](https://solana.com/docs/core/transactions)
- [Anchor Framework](https://www.anchor-lang.com/)
- [Ed25519 Program](https://solana.com/docs/core/programs#ed25519-program)

### 11.2 감사 완료 참조
- [Kora (Solana Foundation)](https://github.com/solana-foundation/kora) - Fee Payer 인프라
- [Squads V4](https://github.com/Squads-Protocol/v4) - Multisig 패턴
