# 결제 플로우 상세

## 전체 흐름

```
User App          Setto Server           Solana Network
   │                   │                       │
   │  1. 결제 요청      │                       │
   │  (상품, 금액)      │                       │
   │ ─────────────────>│                       │
   │                   │                       │
   │                   │  2. payment_id 생성    │
   │                   │  3. 서버 서명 생성      │
   │                   │  (Ed25519)            │
   │                   │                       │
   │  4. 서명 요청      │                       │
   │  (트랜잭션 데이터)  │                       │
   │ <─────────────────│                       │
   │                   │                       │
   │  5. 사용자 서명    │                       │
   │  (토큰 전송 승인)   │                       │
   │ ─────────────────>│                       │
   │                   │                       │
   │                   │  6. Relayer 서명      │
   │                   │  (가스비 지불)         │
   │                   │                       │
   │                   │  7. 트랜잭션 전송      │
   │                   │ ─────────────────────>│
   │                   │                       │
   │                   │                       │  8. Ed25519 검증
   │                   │                       │  9. process_payment
   │                   │                       │     - Deadline 확인
   │                   │                       │     - 서명 검증
   │                   │                       │     - 토큰 전송
   │                   │                       │
   │                   │  10. 결과 확인         │
   │                   │ <─────────────────────│
   │                   │                       │
   │  11. 결제 완료     │                       │
   │ <─────────────────│                       │
   │                   │                       │
```

---

## 단계별 상세

### 1. 결제 요청 (User → Server)

사용자가 결제를 요청합니다.

```json
{
  "pool_address": "PoolPubkey...",
  "user_wallet": "UserPubkey...",
  "token_mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",  // USDC
  "amount": 1000000,      // 1 USDC (6 decimals)
  "fee": 10000,           // 0.01 USDC
  "product_id": "product_456"
}
```

### 2-3. 서버 처리

서버에서 payment_id 생성 및 Ed25519 서명 생성:

```typescript
// payment_id 생성 (고유값)
const paymentId = generateUniquePaymentId();

// 만료 시간 설정 (5분 후)
const deadline = Math.floor(Date.now() / 1000) + 300;

// 서명할 메시지 구성
const message = Buffer.concat([
  // payment_id (8 bytes)
  Buffer.from(new BigUint64Array([paymentId]).buffer),
  // user pubkey (32 bytes)
  userPubkey.toBuffer(),
  // pool pubkey (32 bytes) - pool_token_account.owner
  poolPubkey.toBuffer(),
  // to pubkey (32 bytes)
  toPubkey.toBuffer(),
  // token mint (32 bytes)
  tokenMint.toBuffer(),
  // amount (8 bytes)
  Buffer.from(new BigUint64Array([amount]).buffer),
  // fee_amount (8 bytes)
  Buffer.from(new BigUint64Array([fee]).buffer),
  // deadline (8 bytes)
  Buffer.from(new BigInt64Array([deadline]).buffer),
]);

// Ed25519 서명 생성
const signature = nacl.sign.detached(message, serverSignerKeypair.secretKey);
```

### 4. 트랜잭션 구성

서버에서 트랜잭션을 구성합니다:

```typescript
import { Ed25519Program, TransactionInstruction } from '@solana/web3.js';

// IX[0]: Ed25519 서명 검증 명령어
const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
  publicKey: serverSignerPubkey.toBytes(),
  message: message,
  signature: signature,
});

// IX[1]: process_payment 명령어
const processPaymentIx = await program.methods
  .processPayment({
    amount: new BN(amount),
    feeAmount: new BN(fee),
    paymentId: new BN(paymentId),
    deadline: new BN(deadline),
  })
  .accounts({
    payer: relayerPubkey,
    user: userPubkey,
    to: toPubkey,
    config: configPda,
    tokenMint: tokenMint,
    userTokenAccount: userTokenAccount,
    poolTokenAccount: poolTokenAccount,
    feeTokenAccount: feeTokenAccount,
    tokenProgram: TOKEN_PROGRAM_ID,
    instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
  })
  .instruction();

// 트랜잭션 생성
const tx = new Transaction()
  .add(ed25519Ix)
  .add(processPaymentIx);

tx.feePayer = relayerPubkey;
tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
```

### 5. 사용자 서명

사용자에게 서명 요청 (지갑 연동):

```typescript
// Phantom, Solflare 등 지갑 사용
const signedTx = await wallet.signTransaction(tx);
```

사용자가 서명하는 것:
- **토큰 전송 권한** (user_token_account에서 출금)
- SOL 가스비는 지불하지 않음

### 6. Relayer 서명

서버에서 Relayer 키로 서명 (가스비 지불자):

```typescript
signedTx.partialSign(relayerKeypair);
```

### 7. 트랜잭션 전송

```typescript
const txSignature = await connection.sendRawTransaction(
  signedTx.serialize()
);

// 확정 대기
await connection.confirmTransaction(txSignature, 'confirmed');
```

