// Light, dark or auto: auto (the default) follows the device's setting live; the header button cycles light → dark → auto and remembers the pick.
// Loaded in <head> so the page never flashes the wrong theme.
(() => {
  const KEY = 'mbpg_theme', root = document.documentElement, ORDER = ['light', 'dark', 'auto'];
  const LABEL = { light: 'Light theme', dark: 'Dark theme', auto: 'Auto theme, follows your device' };
  const get = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const apply = mode => {
    root.dataset.mode = mode;
    // style.css follows prefers-color-scheme on its own while data-theme is unset, so auto updates live.
    if (mode === 'auto') delete root.dataset.theme; else root.dataset.theme = mode;
    document.querySelectorAll('[data-theme-toggle]').forEach(b => {
      const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
      b.setAttribute('aria-label', `${LABEL[mode]}. Switch to ${next}`);
      b.title = LABEL[mode];
    });
  };
  const saved = get();
  let mode = ORDER.includes(saved) ? saved : 'auto';
  apply(mode);
  document.addEventListener('DOMContentLoaded', () => apply(mode));
  document.addEventListener('click', e => {
    if (!e.target.closest('[data-theme-toggle]')) return;
    mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    apply(mode);
    try { localStorage.setItem(KEY, mode); } catch (e) {}
  });
})();
