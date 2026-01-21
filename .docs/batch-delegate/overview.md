# Batch Delegate - 개요

## 배경

기존 Single Payment는 **Ed25519 서명 검증** 방식으로 매 결제마다 사용자 서명이 필요합니다.
Batch Delegate는 **SPL Token Delegate** 패턴을 사용하여 1회 approve로 여러 결제/에어드랍을 처리합니다.

---

## Single Payment vs Batch Delegate

| 항목 | Single Payment | Batch Delegate |
|------|---------------|----------------|
| 사용자 서명 | 매 결제마다 | **1회 approve** |
| 트랜잭션 구조 | Ed25519 IX + ProcessPayment IX | BatchProcessPayment IX만 |
| 배치 처리 | 1 TX = 1 결제 | **1 TX = N 결제** |
| 가스비 | 건당 지불 | 묶음으로 절약 |
| UX | 매번 서명 팝업 | 초기 설정 후 자동 |
| 서버 서명 검증 | Ed25519 (이전 IX) | **Ed25519 (파라미터)** |

---

## 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                        Transaction                          │
├─────────────────────────────────────────────────────────────┤
│  Instruction: BatchProcessPayment / BatchAirdrop            │
│    ├─ accounts:                                             │
│    │   ├─ payer (Relayer, Signer) - 가스비 대납             │
│    │   ├─ config (server_signer 포함)                       │
│    │   ├─ authority_pda (delegate 권한)                     │
│    │   └─ token_program                                     │
│    ├─ remaining_accounts:                                   │
│    │   └─ [from_token, pool_token, fee_token, mint] × N    │
│    └─ data: [PaymentItem...] (server_signature 포함)        │
└─────────────────────────────────────────────────────────────┘
```

---

## 검증 레이어 (EVM과 동일)

| 레이어 | EVM (SettoPaymentV2) | Solana (batch_process_payment) |
|--------|---------------------|-------------------------------|
| 1. Relayer | `onlyRelayer` | `payer == config.relayer` |
| 2. Paused | `whenNotPaused` | `!config.paused` |
| 3. Server Signature | EIP-712 ECDSA | **Ed25519** |
| 4. Deadline | `block.timestamp <= deadline` | `clock.unix_timestamp <= deadline` |
| 5. Amount | `amount > 0` | `amount > 0` |

---

## 추가되는 Instructions

### 1. batch_process_payment

여러 사용자의 결제를 한 트랜잭션에서 처리합니다.

- 용도: 결제 배치 처리, 상점 정산
- 방향: N users → N pools
- 서버 서명: 각 PaymentItem에 포함

### 2. batch_airdrop

하나의 소스 지갑에서 여러 수신자에게 토큰을 전송합니다.

- 용도: 에어드랍, 토큰 배포
- 방향: 1 source → N recipients
- 서버 서명: 각 AirdropItem에 포함

### 3. setup_delegate (선택적)

사용자가 Authority PDA에게 토큰 delegate 권한을 부여합니다.

- SPL Token approve를 직접 호출해도 동일

---

## Authority PDA

Delegate 권한을 가지는 Program Derived Address입니다.

```rust
seeds = [b"authority"]
```

사용자가 이 PDA에게 토큰 approve를 하면, 프로그램이 해당 토큰을 전송할 수 있습니다.

---

## 배치 크기 제한

| 제한 요소 | 값 |
|----------|-----|
| 트랜잭션 크기 | 1,232 bytes |
| 계정 수 | ~64개 |
| 결제당 계정 | 4개 (from, pool, fee, mint) |
| PaymentItem 크기 | ~152 bytes (server_signature 포함) |
| **예상 배치 크기** | **6~8건/tx** |

---

## 로그 vs 이벤트

| 체인 | 방식 | 설명 |
|------|------|------|
| EVM | Event emit | `PaymentExecuted`, `PaymentFailed` 이벤트 |
| Solana | **msg!() 로그** | 트랜잭션 로그에서 파싱 |

---

## 관련 문서

- [배치 결제](./batch-payment.md)
- [배치 에어드랍](./batch-airdrop.md)
