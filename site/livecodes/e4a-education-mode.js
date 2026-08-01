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
  const htmlEditorSelector = "code.language-html[contenteditable]";
  const FORMAT_DEBOUNCE_MS = 600;
  const FORMAT_VERIFY_MS = 900;
  const FORMAT_RETRY_DELAYS = [250, 500, 1000, 2000, 4000, 8000];
  let formatTimer;
  let scheduledEditor;
  let scheduledSource = "";
  let trackedEditor;
  let trackedSource = "";
  let formatAttempts = 0;
  let formatExhausted = false;
  let formatInProgress = false;

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

  const isCollapsedCompleteHtml = (source) =>
    /^\s*<!doctype html>/i.test(source) && !/[\r\n]/.test(source);

  const syncFormatState = (editor, source) => {
    if (editor === trackedEditor && source === trackedSource) {
      return;
    }
    trackedEditor = editor;
    trackedSource = source;
    formatAttempts = 0;
    formatExhausted = false;
  };

  const retryDelay = () =>
    FORMAT_RETRY_DELAYS[Math.min(Math.max(formatAttempts - 1, 0), FORMAT_RETRY_DELAYS.length - 1)];

  const scheduleHtmlFormatting = (delay = FORMAT_DEBOUNCE_MS) => {
    if (formatInProgress) {
      return;
    }
    const editor = document.querySelector(htmlEditorSelector);
    const source = editor?.textContent || "";
    syncFormatState(editor, source);
    if (!isCollapsedCompleteHtml(source) || formatExhausted) {
      return;
    }
    if (formatTimer) {
      if (editor === scheduledEditor && source === scheduledSource) {
        return;
      }
      window.clearTimeout(formatTimer);
    }
    scheduledEditor = editor;
    scheduledSource = source;
    formatTimer = window.setTimeout(attemptHtmlFormatting, delay);
  };

  const finishFormattingAttempt = () => {
    formatInProgress = false;
    const editor = document.querySelector(htmlEditorSelector);
    const source = editor?.textContent || "";
    if (!isCollapsedCompleteHtml(source)) {
      syncFormatState(editor, source);
      return;
    }
    trackedEditor = editor;
    trackedSource = source;
    if (formatAttempts >= FORMAT_RETRY_DELAYS.length) {
      formatExhausted = true;
      return;
    }
    scheduleHtmlFormatting(retryDelay());
  };

  function attemptHtmlFormatting() {
    formatTimer = undefined;
    scheduledEditor = undefined;
    scheduledSource = "";
    const editor = document.querySelector(htmlEditorSelector);
    const formatButton = document.querySelector("#format-btn");
    const source = editor?.textContent || "";
    syncFormatState(editor, source);
    if (!isCollapsedCompleteHtml(source) || formatExhausted) {
      return;
    }

    formatAttempts += 1;
    const buttonDisabled =
      formatButton?.getAttribute("aria-disabled") === "true" ||
      (formatButton instanceof HTMLButtonElement && formatButton.disabled);
    if (!(formatButton instanceof HTMLElement) || buttonDisabled) {
      if (formatAttempts >= FORMAT_RETRY_DELAYS.length) {
        formatExhausted = true;
        return;
      }
      scheduleHtmlFormatting(retryDelay());
      return;
    }

    formatInProgress = true;
    formatButton.click();
    window.setTimeout(finishFormattingAttempt, FORMAT_VERIFY_MS);
  }

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
  scheduleHtmlFormatting();
  new MutationObserver((records) => {
    records.forEach((record) => record.addedNodes.forEach((node) => disableBlockedControls(node)));
    scheduleHtmlFormatting();
  }).observe(document.documentElement, {
    characterData: true,
    childList: true,
    subtree: true,
  });
})();
