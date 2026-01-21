# Setto Payment - Solana Program (SVM)

## 개요

Setto Payment는 Solana 블록체인 위에서 동작하는 **Gasless 결제 시스템**입니다.
사용자는 SOL(가스비)을 보유하지 않아도 SPL 토큰으로 결제할 수 있습니다.

### 핵심 특징

- **Gasless 결제**: Relayer가 SOL 가스비 대납, 사용자는 토큰 전송만 서명
- **서버 서명 검증**: Ed25519 서명으로 결제 정보 위변조 방지
- **EVM과 동일 로직**: SettoPayment.sol과 동일한 비즈니스 로직 (네트워크만 다름)
- **Atomic 트랜잭션**: 모든 작업이 성공하거나 모두 실패 (부분 실패 없음)
- **3단계 권한 체계**: Upgrade Authority / Authority / Emergency Admin 분리

---

## 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                        Setto Server                         │
│  1. 결제 요청 수신                                            │
│  2. payment_id 생성 + 서명 (Ed25519)                         │
│  3. 트랜잭션 구성 (Ed25519 verify IX + process_payment IX)    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      User Wallet                            │
│  - 토큰 전송 서명 (user.sign)                                 │
│  - SOL 가스비 불필요                                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Solana Transaction                        │
│  IX[0]: Ed25519 Signature Verify (Native Program)           │
│  IX[1]: process_payment (Setto Payment Program)             │
│                                                              │
│  Fee Payer: Relayer (서버 지갑)                               │
│  Signers: [Relayer, User]                                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Setto Payment Program                       │
│  1. Deadline 검증                                            │
│  2. Ed25519 서명 검증 (이전 IX 확인)                          │
│  3. Amount 검증                                              │
│  4. User → Pool 토큰 전송 (amount)                           │
│  5. User → Fee Wallet 토큰 전송 (fee)                        │
│  6. 로그 기록 (PAYMENT_PROCESSED)                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Program ID

| 네트워크 | Program ID |
|---------|-----------|
| Devnet | `5aMvnLtsZLDEMeQSPXucoX7b49uiUKzLnp8yNujrrmpp` |
| Mainnet | `5iZ49Z39KrQ8MLDq8gUWtAMmSJ5mTcUSvPvjau8NvNVB` |

배포 스크립트가 `lib.rs`와 `Anchor.toml`을 자동으로 업데이트합니다.

---

## 계정 구조

### Config (PDA)

프로그램 설정을 저장하는 Program Derived Address.

```rust
#[account]
pub struct Config {
    pub authority: Pubkey,        // Config 관리자 (마스터)
    pub emergency_admin: Pubkey,  // 긴급 정지 전용 관리자
    pub relayer: Pubkey,          // Relayer (가스비 대납 서버 지갑)
    pub server_signer: Pubkey,    // 서버 서명자 (Ed25519 공개키)
    pub fee_recipient: Pubkey,    // 수수료 수령 지갑
    pub paused: bool,             // 긴급 정지 플래그
    pub bump: u8,                 // PDA bump seed
}

Seeds: ["config"]
```

---

## Instructions

### 1. initialize

프로그램 Config 초기화 (최초 1회만 실행)

**Accounts:**
| Account         | Type            | Description              |
|-----------------|-----------------|--------------------------|
| authority       | Signer (mut)    | 관리자 + 가스비 지불        |
| config          | PDA (init)      | Config 계정               |
| emergency_admin | Unchecked       | 긴급 정지 관리자 주소       |
| relayer         | Unchecked       | Relayer 주소              |
| server_signer   | Unchecked       | 서버 서명자 주소           |
| fee_recipient   | Unchecked       | 수수료 수령자 주소          |
| system_program  | Program         | System Program           |

---

### 2. process_payment

결제 처리 (핵심 기능)

**Accounts:**
| Account              | Type              | Description                    |
|----------------------|-------------------|--------------------------------|
| payer                | Signer (mut)      | Relayer (가스비 지불)            |
| user                 | Signer            | 사용자 (토큰 전송 권한)           |
| to                   | Unchecked         | 수령인 주소 (서명 검증용)         |
| config               | PDA               | Config 계정                     |
| token_mint           | Mint              | 토큰 Mint (서명 검증용)          |
| user_token_account   | TokenAccount (mut)| 사용자 토큰 계정 (출금)           |
| pool_token_account   | TokenAccount (mut)| Pool 토큰 계정 (입금)            |
| fee_token_account    | TokenAccount (mut)| 수수료 수령 토큰 계정             |
| token_program        | Program           | SPL Token Program              |
| instructions_sysvar  | Sysvar            | Ed25519 서명 검증용              |

