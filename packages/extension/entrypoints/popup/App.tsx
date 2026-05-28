import { useEffect, useState } from 'react';
import { listPendingOrders, type PendingOrder } from '@/lib/storage';

type ScanState = 'idle' | 'scanning' | 'cart' | 'notcart' | 'unavailable';

const SCAN_MESSAGE: Record<Exclude<ScanState, 'idle'>, string> = {
  scanning: '스캔 중…',
  cart: '스캔 완료 — 장바구니를 캡처했어요.',
  notcart: '캡처는 했지만 장바구니 페이지로 확인되지 않았어요.',
  unavailable: '이 페이지는 스캔할 수 없어요 (제한 페이지이거나 로딩 전).',
};

export function App() {
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [scan, setScan] = useState<ScanState>('idle');

  useEffect(() => {
    listPendingOrders().then(setOrders);
  }, []);

  // 수동 스캔: 활성 탭의 content script로 SCAN_NOW 전송.
  // host_permissions <all_urls>로 messaging 가능. content script 미주입(chrome:// 등)이면 reject → 안내.
  async function handleScan() {
    setScan('scanning');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setScan('unavailable');
      return;
    }
    try {
      const res = (await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_NOW' })) as
        | { looksLikeCart?: boolean }
        | undefined;
      setScan(res?.looksLikeCart ? 'cart' : 'notcart');
    } catch {
      setScan('unavailable');
    }
  }

  return (
    <div className="p-4 w-80 text-sm">
      <header className="flex items-center justify-between mb-3">
        <h1 className="font-semibold text-base">Zekas Order Auto Sheet</h1>
        <button
          className="text-xs text-blue-600 hover:underline"
          onClick={() => chrome.runtime.openOptionsPage()}
        >
          설정
        </button>
      </header>

      <section className="mb-3">
        <button
          className="w-full rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:opacity-60"
          onClick={handleScan}
          disabled={scan === 'scanning'}
        >
          현재 페이지 스캔
        </button>
        {scan !== 'idle' && (
          <p className="mt-1.5 text-xs text-gray-600">{SCAN_MESSAGE[scan]}</p>
        )}
      </section>

      <section>
        <h2 className="font-medium mb-2">대기 중인 주문 ({orders.length})</h2>
        {orders.length === 0 ? (
          <p className="text-gray-500 text-xs">
            쇼핑몰 결제 완료 페이지를 방문하면 자동으로 캡처됩니다.
          </p>
        ) : (
          <ul className="space-y-1">
            {orders.map((o) => (
              <li key={o.id} className="border rounded px-2 py-1">
                <div className="font-mono text-xs">{o.domain}</div>
                <div className="text-xs text-gray-600">
                  {new Date(o.capturedAt).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
