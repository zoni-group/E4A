"use strict";
(() => {
  // assets/ts/e4a-workbook-db.ts
  var DB_NAME = "e4a-workbook";
  var DB_VERSION = 1;
  var WORKSHEET_STORE = "worksheets";
  function isIndexedDBAvailable() {
    return typeof window !== "undefined" && "indexedDB" in window && window.indexedDB != null;
  }
  var E4AWorkbookDatabase = class {
    open() {
      if (!isIndexedDBAvailable()) {
        return Promise.reject(new Error("IndexedDB is not available in this browser."));
      }
      this.dbPromise ?? (this.dbPromise = new Promise((resolve, reject) => {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(WORKSHEET_STORE)) {
            const store = db.createObjectStore(WORKSHEET_STORE, { keyPath: "artifactId" });
            store.createIndex("byArtifactId", "artifactId", { unique: true });
            store.createIndex("byUpdatedAt", "updatedAt", { unique: false });
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => db.close();
          resolve(db);
        };
        request.onerror = () => reject(request.error ?? new Error("Could not open workbook database."));
        request.onblocked = () => reject(new Error("Workbook database upgrade is blocked by another tab."));
      }));
      return this.dbPromise;
    }
    async get(artifactId) {
      const db = await this.open();
      return requestToPromise(
        db.transaction(WORKSHEET_STORE, "readonly").objectStore(WORKSHEET_STORE).get(artifactId)
      );
    }
    async put(record) {
      const db = await this.open();
      await transactionPromise(
        db.transaction(WORKSHEET_STORE, "readwrite"),
        (store) => store.put(record)
      );
      return record;
    }
    async delete(artifactId) {
      const db = await this.open();
      await transactionPromise(
        db.transaction(WORKSHEET_STORE, "readwrite"),
        (store) => store.delete(artifactId)
      );
    }
    async list() {
      const db = await this.open();
      return requestToPromise(
        db.transaction(WORKSHEET_STORE, "readonly").objectStore(WORKSHEET_STORE).getAll()
      );
    }
    async clear() {
      const db = await this.open();
      await transactionPromise(
        db.transaction(WORKSHEET_STORE, "readwrite"),
        (store) => store.clear()
      );
    }
  };
  function transactionPromise(transaction, run) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Workbook database transaction failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Workbook database transaction was aborted."));
      try {
        run(transaction.objectStore(WORKSHEET_STORE));
      } catch (error) {
        reject(error);
      }
    });
  }
  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Workbook database request failed."));
    });
  }

  // assets/ts/e4a-workbook-dom.ts
  function scanWorkbookBlocks(root = document) {
    return Array.from(root.querySelectorAll("[data-e4a-workbook]")).map(toWorkbookBlock).filter((block) => block !== void 0);
  }
  function setText(element, text) {
    if (element) {
      element.textContent = text;
    }
  }
  function toWorkbookBlock(root) {
    const artifactId = root.dataset.e4aArtifactId?.trim();
    const artifactTitle = root.dataset.e4aArtifactTitle?.trim();
    const filename = root.dataset.e4aFilename?.trim();
    if (!artifactId || !artifactTitle || !filename) {
      return void 0;
    }
    const fields = Array.from(root.querySelectorAll("[data-e4a-field]")).map((control, order) => toFieldBinding(control, order)).filter((field) => field !== void 0);
    return {
      artifactId,
      artifactTitle,
      filename,
      root,
      fields,
      copyButtons: Array.from(root.querySelectorAll("[data-e4a-copy]")),
      downloadButtons: Array.from(root.querySelectorAll("[data-e4a-download]")),
      clearButtons: Array.from(root.querySelectorAll("[data-e4a-clear]")),
      saveStatus: root.querySelector("[data-e4a-save-status]") ?? void 0,
      actionStatus: root.querySelector("[data-e4a-action-status]") ?? void 0
    };
  }
  function toFieldBinding(control, order) {
    if (!isWorkbookControl(control)) {
      console.warn("Ignoring unsupported E4A workbook field element.", control);
      return void 0;
    }
    const name = control.dataset.e4aField?.trim();
    if (!name) {
      return void 0;
    }
    return {
      control,
      definition: {
        name,
        label: getFieldLabel(control),
        type: getFieldType(control),
        order
      }
    };
  }
  function isWorkbookControl(control) {
    return control instanceof HTMLTextAreaElement || control instanceof HTMLInputElement;
  }
  function getFieldLabel(control) {
    const explicitLabel = control.dataset.e4aLabel?.trim();
    if (explicitLabel) {
      return explicitLabel;
    }
    const label = control.id ? document.querySelector(`label[for="${cssEscape(control.id)}"]`) : void 0;
    return label?.textContent?.trim() || control.name || control.dataset.e4aField || "Response";
  }
  function getFieldType(control) {
    const requestedType = control.dataset.e4aFieldType;
    if (requestedType === "checkbox" || requestedType === "text" || requestedType === "textarea") {
      return requestedType;
    }
    if (control instanceof HTMLInputElement && control.type === "checkbox") {
      return "checkbox";
    }
    if (control instanceof HTMLInputElement) {
      return "text";
    }
    return "textarea";
  }
  function cssEscape(value) {
    if ("CSS" in window && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return value.replace(/["\\]/g, "\\$&");
  }

  // assets/ts/e4a-workbook-export.ts
  function workbookRecordToMarkdown(record, fields) {
    const lines = [`# ${record.artifactTitle}`, ""];
    const sortedFields = [...fields].sort((a, b) => a.order - b.order);
    for (const field of sortedFields) {
      const value = record.fields[field.name];
      if (field.type === "checkbox") {
        lines.push(`- [${value === true ? "x" : " "}] ${field.label}`, "");
        continue;
      }
      lines.push(`${field.label}:`);
      lines.push(formatTextValue(value));
      lines.push("");
    }
    return `${lines.join("\n").trimEnd()}
`;
  }
  async function copyMarkdown(markdown) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(markdown);
      return;
    }
    fallbackCopy(markdown);
  }
  function downloadMarkdown(filename, markdown) {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }
  function formatTextValue(value) {
    if (typeof value === "string") {
      return value;
    }
    return "";
  }
  function fallbackCopy(markdown) {
    const textarea = document.createElement("textarea");
    textarea.value = markdown;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.insetInlineStart = "-9999px";
    textarea.style.top = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) {
      throw new Error("Copy is not available in this browser.");
    }
  }

  // assets/ts/e4a-workbook-model.ts
  var WORKBOOK_SCHEMA_VERSION = 1;
  function createWorkbookRecord(draft, existing, now = /* @__PURE__ */ new Date()) {
    const timestamp = now.toISOString();
    return {
      artifactId: draft.artifactId,
      artifactTitle: draft.artifactTitle,
      filename: draft.filename,
      fields: draft.fields,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      schemaVersion: WORKBOOK_SCHEMA_VERSION
    };
  }

  // assets/ts/e4a-workbook-editor.ts
  var AUTOSAVE_DELAY_MS = 500;
  var WorkbookEditor = class {
    constructor(block, store) {
      this.block = block;
      this.store = store;
      this.lastSavedSnapshot = "";
      this.saveEpoch = 0;
      this.abortController = new AbortController();
    }
    async initialize() {
      this.bindControls();
      this.bindActions();
      this.bindLifecycleSaves();
      if (!this.store) {
        this.setSaveStatus("Save failed");
        this.setActionStatus("This browser is blocking local storage. You can still copy or download your work.");
        return;
      }
      try {
        const savedRecord = await this.store.get(this.block.artifactId);
        if (savedRecord) {
          this.latestRecord = savedRecord;
          this.writeRecordToControls(savedRecord);
          this.lastSavedSnapshot = this.snapshotCurrentFields();
          this.setSaveStatus("Saved on this device");
        } else {
          this.lastSavedSnapshot = this.snapshotCurrentFields();
          this.setSaveStatus("Not saved yet");
        }
      } catch {
        this.setSaveStatus("Save failed");
        this.setActionStatus("This browser could not open saved workbook data. You can still copy or download your work.");
      }
    }
    destroy() {
      this.abortController.abort();
      if (this.autosaveTimer) {
        window.clearTimeout(this.autosaveTimer);
      }
    }
    bindControls() {
      for (const field of this.block.fields) {
        const eventName = field.definition.type === "checkbox" ? "change" : "input";
        field.control.addEventListener(eventName, () => this.queueSave(), { signal: this.abortController.signal });
        if (field.definition.type !== "checkbox") {
          field.control.addEventListener("blur", () => void this.saveIfChanged(), {
            signal: this.abortController.signal
          });
        }
      }
    }
    bindActions() {
      for (const button of this.block.copyButtons) {
        button.addEventListener("click", () => void this.copyCurrentWorksheet(), { signal: this.abortController.signal });
      }
      for (const button of this.block.downloadButtons) {
        button.addEventListener("click", () => void this.downloadCurrentWorksheet(), { signal: this.abortController.signal });
      }
      for (const button of this.block.clearButtons) {
        button.addEventListener("click", () => void this.clearCurrentWorksheet(), { signal: this.abortController.signal });
      }
    }
    bindLifecycleSaves() {
      document.addEventListener(
        "visibilitychange",
        () => {
          if (document.visibilityState === "hidden") {
            this.saveBeforeExit();
          }
        },
        { signal: this.abortController.signal }
      );
      window.addEventListener("pagehide", () => this.saveBeforeExit(), { signal: this.abortController.signal });
    }
    queueSave() {
      this.setActionStatus("");
      if (!this.store) {
        this.setSaveStatus("Save failed");
        return;
      }
      if (!this.hasUnsavedChanges()) {
        return;
      }
      this.setSaveStatus("Saving...");
      if (this.autosaveTimer) {
        window.clearTimeout(this.autosaveTimer);
      }
      this.autosaveTimer = window.setTimeout(() => void this.saveIfChanged(), AUTOSAVE_DELAY_MS);
    }
    async saveIfChanged() {
      const store = this.store;
      if (!store) {
        this.setSaveStatus("Save failed");
        return;
      }
      this.clearAutosaveTimer();
      const saveEpoch = this.saveEpoch;
      for (; ; ) {
        await this.waitForPendingSave();
        if (saveEpoch !== this.saveEpoch) {
          return;
        }
        const snapshot = this.snapshotCurrentFields();
        if (snapshot === this.lastSavedSnapshot) {
          return;
        }
        const save = this.writeSnapshot(store, snapshot, saveEpoch);
        this.pendingSave = save;
        try {
          await save;
        } catch {
          this.setSaveStatus("Save failed");
          return;
        } finally {
          if (this.pendingSave === save) {
            this.pendingSave = void 0;
          }
        }
        if (saveEpoch !== this.saveEpoch) {
          return;
        }
        if (!this.hasUnsavedChanges()) {
          return;
        }
        this.setSaveStatus("Saving...");
      }
    }
    saveBeforeExit() {
      this.clearAutosaveTimer();
      if (this.hasUnsavedChanges()) {
        void this.saveIfChanged();
      }
    }
    async copyCurrentWorksheet() {
      try {
        await this.flushPendingSave();
        await copyMarkdown(this.getCurrentMarkdown());
        this.setActionStatus("Markdown copied.");
      } catch {
        this.setActionStatus("Copy failed. Download the Markdown file instead.");
      }
    }
    async downloadCurrentWorksheet() {
      try {
        await this.flushPendingSave();
        downloadMarkdown(this.block.filename, this.getCurrentMarkdown());
        this.setActionStatus("Download started.");
      } catch {
        this.setActionStatus("Download failed. Copy the Markdown instead.");
      }
    }
    async clearCurrentWorksheet() {
      const confirmed = window.confirm(
        `Clear saved answers for "${this.block.artifactTitle}" on this device? This will not clear other worksheets.`
      );
      if (!confirmed) {
        return;
      }
      this.clearAutosaveTimer();
      this.saveEpoch += 1;
      await this.waitForPendingSave();
      this.clearControls();
      this.latestRecord = void 0;
      try {
        if (this.store) {
          await this.store.delete(this.block.artifactId);
        }
        this.setSaveStatus("Not saved yet");
        this.lastSavedSnapshot = this.snapshotCurrentFields();
        this.setActionStatus("This worksheet was cleared on this device.");
      } catch {
        this.setSaveStatus("Save failed");
        this.setActionStatus("The fields were cleared, but saved data could not be removed.");
      }
    }
    async flushPendingSave() {
      this.clearAutosaveTimer();
      await this.saveIfChanged();
    }
    async waitForPendingSave() {
      if (!this.pendingSave) {
        return;
      }
      try {
        await this.pendingSave;
      } catch {
      }
    }
    async writeSnapshot(store, snapshot, saveEpoch) {
      const draft = this.readDraftFromControls();
      const record = createWorkbookRecord(draft, this.latestRecord);
      const savedRecord = await store.put(record);
      if (saveEpoch !== this.saveEpoch) {
        return;
      }
      this.latestRecord = savedRecord;
      this.lastSavedSnapshot = snapshot;
      this.setSaveStatus(this.snapshotCurrentFields() === snapshot ? "Saved on this device" : "Saving...");
    }
    clearAutosaveTimer() {
      if (this.autosaveTimer) {
        window.clearTimeout(this.autosaveTimer);
        this.autosaveTimer = void 0;
      }
    }
    getCurrentMarkdown() {
      const record = createWorkbookRecord(this.readDraftFromControls(), this.latestRecord);
      return workbookRecordToMarkdown(record, this.block.fields.map((field) => field.definition));
    }
    readDraftFromControls() {
      return {
        artifactId: this.block.artifactId,
        artifactTitle: this.block.artifactTitle,
        filename: this.block.filename,
        fields: Object.fromEntries(
          this.block.fields.map(({ definition, control }) => [definition.name, readControlValue(control)])
        )
      };
    }
    writeRecordToControls(record) {
      for (const { definition, control } of this.block.fields) {
        writeControlValue(control, record.fields[definition.name]);
      }
    }
    clearControls() {
      for (const { control } of this.block.fields) {
        writeControlValue(control, control instanceof HTMLInputElement && control.type === "checkbox" ? false : "");
      }
    }
    setSaveStatus(status) {
      setText(this.block.saveStatus, status);
      this.block.root.dataset.e4aSaveState = status.toLowerCase().replace(/[^a-z]+/g, "-").replace(/-$/, "");
    }
    setActionStatus(status) {
      setText(this.block.actionStatus, status);
    }
    hasUnsavedChanges() {
      return this.snapshotCurrentFields() !== this.lastSavedSnapshot;
    }
    snapshotCurrentFields() {
      return JSON.stringify(
        this.block.fields.map(({ definition, control }) => [definition.name, readControlValue(control)])
      );
    }
  };
  function readControlValue(control) {
    if (control instanceof HTMLInputElement && control.type === "checkbox") {
      return control.checked;
    }
    return control.value;
  }
  function writeControlValue(control, value) {
    if (control instanceof HTMLInputElement && control.type === "checkbox") {
      control.checked = value === true;
      return;
    }
    control.value = typeof value === "string" ? value : "";
  }

  // assets/ts/e4a-workbook.ts
  async function initializeWorkbook() {
    const blocks = scanWorkbookBlocks();
    if (blocks.length === 0) {
      return;
    }
    const store = await getWorkbookStore(blocks.length > 0);
    const editors = blocks.map((block) => new WorkbookEditor(block, store));
    await Promise.all(editors.map((editor) => editor.initialize()));
  }
  async function getWorkbookStore(hasWorkbookBlocks) {
    if (!hasWorkbookBlocks || !isIndexedDBAvailable()) {
      return void 0;
    }
    try {
      const db = new E4AWorkbookDatabase();
      await db.open();
      return db;
    } catch {
      return void 0;
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void initializeWorkbook(), { once: true });
  } else {
    void initializeWorkbook();
  }
  window.addEventListener("unhandledrejection", (event) => {
    if (event.reason instanceof Error && event.reason.message.includes("workbook")) {
      for (const status of document.querySelectorAll("[data-e4a-save-status]")) {
        setText(status, "Save failed");
      }
    }
  });
})();
