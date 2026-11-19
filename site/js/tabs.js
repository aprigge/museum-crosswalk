// Accessible tabs (WAI-ARIA tabs pattern): arrow keys, Home/End, roving tabindex.
export function setupTabs(root, onShow = () => {}) {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const show = (tab, focus = true) => {
    for (const t of tabs) {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !selected;
    }
    if (focus) tab.focus();
    onShow(tab.id);
  };
  for (const tab of tabs) {
    tab.addEventListener('click', () => show(tab));
    tab.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(tab);
      const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      show(tabs.at(next % tabs.length));
    });
  }
}
