import "@testing-library/jest-dom/vitest";

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

/**
 * Each test starts in a browser that has never visited this site.
 *
 * The live page keeps the last catalogue in `localStorage` so a reload shows the guide immediately
 * rather than an empty screen for a second. That is right for a viewer and wrong for a test about
 * a cold visit: without this, a list cached by one test would answer the next one's question.
 * A test that wants the cached path can seed the store itself.
 */
beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // A store that refuses to clear is not a test failure.
  }
});
