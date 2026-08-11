(function () {
  'use strict';

  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;

  const scriptUrl = new URL(document.currentScript?.src || './pwa-shell.js', location.href);
  const workerUrl = new URL('service-worker.js', scriptUrl);
  let reloadAfterUpdate = false;
  let reloadingForUpdate = false;

  function ensureNoticeStyles() {
    if (document.getElementById('nexestatePwaShellStyles')) return;
    const style = document.createElement('style');
    style.id = 'nexestatePwaShellStyles';
    style.textContent = '.nexestate-pwa-update{position:fixed;z-index:2147483000;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));max-width:min(420px,calc(100vw - 32px));display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid #2e6589;border-radius:12px;background:#0a1d2d;color:#eef8ff;box-shadow:0 16px 42px rgba(0,0,0,.42);font:500 13px/1.45 "Segoe UI",Arial,sans-serif}.nexestate-pwa-update span{flex:1}.nexestate-pwa-update button{min-height:36px;border:1px solid #3b7da7;border-radius:9px;padding:7px 11px;background:#176ba1;color:#fff;font:600 12px/1 "Segoe UI",Arial,sans-serif;cursor:pointer}.nexestate-pwa-update button:last-child{background:transparent;color:#c7ddeb}.nexestate-pwa-update button:focus-visible{outline:2px solid #8ed5ff;outline-offset:2px}@media(max-width:560px){.nexestate-pwa-update{left:max(12px,env(safe-area-inset-left));right:max(12px,env(safe-area-inset-right));flex-wrap:wrap}.nexestate-pwa-update span{flex-basis:100%}}';
    document.head.appendChild(style);
  }

  function offerUpdate(worker) {
    if (!worker || document.getElementById('nexestatePwaUpdateNotice')) return;
    ensureNoticeStyles();
    const notice = document.createElement('div');
    notice.id = 'nexestatePwaUpdateNotice';
    notice.className = 'nexestate-pwa-update';
    notice.setAttribute('role', 'status');

    const text = document.createElement('span');
    text.textContent = 'Доступна новая версия NexEstate Media Studio.';
    const update = document.createElement('button');
    update.type = 'button';
    update.textContent = 'Обновить';
    const later = document.createElement('button');
    later.type = 'button';
    later.textContent = 'Позже';

    update.addEventListener('click', function () {
      reloadAfterUpdate = true;
      update.disabled = true;
      update.textContent = 'Обновление…';
      worker.postMessage({ type: 'SKIP_WAITING' });
    });
    later.addEventListener('click', function () { notice.remove(); });
    notice.append(text, update, later);
    document.body.appendChild(notice);
  }

  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!reloadAfterUpdate || reloadingForUpdate) return;
    reloadingForUpdate = true;
    location.reload();
  });

  window.addEventListener('load', function () {
    navigator.serviceWorker.register(workerUrl.href, { updateViaCache: 'none' }).then(function (registration) {
      if (registration.waiting && navigator.serviceWorker.controller) offerUpdate(registration.waiting);
      registration.addEventListener('updatefound', function () {
        const worker = registration.installing;
        worker?.addEventListener('statechange', function () {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
        });
      });
      registration.update().catch(function () {});
      window.dispatchEvent(new CustomEvent('nexestate:pwa-ready', { detail: { scope: registration.scope } }));
    }).catch(function (error) {
      console.warn('NexEstate PWA service worker registration failed:', error);
    });
  }, { once: true });
})();