### 8-9. 온체인 처리

Solana 네트워크에서 처리:

1. **Ed25519Program**: 서버 서명 검증
2. **process_payment**:
   - 프로그램 정지 상태 확인 (paused == false)
   - Relayer 권한 확인 (payer == config.relayer)
   - Deadline 확인 (`clock.unix_timestamp <= deadline`)
   - 이전 IX에서 Ed25519 검증 확인
   - 서명 메시지 재구성 및 비교
   - User → Pool 토큰 전송 (amount)
   - User → Fee Wallet 토큰 전송 (fee_amount)
   - 로그 기록

### 10-11. 결과 확인

```typescript
// 트랜잭션 로그에서 결제 정보 확인
const txInfo = await connection.getTransaction(txSignature, {
  commitment: 'confirmed',
});

// 로그 파싱
// "PAYMENT_PROCESSED"
// "payment_id: 12345"
// "from: UserPubkey..."
// "to: ToPubkey..."
// "pool: PoolPubkey..."
// "token: TokenMint..."
// "amount: 1000000"
// "fee: 10000"
```

---

## 토큰 흐름

```
User Token Account
  │
  ├── amount ──────────> Pool Token Account (가맹점)
  │
  └── fee_amount ──────> Fee Token Account (플랫폼)
```

**예시 (1.01 USDC 결제, 0.01 USDC 수수료):**
- User 잔액: 10.00 USDC
- 결제 후 User 잔액: 8.99 USDC
- Pool (가맹점) 수령: 1.00 USDC
- Platform 수령: 0.01 USDC

---

## Pool vs To

| 개념 | 설명 |
|------|------|
| Pool | 실제 토큰을 수령하는 Token Account의 owner |
| To   | 결제 수령인 주소 (서명 검증용, 비즈니스 로직) |

Pool과 To는 동일할 수도 있고 다를 수도 있습니다:
- **동일한 경우**: 가맹점이 직접 토큰 수령
- **다른 경우**: Pool이 수탁 계정, To가 실제 수령인

---

## 에러 시나리오

### 1. 잔액 부족
```
Error: InsufficientFunds (SPL Token)
- User 토큰 잔액 < amount + fee_amount
- SPL Token Program에서 에러 발생
- 전체 트랜잭션 롤백
```

### 2. Deadline 초과
```
Error: PaymentExpired
- clock.unix_timestamp > deadline
- process_payment에서 즉시 실패
```

### 3. 서명 불일치
```
Error: InvalidServerSignature
- Ed25519 검증 실패
- 메시지 내용 불일치
- 서버 공개키 불일치
```

### 4. Relayer 권한 없음
```
Error: UnauthorizedRelayer
- payer != config.relayer
- 등록되지 않은 Relayer
```

### 5. 프로그램 정지
```
Error: Paused
- config.paused == true
- 긴급 상황 시 모든 결제 차단
```

### 6. 금액 오류
```
Error: InvalidAmount
- amount == 0
- 0원 결제 불가
```

---

## 로그 포맷

성공 시 기록되는 로그:

```
Program log: PAYMENT_PROCESSED
Program log: payment_id: 1234567890
Program log: from: 7xKpP...
Program log: to: 9yMqR...
Program log: pool: 3zNpQ...
Program log: token: EPjFW...
Program log: amount: 1000000
Program log: fee: 10000
```

이 로그는 EVM의 `PaymentExecuted` 이벤트와 동일한 정보를 포함합니다.

---

## 서명 검증 상세

### Ed25519 Instruction 구조

```
IX[0]: Ed25519Program.createInstructionWithPublicKey
  - public_key: server_signer 공개키 (32 bytes)
  - message: 결제 정보 (136 bytes)
  - signature: 서버 서명 (64 bytes)
```

### process_payment에서 검증

```rust
// 1. 이전 instruction이 Ed25519인지 확인
let ed25519_ix = load_instruction_at_checked(current_index - 1, instructions_sysvar)?;
if ed25519_ix.program_id != ed25519_program::ID {
    return Err(PaymentError::InvalidServerSignature.into());
}

// 2. Ed25519 instruction의 public key가 config.server_signer와 일치하는지 확인
let pubkey_in_ix = &ix_data[pubkey_offset..pubkey_offset + 32];
if pubkey_in_ix != server_signer.to_bytes() {
    return Err(PaymentError::InvalidServerSignature.into());
}

// 3. 메시지 재구성 후 비교
let expected_message = build_payment_message(params, user, pool, to, token_mint);
if message_in_ix != expected_message.as_slice() {
    return Err(PaymentError::InvalidServerSignature.into());
}
```

이 검증을 통해:
- 서버가 승인한 정확한 금액, 수령인, 토큰만 결제 가능
- 어떤 파라미터도 변조 불가능
