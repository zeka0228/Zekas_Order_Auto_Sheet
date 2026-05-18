# Zekas Order Auto Sheet

해외 쇼핑몰에서 결제한 직후 주문 정보를 자동으로 캡처해, 한국 **배송대행지(배대지) 주문서**를 자동으로 채워주는 크롬 확장 프로그램.

> **상태:** Skeleton (v0.0.1) · 설계 v0.6 (design-confirmed)

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

---

## 모노레포 구조

```
Zekas_Order_Auto_Sheet/
├── packages/
│   ├── extension/      # 크롬 확장 (WXT)
│   └── config-api/     # Cloudflare Worker + D1 (Config DB)
├── pnpm-workspace.yaml
└── package.json
```

각 패키지 README:
- [`packages/extension/README.md`](packages/extension/README.md)
- [`packages/config-api/README.md`](packages/config-api/README.md)

---

## 빠른 시작

```bash
# 의존성 설치 (저장소 루트에서)
pnpm install

# 확장 개발 모드 (Chrome 자동 실행)
pnpm dev:ext

# Config API 로컬 개발
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
| 1 | 확장 골격, HTML Masker, Pro 토글 | 스켈레톤 완료 |
| 2 | 결제 캡처 + AI Config + 자가 치유 | |
| 3 | Gmail 백업 파싱 (Pro) | |
| 4 | 배대지 폼 채움 | |
| 5 | 자가 치유 완성 | |
| 6 | Web Store 심사, 공개 | |

---

## 설계 문서

상세 설계와 폐기된 안의 사유는 외부 Obsidian Vault에 별도 관리됨:

- `해외 직구 배대지 자동화 - 기술명세서.md` (v0.6)
- `해외 직구 배대지 자동화 - 설계 진화 로그.md`

---

## 라이선스

MIT. 자세한 내용은 [LICENSE](LICENSE) 참조.
