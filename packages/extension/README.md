# @zoas/extension

Zekas Order Auto Sheet 크롬 확장. [WXT](https://wxt.dev) 기반.

## 디렉토리

```
extension/
├── entrypoints/
│   ├── background.ts          # 서비스 워커
│   ├── popup/                 # 툴바 팝업 (React)
│   ├── options/               # 옵션 페이지 (React)
│   ├── checkout.content.ts    # 쇼핑몰 결제 페이지 캡처
│   ├── checkout.injected.ts   # MAIN world 주입용 (필요 시)
│   ├── gmail.content.ts       # Gmail 백업 파싱 (Pro)
│   └── baedaeji.content.ts    # 배대지 폼 자동 채움
├── lib/
│   ├── storage.ts             # chrome.storage 래퍼
│   ├── html-masker.ts         # 클라이언트 마스킹 (핵심 보안)
│   ├── config-client.ts       # Worker Config DB 클라이언트
│   ├── claude-client.ts       # 사용자 키로 Anthropic 호출 (Pro)
│   ├── set-native.ts          # React-controlled input에 값 주입
│   ├── self-healing.ts        # 실패 보고 + 재생성 트리거
│   └── schemas.ts             # Zod 스키마
└── wxt.config.ts
```

## 개발

```bash
# 루트에서
pnpm dev:ext           # Chromium dev
pnpm --filter @zoas/extension dev:firefox

# 또는 이 패키지 안에서
pnpm dev
pnpm build
pnpm zip
```

## 환경 변수

런타임 설정은 `chrome.storage.local`에 저장 (사용자 API 키 등). Worker 엔드포인트 같은 상수는 빌드 타임 상수로 `lib/config-client.ts`에 둠 (추후 `wxt.config.ts`의 `runtimeConfig`로 이동 가능).

## 권한

| 권한 | 사유 |
|---|---|
| `storage` | 캡처된 주문, 사용자 키 보관 |
| `activeTab` | 현재 탭에서 폼 조작 |
| `scripting` | 동적 스크립트 주입 (배대지 폼 채움) |
| `host_permissions: <all_urls>` | 임의 쇼핑몰 결제 페이지 감지 |
