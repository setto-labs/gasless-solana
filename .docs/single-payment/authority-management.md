# Authority 관리 가이드

## 개요

Setto Payment 프로그램은 **3단계 권한 체계**를 사용합니다:
1. **Upgrade Authority**: 프로그램 코드 업그레이드 (Solana 시스템)
2. **Authority**: Config 설정 변경 (마스터 관리자)
3. **Emergency Admin**: 긴급 정지/해제만 가능 (운영팀)

---

## 권한 구조

```
┌─────────────────────────────────────────────────────────────┐
│  Upgrade Authority (Solana 시스템 레벨)                       │
│  - 프로그램 코드 업그레이드                                    │
│  - Program keypair 필요                                      │
│  - 프로덕션: 불변(Immutable) 또는 Multisig로 설정              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Authority (Config 관리자)                                   │
│                                                              │
│  가능한 작업:                                                 │
│  - set_emergency_admin: Emergency Admin 변경                 │
│  - set_relayer: Relayer 주소 변경                            │
│  - set_server_signer: 서버 서명자 변경                        │
│  - set_fee_recipient: 수수료 수령자 변경                      │
│  - transfer_authority: Authority 권한 이전                   │
│                                                              │
│  프로덕션: Multisig (Squads Protocol) 권장                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Emergency Admin (긴급 정지 전용)                            │
│                                                              │
│  가능한 작업:                                                 │
│  - pause: 프로그램 긴급 정지                                  │
│  - unpause: 프로그램 정지 해제                                │
│                                                              │
│  24/7 운영팀에 권한 부여 가능 (Authority보다 낮은 권한)        │
└─────────────────────────────────────────────────────────────┘
```

---

## Config 계정 구조

```rust
#[account]
pub struct Config {
    pub authority: Pubkey,        // Config 관리자
    pub emergency_admin: Pubkey,  // 긴급 정지 전용
    pub relayer: Pubkey,          // Relayer 서버 지갑
    pub server_signer: Pubkey,    // Ed25519 서명용 공개키
    pub fee_recipient: Pubkey,    // 수수료 수령 지갑
    pub paused: bool,             // 긴급 정지 플래그
    pub bump: u8,                 // PDA bump seed
}

Seeds: ["config"]
```

---

## 권한별 가능한 작업

| 작업                  | Authority | Emergency Admin |
|-----------------------|:---------:|:---------------:|
| set_emergency_admin   | O         | X               |
| set_relayer           | O         | X               |
| set_server_signer     | O         | X               |
| set_fee_recipient     | O         | X               |
| transfer_authority    | O         | X               |
| pause                 | X         | O               |
| unpause               | X         | O               |

---

## 관리 스크립트 사용법

### Authority 전용 스크립트

```bash
# Emergency Admin 변경
npm run authority:set-emergency-admin
# → Authority private key 입력
# → 새 Emergency Admin 주소 입력

# Relayer 변경
npm run authority:set-relayer
# → Authority private key 입력
# → 새 Relayer 주소 입력

# Server Signer 변경
npm run authority:set-server-signer
# → Authority private key 입력
# → 새 Server Signer 주소 입력

# Fee Recipient 변경
npm run authority:set-fee-recipient
# → Authority private key 입력
# → 새 Fee Recipient 주소 입력

# Authority 이전
npm run authority:transfer
# → 현재 Authority private key 입력
# → 새 Authority 주소 입력
# ⚠️ 이전 후 되돌릴 수 없음!
```

### Emergency Admin 전용 스크립트

```bash
# 프로그램 긴급 정지
npm run emergency:pause
# → Emergency Admin private key 입력
# → 확인 후 정지

# 정지 해제
npm run emergency:unpause
# → Emergency Admin private key 입력
# → 확인 후 해제
```

---

## 프로덕션 권장 설정

### 1단계: 개발/테스트 (단일 키)

초기 개발 및 테스트 단계에서는 동일한 키로 모든 역할 수행 가능:

```
Authority = Deployer 키
Emergency Admin = Deployer 키
```

### 2단계: 프로덕션 (역할 분리)

