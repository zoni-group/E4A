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
    return control instanceof HTMLTextAreaElement || control instanceof HTMLInputElement || control instanceof HTMLSelectElement;
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
    if (requestedType === "checkbox" || requestedType === "select" || requestedType === "text" || requestedType === "textarea") {
      return requestedType;
    }
    if (control instanceof HTMLSelectElement) {
      return "select";
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
  function workbookRecordToText(record, fields) {
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
  async function copyWorkbookText(text) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    fallbackCopy(text);
  }
  function downloadWorkbookText(filename, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename.endsWith(".txt") ? filename : `${filename}.txt`;
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
  function fallbackCopy(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
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
  function createWorkbookRecord(draft, existing, now = /* @__PURE__ */ new Date(), mergeFields = true) {
    const timestamp = now.toISOString();
    return {
      artifactId: draft.artifactId,
      artifactTitle: draft.artifactTitle,
      filename: draft.filename,
      fields: mergeFields ? { ...existing?.fields, ...draft.fields } : draft.fields,
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
      normalizeExclusiveCheckboxGroups(this.block.root);
      updateUniqueSelectOptions(this.block.root);
      if (!this.store) {
        this.setSaveStatus("Save failed");
        this.setActionStatus("This browser is blocking local storage. You can still copy or download a backup.");
        return;
      }
      try {
        const savedRecord = await this.store.get(this.block.artifactId);
        if (savedRecord) {
          this.latestRecord = savedRecord;
          this.writeRecordToControls(savedRecord);
          normalizeExclusiveCheckboxGroups(this.block.root);
          this.updateAnswerStates();
          updateUniqueSelectOptions(this.block.root);
          this.lastSavedSnapshot = this.snapshotCurrentFields();
          this.setSaveStatus("Saved on this device");
        } else {
          this.updateAnswerStates();
          updateUniqueSelectOptions(this.block.root);
          this.lastSavedSnapshot = this.snapshotCurrentFields();
          this.setSaveStatus("Not saved yet");
        }
      } catch {
        this.setSaveStatus("Save failed");
        this.setActionStatus("This browser could not open saved workbook data. You can still copy or download a backup.");
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
        updateAnswerState(field.control);
        const eventName = field.definition.type === "checkbox" || field.definition.type === "select" ? "change" : "input";
        field.control.addEventListener(
          eventName,
          () => {
            enforceExclusiveCheckboxGroup(field.control, this.block.root);
            this.updateAnswerStates();
            updateUniqueSelectOptions(this.block.root);
            this.queueSave();
          },
          { signal: this.abortController.signal }
        );
        if (field.definition.type !== "checkbox") {
          field.control.addEventListener("blur", () => void this.saveIfChanged(), {
            signal: this.abortController.signal
          });
        }
      }
    }
    bindActions() {
      for (const button of this.block.copyButtons) {
        configureActionButton(button, "Copy answers");
        button.addEventListener("click", () => void this.copyCurrentWorksheet(), { signal: this.abortController.signal });
      }
      for (const button of this.block.downloadButtons) {
        configureActionButton(button, "Download backup");
        button.addEventListener("click", () => void this.downloadCurrentWorksheet(), { signal: this.abortController.signal });
      }
      for (const button of this.block.clearButtons) {
        configureActionButton(button, "Clear saved answers");
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
        await copyWorkbookText(this.getCurrentWorkbookText());
        this.setActionStatus("Answers copied.");
      } catch {
        this.setActionStatus("Copy failed. Download a backup instead.");
      }
    }
    async downloadCurrentWorksheet() {
      try {
        await this.flushPendingSave();
        downloadWorkbookText(this.block.filename, this.getCurrentWorkbookText());
        this.setActionStatus("Download started.");
      } catch {
        this.setActionStatus("Download failed. Copy the answers instead.");
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
      try {
        if (this.store) {
          const currentRecord = await this.store.get(this.block.artifactId) ?? this.latestRecord;
          const remainingFields = currentRecord ? withoutCurrentBlockFields(currentRecord, this.block.fields) : {};
          if (Object.keys(remainingFields).length > 0 && currentRecord) {
            const draft = {
              artifactId: currentRecord.artifactId,
              artifactTitle: currentRecord.artifactTitle,
              filename: currentRecord.filename,
              fields: remainingFields
            };
            this.latestRecord = await this.store.put(createWorkbookRecord(draft, currentRecord, /* @__PURE__ */ new Date(), false));
          } else {
            await this.store.delete(this.block.artifactId);
            this.latestRecord = void 0;
          }
        } else {
          this.latestRecord = void 0;
        }
        this.clearControls();
        this.updateAnswerStates();
        updateUniqueSelectOptions(this.block.root);
        this.setSaveStatus("Not saved yet");
        this.lastSavedSnapshot = this.snapshotCurrentFields();
        this.setActionStatus("This activity was cleared on this device.");
      } catch {
        this.clearControls();
        this.updateAnswerStates();
        updateUniqueSelectOptions(this.block.root);
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
    getCurrentWorkbookText() {
      const record = createWorkbookRecord(this.readDraftFromControls(), this.latestRecord);
      return workbookRecordToText(record, this.block.fields.map((field) => field.definition));
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
    updateAnswerStates() {
      for (const { control } of this.block.fields) {
        updateAnswerState(control);
      }
    }
    setSaveStatus(status) {
      setText(this.block.saveStatus, status);
      setStatusLabel(this.block.saveStatus, status);
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
  function withoutCurrentBlockFields(record, fields) {
    const currentFieldNames = new Set(fields.map(({ definition }) => definition.name));
    return Object.fromEntries(Object.entries(record.fields).filter(([name]) => !currentFieldNames.has(name)));
  }
  function configureActionButton(button, label) {
    button.setAttribute("aria-label", label);
    if (!button.title) {
      button.title = label;
    }
  }
  function setStatusLabel(element, label) {
    if (!element) {
      return;
    }
    element.setAttribute("aria-label", label);
    element.title = label;
  }
  function updateAnswerState(control) {
    const answer = control.dataset.e4aAnswer;
    if (!answer) {
      return;
    }
    const value = readControlValue(control);
    const state = toAnswerState(control, value, answer);
    control.dataset.e4aAnswerState = state;
    control.setAttribute("aria-invalid", state === "incorrect" ? "true" : "false");
    control.title = answerStateLabel(state);
    updateAnswerGroup(control);
  }
  function toAnswerState(control, value, answer) {
    if (control instanceof HTMLInputElement && control.type === "checkbox") {
      if (!control.checked) {
        return "empty";
      }
      return answer === "true" ? "correct" : "incorrect";
    }
    return value === "" ? "empty" : value === answer ? "correct" : "incorrect";
  }
  function answerStateLabel(state) {
    if (state === "correct") {
      return "Correct";
    }
    if (state === "incorrect") {
      return "Try again";
    }
    return "Choose an answer";
  }
  function updateAnswerGroup(control) {
    const group = control.closest("[data-e4a-answer-group], .e4a-vocab-match__row");
    if (!group) {
      return;
    }
    const controls = Array.from(group.querySelectorAll("[data-e4a-answer]"));
    const states = controls.map((item) => item.dataset.e4aAnswerState ?? "empty");
    const groupState = group.dataset.e4aAnswerMode === "single-choice" ? toSingleChoiceAnswerGroupState(states) : toAnswerGroupState(states);
    group.dataset.e4aAnswerGroupState = groupState;
    group.title = answerGroupStateLabel(groupState);
  }
  function toSingleChoiceAnswerGroupState(states) {
    if (states.every((state) => state === "empty")) {
      return "empty";
    }
    if (states.some((state) => state === "incorrect")) {
      return "incorrect";
    }
    if (states.some((state) => state === "correct")) {
      return "correct";
    }
    return "partial";
  }
  function toAnswerGroupState(states) {
    if (states.every((state) => state === "empty")) {
      return "empty";
    }
    if (states.every((state) => state === "correct")) {
      return "correct";
    }
    if (states.some((state) => state === "incorrect")) {
      return "incorrect";
    }
    return "partial";
  }
  function answerGroupStateLabel(state) {
    if (state === "correct") {
      return "All answers in this row are correct";
    }
    if (state === "incorrect") {
      return "One or more answers in this row need another try";
    }
    if (state === "partial") {
      return "Keep going";
    }
    return "Choose answers for this row";
  }
  function updateUniqueSelectOptions(root) {
    const selects = Array.from(root.querySelectorAll("select[data-e4a-option-group]"));
    const groups = /* @__PURE__ */ new Map();
    for (const select of selects) {
      const groupName = select.dataset.e4aOptionGroup?.trim();
      if (!groupName) {
        continue;
      }
      groups.set(groupName, [...groups.get(groupName) ?? [], select]);
    }
    for (const groupSelects of groups.values()) {
      const selectedValues = new Set(groupSelects.map((select) => select.value).filter((value) => value !== ""));
      for (const select of groupSelects) {
        for (const option of Array.from(select.options)) {
          option.disabled = option.value !== "" && option.value !== select.value && selectedValues.has(option.value);
        }
      }
    }
  }
  function enforceExclusiveCheckboxGroup(control, root) {
    if (!(control instanceof HTMLInputElement) || control.type !== "checkbox" || !control.checked) {
      return;
    }
    const groupName = control.dataset.e4aExclusiveGroup?.trim();
    if (!groupName) {
      return;
    }
    const checkboxes = Array.from(root.querySelectorAll('input[type="checkbox"][data-e4a-exclusive-group]'));
    for (const checkbox of checkboxes) {
      if (checkbox !== control && checkbox.dataset.e4aExclusiveGroup?.trim() === groupName) {
        checkbox.checked = false;
      }
    }
  }
  function normalizeExclusiveCheckboxGroups(root) {
    const firstCheckedByGroup = /* @__PURE__ */ new Set();
    const checkboxes = Array.from(root.querySelectorAll('input[type="checkbox"][data-e4a-exclusive-group]'));
    for (const checkbox of checkboxes) {
      const groupName = checkbox.dataset.e4aExclusiveGroup?.trim();
      if (!checkbox.checked || !groupName) {
        continue;
      }
      if (firstCheckedByGroup.has(groupName)) {
        checkbox.checked = false;
      } else {
        firstCheckedByGroup.add(groupName);
      }
    }
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
