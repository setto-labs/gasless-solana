# 배포 가이드

## 사전 요구사항

```bash
# Rust 설치
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Solana CLI 설치
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

# Anchor 설치
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install 0.31.1
avm use 0.31.1

# 버전 확인
solana --version      # 2.0.x
anchor --version      # 0.31.1
```

---

## 스크립트 기반 배포

### 배포 흐름

```
npm run deploy
    │
    ├── 1. 네트워크 선택 (devnet/mainnet)
    ├── 2. Program keypair 입력 (또는 새로 생성)
    ├── 3. Deployer private key 입력 (가스비 지불)
    ├── 4. Role addresses 입력
    │       ├── Authority (Config 관리자)
    │       ├── Emergency Admin (긴급 정지 권한)
    │       ├── Relayer (가스비 대납 서버)
    │       ├── Server Signer (Ed25519 서명자)
    │       └── Fee Recipient (수수료 수령)
    ├── 5. lib.rs + Anchor.toml 자동 업데이트
    ├── 6. anchor build
    ├── 7. solana program deploy
    ├── 8. initialize (Config PDA 생성)
    └── 9. deployments/solana-{network}.json 저장
```

### 명령어

```bash
cd solana-program

# 의존성 설치
npm install

# 배포 (interactive)
npm run deploy

# 배포 검증
npm run verify

# 상태 확인
npm run status
```

---

## 배포 스크립트 상세

### npm run deploy

1. **네트워크 선택**: devnet 또는 mainnet
2. **Program Keypair**:
   - 기존 키 입력 → 해당 Program ID 사용
   - 빈 값 → 새 keypair 생성 (반드시 저장!)
3. **Deployer Keypair**: 배포 가스비 지불 (최소 3 SOL 권장)
4. **Role 설정**: 각 역할별 주소 입력
5. **자동 처리**:
   - `lib.rs`의 `declare_id!` 업데이트
   - `Anchor.toml`의 Program ID 업데이트
   - `anchor build` 실행
   - `solana program deploy` 실행
   - `initialize` 호출

### npm run verify

배포 상태 검증:
- Program 존재 여부
- Config PDA 초기화 여부
- Config 값 확인 (authority, relayer 등)
- 로컬 deployment 파일과 비교

### npm run status

현재 프로그램 상태 조회:
- Program ID 및 배포 상태
- Config PDA 주소
- 모든 Config 값 출력
- Explorer 링크 제공

---

## 관리 스크립트

### Authority 전용 (Config 변경)

```bash
# Emergency Admin 변경
npm run authority:set-emergency-admin

# Relayer 변경
npm run authority:set-relayer

# Server Signer 변경
npm run authority:set-server-signer

# Fee Recipient 변경
npm run authority:set-fee-recipient

# Authority 이전
npm run authority:transfer
```

### Emergency Admin 전용 (긴급 정지)

```bash
# 프로그램 긴급 정지
npm run emergency:pause

# 정지 해제
npm run emergency:unpause
```

---

## 권한 체계

```
┌─────────────────────────────────────────────────────────────┐
│  Upgrade Authority (Solana 시스템)                           │
│  - 프로그램 코드 업그레이드                                    │
│  - Program keypair 필요                                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Authority (Config 관리자)                                   │
│  - set_relayer, set_server_signer, set_fee_recipient        │
│  - set_emergency_admin, transfer_authority                  │
│  - 프로덕션: Multisig (Squads) 권장                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Emergency Admin (긴급 정지 전용)                            │
│  - pause, unpause만 가능                                     │
│  - 24/7 운영팀에 권한 부여 가능                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 키 관리

### Program Keypair

```
용도: 프로그램 배포/업그레이드
보안: 최고 (하드웨어 월렛, 오프라인 보관)
분실 시: 업그레이드 불가 (프로그램은 계속 동작)
```

### Authority Key

```
용도: Config 설정 변경
보안: 최고 (Multisig 권장)
분실 시: 설정 변경 불가 (현재 설정으로 계속 동작)
```

### Emergency Admin Key

```
용도: 긴급 정지/해제
보안: 높음 (운영팀 보관 가능)
분실 시: Authority가 새로 지정 가능
```

### Relayer Key

```
용도: 트랜잭션 가스비 지불
보안: 높음 (서버 HSM, AWS KMS)
요구: 항상 SOL 잔액 유지
```

### Server Signer Key

```
용도: 결제 정보 Ed25519 서명
보안: 높음 (서버 환경변수, 시크릿 매니저)
```

---

## 배포 체크리스트

### Devnet

- [ ] `npm install` 완료
- [ ] `npm run deploy` 실행
- [ ] Deployer 잔액 확인 (최소 3 SOL)
- [ ] 모든 Role 주소 입력
- [ ] `npm run verify` 확인
- [ ] 테스트 결제 성공

### Mainnet

- [ ] 새 Program keypair 생성
- [ ] Program private key 안전 보관
- [ ] Authority Multisig 설정 (Squads)
- [ ] Deployer 잔액 확인 (최소 5 SOL)
- [ ] `npm run deploy` 실행
- [ ] `npm run verify` 확인
- [ ] Authority를 Multisig로 이전
- [ ] 소액 테스트 결제
- [ ] 모니터링 설정

---

## 문제 해결

### 빌드 실패

```bash
anchor clean
cargo clean
anchor build
```

### 배포 실패 (SOL 부족)

```bash
# 잔액 확인
solana balance

# Devnet 에어드롭
solana airdrop 2
```

### "Account already in use" 에러

Config PDA가 이미 초기화된 경우:
- deploy 스크립트가 자동으로 감지하고 skip
- 재초기화 필요 시 새 Program ID로 배포

### TypeScript 타입 에러

```bash
# VSCode에서 TypeScript 서버 재시작
Ctrl+Shift+P → "TypeScript: Restart TS Server"
```

---

## 파일 구조

```
solana-program/
├── scripts/
│   ├── constants.ts          # 네트워크, 오프셋 등 상수
│   ├── status.ts             # 상태 확인
│   ├── deploy/
│   │   ├── deploy.ts         # 배포 스크립트
│   │   └── verify.ts         # 검증 스크립트
│   └── manage/
│       ├── common.ts         # 공통 유틸리티
│       ├── authority/        # Authority 전용 스크립트
│       └── emergency-admin/  # Emergency Admin 전용 스크립트
├── deployments/              # 배포 결과 저장 (gitignore)
├── src/                      # Rust 소스 코드
└── Anchor.toml               # Anchor 설정 (자동 업데이트)
```
