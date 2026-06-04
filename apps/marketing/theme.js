/* Shared across all marketing pages. Loaded in <head> (not deferred) so the
   theme is set before first paint, then enhances the nav/footer on DOM ready. */
(function () {
  var LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11 V8 a4 4 0 0 1 8 0 v3"/></svg>';
  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  // 1. Set theme before paint.
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem('lyfos-theme'); } catch (e) {}
  root.setAttribute('data-theme', saved || root.getAttribute('data-theme') || 'light');

  function enhance() {
    var nav = document.querySelector('nav.top');
    var inner = nav && nav.querySelector('.inner');

    // 2. Brand mark in nav + footer.
    document.querySelectorAll('.brand').forEach(function (b) {
      if (!b.querySelector('.mark')) {
        var m = document.createElement('span');
        m.className = 'mark'; m.innerHTML = LOCK;
        b.insertBefore(m, b.firstChild);
      }
    });

    // 3. Theme toggle + group the right-hand nav items.
    if (inner) {
      var right = inner.querySelector('.nav-right');
      if (!right) {
        right = document.createElement('div');
        right.className = 'nav-right';
        var cta = inner.querySelector('.cta');
        if (cta) right.appendChild(cta);
        inner.appendChild(right);
      }
      var toggle = document.createElement('button');
      toggle.className = 'icon-btn'; toggle.id = 'themeToggle';
      toggle.setAttribute('aria-label', 'Switch theme'); toggle.title = 'Switch theme';
      right.insertBefore(toggle, right.firstChild);
      var sync = function () { toggle.innerHTML = root.getAttribute('data-theme') === 'dark' ? SUN : MOON; };
      sync();
      toggle.addEventListener('click', function () {
        var n = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', n);
        try { localStorage.setItem('lyfos-theme', n); } catch (e) {}
        sync();
      });

      // 4. Nav border on scroll.
      var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 8); };
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhance);
  else enhance();
})();
