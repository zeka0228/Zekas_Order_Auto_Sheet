import { useEffect, useState } from 'react';
import {
  getSettings,
  saveSettings,
  type Settings,
} from '@/lib/storage';

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  if (!settings) return <div className="p-6">로딩 중…</div>;

  // 온보딩 응답은 즉시 저장한다(질문 카드 → 설정 화면 전환).
  async function chooseGmail(uses: boolean) {
    const next: Settings = { ...settings!, gmailOrderEmails: uses, onboarded: true };
    await saveSettings(next);
    setSettings(next);
  }

  // ── 온보딩: 처음 등록 시 Gmail 사용 여부를 묻는다 ──
  if (!settings.onboarded) {
    return (
      <div className="max-w-xl mx-auto p-6 text-sm">
        <h1 className="text-xl font-semibold mb-4">Zekas Order Auto Sheet · 시작하기</h1>
        <section className="border rounded-md p-4">
          <h2 className="font-medium mb-2">
            배송대행 주문확인 메일을 Gmail로 받으시나요?
          </h2>
          <p className="text-xs text-gray-600 mb-4 leading-relaxed">
            <b>예</b>를 고르시면, Gmail에서 주문확인 메일을 열 때 주문번호를 자동으로
            채워 드립니다.
            <br />
            <b>아니오</b>를 고르시면 Gmail 자동 스캔을 끄고, 주문번호는 결제 후
            팝업에서 직접 입력하시면 됩니다. (나중에 설정에서 변경할 수 있어요.)
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => chooseGmail(true)}
              className="rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700"
            >
              예, Gmail로 받아요
            </button>
            <button
              onClick={() => chooseGmail(false)}
              className="rounded border border-gray-300 px-3 py-1.5 hover:bg-gray-50"
            >
              아니오, 직접 입력할게요
            </button>
          </div>
        </section>
      </div>
    );
  }

  // ── 온보딩 완료: 일반 설정 ──
  return (
    <div className="max-w-xl mx-auto p-6 text-sm">
      <h1 className="text-xl font-semibold mb-4">Zekas Order Auto Sheet · 설정</h1>

      <section className="border rounded-md p-4 mb-4">
        <h2 className="font-medium mb-2">Gmail 주문번호 자동 채움</h2>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.gmailOrderEmails}
            onChange={(e) =>
              setSettings({ ...settings, gmailOrderEmails: e.target.checked })
            }
          />
          <span>배송대행 주문확인 메일을 Gmail로 받음</span>
        </label>
        <p className="text-xs text-gray-500 mt-1 leading-relaxed">
          {settings.gmailOrderEmails
            ? 'Gmail에서 주문확인 메일을 열면 주문번호를 자동으로 채웁니다.'
            : '꺼져 있습니다. 주문번호는 결제 후 팝업에서 직접 입력하세요. (변경 후 Gmail 탭을 새로고침해야 반영됩니다.)'}
        </p>
      </section>

      <section className="border rounded-md p-4 mb-4">
        <h2 className="font-medium mb-2">Pro 모드 (Gmail 메일 자동 파싱)</h2>
        <label className="flex items-center gap-2 mb-3">
          <input
            type="checkbox"
            checked={settings.proEnabled}
            onChange={(e) =>
              setSettings({ ...settings, proEnabled: e.target.checked })
            }
          />
          <span>Pro 모드 사용</span>
        </label>

        <label className="block">
          <span className="block mb-1">Anthropic API Key</span>
          <input
            type="password"
            placeholder="sk-ant-…"
            value={settings.anthropicApiKey ?? ''}
            onChange={(e) =>
              setSettings({ ...settings, anthropicApiKey: e.target.value })
            }
            className="w-full border rounded px-2 py-1 font-mono text-xs"
            disabled={!settings.proEnabled}
          />
          <p className="text-xs text-gray-500 mt-1">
            키는 이 기기에만 저장되며, 외부 서버로 전송되지 않습니다.
          </p>
        </label>
      </section>

      <button
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        onClick={async () => {
          await saveSettings(settings);
          setSavedAt(Date.now());
        }}
      >
        저장
      </button>
      {savedAt && (
        <span className="ml-3 text-green-600 text-xs">
          저장됨 ({new Date(savedAt).toLocaleTimeString()})
        </span>
      )}
    </div>
  );
}
