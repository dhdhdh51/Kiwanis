// Applies the saved theme before first paint (avoids a light/dark flash). Kept external for a strict CSP.
(function () {
  try {
    var t = localStorage.getItem('vv-theme') || 'system';
    var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();
