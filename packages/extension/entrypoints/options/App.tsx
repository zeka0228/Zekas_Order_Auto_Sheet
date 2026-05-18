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

  return (
    <div className="max-w-xl mx-auto p-6 text-sm">
      <h1 className="text-xl font-semibold mb-4">Zekas Order Auto Sheet · 설정</h1>

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
