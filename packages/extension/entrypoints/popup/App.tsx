import { useEffect, useState } from 'react';
import { listPendingOrders, type PendingOrder } from '@/lib/storage';

export function App() {
  const [orders, setOrders] = useState<PendingOrder[]>([]);

  useEffect(() => {
    listPendingOrders().then(setOrders);
  }, []);

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
