# Zekas Order Auto Sheet

해외 쇼핑몰에서 결제한 직후 주문 정보를 자동으로 캡처해, 한국 **배송대행지(배대지) 주문서**를 자동으로 채워주는 크롬 확장 프로그램.

> **상태:** Skeleton (v0.0.1) · 설계 v0.7 (design-confirmed) · Apache License 2.0

---

## 한눈에

| | |
|---|---|
| **무엇** | 결제 페이지 → 배대지 주문서 자동 입력 크롬 확장 |
| **언어** | TypeScript · React · Tailwind |
| **빌드** | [WXT](https://wxt.dev) (확장) · [Cloudflare Workers](https://workers.cloudflare.com) + D1 (백엔드) |
| **모드** | Free (API 키 불필요) · Pro (사용자 본인 Anthropic 키로 메일 파싱) |
| **개인정보** | HTML 클라이언트 마스킹 — 실 사용자 데이터는 기기를 떠나지 않음 |
| **자동 제출** | 없음. 폼만 채우고 사용자가 직접 제출 |
| **라이선스** | Apache License 2.0 (특허·상표 보호) |

---

## ⚠️ Disclaimer

- 사용자 본인 책임 하에 사용
- 신고 정보를 검토 후 직접 제출
- 잘못된 신고로 인한 통관 문제는 사용자 책임
- 자동 제출 기능 없음

## 🔒 Privacy

- 실 주문 데이터(주문번호·상품명·가격·주소 등)는 사용자 기기를 떠나지 않음
- AI 호출 시 HTML은 클라이언트에서 placeholder로 치환된 후 전송
- Pro 모드(이메일 파싱)는 사용자 본인 Anthropic 키로만 호출

---

## 모노레포 구조

```
Zekas_Order_Auto_Sheet/
├── packages/
│   ├── shared/         # 공유 Zod 스키마 · 상수 (extension ↔ worker)
│   ├── extension/      # 크롬 확장 (WXT)
│   └── worker/         # Cloudflare Worker + D1 (Config DB · AI 프록시)
├── pnpm-workspace.yaml
├── package.json
├── LICENSE             # Apache License 2.0 전문
└── NOTICE
```

각 패키지 README:
- [`packages/extension/README.md`](packages/extension/README.md)
- [`packages/worker/README.md`](packages/worker/README.md)

---

## 빠른 시작

```bash
# 의존성 설치 (저장소 루트에서)
pnpm install

# 확장 개발 모드 (Chrome 자동 실행)
pnpm dev:ext

# Worker 로컬 개발
pnpm dev:api

# 확장 빌드 + zip
pnpm build:ext
pnpm zip:ext
```

> Node 20.10+, pnpm 9+ 필요.

---

## 개발 로드맵

| Phase | 내용 | 비고 |
|---|---|---|
| 0 | Cloudflare 인프라 (D1 + Worker + 개발자 키) | 진행 예정 |
| 1 | 모노레포 + 확장 골격, HTML Masker, Pro 토글 | 스켈레톤 + v0.7 정렬 완료 |
| 2 | 결제 캡처 + AI Config + 자가 치유 | |
| 3 | Gmail 백업 파싱 (Pro) | |
| 4 | 배대지 폼 채움 | |
| 5 | 자가 치유 완성 | |
| 6 | Web Store 심사, GitHub 공개 | |

---

## 설계 문서

상세 설계와 폐기된 안의 사유는 외부 Obsidian Vault에 별도 관리됨:

- `해외 직구 배대지 자동화 - 기술명세서.md` (v0.7)
- `해외 직구 배대지 자동화 - 설계 진화 로그.md` (v1.2)
- `해외 직구 배대지 자동화 - 버그 이력.md` (Living Documentation, 명세서 §15)

Phase 6 출시 시 위 내용을 `docs/` 폴더로 미러링.

---

## 라이선스

Apache License, Version 2.0. 자세한 내용은 [LICENSE](LICENSE) 및 [NOTICE](NOTICE) 참조.

- AI 시대 특허 분쟁 대비 (explicit patent grant + termination)
- 상표권 보호 (사칭 fork 방지)
- 기업 친화 (TypeScript · Kubernetes · Android 등 표준)
- GPL v3+ 호환
