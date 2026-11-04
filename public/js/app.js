// Shared helpers for every StockFlow page: API calls, layout, icons, messages, forms.
(function () {
  'use strict';

  // ---------- Icons ----------
  const ICONS = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7l10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  };

  function icon(name, size) {
    size = size || 18;
    return '<svg class="icon" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }

  // Replace <span data-icon="plus" data-size="16"></span> placeholders in the HTML.
  function renderIcons(root) {
    (root || document).querySelectorAll('[data-icon]').forEach(function (el) {
      el.outerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 18);
    });
  }

  // ---------- Formatting ----------
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) { return Number(n || 0).toLocaleString('en-IN'); }
  function money(n) {
    return n === null || n === undefined ? '—' : '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ---------- API ----------
  class ApiError extends Error {
    constructor(status, body) {
      super((body && body.error) || 'Request failed.');
      this.status = status;
      this.errors = (body && body.errors) || {};
    }
  }

  async function api(path, options) {
    options = options || {};
    const init = { method: options.method || 'GET', headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (init.method !== 'GET') init.headers['X-Requested-With'] = 'StockFlow';
    if (options.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    let res;
    try {
      res = await fetch('/api' + path, init);
    } catch (e) {
      throw new ApiError(0, { error: 'Cannot reach the server. Check your connection.' });
    }
    const body = await res.json().catch(function () { return null; });
    if (res.status === 401 && !options.allow401) {
      location.replace('/login.html');
      return new Promise(function () {}); // stop the caller while redirecting
    }
    if (!res.ok) throw new ApiError(res.status, body);
    return body;
  }

  // ---------- Messages ----------
  function toast(message, type) {
    type = type || 'success';
    let box = document.getElementById('toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts';
      box.className = 'toasts';
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = 'flash flash-' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = icon(type === 'success' ? 'check' : 'alert', 16) + '<span>' + esc(message) + '</span>';
    box.appendChild(el);
    setTimeout(function () { el.classList.add('fade'); }, 3200);
    setTimeout(function () { el.remove(); }, 3800);
  }

  // Message to show after navigating to another page.
  function flashNext(message, type) {
    try { sessionStorage.setItem('flash', JSON.stringify({ message: message, type: type || 'success' })); } catch (e) { /* ignore */ }
  }
  function showPendingFlash() {
    try {
      const raw = sessionStorage.getItem('flash');
      if (raw) {
        sessionStorage.removeItem('flash');
        const f = JSON.parse(raw);
        toast(f.message, f.type);
      }
    } catch (e) { /* ignore */ }
  }

  // ---------- Forms ----------
  function formValues(form) {
    const out = {};
    new FormData(form).forEach(function (v, k) { out[k] = typeof v === 'string' ? v.trim() : v; });
    return out;
  }

  function clearErrors(form) {
    form.querySelectorAll('.field.has-error').forEach(function (f) { f.classList.remove('has-error'); });
    form.querySelectorAll('.field .error').forEach(function (e) { e.remove(); });
    const banner = form.querySelector('.form-error');
    if (banner) banner.hidden = true;
  }

  function showErrors(form, err) {
    clearErrors(form);
    const errors = err.errors || {};
    let first = null;
    Object.keys(errors).forEach(function (name) {
      const input = form.elements[name];
      if (!input) return;
      const field = input.closest('.field');
      field.classList.add('has-error');
      const msg = document.createElement('small');
      msg.className = 'error';
      msg.textContent = errors[name];
      field.appendChild(msg);
      if (!first) first = input;
    });
    if (first) first.focus();
    else {
      const banner = form.querySelector('.form-error');
      if (banner) {
        banner.querySelector('span').textContent = err.message;
        banner.hidden = false;
      } else {
        toast(err.message, 'error');
      }
    }
  }

  // Wire a form to an async submit handler with a busy state and error display.
  function onSubmit(form, handler) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.classList.add('busy'); }
      clearErrors(form);
      try {
        await handler(formValues(form));
      } catch (err) {
        if (err instanceof ApiError) showErrors(form, err);
        else { console.error(err); toast('Something went wrong.', 'error'); }
      } finally {
        if (btn) { btn.disabled = false; btn.classList.remove('busy'); }
      }
    });
  }

  // ---------- Layout ----------
  function renderShell(me) {
    const page = document.body.dataset.page;
    const initial = esc(me.organization.name.charAt(0).toUpperCase());
    const link = function (href, name, label, key) {
      return '<a href="' + href + '" class="' + (page === key ? 'active' : '') + '">' + icon(name) + ' ' + label + '</a>';
    };

    document.getElementById('sidebar').innerHTML =
      '<a class="brand" href="/">' +
        '<span class="brand-mark">' + icon('box', 18) + '</span><span>Stock<b>Flow</b></span></a>' +
      '<nav class="side-nav">' +
        link('/', 'dashboard', 'Dashboard', 'dashboard') +
        link('/products.html', 'layers', 'Products', 'products') +
        link('/settings.html', 'settings', 'Settings', 'settings') +
      '</nav>' +
      '<div class="side-foot">' +
        '<div class="account"><span class="avatar">' + initial + '</span>' +
          '<span class="account-text"><span class="org">' + esc(me.organization.name) + '</span>' +
          '<span class="email">' + esc(me.user.email) + '</span></span></div>' +
        '<button class="side-logout" id="logout-btn" type="button">' + icon('logout', 16) + ' Log out</button>' +
      '</div>';

    document.getElementById('mobile-bar').innerHTML =
      '<button class="icon-btn" id="menu-btn" type="button" aria-label="Open menu">' + icon('menu') + '</button>' +
      '<a class="brand" href="/"><span class="brand-mark">' + icon('box', 16) + '</span><span>Stock<b>Flow</b></span></a>' +
      '<span class="avatar sm">' + initial + '</span>';

    document.querySelectorAll('[data-org-name]').forEach(function (el) { el.textContent = me.organization.name; });

    document.getElementById('logout-btn').addEventListener('click', async function () {
      await api('/auth/logout', { method: 'POST', allow401: true });
      location.href = '/login.html';
    });
    document.getElementById('menu-btn').addEventListener('click', function () { document.body.classList.add('nav-open'); });
    document.getElementById('scrim').addEventListener('click', function () { document.body.classList.remove('nav-open'); });
  }

  // For signed-in pages: check the session, draw the layout, then run the page code.
  async function initPage(run) {
    renderIcons();
    const me = await api('/me');
    renderShell(me);
    document.body.classList.add('ready');
    showPendingFlash();
    try {
      await run(me);
    } catch (err) {
      console.error(err);
      toast(err.message || 'Could not load this page.', 'error');
    }
  }

  // For login/signup: skip straight to the dashboard if already signed in.
  async function initGuestPage(run) {
    renderIcons();
    try {
      await api('/me', { allow401: true });
      location.replace('/');
      return;
    } catch (e) { /* not signed in: stay */ }
    document.body.classList.add('ready');
    showPendingFlash();
    run();
  }

  window.SF = {
    api: api, ApiError: ApiError, icon: icon, renderIcons: renderIcons, esc: esc, num: num, money: money,
    toast: toast, flashNext: flashNext, onSubmit: onSubmit, showErrors: showErrors,
    initPage: initPage, initGuestPage: initGuestPage,
  };
})();
