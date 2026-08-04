/**
 * MAIN world: wrap fetch + XHR to intercept Jimeng list APIs.
 * Reports via window.pkgJimengReport (preload bridge) and postMessage backup.
 * Injected by main with webContents.executeJavaScript (bypasses page CSP).
 */
(function pkgJimengTap() {
  function fetchStillOurs() {
    try {
      return !!(window.fetch && window.fetch.__pkgJimengTap);
    } catch (_) {
      return false;
    }
  }
  function xhrStillOurs() {
    try {
      return !!(window.XMLHttpRequest && window.XMLHttpRequest.__pkgJimengTap);
    } catch (_) {
      return false;
    }
  }

  function install() {
    if (window.__pkgJimengTapInstalled && fetchStillOurs() && xhrStillOurs()) {
      return;
    }
    window.__pkgJimengTapInstalled = true;

    var SOURCE = 'pkg-jimeng-tap';

    function emit(payload) {
      try {
        var bridge = window.pkgJimengReport;
        if (typeof bridge === 'function') bridge(payload);
      } catch (_) {}
      try {
        window.postMessage({ source: SOURCE, payload: payload }, window.location.origin);
      } catch (_) {}
    }

    function toUrl(input) {
      try {
        if (typeof input === 'string') return input;
        if (input && typeof input.url === 'string') return input.url;
      } catch (_) {}
      return '';
    }

    function hostOk(url) {
      try {
        var h = new URL(url, location.href).hostname;
        return h === 'jimeng.jianying.com' || h.endsWith('.jianying.com');
      } catch (_) {
        return false;
      }
    }

    /**
     * favorite | home | null
     * Recommend before broad favorite tokens (collection_recommend ≠ 收藏).
     */
    function classify(url) {
      if (!url || !hostOk(url)) return null;
      var u = String(url);
      if (/workbench|generate|draft_list|history_list|workspace\/list|upload|login|passport|captcha/i.test(u)) {
        return null;
      }
      if (/get_favorite_list/i.test(u)) return 'favorite';
      if (/recommend|explore|discover|inspiration|hot[_-]?list|for[_-]?you|trending|home[_-]?feed|gallery_feed|community_feed|get_image_feed|get_video_feed|story_feed|channel_feed|local_item_list/i.test(u)) {
        return 'home';
      }
      if (/favorit|bookmark|star_list|like_list|get_collect|my_collect|user_collect|pack_list|get_asset_list|personal_asset|my_work|my_creation|work_list/i.test(u)) {
        return 'favorite';
      }
      return null;
    }

    function reportText(url, text, source) {
      if (!text || text.length < 8) return;
      emit({
        kind: 'capture',
        url: url,
        source: source,
        text: text,
        at: new Date().toISOString(),
      });
    }

    // ---- fetch ----
    var origFetch = window.fetch;
    function tappedFetch(input, init) {
      var url = toUrl(input);
      var source = classify(url);
      var p = origFetch.apply(this, arguments);
      if (!source) return p;
      return p.then(function (res) {
        try {
          var clone = res.clone();
          clone
            .text()
            .then(function (text) {
              reportText(url, text, source);
            })
            .catch(function () {});
        } catch (_) {}
        return res;
      });
    }
    tappedFetch.__pkgJimengTap = true;
    window.fetch = tappedFetch;

    // ---- XHR ----
    var OrigXHR = window.XMLHttpRequest;
    function TappedXHR() {
      var xhr = new OrigXHR();
      var _url = '';
      var _source = null;
      var open = xhr.open;
      xhr.open = function (method, url) {
        _url = typeof url === 'string' ? url : String(url || '');
        _source = classify(_url);
        return open.apply(xhr, arguments);
      };
      xhr.addEventListener('load', function () {
        if (!_source) return;
        try {
          reportText(_url, xhr.responseText || '', _source);
        } catch (_) {}
      });
      return xhr;
    }
    TappedXHR.__pkgJimengTap = true;
    TappedXHR.prototype = OrigXHR.prototype;
    window.XMLHttpRequest = TappedXHR;
  }

  install();
  // SPA may replace fetch after boot — reinstall periodically for a short window.
  var n = 0;
  var timer = setInterval(function () {
    n += 1;
    install();
    if (n >= 20) clearInterval(timer);
  }, 1500);
})();
