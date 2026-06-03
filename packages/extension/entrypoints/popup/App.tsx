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
  // 미입력 주문별 입력 초안(id → 입력 중 문자열). 저장하면 비운다.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    listPendingOrders().then(setOrders);
    // background가 백필·수동 입력·청소로 pending_orders를 바꾸면 즉시 목록 반영(배지와 단일 소스).
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === 'local' && changes.pending_orders) listPendingOrders().then(setOrders);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
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

  // 수동 입력 저장 — background(단일 쓰기 주체)로 보내고, 목록은 storage.onChanged로 갱신된다.
  function saveOrderNumber(id: string) {
    const value = (drafts[id] ?? '').trim();
    if (!value) return;
    chrome.runtime.sendMessage({
      type: 'ORDER_SET_NUMBER',
      payload: { orderId: id, orderNumber: value },
    });
    setDrafts((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
  }

  const missingCount = orders.filter((o) => !o.orderNumber).length;
  // 미입력(주문번호 못 가져옴) 주문을 위로 — 사용자가 바로 처리하도록.
  const sorted = [...orders].sort(
    (a, b) => Number(Boolean(a.orderNumber)) - Number(Boolean(b.orderNumber)),
  );

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

      {missingCount > 0 && (
        <div className="mb-3 rounded border border-red-300 bg-red-50 px-2.5 py-2 text-xs text-red-700">
          주문번호를 메일에서 못 가져온 주문이 <b>{missingCount}건</b> 있어요. 확인 후
          입력하시면 주문서 작성에 바로 반영할게요.
        </div>
      )}

      <section>
        <h2 className="font-medium mb-2">대기 중인 주문 ({orders.length})</h2>
        {orders.length === 0 ? (
          <p className="text-gray-500 text-xs">
            쇼핑몰 결제 완료 페이지를 방문하면 자동으로 캡처됩니다.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {sorted.map((o) => {
              const filled = Boolean(o.orderNumber);
              return (
                <li
                  key={o.id}
                  className={`border rounded px-2 py-1.5 ${
                    filled ? '' : 'border-red-300 bg-red-50'
                  }`}
                >
                  <div className="font-mono text-xs">{o.domain}</div>
                  <div className="text-xs text-gray-500">
                    {new Date(o.capturedAt).toLocaleString()}
                  </div>

                  {filled ? (
                    <div className="mt-1 text-xs">
                      주문번호: <span className="font-mono font-medium">{o.orderNumber}</span>
                    </div>
                  ) : (
                    <div className="mt-1.5 flex gap-1">
                      <input
                        className="flex-1 min-w-0 rounded border border-gray-300 px-1.5 py-1 font-mono text-xs"
                        placeholder="주문번호 직접 입력"
                        value={drafts[o.id] ?? ''}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [o.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveOrderNumber(o.id);
                        }}
                      />
                      <button
                        className="shrink-0 rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                        onClick={() => saveOrderNumber(o.id)}
                        disabled={!(drafts[o.id] ?? '').trim()}
                      >
                        저장
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
