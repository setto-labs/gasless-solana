# Phantom Wallet Whitelist 요청 가이드

> Phantom에서 "이 dApp은 악성일 수 있습니다" 경고를 해제하기 위한 등록 절차

## 요청 대상 도메인

- `dev-app.settopay.com` (Development)
- `app.settopay.com` (Production)
- `*.settopay.com`

---

## 방법 1: 이메일 요청 (권장)

### 연락처

- **Blowfish (보안 파트너):** review@blowfish.xyz
- **Phantom 직접:** review@phantom.com

### 이메일 템플릿

**Subject:** Whitelist Request: settopay.com - Solana Payment Gateway

```
Hello Phantom/Blowfish Security Team,

We are requesting whitelist verification for our domains:
- dev-app.settopay.com (Development)
- app.settopay.com (Production)

== PROJECT OVERVIEW ==

Name: Setto Pay
Type: Solana Payment Gateway / B2B Payment Infrastructure
Website: https://settopay.com
Launch: Q1 2025

== WHAT WE DO ==

Setto Pay is a crypto payment infrastructure for merchants, enabling:
- USDC/USDT payments on Solana
- Gas-sponsored transactions (Relayer pays fees, not users)
- QR code payments for retail/e-commerce
- Multi-chain support (Solana, Base, Arbitrum, etc.)

== SECURITY ARCHITECTURE ==

- Ed25519 Precompile for server signature verification
- signTransaction pattern (users verify TX before signing)
- Relayer-based gas sponsorship (feePayer = our server)
- Anchor-based smart contract on Solana Devnet/Mainnet

Program ID (Devnet): 5aMvnLtsZLDEMeQSPXucoX7b49uiUKzLnp8yNujrrmpp

== TEAM & CREDENTIALS ==

- Building on Solana since 2024
- Company: [회사명]
- Contact: [이메일]

== TRANSACTION FLOW ==

1. User scans QR → connects Phantom
2. Server builds unsigned TX (feePayer = Relayer)
3. User reviews & signs via signTransaction()
4. Server adds Relayer signature → broadcasts

Users NEVER pay gas fees. All fees paid by our Relayer.

== WHY WHITELIST ==

Our dApp is legitimate payment infrastructure. The "malicious" warning
prevents normal merchant/customer transactions and damages trust in our service.

== REFERENCES ==

We can provide:
- Demo video of payment flow
- Smart contract source code
- Audit reports (if available)
- Community/partner references

Please let us know what additional information you need.

Thank you,
[이름]
[직책]
Setto Pay
[이메일]
[전화번호]
```

---

## 방법 2: GitHub PR

### Repository

https://github.com/phantom/blocklist

### 수정 파일

`whitelist.yaml`에 추가:

```yaml
- url: "*.settopay.com"
```

### PR 제목

```
Add settopay.com to whitelist - Solana Payment Gateway
```

### PR 설명

```markdown
## Request Type
Whitelist addition

## Domain
- `*.settopay.com`

## Description
Setto Pay is a legitimate Solana payment gateway providing:
- B2B crypto payment infrastructure
- Gas-sponsored transactions for users
- Ed25519 signature verification

## Proof of Legitimacy
- Website: https://settopay.com
- Program ID: 5aMvnLtsZLDEMeQSPXucoX7b49uiUKzLnp8yNujrrmpp
- Contact: [이메일]

## Why Flagged
New domain without existing Phantom/Blowfish verification history.

cc: @phantom/security
```

---

## 성공률 높이는 팁

| 항목 | 설명 | 우선순위 |
|------|------|----------|
| **Twitter/X 활동** | 프로젝트 계정으로 Solana 커뮤니티와 교류 | 높음 |
| **커뮤니티 보증** | Solana 개발자가 트위터에서 멘션해주면 효과적 | 높음 |
| **GitHub 이력** | Public repo, 활발한 커밋 이력 | 중간 |
| **Audit** | 스마트 컨트랙트 감사 리포트 첨부 | 중간 |
| **빠른 응답** | 추가 질문에 24시간 내 답변 | 높음 |

---

## 참고 자료

- [Phantom Blocklist GitHub](https://github.com/phantom/blocklist)
- [Phantom Discussion #426 - dApp Unblocking](https://github.com/orgs/phantom/discussions/426)
- [Blowfish Security](https://blowfish.xyz)

---

## 신청 체크리스트

- [ ] 이메일 발송 (review@blowfish.xyz, review@phantom.com)
- [ ] GitHub PR 생성 (선택)
- [ ] Twitter/X 프로젝트 계정 활성화
- [ ] 데모 영상 준비
- [ ] 스마트 컨트랙트 소스 공개 준비

---

## 예상 소요 시간

- 일반: 1-2주
- 커뮤니티 보증 있을 경우: 3-5일
- Audit 리포트 있을 경우: 빠른 승인 가능

---

*마지막 업데이트: 2025-01-06*
