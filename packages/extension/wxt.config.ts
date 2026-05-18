import { defineConfig } from 'wxt';

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: '.',
  outDir: '.output',
  manifest: {
    name: 'Zekas Order Auto Sheet',
    short_name: 'ZOAS',
    description:
      '해외 직구 결제 정보를 자동 캡처해 배대지 주문서를 채워주는 확장.',
    version: '0.0.1',
    permissions: ['storage', 'activeTab', 'scripting'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'Zekas Order Auto Sheet',
    },
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
  },
});