```
Authority = Multisig (Squads)
  - 3/5 또는 2/3 서명 요구
  - 핵심 팀원들로 구성

Emergency Admin = 운영팀 키
  - 24/7 모니터링 담당자
  - 긴급 상황 시 즉시 정지 가능
```

---

## Multisig 설정 (Squads Protocol)

### Squads 생성

1. https://v4.squads.so/ 접속
2. "Create Squad" 클릭
3. 멤버 추가 (예: 5명의 팀원)
4. Threshold 설정 (예: 3/5 = 5명 중 3명 서명 필요)
5. Squad 생성 완료 → **Vault 주소** 획득

### Authority를 Multisig로 이전

```bash
npm run authority:transfer
# → 현재 Authority private key 입력
# → 새 Authority 주소: Squads Vault 주소 입력
```

### Multisig로 Admin 함수 실행

Squads를 통해 트랜잭션을 제안하고 승인:

1. Squads 앱에서 "New Transaction" 클릭
2. 프로그램 instruction 입력
3. 멤버들이 순차적으로 승인
4. Threshold 도달 시 자동 실행

---

## 권한 이전 절차

### Authority 이전

```
1. 새 Authority 주소 준비
   └─> 개인 키 또는 Multisig Vault

2. npm run authority:transfer 실행
   └─> 현재 Authority 서명 필요

3. 기존 키 안전하게 폐기 (필요시)
   └─> 더 이상 권한 없음
```

### Emergency Admin 변경

```
1. 새 Emergency Admin 주소 준비

2. npm run authority:set-emergency-admin 실행
   └─> Authority 서명 필요

3. 새 Emergency Admin에게 private key 전달
```

---

## 긴급 상황 대응

### 해킹/취약점 발견 시

```
1. 즉시 pause() 실행
   npm run emergency:pause
   └─> 모든 결제 차단

2. 원인 분석 및 수정

3. 보안 검토 완료 후 unpause()
   npm run emergency:unpause
```

### Emergency Admin 키 분실 시

```
1. Authority가 새 Emergency Admin 지정
   npm run authority:set-emergency-admin

2. 기존 키 무효화됨
```

### Authority 키 분실 시

```
프로그램 설정 변경 불가
하지만:
- 기존 설정대로 결제는 계속 작동
- Emergency Admin으로 정지/해제 가능
- 설정 변경 필요 시 새 프로그램 배포 필요
```

---

## 보안 체크리스트

### 개발/테스트

- [ ] 모든 키페어 `.gitignore`에 추가
- [ ] 테스트 후 Devnet Authority 변경
- [ ] Emergency Admin 테스트 (pause/unpause)

### 프로덕션 (Mainnet)

- [ ] Authority Multisig 생성 (Squads)
- [ ] 최소 3명 이상의 멤버
- [ ] Threshold 설정 (과반수 이상 권장)
- [ ] Authority를 Multisig로 이전
- [ ] Emergency Admin 운영팀 지정
- [ ] 긴급 연락망 구축
- [ ] 정기적인 키 로테이션 계획

---

## FAQ

### Q: Authority와 Emergency Admin을 같은 주소로 설정해도 되나요?

네, 가능합니다. 하지만 프로덕션에서는 권한 분리를 권장합니다:
- Authority: 높은 보안 (Multisig)
- Emergency Admin: 신속한 대응 (운영팀)

### Q: Emergency Admin이 Config를 변경할 수 있나요?

아니요. Emergency Admin은 **pause/unpause만** 가능합니다. Config 변경은 Authority만 가능합니다.

### Q: Upgrade Authority와 Authority의 차이는?

```
Upgrade Authority: Solana 시스템 레벨
  - 프로그램 코드 업그레이드
  - Program keypair로 제어

Authority: 프로그램 내부 레벨
  - Config 설정 변경
  - Config PDA에 저장된 주소
```

### Q: Authority를 잘못된 주소로 이전하면?

되돌릴 수 없습니다. transfer_authority는 **즉시 적용**됩니다:
- 새 주소가 올바른지 반드시 확인
- 테스트 환경에서 먼저 시도
- Multisig 이전 시 Vault 주소 정확히 확인