**Parameters:**
```rust
pub struct ProcessPaymentParams {
    pub amount: u64,              // 결제 금액 (pool에게 전송)
    pub fee_amount: u64,          // 플랫폼 수수료 (fee_recipient에게 전송)
    pub payment_id: u64,          // 고유 결제 ID
    pub deadline: i64,            // 만료 시간 (Unix timestamp)
    pub server_signature: [u8; 64], // 서버 Ed25519 서명
}
```

**서명 메시지 포맷:**
```
payment_id (8 bytes, u64)
user (32 bytes, Pubkey)
pool (32 bytes, Pubkey) - pool_token_account.owner
to (32 bytes, Pubkey)
token_mint (32 bytes, Pubkey)
amount (8 bytes, u64)
fee_amount (8 bytes, u64)
deadline (8 bytes, i64)
```

---

### 3. Admin Functions

#### Authority 전용

| Function            | Description                    |
|---------------------|--------------------------------|
| set_emergency_admin | Emergency Admin 주소 변경       |
| set_relayer         | Relayer 주소 변경               |
| set_server_signer   | 서버 서명자 변경                 |
| set_fee_recipient   | 수수료 수령자 변경               |
| transfer_authority  | Authority 권한 이전             |

#### Emergency Admin 전용

| Function | Description        |
|----------|--------------------|
| pause    | 프로그램 긴급 정지   |
| unpause  | 프로그램 정지 해제   |

---

## 에러 코드

| Code                   | Description                          |
|------------------------|--------------------------------------|
| Paused                 | 프로그램이 정지됨                      |
| NotPaused              | 프로그램이 정지 상태가 아님            |
| InvalidAmount          | 금액이 0 이하                         |
| Unauthorized           | 권한 없음 (authority 아님)            |
| UnauthorizedRelayer    | Relayer 권한 없음                     |
| InvalidServerSignature | 서버 서명 검증 실패                    |
| PaymentExpired         | 결제 만료 (deadline 초과)           |
| InvalidAddress         | 유효하지 않은 주소 (zero pubkey)       |

---

## EVM vs SVM 비교

| 항목              | EVM (SettoPayment.sol)           | SVM (setto_payment)              |
|------------------|----------------------------------|----------------------------------|
| 서명 방식         | EIP-712 + ECDSA                  | Ed25519 (Native Program)         |
| 가스비 대납       | Permit2 + Relayer                | Relayer as fee_payer             |
| 토큰 전송         | Permit2.transferFrom             | SPL Token CPI                    |
| 결제 타입         | 3가지 (MPC/Permit2/Allowance)    | 1가지 (단순화)                    |
| 배치 처리         | 1 TX = N 결제 (try-catch)        | 1 TX = 1 결제 (Atomic)           |
| 이벤트/로그       | Event (PaymentExecuted)          | msg!() 로그                       |
| 권한 구조         | Owner only                       | Authority + Emergency Admin      |

---

## 보안

### 1. Replay Attack 방지
- `payment_id`는 서버에서 고유하게 생성
- 서버에서 사용된 payment_id 추적 (DB)

### 2. 서명 바인딩
서명 메시지에 모든 결제 정보 포함:
- user, pool, to, token_mint, amount, fee_amount, deadline

### 3. Deadline (deadline)
- 서버 서명에 deadline 포함
- 만료된 결제는 거부

### 4. Relayer 제한
- Config에 등록된 relayer만 결제 처리 가능
- 악의적인 트랜잭션 방지

### 5. 권한 분리
- Authority: Config 변경 (Multisig 권장)
- Emergency Admin: 긴급 정지만 가능 (운영팀)
- Upgrade Authority: 프로그램 업그레이드 (별도 관리)

### 6. Pool 검증
- pool_token_account.owner가 서명 메시지에 포함
- 서버가 승인한 pool만 결제 가능

---

## 파일 구조

```
solana-program/
├── src/
│   ├── lib.rs                    # 프로그램 진입점
│   ├── errors.rs                 # 에러 정의
│   ├── state/
│   │   └── config.rs             # Config 계정 구조
│   └── instructions/
│       ├── mod.rs                # 모듈 export
│       ├── initialize.rs         # 초기화
│       ├── process_payment.rs    # 결제 처리
│       └── admin.rs              # 관리 함수들
├── scripts/                      # 배포/관리 스크립트
├── tests/                        # 테스트
└── Anchor.toml                   # Anchor 설정
```
