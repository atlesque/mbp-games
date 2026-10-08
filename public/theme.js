// Light or dark: the device's setting until the player picks one with the header button, then their pick.
// Loaded in <head> so the page never flashes the wrong theme.
(() => {
  const KEY = 'mbpg_theme', root = document.documentElement;
  const get = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const saved = get();
  if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
  const current = () => root.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-theme-toggle]');
    if (!b) return;
    const next = current() === 'light' ? 'dark' : 'light';
    root.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch (e) {}
  });
})();
