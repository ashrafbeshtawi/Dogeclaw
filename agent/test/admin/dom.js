// Minimal DOM stand-in for unit-testing the admin modules in Node.
// Not a test file itself.
//
// The admin modules touch a deliberately small surface — getElementById,
// querySelectorAll, and a handful of element properties — so a stub is a few
// dozen lines and needs no dependency. Elements are created on first access,
// so a module never hits null for markup the test did not bother to declare.

class StubElement {
  constructor(id) {
    this.id = id;
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.style = {};
    this.dataset = {};
    this.children = [];
    const classes = new Set();
    this.classList = {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      contains: c => classes.has(c),
      toggle: (c, on) => {
        const want = on === undefined ? !classes.has(c) : on;
        if (want) classes.add(c); else classes.delete(c);
        return want;
      },
    };
  }
}

/**
 * Installs the stub globals. Returns { el, restore }; `el(id)` reaches the
 * same element the module under test will get from getElementById.
 */
export function installDom() {
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, new StubElement(id));
    return elements.get(id);
  };

  const saved = {
    document: globalThis.document,
    confirm: globalThis.confirm,
    alert: globalThis.alert,
  };

  globalThis.document = {
    getElementById: el,
    // Only used for tab switching, which lives in main.js.
    querySelectorAll: () => [],
  };
  globalThis.confirm = () => true;
  globalThis.alert = () => {};

  return {
    el,
    restore() {
      globalThis.document = saved.document;
      globalThis.confirm = saved.confirm;
      globalThis.alert = saved.alert;
    },
  };
}

/** Swaps global fetch; returns the restore fn. */
export function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}
