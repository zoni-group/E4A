(() => {
  "use strict";

  const blockedSelectors = [
    "#share-button",
    "#login-link",
    "#logout-link",
    "#login-btn",
    "#share-link",
    "#embed-link",
    "#deploy-link",
    "#sync-link",
    "#broadcast-link",
    "#broadcast-status-btn",
    "#export-githubGist",
    "#export-codepen",
    "#export-jsfiddle",
    "#command-menu-link",
    "#keyboard-shortcuts-menu-link",
    "#app-menu-settings input#autosync",
    "#style-selector",
    "#script-selector",
    "ninja-keys",
  ];
  const selector = blockedSelectors.join(",");
  let initialHtmlFormatStarted = false;
  let initialHtmlFormatTimer;

  const style = document.createElement("style");
  style.dataset.e4aEducationMode = "true";
  style.textContent = `${selector} { display: none !important; }`;
  document.head.append(style);

  const disableControl = (element) => {
    element.setAttribute("aria-hidden", "true");
    if (element instanceof HTMLElement) {
      element.tabIndex = -1;
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLButtonElement) {
      element.disabled = true;
    }
    if (element.id === "autosync") {
      const row = element.closest("label, li");
      if (row instanceof HTMLElement) {
        row.hidden = true;
      }
    }
  };

  const disableBlockedControls = (root = document) => {
    if (root instanceof Element && root.matches(selector)) {
      disableControl(root);
    }
    root.querySelectorAll?.(selector).forEach(disableControl);
  };

  const formatInitialHtml = () => {
    if (initialHtmlFormatStarted || initialHtmlFormatTimer) {
      return;
    }
    const editor = document.querySelector("code.language-html[contenteditable]");
    const formatButton = document.querySelector("#format-btn");
    const source = editor?.textContent || "";
    if (!(formatButton instanceof HTMLElement) || !/^\s*<!doctype html>/i.test(source)) {
      return;
    }

    initialHtmlFormatTimer = window.setTimeout(() => {
      initialHtmlFormatTimer = undefined;
      const readyEditor = document.querySelector("code.language-html[contenteditable]");
      const readyFormatButton = document.querySelector("#format-btn");
      const readySource = readyEditor?.textContent || "";
      if (
        !(readyFormatButton instanceof HTMLElement) ||
        !/^\s*<!doctype html>/i.test(readySource)
      ) {
        formatInitialHtml();
        return;
      }
      initialHtmlFormatStarted = true;
      readyFormatButton.click();
    }, 1000);
  };

  document.addEventListener(
    "click",
    (event) => {
      if (event.target instanceof Element && event.target.closest(selector)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (event) => {
      const primaryModifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const opensCommandMenu = primaryModifier && !event.altKey && key === "k";
      const opensShare = primaryModifier && event.altKey && key === "s";
      const opensSeparateCodeEditor = primaryModifier && event.altKey && (key === "2" || key === "3");
      if (opensCommandMenu || opensShare || opensSeparateCodeEditor) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );

  disableBlockedControls();
  formatInitialHtml();
  new MutationObserver((records) => {
    records.forEach((record) => record.addedNodes.forEach((node) => disableBlockedControls(node)));
    formatInitialHtml();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
