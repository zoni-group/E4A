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
      shuffleGroupedSelectOptions(this.block.root);
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
  function shuffleGroupedSelectOptions(root) {
    const selects = Array.from(root.querySelectorAll("select[data-e4a-option-group]"));
    const groups = /* @__PURE__ */ new Map();
    for (const select of selects) {
      const groupName = select.dataset.e4aOptionGroup?.trim();
      if (!groupName || select.dataset.e4aOptionsShuffled === "true") {
        continue;
      }
      groups.set(groupName, [...groups.get(groupName) ?? [], select]);
    }
    for (const groupSelects of groups.values()) {
      const shuffledValues = shuffleOptionValues(getAnswerOptionValues(groupSelects[0]));
      for (const select of groupSelects) {
        applySelectOptionOrder(select, shuffledValues);
      }
    }
  }
  function getAnswerOptionValues(select) {
    return Array.from(select.options).filter((option) => option.value !== "").map((option) => option.value);
  }
  function shuffleOptionValues(values) {
    if (values.length < 2) {
      return values;
    }
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    if (shuffled.every((value, index) => value === values[index])) {
      const [firstValue, ...remainingValues] = shuffled;
      return [...remainingValues, firstValue];
    }
    return shuffled;
  }
  function applySelectOptionOrder(select, shuffledValues) {
    const selectedValue = select.value;
    const options = Array.from(select.options);
    const placeholderOptions = options.filter((option) => option.value === "");
    const answerOptions = options.filter((option) => option.value !== "");
    const orderedAnswerOptions = shuffledValues.map((value) => answerOptions.find((option) => option.value === value)).filter((option) => option !== void 0);
    const remainingAnswerOptions = answerOptions.filter((option) => !orderedAnswerOptions.includes(option));
    select.replaceChildren(...placeholderOptions, ...orderedAnswerOptions, ...remainingAnswerOptions);
    select.value = selectedValue;
    select.dataset.e4aOptionsShuffled = "true";
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

  // assets/ts/e4a-image-expand.ts
  var activeClose;
  var dialogCounter = 0;
  var FOCUSABLE_SELECTOR = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])"
  ].join(",");
  function initializeImageExpanders(root = document) {
    const buttons = Array.from(root.querySelectorAll("[data-e4a-image-expand]"));
    for (const button of buttons) {
      if (button.dataset.e4aImageExpandReady === "true") {
        continue;
      }
      button.dataset.e4aImageExpandReady = "true";
      button.setAttribute("aria-haspopup", "dialog");
      if (!button.title) {
        button.title = button.textContent?.trim() || "Expand image";
      }
      button.addEventListener("click", () => openExpandedImage(button));
    }
  }
  function openExpandedImage(button) {
    const src = button.dataset.e4aImageExpandSrc?.trim();
    if (!src) {
      return;
    }
    activeClose?.();
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : void 0;
    const webpSrc = button.dataset.e4aImageExpandWebpSrc?.trim();
    const alt = button.dataset.e4aImageExpandAlt?.trim() || "";
    const caption = button.dataset.e4aImageExpandCaption?.trim() || alt;
    const captionId = `e4a-expanded-image-caption-${++dialogCounter}`;
    const overlay = document.createElement("div");
    overlay.className = "e4a-image-expand";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Expanded image preview");
    const dialog = document.createElement("div");
    dialog.className = "e4a-image-expand__dialog";
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "btn btn-light btn-sm e4a-image-expand__close";
    closeButton.textContent = "Close";
    closeButton.setAttribute("aria-label", "Close expanded image");
    const figure = document.createElement("figure");
    figure.className = "e4a-image-expand__figure";
    const picture = document.createElement("picture");
    const image = document.createElement("img");
    if (webpSrc) {
      const source = document.createElement("source");
      source.srcset = webpSrc;
      source.type = "image/webp";
      picture.append(source);
    }
    image.src = src;
    image.alt = alt;
    image.decoding = "async";
    picture.append(image);
    figure.append(picture);
    if (caption) {
      const figcaption = document.createElement("figcaption");
      figcaption.id = captionId;
      figcaption.textContent = caption;
      figure.append(figcaption);
      overlay.setAttribute("aria-describedby", captionId);
    }
    dialog.append(closeButton, figure);
    overlay.append(dialog);
    const close = () => {
      if (!overlay.isConnected) {
        return;
      }
      overlay.remove();
      document.body.classList.remove("e4a-image-expand-open");
      document.removeEventListener("keydown", handleKeyDown);
      activeClose = void 0;
      previousFocus?.focus({ preventScroll: true });
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "Tab") {
        keepFocusInside(event, overlay);
      }
    };
    closeButton.addEventListener("click", close);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        close();
      }
    });
    document.addEventListener("keydown", handleKeyDown);
    activeClose = close;
    const overlayHost = document.fullscreenElement ?? document.body;
    document.body.classList.add("e4a-image-expand-open");
    overlayHost.append(overlay);
    closeButton.focus({ preventScroll: true });
  }
  function keepFocusInside(event, root) {
    const focusable = Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
      (element) => element.offsetParent !== null
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // assets/ts/e4a-decision-poll.ts
  var feelingScale = [
    { value: 1, label: "Very weak" },
    { value: 2, label: "Weak" },
    { value: 3, label: "Medium" },
    { value: 4, label: "Strong" },
    { value: 5, label: "Very strong" }
  ];
  var decisionSlides = [
    {
      variant: "intro",
      eyebrow: "Interactive activity",
      title: "Decision Poll: Are We Really in Control?",
      copy: "Read each question, vote quickly, then move to the surprise slide."
    },
    {
      variant: "vote-options",
      title: "Poll 1",
      prompt: "Would you take this medicine?",
      details: ["This medicine saves 90 out of 100 people."],
      options: ["Yes", "No", "I'm not sure"],
      questionImage: {
        imagePath: "assets/images/lesson-03/poll_1_question_would_you_take_this_medicine.png",
        imageAlt: "A classroom medicine choice card says this medicine saves 90 out of 100 people while students prepare to vote."
      }
    },
    {
      variant: "surprise",
      title: "The Framing Effect",
      revealTitle: "Same facts, different feeling",
      revealText: '"Saves 90 out of 100 people" means the same as "10 out of 100 people do not survive."',
      bigIdea: "Words can change decisions.",
      simpleEnglish: "People do not only react to facts. People react to how facts are presented.",
      imagePath: "assets/images/lesson-03/01-framing_effect-same_facts_different_words.png",
      imageAlt: "Two classroom medicine explanations show the same survival facts framed positively and negatively, with students reacting differently."
    },
    {
      variant: "vote-options",
      title: "Poll 2 - Question 1",
      prompt: "Is this backpack more or less than $120?",
      options: ["More than $120", "Less than $120"],
      questionImage: {
        imagePath: "assets/images/lesson-03/poll_2_question_1_question_is_this_backpack_more_or_less_than_120.png",
        imageAlt: "A classroom shopping scene shows a backpack and a one hundred twenty dollar question."
      }
    },
    {
      variant: "vote-options",
      title: "Poll 2 - Question 2",
      prompt: "What is a fair price for this backpack?",
      options: ["$20", "$40", "$60", "$80 or more"],
      questionImage: {
        imagePath: "assets/images/lesson-03/poll_2_question_2_question_what_is_a_fair_price_for_this_backpack.png",
        imageAlt: "A backpack is shown with price choices of twenty, forty, sixty, and eighty dollars or more."
      }
    },
    {
      variant: "surprise",
      title: "The Anchoring Effect",
      revealTitle: "The first number can influence you",
      revealText: "The number $120 may stay in your mind. Then your price guess may become higher.",
      bigIdea: "Random numbers can affect decisions.",
      simpleEnglish: "The first number you see can become an anchor.",
      imagePath: "assets/images/lesson-03/02-anchoring_effect-the_first_number_sticks.png",
      imageAlt: "A classroom backpack price example shows an early high number acting like an anchor for later price guesses."
    },
    {
      variant: "vote-radio-submit",
      title: "Poll 3",
      prompt: "Choose your class snack.",
      options: ["Apple", "Cookie", "I want to change the option"],
      selectedIndex: 1,
      questionImage: {
        imagePath: "assets/images/lesson-03/poll_3_question_choose_your_class_snack.png",
        imageAlt: "A classroom snack choice form shows Apple, Cookie, and a change option with Cookie selected."
      }
    },
    {
      variant: "surprise",
      title: "The Default Effect",
      revealTitle: "Many people keep the selected option",
      revealText: "The checked option feels easy. Changing it takes more effort.",
      bigIdea: "The default option is powerful.",
      simpleEnglish: "Sometimes we choose something because it is already chosen for us.",
      imagePath: "assets/images/lesson-03/03-default_effect-the_option_already_selected.png",
      imageAlt: "A snack choice example shows an apple and a cookie, with the cookie already selected as the default option."
    },
    {
      variant: "vote-menu-compare",
      title: "Poll 4",
      prompt: "Which menu is easier?",
      menus: [
        {
          title: "Menu A",
          items: ["Chocolate", "Vanilla", "Strawberry"]
        },
        {
          title: "Menu B",
          items: [
            "Chocolate",
            "Vanilla",
            "Strawberry",
            "Mango",
            "Coffee",
            "Pistachio",
            "Coconut",
            "Caramel",
            "Mint",
            "Banana",
            "Lemon",
            "Cherry",
            "Blueberry",
            "Peanut butter"
          ]
        }
      ],
      options: ["Menu A is easier", "Menu B is easier", "Both are easy"],
      questionImage: {
        imagePath: "assets/images/lesson-03/poll_4_question_which_menu_is_easier.png",
        imageAlt: "Two ice cream menus compare a short flavor list and a longer flavor list."
      }
    },
    {
      variant: "surprise",
      title: "Choice Overload",
      revealTitle: "More choices are not always better",
      revealText: "Many options can feel exciting. But too many options can make choosing harder.",
      bigIdea: "Too many choices can make people feel stuck.",
      simpleEnglish: "More options can make decisions more difficult.",
      imagePath: "assets/images/lesson-03/04-choice_overload-too_many_options.png",
      imageAlt: "An ice cream shop compares a simple three-flavor menu with a crowded menu that makes a student feel unsure."
    },
    {
      variant: "vote-options",
      title: "Poll 5 - Question 1",
      prompt: "You own this pen. How much would you sell it for?",
      options: ["$0.25", "$0.50", "$1.00", "More than $1.00"],
      questionImage: {
        imagePath: "assets/images/lesson-03/poll_5_question_1_how_much_would_you_sell_it_for.png",
        imageAlt: "A student holds a simple blue pen and considers selling price choices."
      }
    },
    {
      variant: "vote-options",
      title: "Poll 5 - Question 2",
      prompt: "Now imagine someone is offering you the same pen. How much would you buy it for?",
      options: ["$0.25", "$0.50", "$1.00", "More than $1.00"],
      questionImage: {
        imagePath: "assets/images/lesson-03/poll_5_question_2_how_much_would_you_buy_it_for.png",
        imageAlt: "A simple blue pen is offered for sale while a student considers buying price choices."
      }
    },
    {
      variant: "surprise",
      title: "The Endowment Effect",
      revealTitle: '"My pen" feels more valuable',
      revealText: "When something becomes mine, I may value it more.",
      bigIdea: "Ownership changes value.",
      simpleEnglish: "People often want more money to sell something they own than they would pay to buy it.",
      imagePath: "assets/images/lesson-03/05-endowment_effect-my_pen_feels_more_valuable.png",
      imageAlt: "A classroom pen example shows that a student may value a pen more after thinking of it as their own."
    },
    {
      variant: "vote-scale",
      title: "Poll 6 - Question 1",
      prompt: "Imagine you find $20. How strong is the feeling?",
      scale: feelingScale,
      questionImage: {
        imagePath: "assets/images/lesson-03/poll_6_question_1_how_strong_is_the_feeling.png",
        imageAlt: "A student finds a twenty dollar bill and looks at a one to five feeling scale."
      }
    },
    {
      variant: "vote-scale",
      title: "Poll 6 - Question 2",
      prompt: "Imagine you lose $20. How strong is the feeling?",
      scale: feelingScale,
      questionImage: {
        imagePath: "assets/images/lesson-03/poll_6_question_2_magine_you_lose_20.png",
        imageAlt: "A student checks a bag for a missing twenty dollar bill and looks at a one to five feeling scale."
      }
    },
    {
      variant: "surprise",
      title: "Loss Aversion",
      revealTitle: "Losses often feel stronger than gains",
      revealText: "For many people, losing money hurts more than winning the same amount feels good.",
      bigIdea: "Losses feel bigger than gains.",
      simpleEnglish: "People often work harder to avoid losing something than to get something new.",
      imagePath: "assets/images/lesson-03/06-loss_aversion-losing_hurts_more.png",
      imageAlt: "A classroom money example compares the feeling of finding twenty dollars with the stronger feeling of losing twenty dollars."
    },
    {
      variant: "vote-options",
      title: "Poll 7",
      prompt: "You answer a question. Then five classmates give a different answer. What do you do?",
      options: ["Keep my answer", "Change my answer", "Feel less sure"],
      questionImage: {
        imagePath: "assets/images/lesson-03/poll_7_question_five_classmates_give_a_different_answer.png",
        imageAlt: "One student holds answer A while five classmates hold answer B in a calm classroom vote."
      }
    },
    {
      variant: "surprise",
      title: "Social Influence",
      revealTitle: "Groups can influence decisions",
      revealText: "Sometimes people change their answers because they do not want to be different.",
      bigIdea: "Other people can change our decisions.",
      simpleEnglish: "We are influenced by the people around us.",
      imagePath: "assets/images/lesson-03/07-social_influence-the_group_changes_your_mind.png",
      imageAlt: "A classroom vote shows one student holding answer A while classmates hold answer B, making the student feel unsure."
    },
    {
      variant: "summary"
    },
    {
      variant: "transition",
      text: "A decision matrix helps us compare options more clearly."
    }
  ];
  var INTRO_SLIDE_COUNT = 1;
  var LETTERS = ["A", "B", "C", "D"];
  function initializeDecisionPollActivities(root = document) {
    const activities = Array.from(root.querySelectorAll("[data-e4a-decision-poll]"));
    for (const activity of activities) {
      new DecisionPollActivity(activity).initialize();
    }
  }
  var DecisionPollActivity = class {
    constructor(root) {
      this.root = root;
      this.currentSlideIndex = 0;
      this.isPresenting = false;
      this.handlePresentationKeydown = (event) => {
        if (event.key === "Escape" && this.isPresenting) {
          if (document.querySelector(".e4a-image-expand")) {
            return;
          }
          this.exitPresentation();
        }
      };
      this.handleFullscreenChange = () => {
        if (this.isPresenting && document.fullscreenElement === null) {
          this.exitPresentation(true);
        }
      };
    }
    initialize() {
      this.root.innerHTML = this.renderShell();
      const elements = this.queryElements();
      if (!elements) {
        return;
      }
      this.elements = elements;
      elements.presentButton.addEventListener("click", () => this.enterPresentation());
      elements.exitButton.addEventListener("click", () => this.exitPresentation());
      elements.previousButton.addEventListener("click", () => this.goPrevious());
      elements.primaryButton.addEventListener("click", () => this.goNext());
      this.renderSlide();
    }
    renderShell() {
      return `
      <div class="e4a-decision-poll__inner">
        <div class="e4a-decision-poll__header">
          <div class="e4a-decision-poll__present-controls">
            <button type="button" class="e4a-decision-poll__present btn btn-outline-primary" data-e4a-decision-poll-present>Present</button>
            <button type="button" class="e4a-decision-poll__exit btn btn-outline-secondary" data-e4a-decision-poll-exit hidden>Exit</button>
          </div>
        </div>
        <div class="e4a-decision-poll__poll" data-e4a-decision-poll-view>
          <div class="e4a-decision-poll__progress-row" data-e4a-decision-poll-progress-row>
            <p class="e4a-decision-poll__progress-text" data-e4a-decision-poll-progress-text></p>
            <div class="e4a-decision-poll__progress-track" aria-hidden="true">
              <div class="e4a-decision-poll__progress-bar" data-e4a-decision-poll-progress-bar></div>
            </div>
          </div>
          <div class="e4a-decision-poll__slide" data-e4a-decision-poll-slide tabindex="-1"></div>
          <div class="e4a-decision-poll__actions">
            <button type="button" class="e4a-decision-poll__previous btn btn-outline-secondary" data-e4a-decision-poll-previous hidden>Previous slide</button>
            <button type="button" class="e4a-decision-poll__primary btn btn-primary" data-e4a-decision-poll-primary>Next</button>
          </div>
        </div>
      </div>
    `;
    }
    queryElements() {
      const progressRow = this.root.querySelector("[data-e4a-decision-poll-progress-row]");
      const progressText = this.root.querySelector("[data-e4a-decision-poll-progress-text]");
      const progressBar = this.root.querySelector("[data-e4a-decision-poll-progress-bar]");
      const slide = this.root.querySelector("[data-e4a-decision-poll-slide]");
      const previousButton = this.root.querySelector("[data-e4a-decision-poll-previous]");
      const primaryButton = this.root.querySelector("[data-e4a-decision-poll-primary]");
      const presentButton = this.root.querySelector("[data-e4a-decision-poll-present]");
      const exitButton = this.root.querySelector("[data-e4a-decision-poll-exit]");
      if (!progressRow || !progressText || !progressBar || !slide || !previousButton || !primaryButton || !presentButton || !exitButton) {
        return void 0;
      }
      return { progressRow, progressText, progressBar, slide, previousButton, primaryButton, presentButton, exitButton };
    }
    renderSlide() {
      if (!this.elements) {
        return;
      }
      const slide = decisionSlides[this.currentSlideIndex];
      const isIntroSlide = slide.variant === "intro";
      const teachingSlideCount = decisionSlides.length - INTRO_SLIDE_COUNT;
      const teachingSlideNumber = this.currentSlideIndex - INTRO_SLIDE_COUNT + 1;
      this.elements.slide.replaceChildren();
      this.elements.progressRow.hidden = isIntroSlide;
      this.elements.progressText.textContent = isIntroSlide ? "" : `Slide ${teachingSlideNumber} of ${teachingSlideCount}`;
      this.elements.progressBar.style.width = isIntroSlide ? "0%" : `${teachingSlideNumber / teachingSlideCount * 100}%`;
      this.elements.previousButton.hidden = this.currentSlideIndex <= INTRO_SLIDE_COUNT;
      this.setControlButtonLabel(this.elements.previousButton, "Previous slide");
      this.renderPrimaryButton(slide);
      if (slide.variant === "intro") {
        this.renderIntroSlide(slide);
      } else if (slide.variant === "vote-options") {
        this.renderVoteOptionsSlide(slide);
      } else if (slide.variant === "vote-radio-submit") {
        this.renderVoteRadioSubmitSlide(slide);
      } else if (slide.variant === "vote-menu-compare") {
        this.renderVoteMenuCompareSlide(slide);
      } else if (slide.variant === "vote-scale") {
        this.renderVoteScaleSlide(slide);
      } else if (slide.variant === "surprise") {
        this.renderSurpriseSlide(slide);
      } else if (slide.variant === "summary") {
        this.renderSummarySlide();
      } else {
        this.renderTransitionSlide(slide);
      }
      initializeImageExpanders(this.elements.slide);
      focusWithoutScrolling(this.elements.slide);
    }
    renderPrimaryButton(slide) {
      if (!this.elements) {
        return;
      }
      if (slide.variant === "transition") {
        this.elements.primaryButton.hidden = true;
        return;
      }
      this.elements.primaryButton.hidden = false;
      if (slide.variant === "intro") {
        this.setControlButtonLabel(this.elements.primaryButton, "Start");
      } else if (slide.variant === "vote-radio-submit") {
        this.setControlButtonLabel(this.elements.primaryButton, "Submit vote");
      } else if (slide.variant === "surprise") {
        this.setControlButtonLabel(
          this.elements.primaryButton,
          decisionSlides[this.currentSlideIndex + 1]?.variant === "summary" ? "See summary" : "Next poll"
        );
      } else if (slide.variant === "summary") {
        this.setControlButtonLabel(this.elements.primaryButton, "Finish");
      } else {
        this.setControlButtonLabel(this.elements.primaryButton, "Next");
      }
    }
    renderIntroSlide(slide) {
      if (!this.elements) {
        return;
      }
      this.elements.slide.className = "e4a-decision-poll__slide e4a-decision-poll__slide--intro";
      const content = document.createElement("div");
      content.className = "e4a-decision-poll__intro-slide";
      const eyebrow = document.createElement("p");
      eyebrow.className = "e4a-decision-poll__eyebrow";
      eyebrow.textContent = slide.eyebrow;
      const title = document.createElement("h3");
      title.className = "e4a-decision-poll__title";
      title.textContent = slide.title;
      const copy = document.createElement("p");
      copy.className = "e4a-decision-poll__copy";
      copy.textContent = slide.copy;
      content.append(eyebrow, title, copy);
      this.elements.slide.append(content);
    }
    renderVoteOptionsSlide(slide) {
      if (!this.elements) {
        return;
      }
      this.elements.slide.className = "e4a-decision-poll__slide e4a-decision-poll__slide--question";
      const content = document.createElement("div");
      content.className = "e4a-decision-poll__question-content";
      content.append(this.renderSlideHeader(slide.title, slide.prompt));
      if (slide.details && slide.details.length > 0) {
        content.append(this.renderDetails(slide.details));
      }
      content.append(this.renderOptions(slide.options));
      this.appendQuestionLayout(content, slide.questionImage, `${slide.title}: ${slide.prompt}`);
    }
    renderVoteRadioSubmitSlide(slide) {
      if (!this.elements) {
        return;
      }
      this.elements.slide.className = "e4a-decision-poll__slide e4a-decision-poll__slide--question";
      const content = document.createElement("div");
      content.className = "e4a-decision-poll__question-content";
      content.append(this.renderSlideHeader(slide.title, slide.prompt));
      const form = document.createElement("form");
      form.className = "e4a-decision-poll__radio-form";
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        this.goNext();
      });
      slide.options.forEach((option, index) => {
        const id = `e4a-decision-poll-default-${index}`;
        const label = document.createElement("label");
        label.className = "e4a-decision-poll__radio-option";
        label.htmlFor = id;
        const radio = document.createElement("input");
        radio.id = id;
        radio.type = "radio";
        radio.name = "e4a-decision-poll-default-snack";
        radio.value = option;
        radio.checked = index === slide.selectedIndex;
        const text = document.createElement("span");
        text.textContent = option;
        label.append(radio, text);
        form.append(label);
      });
      content.append(form);
      this.appendQuestionLayout(content, slide.questionImage, `${slide.title}: ${slide.prompt}`);
    }
    renderVoteMenuCompareSlide(slide) {
      if (!this.elements) {
        return;
      }
      this.elements.slide.className = "e4a-decision-poll__slide e4a-decision-poll__slide--question e4a-decision-poll__slide--question-menu";
      const topLine = document.createElement("div");
      topLine.className = "e4a-decision-poll__question-topline";
      if (slide.questionImage) {
        topLine.append(this.renderQuestionImage(slide.questionImage, `${slide.title}: ${slide.prompt}`));
      }
      topLine.append(this.renderSlideHeader(slide.title, slide.prompt));
      this.elements.slide.append(topLine);
      this.elements.slide.append(this.renderMenuTable(slide.menus));
      this.elements.slide.append(this.renderOptions(slide.options));
    }
    renderVoteScaleSlide(slide) {
      if (!this.elements) {
        return;
      }
      this.elements.slide.className = "e4a-decision-poll__slide e4a-decision-poll__slide--question e4a-decision-poll__slide--scale";
      const content = document.createElement("div");
      content.className = "e4a-decision-poll__question-content";
      content.append(this.renderSlideHeader(slide.title, slide.prompt));
      content.append(this.renderScale(slide.scale));
      this.appendQuestionLayout(content, slide.questionImage, `${slide.title}: ${slide.prompt}`);
    }
    renderSurpriseSlide(slide) {
      if (!this.elements) {
        return;
      }
      this.elements.slide.className = "e4a-decision-poll__slide e4a-decision-poll__slide--surprise";
      const text = document.createElement("div");
      text.className = "e4a-decision-poll__surprise-text";
      text.append(this.renderSlideHeader(slide.title, slide.revealTitle));
      const reveal = document.createElement("p");
      reveal.className = "e4a-decision-poll__reveal-copy";
      reveal.textContent = slide.revealText;
      const idea = document.createElement("p");
      idea.className = "e4a-decision-poll__idea";
      idea.textContent = `Big idea: ${slide.bigIdea}`;
      const simple = document.createElement("p");
      simple.className = "e4a-decision-poll__simple";
      simple.textContent = `Simple English: ${slide.simpleEnglish}`;
      text.append(reveal, idea, simple);
      const figure = document.createElement("figure");
      figure.className = "e4a-decision-poll__figure";
      figure.append(
        this.renderResponsiveImage(slide.imagePath, slide.imageAlt),
        this.renderImageExpandButton(slide.imagePath, slide.imageAlt, `${slide.revealTitle}: ${slide.bigIdea}`)
      );
      this.elements.slide.append(text, figure);
    }
    renderSummarySlide() {
      if (!this.elements) {
        return;
      }
      this.elements.slide.className = "e4a-decision-poll__slide e4a-decision-poll__slide--summary";
      const title = document.createElement("h4");
      title.className = "e4a-decision-poll__summary-title";
      title.textContent = "What Influenced Our Decisions?";
      const summary = document.createElement("div");
      summary.className = "e4a-decision-poll__summary";
      summary.setAttribute("aria-label", "Decision influences");
      [
        ["Medicine", "different words"],
        ["Backpack", "first number"],
        ["Snack", "selected option"],
        ["Ice cream", "too many choices"],
        ["Pen", "ownership"],
        ["Money", "fear of losing"],
        ["Classmates", "other people"]
      ].forEach(([topic, influence]) => {
        const item = document.createElement("p");
        const strong = document.createElement("strong");
        strong.textContent = `${topic}: `;
        item.append(strong, influence);
        summary.append(item);
      });
      this.elements.slide.append(title, summary);
    }
    renderTransitionSlide(slide) {
      if (!this.elements) {
        return;
      }
      this.elements.slide.className = "e4a-decision-poll__slide e4a-decision-poll__slide--transition";
      const text = document.createElement("p");
      text.className = "e4a-decision-poll__transition-text";
      text.textContent = slide.text;
      this.elements.slide.append(text);
    }
    renderSlideHeader(title, heading) {
      const header = document.createElement("div");
      header.className = "e4a-decision-poll__slide-header";
      const eyebrow = document.createElement("p");
      eyebrow.className = "e4a-decision-poll__slide-eyebrow";
      eyebrow.textContent = title;
      const prompt = document.createElement("p");
      prompt.className = "e4a-decision-poll__question";
      prompt.textContent = heading;
      header.append(eyebrow, prompt);
      return header;
    }
    renderDetails(details) {
      const container = document.createElement("div");
      container.className = "e4a-decision-poll__details";
      for (const detail of details) {
        const paragraph = document.createElement("p");
        paragraph.textContent = detail;
        container.append(paragraph);
      }
      return container;
    }
    appendQuestionLayout(content, questionImage, imageCaption) {
      if (!this.elements) {
        return;
      }
      if (!questionImage) {
        this.elements.slide.append(content);
        return;
      }
      const layout = document.createElement("div");
      layout.className = "e4a-decision-poll__question-layout";
      layout.append(this.renderQuestionImage(questionImage, imageCaption), content);
      this.elements.slide.append(layout);
    }
    renderQuestionImage(questionImage, fallbackCaption) {
      const figure = document.createElement("figure");
      figure.className = "e4a-decision-poll__question-figure";
      figure.append(
        this.renderResponsiveImage(questionImage.imagePath, questionImage.imageAlt),
        this.renderImageExpandButton(
          questionImage.imagePath,
          questionImage.imageAlt,
          questionImage.imageCaption ?? fallbackCaption ?? questionImage.imageAlt
        )
      );
      return figure;
    }
    renderResponsiveImage(imagePath, imageAlt) {
      const picture = document.createElement("picture");
      const source = document.createElement("source");
      source.srcset = imagePath.replace(/\.png$/i, ".webp");
      source.type = "image/webp";
      const image = document.createElement("img");
      image.src = imagePath;
      image.alt = imageAlt;
      image.decoding = "async";
      picture.append(source, image);
      return picture;
    }
    renderImageExpandButton(imagePath, imageAlt, imageCaption) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-outline-primary btn-sm e4a-image-expand__trigger";
      button.textContent = "Expand image";
      button.dataset.e4aImageExpand = "";
      button.dataset.e4aImageExpandSrc = imagePath;
      button.dataset.e4aImageExpandWebpSrc = imagePath.replace(/\.png$/i, ".webp");
      button.dataset.e4aImageExpandAlt = imageAlt;
      button.dataset.e4aImageExpandCaption = imageCaption;
      button.setAttribute("aria-label", `Expand image: ${imageCaption}`);
      return button;
    }
    renderOptions(options) {
      const container = document.createElement("div");
      container.className = "e4a-decision-poll__options";
      container.setAttribute("role", "group");
      container.setAttribute("aria-label", "Poll choices");
      options.forEach((option, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "e4a-decision-poll__option";
        button.setAttribute("aria-pressed", "false");
        const letter = document.createElement("span");
        letter.className = "e4a-decision-poll__option-letter";
        letter.textContent = LETTERS[index] ?? "";
        const text = document.createElement("span");
        text.className = "e4a-decision-poll__option-text";
        text.textContent = option;
        button.append(letter, text);
        button.addEventListener("click", () => this.toggleOption(button));
        container.append(button);
      });
      return container;
    }
    renderScale(scale) {
      const container = document.createElement("div");
      container.className = "e4a-decision-poll__scale";
      container.setAttribute("role", "group");
      container.setAttribute("aria-label", "Feeling strength scale");
      for (const option of scale) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "e4a-decision-poll__scale-option";
        button.setAttribute("aria-pressed", "false");
        const value = document.createElement("span");
        value.className = "e4a-decision-poll__scale-value";
        value.textContent = String(option.value);
        const label = document.createElement("span");
        label.className = "e4a-decision-poll__scale-label";
        label.textContent = option.label;
        button.append(value, label);
        button.addEventListener("click", () => this.toggleOption(button));
        container.append(button);
      }
      return container;
    }
    renderMenuTable(menus) {
      const table = document.createElement("div");
      table.className = "e4a-decision-poll__menu-table";
      table.setAttribute("role", "group");
      table.setAttribute("aria-label", "Menu comparison");
      menus.forEach((menu) => {
        const card = document.createElement("section");
        card.className = "e4a-decision-poll__menu-card";
        const title = document.createElement("h5");
        title.className = "e4a-decision-poll__menu-title";
        title.textContent = menu.title;
        const list = document.createElement("ul");
        list.className = "e4a-decision-poll__menu-list";
        if (menu.items.length > 6) {
          list.classList.add("e4a-decision-poll__menu-list--compact");
        }
        menu.items.forEach((item) => {
          const listItem = document.createElement("li");
          listItem.textContent = item;
          list.append(listItem);
        });
        card.append(title, list);
        table.append(card);
      });
      return table;
    }
    toggleOption(selectedButton) {
      const group = selectedButton.parentElement;
      if (!group) {
        return;
      }
      const buttons = Array.from(group.querySelectorAll(".e4a-decision-poll__option"));
      for (const button of buttons) {
        const isSelected = button === selectedButton;
        button.setAttribute("aria-pressed", isSelected ? "true" : "false");
        button.dataset.e4aDecisionPollSelected = isSelected ? "true" : "";
      }
    }
    goPrevious() {
      if (!this.elements || this.currentSlideIndex <= INTRO_SLIDE_COUNT) {
        return;
      }
      this.currentSlideIndex -= 1;
      this.renderSlide();
    }
    goNext() {
      if (!this.elements || this.currentSlideIndex >= decisionSlides.length - 1) {
        return;
      }
      this.currentSlideIndex += 1;
      this.renderSlide();
    }
    setControlButtonLabel(button, label) {
      button.textContent = label;
      button.setAttribute("aria-label", label);
      button.title = label;
    }
    enterPresentation() {
      if (!this.elements || this.isPresenting) {
        return;
      }
      this.isPresenting = true;
      this.root.dataset.e4aPresentationMode = "true";
      this.root.setAttribute("role", "dialog");
      this.root.setAttribute("aria-label", "Decision Poll presentation");
      document.body.classList.add("e4a-decision-poll-presenting");
      document.addEventListener("keydown", this.handlePresentationKeydown);
      document.addEventListener("fullscreenchange", this.handleFullscreenChange);
      this.elements.presentButton.hidden = true;
      this.elements.exitButton.hidden = false;
      focusWithoutScrolling(this.elements.exitButton);
      if (typeof this.root.requestFullscreen === "function") {
        void this.root.requestFullscreen().catch(() => void 0);
      }
    }
    exitPresentation(skipFullscreenExit = false) {
      if (!this.elements || !this.isPresenting) {
        return;
      }
      this.isPresenting = false;
      delete this.root.dataset.e4aPresentationMode;
      this.root.removeAttribute("role");
      this.root.removeAttribute("aria-label");
      document.body.classList.remove("e4a-decision-poll-presenting");
      document.removeEventListener("keydown", this.handlePresentationKeydown);
      document.removeEventListener("fullscreenchange", this.handleFullscreenChange);
      this.elements.presentButton.hidden = false;
      this.elements.exitButton.hidden = true;
      focusWithoutScrolling(this.elements.presentButton);
      if (!skipFullscreenExit && document.fullscreenElement !== null && typeof document.exitFullscreen === "function") {
        void document.exitFullscreen().catch(() => void 0);
      }
    }
  };
  function focusWithoutScrolling(element) {
    try {
      element.focus({ preventScroll: true });
    } catch {
      element.focus();
    }
  }

  // assets/ts/e4a-first-checked-answer.ts
  var firstCheckedQuestions = [
    {
      title: "Bat and ball",
      question: "A bat and a ball cost $1.10 total. The bat costs $1 more than the ball. How much does the ball cost?",
      answerHint: "Use cents",
      correctAnswer: "5 cents",
      acceptedAnswers: ["5 cents", "5 cent", "5c", "$0.05", "0.05", ".05", "five cents", "five cent", "5"],
      explanation: "If the ball is 5 cents, the bat is $1.05. Together, they cost $1.10."
    },
    {
      title: "Five machines",
      question: "Five machines make five T-shirts in five minutes. How long do 100 machines take to make 100 T-shirts?",
      answerHint: "Use minutes",
      correctAnswer: "5 minutes",
      acceptedAnswers: ["5 minutes", "5 minute", "5 min", "5 mins", "five minutes", "five minute", "five min", "5"],
      explanation: "Each machine makes one T-shirt in five minutes. So 100 machines make 100 T-shirts in five minutes."
    },
    {
      title: "Three pills",
      question: "A doctor gives you three pills. You must take one pill every 30 minutes. How long will it take to finish all three pills?",
      answerHint: "Use minutes",
      correctAnswer: "60 minutes",
      acceptedAnswers: [
        "60 minutes",
        "60 minute",
        "60 min",
        "60 mins",
        "sixty minutes",
        "sixty minute",
        "1 hour",
        "one hour",
        "an hour",
        "60"
      ],
      explanation: "You take the first pill now, the second after 30 minutes, and the third after 60 minutes."
    },
    {
      title: "Running race",
      question: "You are running a race. You pass the person in second place. What place are you in now?",
      answerHint: "Use a place or position number",
      correctAnswer: "Second place",
      acceptedAnswers: ["second place", "second", "2nd place", "2nd", "2"],
      explanation: "If you pass the person in second place, you take second place."
    },
    {
      title: "Maria's father",
      question: "Maria's father has five daughters: Nana, Nene, Nini, Nono, and ______. What is the fifth daughter's name?",
      answerHint: "Write a name",
      correctAnswer: "Maria",
      acceptedAnswers: ["maria"],
      explanation: `The question says "Maria's father," so Maria is one of the daughters.`
    },
    {
      title: "Months with 28 days",
      question: "How many months have at least 28 days?",
      answerHint: "Use months",
      correctAnswer: "12 months",
      acceptedAnswers: ["12 months", "12 month", "twelve months", "twelve month", "all months", "every month", "all 12 months", "12"],
      explanation: "Every month has at least 28 days."
    }
  ];
  function initializeFirstCheckedAnswerActivities(root = document) {
    const activities = Array.from(root.querySelectorAll("[data-e4a-first-checked-answer]"));
    for (const activity of activities) {
      new FirstCheckedAnswerActivity(activity).initialize();
    }
  }
  var FirstCheckedAnswerActivity = class {
    constructor(root) {
      this.root = root;
      this.currentQuestionIndex = 0;
      this.checkedCorrectCount = 0;
      this.completedCount = 0;
    }
    initialize() {
      this.root.innerHTML = this.renderShell();
      const elements = this.queryElements();
      if (!elements) {
        return;
      }
      this.elements = elements;
      elements.startButton.addEventListener("click", () => this.start());
      elements.checkButton.addEventListener("click", () => this.checkAnswer());
      elements.nextButton.addEventListener("click", () => this.goNext());
      elements.restartButton.addEventListener("click", () => this.restart());
      elements.firstAnswerInput.addEventListener("input", () => this.updateCheckButton());
      elements.checkedAnswerInput.addEventListener("input", () => this.updateCheckButton());
      this.showIntro();
    }
    renderShell() {
      return `
      <div class="e4a-first-checked__inner">
        <div class="e4a-first-checked__intro" data-e4a-first-checked-intro>
          <p class="e4a-first-checked__eyebrow">Warm-up activity</p>
          <h3 class="e4a-first-checked__title">First Answer vs. Checked Answer</h3>
          <p class="e4a-first-checked__copy">Your brain wants to answer fast. First, write your quick answer. Then stop, read again, and write your checked answer.</p>
          <button type="button" class="btn btn-primary e4a-first-checked__start" data-e4a-first-checked-start>Start Activity</button>
        </div>

        <div class="e4a-first-checked__activity" data-e4a-first-checked-activity hidden>
          <div class="e4a-first-checked__progress-row">
            <p class="e4a-first-checked__progress-text" data-e4a-first-checked-progress-text></p>
            <div class="e4a-first-checked__progress-track" aria-hidden="true">
              <div class="e4a-first-checked__progress-bar" data-e4a-first-checked-progress-bar></div>
            </div>
          </div>

          <div class="e4a-first-checked__question-panel">
            <p class="e4a-first-checked__question-title" data-e4a-first-checked-question-title></p>
            <p class="e4a-first-checked__question" data-e4a-first-checked-question tabindex="-1"></p>
          </div>

          <div class="e4a-first-checked__answers">
            <div class="e4a-first-checked__field">
              <label for="e4a-first-checked-first-answer">My first answer</label>
              <input id="e4a-first-checked-first-answer" type="text" autocomplete="off" data-e4a-first-checked-first-answer>
            </div>
            <div class="e4a-first-checked__field">
              <label for="e4a-first-checked-checked-answer">My checked answer</label>
              <input id="e4a-first-checked-checked-answer" type="text" autocomplete="off" data-e4a-first-checked-checked-answer>
            </div>
          </div>

          <div class="e4a-first-checked__feedback" data-e4a-first-checked-feedback hidden aria-live="polite">
            <p class="e4a-first-checked__feedback-status" data-e4a-first-checked-feedback-status></p>
            <p class="e4a-first-checked__correct-answer" data-e4a-first-checked-correct-answer></p>
            <p class="e4a-first-checked__explanation" data-e4a-first-checked-explanation></p>
          </div>

          <div class="e4a-first-checked__actions">
            <button type="button" class="btn btn-primary e4a-first-checked__check" data-e4a-first-checked-check disabled>Check Answer</button>
            <button type="button" class="btn btn-primary e4a-first-checked__next" data-e4a-first-checked-next hidden>Next Question</button>
          </div>
        </div>

        <div class="e4a-first-checked__final" data-e4a-first-checked-final hidden>
          <p class="e4a-first-checked__summary" data-e4a-first-checked-completed></p>
          <p class="e4a-first-checked__score" data-e4a-first-checked-score></p>
          <p class="e4a-first-checked__final-message">A fast answer can feel correct, but a checked answer is often better.</p>
          <button type="button" class="btn btn-primary e4a-first-checked__restart" data-e4a-first-checked-restart>Restart activity</button>
        </div>
      </div>
    `;
    }
    queryElements() {
      const introView = this.root.querySelector("[data-e4a-first-checked-intro]");
      const activityView = this.root.querySelector("[data-e4a-first-checked-activity]");
      const finalView = this.root.querySelector("[data-e4a-first-checked-final]");
      const startButton = this.root.querySelector("[data-e4a-first-checked-start]");
      const progressText = this.root.querySelector("[data-e4a-first-checked-progress-text]");
      const progressBar = this.root.querySelector("[data-e4a-first-checked-progress-bar]");
      const questionTitle = this.root.querySelector("[data-e4a-first-checked-question-title]");
      const questionText = this.root.querySelector("[data-e4a-first-checked-question]");
      const firstAnswerInput = this.root.querySelector("[data-e4a-first-checked-first-answer]");
      const checkedAnswerInput = this.root.querySelector("[data-e4a-first-checked-checked-answer]");
      const checkButton = this.root.querySelector("[data-e4a-first-checked-check]");
      const nextButton = this.root.querySelector("[data-e4a-first-checked-next]");
      const feedback = this.root.querySelector("[data-e4a-first-checked-feedback]");
      const feedbackStatus = this.root.querySelector("[data-e4a-first-checked-feedback-status]");
      const correctAnswerText = this.root.querySelector("[data-e4a-first-checked-correct-answer]");
      const explanationText = this.root.querySelector("[data-e4a-first-checked-explanation]");
      const completedText = this.root.querySelector("[data-e4a-first-checked-completed]");
      const scoreText = this.root.querySelector("[data-e4a-first-checked-score]");
      const restartButton = this.root.querySelector("[data-e4a-first-checked-restart]");
      if (!introView || !activityView || !finalView || !startButton || !progressText || !progressBar || !questionTitle || !questionText || !firstAnswerInput || !checkedAnswerInput || !checkButton || !nextButton || !feedback || !feedbackStatus || !correctAnswerText || !explanationText || !completedText || !scoreText || !restartButton) {
        return void 0;
      }
      return {
        introView,
        activityView,
        finalView,
        startButton,
        progressText,
        progressBar,
        questionTitle,
        questionText,
        firstAnswerInput,
        checkedAnswerInput,
        checkButton,
        nextButton,
        feedback,
        feedbackStatus,
        correctAnswerText,
        explanationText,
        completedText,
        scoreText,
        restartButton
      };
    }
    showIntro() {
      if (!this.elements) {
        return;
      }
      this.elements.introView.hidden = false;
      this.elements.activityView.hidden = true;
      this.elements.finalView.hidden = true;
    }
    start() {
      this.currentQuestionIndex = 0;
      this.checkedCorrectCount = 0;
      this.completedCount = 0;
      this.renderQuestion();
    }
    renderQuestion() {
      if (!this.elements) {
        return;
      }
      const question = firstCheckedQuestions[this.currentQuestionIndex];
      this.elements.introView.hidden = true;
      this.elements.activityView.hidden = false;
      this.elements.finalView.hidden = true;
      this.elements.progressText.textContent = `Question ${this.currentQuestionIndex + 1} of ${firstCheckedQuestions.length}`;
      this.elements.progressBar.style.width = `${(this.currentQuestionIndex + 1) / firstCheckedQuestions.length * 100}%`;
      this.elements.questionTitle.textContent = question.title;
      this.elements.questionText.textContent = question.question;
      this.elements.firstAnswerInput.value = "";
      this.elements.checkedAnswerInput.value = "";
      this.elements.firstAnswerInput.placeholder = question.answerHint;
      this.elements.checkedAnswerInput.placeholder = question.answerHint;
      this.elements.firstAnswerInput.disabled = false;
      this.elements.checkedAnswerInput.disabled = false;
      this.elements.feedback.hidden = true;
      this.elements.feedback.dataset.e4aFirstCheckedState = "";
      this.elements.feedbackStatus.textContent = "";
      this.elements.correctAnswerText.textContent = "";
      this.elements.explanationText.textContent = "";
      this.elements.checkButton.hidden = false;
      this.elements.nextButton.hidden = true;
      this.elements.nextButton.textContent = this.currentQuestionIndex === firstCheckedQuestions.length - 1 ? "See Summary" : "Next Question";
      this.updateCheckButton();
      focusWithoutScrolling2(this.elements.questionText);
    }
    updateCheckButton() {
      if (!this.elements) {
        return;
      }
      const hasFirstAnswer = this.elements.firstAnswerInput.value.trim().length > 0;
      const hasCheckedAnswer = this.elements.checkedAnswerInput.value.trim().length > 0;
      this.elements.checkButton.disabled = !hasFirstAnswer || !hasCheckedAnswer;
    }
    checkAnswer() {
      if (!this.elements || this.elements.checkButton.disabled) {
        return;
      }
      const question = firstCheckedQuestions[this.currentQuestionIndex];
      const isCorrect = isAcceptedAnswer(this.elements.checkedAnswerInput.value, question);
      this.completedCount += 1;
      if (isCorrect) {
        this.checkedCorrectCount += 1;
      }
      this.elements.firstAnswerInput.disabled = true;
      this.elements.checkedAnswerInput.disabled = true;
      this.elements.feedback.hidden = false;
      this.elements.feedback.dataset.e4aFirstCheckedState = isCorrect ? "correct" : "incorrect";
      this.elements.feedbackStatus.textContent = isCorrect ? "Your checked answer is correct." : "Not quite. Check the explanation.";
      this.elements.correctAnswerText.textContent = `Correct answer: ${question.correctAnswer}`;
      this.elements.explanationText.textContent = question.explanation;
      this.elements.checkButton.hidden = true;
      this.elements.nextButton.hidden = false;
      focusWithoutScrolling2(this.elements.nextButton);
    }
    goNext() {
      if (!this.elements) {
        return;
      }
      if (this.currentQuestionIndex >= firstCheckedQuestions.length - 1) {
        this.showFinal();
        return;
      }
      this.currentQuestionIndex += 1;
      this.renderQuestion();
    }
    showFinal() {
      if (!this.elements) {
        return;
      }
      this.elements.introView.hidden = true;
      this.elements.activityView.hidden = true;
      this.elements.finalView.hidden = false;
      this.elements.completedText.textContent = `Questions completed: ${this.completedCount} of ${firstCheckedQuestions.length}`;
      this.elements.scoreText.textContent = `Checked answers correct: ${this.checkedCorrectCount} of ${firstCheckedQuestions.length}`;
      focusWithoutScrolling2(this.elements.restartButton);
    }
    restart() {
      this.currentQuestionIndex = 0;
      this.checkedCorrectCount = 0;
      this.completedCount = 0;
      this.showIntro();
      focusWithoutScrolling2(this.elements?.startButton);
    }
  };
  function isAcceptedAnswer(answer, question) {
    const normalizedAnswer = normalizeAnswer(answer);
    return question.acceptedAnswers.some((acceptedAnswer) => normalizeAnswer(acceptedAnswer) === normalizedAnswer);
  }
  function normalizeAnswer(answer) {
    return answer.trim().toLowerCase().replace(/\$/g, "").replace(/\bmins?\b/g, "minutes").replace(/\bmin\b/g, "minutes").replace(/\bhrs?\b/g, "hours").replace(/\bhr\b/g, "hour").replace(/[^a-z0-9.]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function focusWithoutScrolling2(element) {
    if (!element) {
      return;
    }
    try {
      element.focus({ preventScroll: true });
    } catch {
      element.focus();
    }
  }

  // assets/ts/e4a-small-change-activity.ts
  var smallChangeQuestions = [
    {
      question: "Which sentence means the person likes dogs as animals?",
      options: ["I like dogs.", "I like dog."],
      correctAnswerIndex: 0,
      imagePath: "assets/images/lesson-02/01-dogs.png",
      webpPath: "assets/images/lesson-02/01-dogs.webp",
      imageAlt: "A split-screen image showing liking dogs as animals versus a funny food misunderstanding.",
      correctFeedback: 'Correct. "Dogs" means dogs in general.',
      wrongFeedback: 'Not quite. "Dog" can sound like a type of food or meat.'
    },
    {
      question: "Which sentence means Grandma is invited to eat?",
      options: ["Let's eat, Grandma.", "Let's eat Grandma."],
      correctAnswerIndex: 0,
      imagePath: "assets/images/lesson-02/02-grandma.png",
      webpPath: "assets/images/lesson-02/02-grandma.webp",
      imageAlt: "A split-screen image showing Grandma joining dinner versus a silly comma misunderstanding.",
      correctFeedback: "Correct. The comma shows Grandma is the person you are speaking to.",
      wrongFeedback: "Not quite. Without the comma, it sounds like Grandma is the food."
    },
    {
      question: "Which sentence means the person has some friends?",
      options: ["I have a few friends.", "I have few friends."],
      correctAnswerIndex: 0,
      imagePath: "assets/images/lesson-02/03-friends.png",
      webpPath: "assets/images/lesson-02/03-friends.webp",
      imageAlt: "A split-screen image showing a person with several friends versus a person almost alone.",
      correctFeedback: 'Correct. "A few" means some.',
      wrongFeedback: 'Not quite. "Few" means almost none.'
    },
    {
      question: 'In the sentence "I saw her duck," which meaning is an action?',
      options: ["I saw the woman move down quickly.", "I saw the duck that belongs to her."],
      correctAnswerIndex: 0,
      imagePath: "assets/images/lesson-02/04-duck.png",
      webpPath: "assets/images/lesson-02/04-duck.webp",
      imageAlt: "A split-screen image showing duck as an action and duck as an animal.",
      correctFeedback: 'Correct. "Duck" can be a verb meaning move down quickly.',
      wrongFeedback: 'Not quite. That meaning uses "duck" as a noun: the animal.'
    },
    {
      question: 'Which sentence means "She is quite smart"?',
      options: ["She is pretty smart.", "She is pretty, smart."],
      correctAnswerIndex: 0,
      imagePath: "assets/images/lesson-02/05-pretty-smart.png",
      webpPath: "assets/images/lesson-02/05-pretty-smart.webp",
      imageAlt: "A split-screen image showing quite smart versus beautiful and smart.",
      correctFeedback: 'Correct. "Pretty smart" means quite smart.',
      wrongFeedback: 'Not quite. With a comma, "pretty" means beautiful.'
    },
    {
      question: "Which prompt gives the AI clearer instructions?",
      options: ["Write about New York.", "Write a 5-sentence paragraph about New York for beginner English students."],
      correctAnswerIndex: 1,
      imagePath: "assets/images/lesson-02/06-clear-prompt.png",
      webpPath: "assets/images/lesson-02/06-clear-prompt.webp",
      imageAlt: "A split-screen image showing a vague AI prompt versus a clear AI prompt.",
      correctFeedback: "Correct. The second prompt gives length, topic, and student level.",
      wrongFeedback: "Not quite. The first prompt is very general."
    },
    {
      question: "Which prompt gives the AI a clear safety limit?",
      options: [
        "Analyze this document and improve it.",
        "Analyze this document in read-only mode. Do not edit, rewrite, delete, or change the original file. Only give comments and recommendations."
      ],
      correctAnswerIndex: 1,
      imagePath: "assets/images/lesson-02/07-read-only-limits.png",
      webpPath: "assets/images/lesson-02/07-read-only-limits.webp",
      imageAlt: "A split-screen image showing an AI editing and damaging a document versus analyzing it safely in read-only mode.",
      correctFeedback: "Correct. The second prompt gives a clear limit: the AI can analyze, but it cannot change the document.",
      wrongFeedback: 'Not quite. The first prompt does not say "read-only," so the AI may start editing the document instead of only analyzing it.'
    },
    {
      question: "Which prompt asks for a clear format?",
      options: ["Explain commas.", "Explain commas in a table with 3 columns: sentence, meaning, and warning."],
      correctAnswerIndex: 1,
      imagePath: "assets/images/lesson-02/08-format.png.png",
      webpPath: "assets/images/lesson-02/08-format.png.webp",
      imageAlt: "A split-screen image showing a messy AI answer versus a clear table-style answer.",
      correctFeedback: "Correct. The second prompt tells the AI the exact format to use.",
      wrongFeedback: "Not quite. The first prompt does not say how the answer should look."
    }
  ];
  function initializeSmallChangeActivities(root = document) {
    const activities = Array.from(root.querySelectorAll("[data-e4a-small-change]"));
    for (const activity of activities) {
      new SmallChangeActivity(activity).initialize();
    }
  }
  var SmallChangeActivity = class {
    constructor(root) {
      this.root = root;
      this.currentQuestionIndex = 0;
      this.score = 0;
      this.answered = false;
      this.isPresenting = false;
      this.firstAttemptResults = Array(smallChangeQuestions.length).fill(void 0);
      this.handlePresentationKeydown = (event) => {
        if (event.key === "Escape" && this.isPresenting) {
          this.exitPresentation();
        }
      };
      this.handleFullscreenChange = () => {
        if (this.isPresenting && document.fullscreenElement === null) {
          this.exitPresentation(true);
        }
      };
    }
    initialize() {
      this.root.innerHTML = this.renderShell();
      const elements = this.queryElements();
      if (!elements) {
        return;
      }
      this.elements = elements;
      elements.optionButtons.forEach((button, index) => {
        button.addEventListener("click", () => this.answer(index));
      });
      elements.presentButton.addEventListener("click", () => this.enterPresentation());
      elements.exitButton.addEventListener("click", () => this.exitPresentation());
      elements.previousButton.addEventListener("click", () => this.goPrevious());
      elements.retryButton.addEventListener("click", () => this.retryCurrentQuestion());
      elements.nextButton.addEventListener("click", () => this.goNext());
      elements.restartButton.addEventListener("click", () => this.restart());
      this.renderQuestion();
    }
    renderShell() {
      return `
      <div class="e4a-small-change__inner">
        <div class="e4a-small-change__header">
          <div class="e4a-small-change__intro">
            <p class="e4a-small-change__eyebrow">Warm-up activity</p>
            <h3 class="e4a-small-change__title">Small Change, Big Meaning</h3>
            <p class="e4a-small-change__copy">A small change in your English can make a big change in the AI answer. Choose the better meaning or better prompt. After you answer, you will see an image explanation.</p>
          </div>
          <div class="e4a-small-change__present-controls">
            <button type="button" class="e4a-small-change__present btn btn-outline-primary" data-e4a-small-change-present>Present</button>
            <button type="button" class="e4a-small-change__exit btn btn-outline-secondary" data-e4a-small-change-exit hidden>Exit</button>
          </div>
        </div>
        <div class="e4a-small-change__quiz" data-e4a-small-change-quiz>
          <div class="e4a-small-change__progress-row">
            <p class="e4a-small-change__progress-text" data-e4a-small-change-progress-text></p>
            <div class="e4a-small-change__progress-track" aria-hidden="true">
              <div class="e4a-small-change__progress-bar" data-e4a-small-change-progress-bar></div>
            </div>
          </div>
          <div class="e4a-small-change__question-panel">
            <p class="e4a-small-change__question" data-e4a-small-change-question tabindex="-1"></p>
            <div class="e4a-small-change__options" role="group" aria-label="Answer choices">
              <button type="button" class="e4a-small-change__option" data-e4a-small-change-option="0">
                <span class="e4a-small-change__option-letter">A</span>
                <span class="e4a-small-change__option-text"></span>
              </button>
              <button type="button" class="e4a-small-change__option" data-e4a-small-change-option="1">
                <span class="e4a-small-change__option-letter">B</span>
                <span class="e4a-small-change__option-text"></span>
              </button>
            </div>
          </div>
          <div class="e4a-small-change__result" data-e4a-small-change-feedback hidden aria-live="polite">
            <p class="e4a-small-change__feedback-heading" data-e4a-small-change-feedback-status></p>
            <p class="e4a-small-change__feedback-text" data-e4a-small-change-feedback-text></p>
          </div>
          <figure class="e4a-small-change__figure" data-e4a-small-change-figure hidden>
            <picture>
              <source data-e4a-small-change-source type="image/webp">
              <img data-e4a-small-change-image alt="">
            </picture>
          </figure>
          <div class="e4a-small-change__actions">
            <button type="button" class="e4a-small-change__previous btn btn-outline-secondary" data-e4a-small-change-previous hidden>Previous question</button>
            <button type="button" class="e4a-small-change__retry btn btn-outline-secondary" data-e4a-small-change-retry hidden>Retry</button>
            <button type="button" class="e4a-small-change__next btn btn-primary" data-e4a-small-change-next hidden>Next question</button>
          </div>
        </div>
        <div class="e4a-small-change__final" data-e4a-small-change-final hidden>
          <p class="e4a-small-change__score" data-e4a-small-change-score></p>
          <p class="e4a-small-change__final-message">Great work. Small English changes can create big meaning changes. Clear prompts need context, limits, format, and safe boundaries.</p>
          <button type="button" class="e4a-small-change__restart btn btn-primary" data-e4a-small-change-restart>Restart activity</button>
        </div>
      </div>
    `;
    }
    queryElements() {
      const progressText = this.root.querySelector("[data-e4a-small-change-progress-text]");
      const progressBar = this.root.querySelector("[data-e4a-small-change-progress-bar]");
      const questionPanel = this.root.querySelector(".e4a-small-change__question-panel");
      const questionText = this.root.querySelector("[data-e4a-small-change-question]");
      const optionButtons = Array.from(this.root.querySelectorAll("[data-e4a-small-change-option]"));
      const feedback = this.root.querySelector("[data-e4a-small-change-feedback]");
      const feedbackStatus = this.root.querySelector("[data-e4a-small-change-feedback-status]");
      const feedbackText = this.root.querySelector("[data-e4a-small-change-feedback-text]");
      const figure = this.root.querySelector("[data-e4a-small-change-figure]");
      const imageSource = this.root.querySelector("[data-e4a-small-change-source]");
      const image = this.root.querySelector("[data-e4a-small-change-image]");
      const previousButton = this.root.querySelector("[data-e4a-small-change-previous]");
      const retryButton = this.root.querySelector("[data-e4a-small-change-retry]");
      const nextButton = this.root.querySelector("[data-e4a-small-change-next]");
      const quizView = this.root.querySelector("[data-e4a-small-change-quiz]");
      const finalView = this.root.querySelector("[data-e4a-small-change-final]");
      const scoreText = this.root.querySelector("[data-e4a-small-change-score]");
      const presentButton = this.root.querySelector("[data-e4a-small-change-present]");
      const exitButton = this.root.querySelector("[data-e4a-small-change-exit]");
      const restartButton = this.root.querySelector("[data-e4a-small-change-restart]");
      if (!progressText || !progressBar || !questionPanel || !questionText || optionButtons.length !== 2 || !feedback || !feedbackStatus || !feedbackText || !figure || !imageSource || !image || !previousButton || !retryButton || !nextButton || !quizView || !finalView || !scoreText || !presentButton || !exitButton || !restartButton) {
        return void 0;
      }
      return {
        progressText,
        progressBar,
        questionPanel,
        questionText,
        optionButtons,
        feedback,
        feedbackStatus,
        feedbackText,
        figure,
        imageSource,
        image,
        previousButton,
        retryButton,
        nextButton,
        quizView,
        finalView,
        scoreText,
        presentButton,
        exitButton,
        restartButton
      };
    }
    renderQuestion() {
      if (!this.elements) {
        return;
      }
      const question = smallChangeQuestions[this.currentQuestionIndex];
      this.answered = false;
      this.elements.quizView.hidden = false;
      this.elements.finalView.hidden = true;
      this.elements.progressText.textContent = `Question ${this.currentQuestionIndex + 1} of ${smallChangeQuestions.length}`;
      this.elements.progressBar.style.width = `${(this.currentQuestionIndex + 1) / smallChangeQuestions.length * 100}%`;
      this.elements.questionText.textContent = question.question;
      this.elements.previousButton.hidden = this.currentQuestionIndex === 0;
      this.setControlButtonLabel(this.elements.previousButton, "Previous question");
      this.setControlButtonLabel(this.elements.retryButton, "Retry");
      this.setControlButtonLabel(
        this.elements.nextButton,
        this.currentQuestionIndex === smallChangeQuestions.length - 1 ? "See score" : "Next question"
      );
      this.elements.nextButton.dataset.e4aSmallChangeAction = this.currentQuestionIndex === smallChangeQuestions.length - 1 ? "score" : "next";
      this.elements.optionButtons.forEach((button, index) => {
        const text = button.querySelector(".e4a-small-change__option-text");
        if (text) {
          text.textContent = question.options[index];
        }
      });
      this.resetAnswerState();
    }
    answer(selectedIndex) {
      if (!this.elements || this.answered) {
        return;
      }
      const question = smallChangeQuestions[this.currentQuestionIndex];
      const isCorrect = selectedIndex === question.correctAnswerIndex;
      const isFirstAttempt = this.firstAttemptResults[this.currentQuestionIndex] === void 0;
      this.answered = true;
      if (isFirstAttempt) {
        this.firstAttemptResults[this.currentQuestionIndex] = isCorrect;
      }
      if (isFirstAttempt && isCorrect) {
        this.score += 1;
      }
      this.elements.optionButtons.forEach((button, index) => {
        button.disabled = true;
        button.setAttribute("aria-pressed", index === selectedIndex ? "true" : "false");
        if (index === question.correctAnswerIndex) {
          button.dataset.e4aSmallChangeState = "correct";
        } else if (index === selectedIndex) {
          button.dataset.e4aSmallChangeState = "incorrect";
        } else {
          button.dataset.e4aSmallChangeState = "neutral";
        }
      });
      this.elements.feedback.hidden = false;
      this.elements.feedback.dataset.e4aSmallChangeState = isCorrect ? "correct" : "incorrect";
      this.elements.feedbackStatus.textContent = isCorrect ? "Correct" : "Not quite";
      this.elements.feedbackText.textContent = isCorrect ? question.correctFeedback : question.wrongFeedback;
      this.elements.imageSource.srcset = question.webpPath;
      this.elements.image.src = question.imagePath;
      this.elements.image.alt = question.imageAlt;
      this.elements.figure.hidden = false;
      this.elements.retryButton.hidden = false;
      this.elements.nextButton.hidden = false;
      this.elements.progressBar.style.width = `${(this.currentQuestionIndex + 1) / smallChangeQuestions.length * 100}%`;
      focusWithoutScrolling3(this.elements.nextButton);
    }
    retryCurrentQuestion() {
      if (!this.elements || !this.answered) {
        return;
      }
      this.answered = false;
      this.resetAnswerState();
      this.scrollQuestionIntoView();
    }
    goPrevious() {
      if (!this.elements || this.currentQuestionIndex === 0) {
        return;
      }
      this.currentQuestionIndex -= 1;
      this.renderQuestion();
      this.scrollQuestionIntoView();
    }
    goNext() {
      if (!this.elements) {
        return;
      }
      if (this.currentQuestionIndex >= smallChangeQuestions.length - 1) {
        this.showFinal();
        return;
      }
      this.currentQuestionIndex += 1;
      this.renderQuestion();
      this.scrollQuestionIntoView();
    }
    showFinal() {
      if (!this.elements) {
        return;
      }
      this.elements.quizView.hidden = true;
      this.elements.finalView.hidden = false;
      this.elements.scoreText.textContent = `Your first-try score: ${this.score} / ${smallChangeQuestions.length}`;
      focusWithoutScrolling3(this.elements.restartButton);
    }
    restart() {
      this.currentQuestionIndex = 0;
      this.score = 0;
      this.firstAttemptResults = Array(smallChangeQuestions.length).fill(void 0);
      this.renderQuestion();
    }
    resetAnswerState() {
      if (!this.elements) {
        return;
      }
      this.elements.feedback.hidden = true;
      this.elements.feedback.dataset.e4aSmallChangeState = "";
      this.elements.feedbackStatus.textContent = "";
      this.elements.feedbackText.textContent = "";
      this.elements.figure.hidden = true;
      this.elements.imageSource.removeAttribute("srcset");
      this.elements.image.removeAttribute("src");
      this.elements.image.alt = "";
      this.elements.retryButton.hidden = true;
      this.elements.nextButton.hidden = true;
      this.elements.optionButtons.forEach((button) => {
        button.disabled = false;
        button.dataset.e4aSmallChangeState = "";
        button.setAttribute("aria-pressed", "false");
      });
    }
    scrollQuestionIntoView() {
      if (!this.elements) {
        return;
      }
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      this.elements.questionPanel.scrollIntoView({ behavior, block: "start", inline: "nearest" });
      focusWithoutScrolling3(this.elements.questionText);
    }
    setControlButtonLabel(button, label) {
      button.textContent = label;
      button.setAttribute("aria-label", label);
      button.title = label;
    }
    enterPresentation() {
      if (!this.elements || this.isPresenting) {
        return;
      }
      this.isPresenting = true;
      this.root.dataset.e4aPresentationMode = "true";
      this.root.setAttribute("role", "dialog");
      this.root.setAttribute("aria-label", "Small Change, Big Meaning presentation");
      document.body.classList.add("e4a-small-change-presenting");
      document.addEventListener("keydown", this.handlePresentationKeydown);
      document.addEventListener("fullscreenchange", this.handleFullscreenChange);
      this.elements.presentButton.hidden = true;
      this.elements.exitButton.hidden = false;
      focusWithoutScrolling3(this.elements.exitButton);
      if (typeof this.root.requestFullscreen === "function") {
        void this.root.requestFullscreen().catch(() => void 0);
      }
    }
    exitPresentation(skipFullscreenExit = false) {
      if (!this.elements || !this.isPresenting) {
        return;
      }
      this.isPresenting = false;
      delete this.root.dataset.e4aPresentationMode;
      this.root.removeAttribute("role");
      this.root.removeAttribute("aria-label");
      document.body.classList.remove("e4a-small-change-presenting");
      document.removeEventListener("keydown", this.handlePresentationKeydown);
      document.removeEventListener("fullscreenchange", this.handleFullscreenChange);
      this.elements.presentButton.hidden = false;
      this.elements.exitButton.hidden = true;
      focusWithoutScrolling3(this.elements.presentButton);
      if (!skipFullscreenExit && document.fullscreenElement !== null && typeof document.exitFullscreen === "function") {
        void document.exitFullscreen().catch(() => void 0);
      }
    }
  };
  function focusWithoutScrolling3(element) {
    try {
      element.focus({ preventScroll: true });
    } catch {
      element.focus();
    }
  }

  // assets/ts/e4a-prompt-result-compare.ts
  var SHOW_RESULT_LABEL = "Show result";
  var HIDE_RESULT_LABEL = "Hide result";
  function initializePromptResultCompareActivities(root = document) {
    const activities = Array.from(root.querySelectorAll("[data-e4a-prompt-result-compare]"));
    for (const activity of activities) {
      new PromptResultCompareActivity(activity).initialize();
    }
  }
  var PromptResultCompareActivity = class {
    constructor(root) {
      this.root = root;
      this.toggles = [];
    }
    initialize() {
      this.toggles = Array.from(this.root.querySelectorAll("[data-e4a-prompt-result-toggle]")).map((button) => this.toToggle(button)).filter((toggle) => toggle !== void 0);
      if (this.toggles.length === 0) {
        return;
      }
      const showAllButton = this.root.querySelector("[data-e4a-prompt-result-show-all]");
      const hideAllButton = this.root.querySelector("[data-e4a-prompt-result-hide-all]");
      for (const toggle of this.toggles) {
        this.setExpanded(toggle, false);
        toggle.button.addEventListener("click", () => this.setExpanded(toggle, toggle.panel.hidden !== false));
      }
      showAllButton?.addEventListener("click", () => this.setAllExpanded(true));
      hideAllButton?.addEventListener("click", () => this.setAllExpanded(false));
    }
    toToggle(button) {
      const panelId = button.getAttribute("aria-controls")?.trim();
      if (!panelId) {
        return void 0;
      }
      const panel = document.getElementById(panelId);
      if (!panel) {
        return void 0;
      }
      return { button, panel };
    }
    setAllExpanded(expanded) {
      for (const toggle of this.toggles) {
        this.setExpanded(toggle, expanded);
      }
    }
    setExpanded(toggle, expanded) {
      toggle.panel.hidden = !expanded;
      toggle.button.setAttribute("aria-expanded", expanded ? "true" : "false");
      toggle.button.textContent = expanded ? HIDE_RESULT_LABEL : SHOW_RESULT_LABEL;
      toggle.button.title = expanded ? HIDE_RESULT_LABEL : SHOW_RESULT_LABEL;
    }
  };

  // assets/ts/e4a-source-check-warmup.ts
  var INTRO_SLIDE_COUNT2 = 1;
  var sourceCheckItems = [
    {
      statement: "Chocolate can contain caffeine.",
      answer: "Mostly True",
      explanation: "Chocolate can have caffeine. Dark chocolate usually has more.",
      imagePath: "assets/images/lesson-05/01-chocolate-caffeine.png",
      imageAlt: "Chocolate pieces, a warm drink, and a gentle energy cue on a classroom table.",
      sourceLabel: "USDA FoodData Central caffeine data",
      sourceUrl: "https://www.nal.usda.gov/sites/default/files/page-files/caffeine.pdf?utm_source=openai"
    },
    {
      statement: "Sugar makes most children hyperactive.",
      answer: "Mostly False",
      explanation: "Sugar does not usually make children hyperactive. Parties, games, and excitement may be the reason.",
      imagePath: "assets/images/lesson-05/02-sugar-hyperactive.png",
      imageAlt: "Candy, party objects, and game items in a classroom-style illustration.",
      sourceLabel: "JAMA/PubMed sugar behavior meta-analysis",
      sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/7474248/?utm_source=openai"
    },
    {
      statement: "Dogs can see some colors.",
      answer: "Mostly True",
      explanation: "Dogs do not see colors like humans, but they can see some colors.",
      imagePath: "assets/images/lesson-05/03-dogs-colors.png",
      imageAlt: "A friendly dog looks at blue and yellow objects on a classroom table.",
      sourceLabel: "AKC dog color vision explainer",
      sourceUrl: "https://www.akc.org/expert-advice/health/can-dogs-see-color/?utm_source=openai"
    },
    {
      statement: "Bats are blind.",
      answer: "Mostly False",
      explanation: "Bats are not blind. They have eyes and can see.",
      imagePath: "assets/images/lesson-05/04-bats-blind.png",
      imageAlt: "A friendly bat with visible eyes in a gentle classroom nature-study scene.",
      sourceLabel: "Bat Conservation International bat vision explainer",
      sourceUrl: "https://www.batcon.org/blind-as-a-bat-no-such-thing/?utm_source=openai"
    },
    {
      statement: "Washing hands with soap can help stop illness.",
      answer: "Mostly True",
      explanation: "Soap and water help remove germs from your hands.",
      imagePath: "assets/images/lesson-05/05-handwashing-soap.png",
      imageAlt: "Hands, soap bubbles, and abstract germs being washed away at a sink.",
      sourceLabel: "CDC clean hands guidance",
      sourceUrl: "https://www.cdc.gov/clean-hands/about/index.html?utm_source=openai"
    },
    {
      statement: "Antibiotics usually help with a cold.",
      answer: "Mostly False",
      explanation: "Colds are usually caused by viruses. Antibiotics fight bacteria, not viruses.",
      imagePath: "assets/images/lesson-05/06-antibiotics-cold.png",
      imageAlt: "Cold-care objects, abstract virus shapes, and pills separated in a health literacy illustration.",
      sourceLabel: "CDC antibiotic use guidance",
      sourceUrl: "https://www.cdc.gov/antibiotic-use/about/index.html?utm_source=openai"
    },
    {
      statement: "Lightning can hit the same place more than once.",
      answer: "Mostly True",
      explanation: "Lightning can hit the same place many times.",
      imagePath: "assets/images/lesson-05/07-lightning-same-place.png",
      imageAlt: "A tall tower safely receiving repeated stylized lightning strikes in a city skyline.",
      sourceLabel: "NOAA/NSSL lightning FAQ",
      sourceUrl: "https://www.nssl.noaa.gov/education/svrwx101/lightning/faq/?utm_source=openai"
    },
    {
      statement: "People use only 10% of their brain.",
      answer: "Mostly False",
      explanation: "People use much more than 10% of the brain.",
      imagePath: "assets/images/lesson-05/08-brain-ten-percent.png",
      imageAlt: "A colorful brain model with many active regions and simple idea symbols around it.",
      sourceLabel: "BrainFacts 10 percent myth explainer",
      sourceUrl: "https://www.brainfacts.org/thinking-sensing-and-behaving/thinking-and-awareness/2014/the-ten-percent-myth?utm_source=openai"
    },
    {
      statement: "A tomato is a fruit in science.",
      answer: "Mostly True",
      explanation: "In science, a tomato is a fruit. In cooking, people often call it a vegetable.",
      imagePath: "assets/images/lesson-05/09-tomato-fruit.png",
      imageAlt: "A tomato on a vine and a sliced tomato showing seeds on a classroom science table.",
      sourceLabel: "University of Illinois Extension plant-parts explainer",
      sourceUrl: "https://web.extension.illinois.edu/gpe/case1/c1facts2e.html?utm_source=openai"
    },
    {
      statement: "A confident AI answer is always correct.",
      answer: "Mostly False",
      explanation: "AI can sound confident and still be wrong. We need to check sources.",
      imagePath: "assets/images/lesson-05/10-ai-confident-wrong.png",
      imageAlt: "A laptop with a generic AI chat image beside a magnifying glass checking source documents.",
      sourceLabel: "OpenAI Help Center truthfulness note",
      sourceUrl: "https://help.openai.com/en/articles/8313428-does-chatgpt-tell-the-truth?utm_source=openai"
    }
  ];
  var sourceCheckSlides = [
    { variant: "intro" },
    ...sourceCheckItems.flatMap((_, itemIndex) => [
      { variant: "statement", itemIndex },
      { variant: "explanation", itemIndex }
    ]),
    { variant: "closing" },
    { variant: "conclusion" }
  ];
  function initializeSourceCheckWarmupActivities(root = document) {
    const activities = Array.from(root.querySelectorAll("[data-e4a-source-check-warmup]"));
    for (const activity of activities) {
      new SourceCheckWarmupActivity(activity).initialize();
    }
  }
  var SourceCheckWarmupActivity = class {
    constructor(root) {
      this.root = root;
      this.currentSlideIndex = 0;
      this.isPresenting = false;
      this.voteCounts = sourceCheckItems.map(() => ({ mostlyTrue: 0, mostlyFalse: 0 }));
      this.handlePresentationKeydown = (event) => {
        if (event.key === "Escape" && this.isPresenting) {
          if (document.querySelector(".e4a-image-expand")) {
            return;
          }
          this.exitPresentation();
        }
      };
      this.handleFullscreenChange = () => {
        if (this.isPresenting && document.fullscreenElement === null) {
          this.exitPresentation(true);
        }
      };
    }
    initialize() {
      this.root.innerHTML = this.renderShell();
      const elements = this.queryElements();
      if (!elements) {
        return;
      }
      this.elements = elements;
      elements.presentButton.addEventListener("click", () => this.enterPresentation());
      elements.exitButton.addEventListener("click", () => this.exitPresentation());
      elements.previousButton.addEventListener("click", () => this.goPrevious());
      elements.primaryButton.addEventListener("click", () => this.goNext());
      this.renderSlide();
    }
    renderShell() {
      return `
      <div class="e4a-source-check-warmup__inner">
        <div class="e4a-source-check-warmup__header">
          <div class="e4a-source-check-warmup__present-controls">
            <button type="button" class="e4a-source-check-warmup__present btn btn-outline-primary" data-e4a-source-check-present>Present</button>
            <button type="button" class="e4a-source-check-warmup__exit btn btn-outline-secondary" data-e4a-source-check-exit hidden>Exit</button>
          </div>
        </div>
        <div class="e4a-source-check-warmup__activity">
          <div class="e4a-source-check-warmup__progress-row" data-e4a-source-check-progress-row>
            <p class="e4a-source-check-warmup__progress-text" data-e4a-source-check-progress-text></p>
            <div class="e4a-source-check-warmup__progress-track" aria-hidden="true">
              <div class="e4a-source-check-warmup__progress-bar" data-e4a-source-check-progress-bar></div>
            </div>
          </div>
          <div class="e4a-source-check-warmup__slide" data-e4a-source-check-slide tabindex="-1"></div>
          <div class="e4a-source-check-warmup__actions">
            <button type="button" class="e4a-source-check-warmup__previous btn btn-outline-secondary" data-e4a-source-check-previous hidden>Previous slide</button>
            <button type="button" class="e4a-source-check-warmup__primary btn btn-primary" data-e4a-source-check-primary>Next</button>
          </div>
        </div>
      </div>
    `;
    }
    queryElements() {
      const progressRow = this.root.querySelector("[data-e4a-source-check-progress-row]");
      const progressText = this.root.querySelector("[data-e4a-source-check-progress-text]");
      const progressBar = this.root.querySelector("[data-e4a-source-check-progress-bar]");
      const slide = this.root.querySelector("[data-e4a-source-check-slide]");
      const previousButton = this.root.querySelector("[data-e4a-source-check-previous]");
      const primaryButton = this.root.querySelector("[data-e4a-source-check-primary]");
      const presentButton = this.root.querySelector("[data-e4a-source-check-present]");
      const exitButton = this.root.querySelector("[data-e4a-source-check-exit]");
      if (!progressRow || !progressText || !progressBar || !slide || !previousButton || !primaryButton || !presentButton || !exitButton) {
        return void 0;
      }
      return { progressRow, progressText, progressBar, slide, previousButton, primaryButton, presentButton, exitButton };
    }
    renderSlide() {
      if (!this.elements) {
        return;
      }
      const slide = sourceCheckSlides[this.currentSlideIndex];
      const isIntroSlide = slide.variant === "intro";
      const teachingSlideCount = sourceCheckSlides.length - INTRO_SLIDE_COUNT2;
      const teachingSlideNumber = this.currentSlideIndex - INTRO_SLIDE_COUNT2 + 1;
      this.elements.slide.replaceChildren();
      this.elements.progressRow.hidden = isIntroSlide;
      this.elements.progressText.textContent = isIntroSlide ? "" : `Slide ${teachingSlideNumber} of ${teachingSlideCount}`;
      this.elements.progressBar.style.width = isIntroSlide ? "0%" : `${teachingSlideNumber / teachingSlideCount * 100}%`;
      this.elements.previousButton.hidden = this.currentSlideIndex <= INTRO_SLIDE_COUNT2;
      this.setControlButtonLabel(this.elements.previousButton, "Previous slide");
      this.renderPrimaryButton(slide);
      if (slide.variant === "intro") {
        this.renderIntroSlide();
      } else if (slide.variant === "statement") {
        this.renderStatementSlide(slide);
      } else if (slide.variant === "explanation") {
        this.renderExplanationSlide(slide);
      } else if (slide.variant === "closing") {
        this.renderClosingSlide();
      } else {
        this.renderConclusionSlide();
      }
      initializeImageExpanders(this.elements.slide);
      focusWithoutScrolling4(this.elements.slide);
    }
    renderPrimaryButton(slide) {
      if (!this.elements) {
        return;
      }
      if (slide.variant === "conclusion") {
        this.elements.primaryButton.hidden = true;
        return;
      }
      this.elements.primaryButton.hidden = false;
      if (slide.variant === "intro") {
        this.setControlButtonLabel(this.elements.primaryButton, "Start");
      } else if (slide.variant === "statement") {
        this.setControlButtonLabel(this.elements.primaryButton, "Show explanation");
      } else if (slide.variant === "explanation") {
        this.setControlButtonLabel(
          this.elements.primaryButton,
          slide.itemIndex === sourceCheckItems.length - 1 ? "Closing sentence" : "Next statement"
        );
      } else {
        this.setControlButtonLabel(this.elements.primaryButton, "Conclusion");
      }
    }
    renderIntroSlide() {
      if (!this.elements) {
        return;
      }
      this.elements.slide.className = "e4a-source-check-warmup__slide e4a-source-check-warmup__slide--intro";
      const content = document.createElement("div");
      content.className = "e4a-source-check-warmup__intro-slide";
      const eyebrow = document.createElement("p");
      eyebrow.className = "e4a-source-check-warmup__eyebrow";
      eyebrow.textContent = "Warm-up activity";
      const title = document.createElement("h3");
      title.className = "e4a-source-check-warmup__title";
      title.textContent = "Mostly True or Mostly False?";
      const copy = document.createElement("p");
      copy.className = "e4a-source-check-warmup__copy";
      copy.textContent = "Read each statement, vote, then check a source before you decide.";
      content.append(eyebrow, title, copy);
      this.elements.slide.append(content);
    }
    renderStatementSlide(slide) {
      if (!this.elements) {
        return;
      }
      const item = sourceCheckItems[slide.itemIndex];
      this.elements.slide.className = "e4a-source-check-warmup__slide e4a-source-check-warmup__slide--statement";
      const layout = document.createElement("div");
      layout.className = "e4a-source-check-warmup__statement-layout";
      layout.append(this.renderQuestionImage(item), this.renderStatementContent(item, slide.itemIndex));
      this.elements.slide.append(layout);
    }
    renderStatementContent(item, itemIndex) {
      const content = document.createElement("div");
      content.className = "e4a-source-check-warmup__statement-content";
      content.append(this.renderSlideHeader(`Statement ${itemIndex + 1}`, item.statement), this.renderVoteButtons(itemIndex));
      return content;
    }
    renderVoteButtons(itemIndex) {
      const group = document.createElement("div");
      group.className = "e4a-source-check-warmup__vote-buttons";
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", "Vote choices");
      group.append(
        this.renderVoteButton(itemIndex, "mostlyTrue", "Mostly True"),
        this.renderVoteButton(itemIndex, "mostlyFalse", "Mostly False")
      );
      return group;
    }
    renderVoteButton(itemIndex, key, label) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "e4a-source-check-warmup__vote-button";
      button.dataset.e4aSourceCheckVote = key;
      this.updateVoteButton(button, itemIndex, key, label);
      button.addEventListener("click", () => {
        this.voteCounts[itemIndex][key] += 1;
        this.updateVoteButton(button, itemIndex, key, label);
      });
      return button;
    }
    updateVoteButton(button, itemIndex, key, label) {
      const count = this.voteCounts[itemIndex][key];
      button.replaceChildren();
      const text = document.createElement("span");
      text.className = "e4a-source-check-warmup__vote-label";
      text.textContent = label;
      const countElement = document.createElement("span");
      countElement.className = "e4a-source-check-warmup__vote-count";
      countElement.textContent = String(count);
      countElement.setAttribute("aria-hidden", "true");
      button.append(text, countElement);
      button.setAttribute("aria-label", `${label}, ${count} votes`);
    }
    renderExplanationSlide(slide) {
      if (!this.elements) {
        return;
      }
      const item = sourceCheckItems[slide.itemIndex];
      this.elements.slide.className = "e4a-source-check-warmup__slide e4a-source-check-warmup__slide--explanation";
      const content = document.createElement("div");
      content.className = "e4a-source-check-warmup__explanation";
      content.append(this.renderSlideHeader(`Source Check ${slide.itemIndex + 1}`, item.statement));
      const answer = document.createElement("p");
      answer.className = "e4a-source-check-warmup__answer";
      const answerLabel = document.createElement("span");
      answerLabel.className = "e4a-source-check-warmup__answer-label";
      answerLabel.textContent = "Answer";
      const answerText = document.createElement("strong");
      answerText.textContent = item.answer;
      answer.append(answerLabel, answerText);
      const explanation = document.createElement("p");
      explanation.className = "e4a-source-check-warmup__explanation-text";
      explanation.textContent = item.explanation;
      const source = document.createElement("p");
      source.className = "e4a-source-check-warmup__source";
      const sourcePrefix = document.createElement("span");
      sourcePrefix.textContent = "Source: ";
      const link = document.createElement("a");
      link.href = item.sourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = item.sourceLabel;
      source.append(sourcePrefix, link);
      content.append(answer, explanation, source);
      this.elements.slide.append(content);
    }
    renderClosingSlide() {
      if (!this.elements) {
        return;
      }
      this.elements.slide.className = "e4a-source-check-warmup__slide e4a-source-check-warmup__slide--closing";
      const content = document.createElement("div");
      content.className = "e4a-source-check-warmup__closing";
      const eyebrow = document.createElement("p");
      eyebrow.className = "e4a-source-check-warmup__eyebrow";
      eyebrow.textContent = "Speaking frame";
      const frame = document.createElement("p");
      frame.className = "e4a-source-check-warmup__frame";
      frame.textContent = "At first, I thought it was ______. After reading the source, I think it is ______ because ______.";
      content.append(eyebrow, frame);
      this.elements.slide.append(content);
    }
    renderConclusionSlide() {
      if (!this.elements) {
        return;
      }
      this.elements.slide.className = "e4a-source-check-warmup__slide e4a-source-check-warmup__slide--conclusion";
      const content = document.createElement("div");
      content.className = "e4a-source-check-warmup__conclusion";
      const title = document.createElement("h3");
      title.className = "e4a-source-check-warmup__conclusion-title";
      title.textContent = "Always Check the Source";
      const copy = document.createElement("p");
      copy.className = "e4a-source-check-warmup__conclusion-copy";
      copy.textContent = "AI can sound confident and still be wrong. Always check the source.";
      content.append(title, copy);
      this.elements.slide.append(content);
    }
    renderSlideHeader(title, heading) {
      const header = document.createElement("div");
      header.className = "e4a-source-check-warmup__slide-header";
      const eyebrow = document.createElement("p");
      eyebrow.className = "e4a-source-check-warmup__slide-eyebrow";
      eyebrow.textContent = title;
      const prompt = document.createElement("p");
      prompt.className = "e4a-source-check-warmup__statement";
      prompt.textContent = heading;
      header.append(eyebrow, prompt);
      return header;
    }
    renderQuestionImage(item) {
      const figure = document.createElement("figure");
      figure.className = "e4a-source-check-warmup__figure";
      figure.append(
        this.renderResponsiveImage(item.imagePath, item.imageAlt),
        this.renderImageExpandButton(item.imagePath, item.imageAlt, item.statement)
      );
      return figure;
    }
    renderResponsiveImage(imagePath, imageAlt) {
      const picture = document.createElement("picture");
      const source = document.createElement("source");
      source.srcset = imagePath.replace(/\.png$/i, ".webp");
      source.type = "image/webp";
      const image = document.createElement("img");
      image.src = imagePath;
      image.alt = imageAlt;
      image.decoding = "async";
      image.loading = "lazy";
      picture.append(source, image);
      return picture;
    }
    renderImageExpandButton(imagePath, imageAlt, imageCaption) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-outline-primary btn-sm e4a-image-expand__trigger";
      button.textContent = "Expand image";
      button.dataset.e4aImageExpand = "";
      button.dataset.e4aImageExpandSrc = imagePath;
      button.dataset.e4aImageExpandWebpSrc = imagePath.replace(/\.png$/i, ".webp");
      button.dataset.e4aImageExpandAlt = imageAlt;
      button.dataset.e4aImageExpandCaption = imageCaption;
      button.setAttribute("aria-label", `Expand image: ${imageCaption}`);
      return button;
    }
    goPrevious() {
      if (!this.elements || this.currentSlideIndex <= INTRO_SLIDE_COUNT2) {
        return;
      }
      this.currentSlideIndex -= 1;
      this.renderSlide();
    }
    goNext() {
      if (!this.elements || this.currentSlideIndex >= sourceCheckSlides.length - 1) {
        return;
      }
      this.currentSlideIndex += 1;
      this.renderSlide();
    }
    setControlButtonLabel(button, label) {
      button.textContent = label;
      button.setAttribute("aria-label", label);
      button.title = label;
    }
    enterPresentation() {
      if (!this.elements || this.isPresenting) {
        return;
      }
      this.isPresenting = true;
      this.root.dataset.e4aPresentationMode = "true";
      this.root.setAttribute("role", "dialog");
      this.root.setAttribute("aria-label", "Mostly True or Mostly False presentation");
      document.body.classList.add("e4a-source-check-warmup-presenting");
      document.addEventListener("keydown", this.handlePresentationKeydown);
      document.addEventListener("fullscreenchange", this.handleFullscreenChange);
      this.elements.presentButton.hidden = true;
      this.elements.exitButton.hidden = false;
      focusWithoutScrolling4(this.elements.exitButton);
      if (typeof this.root.requestFullscreen === "function") {
        void this.root.requestFullscreen().catch(() => void 0);
      }
    }
    exitPresentation(skipFullscreenExit = false) {
      if (!this.elements || !this.isPresenting) {
        return;
      }
      this.isPresenting = false;
      delete this.root.dataset.e4aPresentationMode;
      this.root.removeAttribute("role");
      this.root.removeAttribute("aria-label");
      document.body.classList.remove("e4a-source-check-warmup-presenting");
      document.removeEventListener("keydown", this.handlePresentationKeydown);
      document.removeEventListener("fullscreenchange", this.handleFullscreenChange);
      this.elements.presentButton.hidden = false;
      this.elements.exitButton.hidden = true;
      focusWithoutScrolling4(this.elements.presentButton);
      if (!skipFullscreenExit && document.fullscreenElement !== null && typeof document.exitFullscreen === "function") {
        void document.exitFullscreen().catch(() => void 0);
      }
    }
  };
  function focusWithoutScrolling4(element) {
    try {
      element.focus({ preventScroll: true });
    } catch {
      element.focus();
    }
  }

  // assets/ts/e4a-data-workshop.ts
  function initializeDataWorkshopActivities(root = document) {
    const activities = Array.from(root.querySelectorAll("[data-e4a-data-workshop]"));
    for (const activity of activities) {
      new DataWorkshopActivity(activity).initialize();
    }
  }
  var DataWorkshopActivity = class {
    constructor(root) {
      this.root = root;
      this.questions = [];
      this.progress = { text: void 0, bar: void 0 };
    }
    initialize() {
      this.questions = Array.from(
        this.root.querySelectorAll("[data-e4a-data-workshop-question]")
      ).map((question) => this.toQuestion(question)).filter((question) => question !== void 0);
      if (this.questions.length === 0) {
        return;
      }
      this.progress = {
        text: this.root.querySelector("[data-e4a-data-workshop-progress-text]") ?? void 0,
        bar: this.root.querySelector("[data-e4a-data-workshop-progress-bar]") ?? void 0
      };
      for (const question of this.questions) {
        question.options.forEach((option) => {
          option.setAttribute("aria-pressed", "false");
          option.addEventListener("click", () => this.answer(question, option));
        });
      }
      this.root.querySelector("[data-e4a-data-workshop-restart]")?.addEventListener("click", () => this.restart());
      this.updateProgress();
    }
    toQuestion(root) {
      const correctAnswer = root.dataset.e4aCorrectAnswer?.trim();
      const options = Array.from(root.querySelectorAll("[data-e4a-data-workshop-option]"));
      if (!correctAnswer || options.length === 0) {
        return void 0;
      }
      return {
        root,
        options,
        feedback: root.querySelector("[data-e4a-data-workshop-feedback]") ?? void 0,
        feedbackStatus: root.querySelector("[data-e4a-data-workshop-feedback-status]") ?? void 0,
        correctAnswer,
        correctLabel: root.dataset.e4aCorrectLabel?.trim() || correctAnswer,
        answered: false
      };
    }
    answer(question, selected) {
      const selectedAnswer = selected.dataset.e4aDataWorkshopOption?.trim() || "";
      const isCorrect = selectedAnswer === question.correctAnswer;
      for (const option of question.options) {
        const isSelected = option === selected;
        option.setAttribute("aria-pressed", isSelected ? "true" : "false");
        delete option.dataset.e4aAnswerState;
        if (isSelected) {
          option.dataset.e4aAnswerState = isCorrect ? "correct" : "incorrect";
        }
      }
      question.root.dataset.e4aAnswerState = isCorrect ? "correct" : "incorrect";
      if (question.feedbackStatus) {
        question.feedbackStatus.textContent = isCorrect ? `Correct. The answer is ${question.correctLabel}.` : `Try again. The best answer is ${question.correctLabel}.`;
      }
      if (question.feedback) {
        question.feedback.open = true;
      }
      question.answered = true;
      this.updateProgress();
    }
    restart() {
      for (const question of this.questions) {
        question.answered = false;
        delete question.root.dataset.e4aAnswerState;
        for (const option of question.options) {
          option.setAttribute("aria-pressed", "false");
          delete option.dataset.e4aAnswerState;
        }
        if (question.feedbackStatus) {
          question.feedbackStatus.textContent = "Choose an answer, then open this panel to check it.";
        }
        if (question.feedback) {
          question.feedback.open = false;
        }
      }
      this.updateProgress();
      this.questions[0]?.root.scrollIntoView({ behavior: this.prefersReducedMotion() ? "auto" : "smooth", block: "center" });
      this.questions[0]?.options[0]?.focus();
    }
    updateProgress() {
      const answered = this.questions.filter((question) => question.answered).length;
      const total = this.questions.length;
      const percent = Math.round(answered / total * 100);
      if (this.progress.text) {
        this.progress.text.textContent = `${answered} of ${total} questions checked`;
      }
      if (this.progress.bar) {
        this.progress.bar.style.width = `${percent}%`;
        this.progress.bar.setAttribute("aria-valuenow", String(answered));
        this.progress.bar.setAttribute("aria-valuemax", String(total));
        this.progress.bar.setAttribute("aria-label", `${answered} of ${total} questions checked`);
      }
    }
    prefersReducedMotion() {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
  };

  // assets/ts/e4a-vocabulary-practice.ts
  function initializeVocabularyPracticeActivities(root = document) {
    const activities = Array.from(root.querySelectorAll("[data-e4a-vocabulary-practice]"));
    for (const activity of activities) {
      new VocabularyPracticeActivity(activity).initialize();
    }
  }
  var VocabularyPracticeActivity = class {
    constructor(root) {
      this.root = root;
    }
    initialize() {
      const rounds = Array.from(this.root.querySelectorAll("[data-e4a-vocabulary-round]")).map((round) => this.toRound(round)).filter((round) => round !== void 0);
      for (const round of rounds) {
        round.restartButton?.addEventListener("click", () => this.restart(round));
        const observer = new MutationObserver((mutations) => {
          if (mutations.some((mutation) => mutation.target instanceof HTMLSelectElement)) {
            this.queueUpdate(round);
          }
        });
        observer.observe(round.root, {
          attributes: true,
          attributeFilter: ["data-e4a-answer-state"],
          subtree: true
        });
        this.update(round);
      }
    }
    toRound(root) {
      const selects = Array.from(root.querySelectorAll("select[data-e4a-answer]"));
      if (selects.length === 0) {
        return void 0;
      }
      return {
        root,
        selects,
        progressText: root.querySelector("[data-e4a-vocabulary-progress-text]") ?? void 0,
        progressBar: root.querySelector("[data-e4a-vocabulary-progress-bar]") ?? void 0,
        restartButton: root.querySelector("[data-e4a-vocabulary-restart]") ?? void 0,
        updateQueued: false
      };
    }
    queueUpdate(round) {
      if (round.updateQueued) {
        return;
      }
      round.updateQueued = true;
      window.queueMicrotask(() => {
        round.updateQueued = false;
        this.update(round);
      });
    }
    update(round) {
      let correct = 0;
      for (const select of round.selects) {
        const state = select.dataset.e4aAnswerState ?? "empty";
        if (state === "correct") {
          correct += 1;
        }
        const feedback = select.closest(".e4a-vocab-match__row")?.querySelector("[data-e4a-vocabulary-feedback]");
        if (feedback) {
          feedback.textContent = state === "correct" ? "\u2713 Correct" : state === "incorrect" ? "\xD7 Try again" : "";
          feedback.dataset.e4aVocabularyFeedbackState = state;
        }
      }
      const total = round.selects.length;
      const progressLabel = correct === total ? `Round complete: ${correct} of ${total} matched correctly` : `${correct} of ${total} matched correctly`;
      if (round.progressText) {
        round.progressText.textContent = progressLabel;
      }
      if (round.progressBar) {
        round.progressBar.style.width = `${Math.round(correct / total * 100)}%`;
        round.progressBar.setAttribute("role", "progressbar");
        round.progressBar.setAttribute("aria-valuemin", "0");
        round.progressBar.setAttribute("aria-valuenow", String(correct));
        round.progressBar.setAttribute("aria-valuemax", String(total));
        round.progressBar.setAttribute("aria-valuetext", progressLabel);
      }
    }
    restart(round) {
      for (const select of round.selects) {
        select.value = "";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      round.selects[0]?.focus();
    }
  };

  // node_modules/.pnpm/livecodes@0.14.1/node_modules/livecodes/livecodes.js
  var te = Object.create;
  var Q = Object.defineProperty;
  var ne = Object.getOwnPropertyDescriptor;
  var oe = Object.getOwnPropertyNames;
  var re = Object.getPrototypeOf;
  var se = Object.prototype.hasOwnProperty;
  var ie = (c, m) => () => (m || c((m = { exports: {} }).exports, m), m.exports);
  var ae = (c, m, P, f) => {
    if (m && typeof m == "object" || typeof m == "function") for (let L of oe(m)) !se.call(c, L) && L !== P && Q(c, L, { get: () => m[L], enumerable: !(f = ne(m, L)) || f.enumerable });
    return c;
  };
  var le = (c, m, P) => (P = c != null ? te(re(c)) : {}, ae(m || !c || !c.__esModule ? Q(P, "default", { value: c, enumerable: true }) : P, c));
  var Z = ie((ge, N) => {
    var ce = (function() {
      var c = String.fromCharCode, m = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=", P = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$", f = {};
      function L(s, r) {
        if (!f[s]) {
          f[s] = {};
          for (var e = 0; e < s.length; e++) f[s][s.charAt(e)] = e;
        }
        return f[s][r];
      }
      var x = { compressToBase64: function(s) {
        if (s == null) return "";
        var r = x._compress(s, 6, function(e) {
          return m.charAt(e);
        });
        switch (r.length % 4) {
          default:
          case 0:
            return r;
          case 1:
            return r + "===";
          case 2:
            return r + "==";
          case 3:
            return r + "=";
        }
      }, decompressFromBase64: function(s) {
        return s == null ? "" : s == "" ? null : x._decompress(s.length, 32, function(r) {
          return L(m, s.charAt(r));
        });
      }, compressToUTF16: function(s) {
        return s == null ? "" : x._compress(s, 15, function(r) {
          return c(r + 32);
        }) + " ";
      }, decompressFromUTF16: function(s) {
        return s == null ? "" : s == "" ? null : x._decompress(s.length, 16384, function(r) {
          return s.charCodeAt(r) - 32;
        });
      }, compressToUint8Array: function(s) {
        for (var r = x.compress(s), e = new Uint8Array(r.length * 2), n = 0, l = r.length; n < l; n++) {
          var g = r.charCodeAt(n);
          e[n * 2] = g >>> 8, e[n * 2 + 1] = g % 256;
        }
        return e;
      }, decompressFromUint8Array: function(s) {
        if (s == null) return x.decompress(s);
        for (var r = new Array(s.length / 2), e = 0, n = r.length; e < n; e++) r[e] = s[e * 2] * 256 + s[e * 2 + 1];
        var l = [];
        return r.forEach(function(g) {
          l.push(c(g));
        }), x.decompress(l.join(""));
      }, compressToEncodedURIComponent: function(s) {
        return s == null ? "" : x._compress(s, 6, function(r) {
          return P.charAt(r);
        });
      }, decompressFromEncodedURIComponent: function(s) {
        return s == null ? "" : s == "" ? null : (s = s.replace(/ /g, "+"), x._decompress(s.length, 32, function(r) {
          return L(P, s.charAt(r));
        }));
      }, compress: function(s) {
        return x._compress(s, 16, function(r) {
          return c(r);
        });
      }, _compress: function(s, r, e) {
        if (s == null) return "";
        var n, l, g = {}, y = {}, w = "", C = "", v = "", E = 2, S = 3, d = 2, h = [], t = 0, o = 0, A;
        for (A = 0; A < s.length; A += 1) if (w = s.charAt(A), Object.prototype.hasOwnProperty.call(g, w) || (g[w] = S++, y[w] = true), C = v + w, Object.prototype.hasOwnProperty.call(g, C)) v = C;
        else {
          if (Object.prototype.hasOwnProperty.call(y, v)) {
            if (v.charCodeAt(0) < 256) {
              for (n = 0; n < d; n++) t = t << 1, o == r - 1 ? (o = 0, h.push(e(t)), t = 0) : o++;
              for (l = v.charCodeAt(0), n = 0; n < 8; n++) t = t << 1 | l & 1, o == r - 1 ? (o = 0, h.push(e(t)), t = 0) : o++, l = l >> 1;
            } else {
              for (l = 1, n = 0; n < d; n++) t = t << 1 | l, o == r - 1 ? (o = 0, h.push(e(t)), t = 0) : o++, l = 0;
              for (l = v.charCodeAt(0), n = 0; n < 16; n++) t = t << 1 | l & 1, o == r - 1 ? (o = 0, h.push(e(t)), t = 0) : o++, l = l >> 1;
            }
            E--, E == 0 && (E = Math.pow(2, d), d++), delete y[v];
          } else for (l = g[v], n = 0; n < d; n++) t = t << 1 | l & 1, o == r - 1 ? (o = 0, h.push(e(t)), t = 0) : o++, l = l >> 1;
          E--, E == 0 && (E = Math.pow(2, d), d++), g[C] = S++, v = String(w);
        }
        if (v !== "") {
          if (Object.prototype.hasOwnProperty.call(y, v)) {
            if (v.charCodeAt(0) < 256) {
              for (n = 0; n < d; n++) t = t << 1, o == r - 1 ? (o = 0, h.push(e(t)), t = 0) : o++;
              for (l = v.charCodeAt(0), n = 0; n < 8; n++) t = t << 1 | l & 1, o == r - 1 ? (o = 0, h.push(e(t)), t = 0) : o++, l = l >> 1;
            } else {
              for (l = 1, n = 0; n < d; n++) t = t << 1 | l, o == r - 1 ? (o = 0, h.push(e(t)), t = 0) : o++, l = 0;
              for (l = v.charCodeAt(0), n = 0; n < 16; n++) t = t << 1 | l & 1, o == r - 1 ? (o = 0, h.push(e(t)), t = 0) : o++, l = l >> 1;
            }
            E--, E == 0 && (E = Math.pow(2, d), d++), delete y[v];
          } else for (l = g[v], n = 0; n < d; n++) t = t << 1 | l & 1, o == r - 1 ? (o = 0, h.push(e(t)), t = 0) : o++, l = l >> 1;
          E--, E == 0 && (E = Math.pow(2, d), d++);
        }
        for (l = 2, n = 0; n < d; n++) t = t << 1 | l & 1, o == r - 1 ? (o = 0, h.push(e(t)), t = 0) : o++, l = l >> 1;
        for (; ; ) if (t = t << 1, o == r - 1) {
          h.push(e(t));
          break;
        } else o++;
        return h.join("");
      }, decompress: function(s) {
        return s == null ? "" : s == "" ? null : x._decompress(s.length, 32768, function(r) {
          return s.charCodeAt(r);
        });
      }, _decompress: function(s, r, e) {
        var n = [], l, g = 4, y = 4, w = 3, C = "", v = [], E, S, d, h, t, o, A, a = { val: e(0), position: r, index: 1 };
        for (E = 0; E < 3; E += 1) n[E] = E;
        for (d = 0, t = Math.pow(2, 2), o = 1; o != t; ) h = a.val & a.position, a.position >>= 1, a.position == 0 && (a.position = r, a.val = e(a.index++)), d |= (h > 0 ? 1 : 0) * o, o <<= 1;
        switch (l = d) {
          case 0:
            for (d = 0, t = Math.pow(2, 8), o = 1; o != t; ) h = a.val & a.position, a.position >>= 1, a.position == 0 && (a.position = r, a.val = e(a.index++)), d |= (h > 0 ? 1 : 0) * o, o <<= 1;
            A = c(d);
            break;
          case 1:
            for (d = 0, t = Math.pow(2, 16), o = 1; o != t; ) h = a.val & a.position, a.position >>= 1, a.position == 0 && (a.position = r, a.val = e(a.index++)), d |= (h > 0 ? 1 : 0) * o, o <<= 1;
            A = c(d);
            break;
          case 2:
            return "";
        }
        for (n[3] = A, S = A, v.push(A); ; ) {
          if (a.index > s) return "";
          for (d = 0, t = Math.pow(2, w), o = 1; o != t; ) h = a.val & a.position, a.position >>= 1, a.position == 0 && (a.position = r, a.val = e(a.index++)), d |= (h > 0 ? 1 : 0) * o, o <<= 1;
          switch (A = d) {
            case 0:
              for (d = 0, t = Math.pow(2, 8), o = 1; o != t; ) h = a.val & a.position, a.position >>= 1, a.position == 0 && (a.position = r, a.val = e(a.index++)), d |= (h > 0 ? 1 : 0) * o, o <<= 1;
              n[y++] = c(d), A = y - 1, g--;
              break;
            case 1:
              for (d = 0, t = Math.pow(2, 16), o = 1; o != t; ) h = a.val & a.position, a.position >>= 1, a.position == 0 && (a.position = r, a.val = e(a.index++)), d |= (h > 0 ? 1 : 0) * o, o <<= 1;
              n[y++] = c(d), A = y - 1, g--;
              break;
            case 2:
              return v.join("");
          }
          if (g == 0 && (g = Math.pow(2, w), w++), n[A]) C = n[A];
          else if (A === y) C = S + S.charAt(0);
          else return null;
          v.push(C), n[y++] = S + C.charAt(0), g--, S = C, g == 0 && (g = Math.pow(2, w), w++);
        }
      } };
      return x;
    })();
    typeof N != "undefined" && N != null && (N.exports = ce);
  });
  var I = le(Z());
  function ue(c = {}) {
    let { appUrl: m = "https://livecodes.io", params: P = {}, config: f = {}, headless: L, import: x, lite: s, view: r, ...e } = c, n;
    try {
      n = new URL(m);
    } catch (y) {
      throw new Error(`${m} is not a valid URL.`);
    }
    let l = new URLSearchParams();
    Object.entries(e).forEach(([y, w]) => {
      w !== void 0 && n.searchParams.set(y, String(w));
    });
    let g = c.view === "headless" || L;
    if (s && (console.warn(`Deprecation notice: "lite" option is deprecated. Use "config: { mode: 'lite' }" instead.`), typeof f == "object" && f.mode == null ? f.mode = "lite" : n.searchParams.set("lite", "true")), r && (console.warn('Deprecation notice: The "view" option has been moved to "config.view". For headless mode use "headless: true".'), typeof f == "object" && f.view == null && r !== "headless" ? f.view = r : n.searchParams.set("view", r)), typeof f == "string") try {
      new URL(f), n.searchParams.set("config", encodeURIComponent(f));
    } catch (y) {
      throw new Error('"config" is not a valid URL or configuration object.');
    }
    else f && typeof f == "object" && Object.keys(f).length > 0 && (f.title && f.title !== "Untitled Project" && n.searchParams.set("title", f.title), f.description && f.description.length > 0 && n.searchParams.set("description", f.description), l.set("config", "code/" + (0, I.compressToEncodedURIComponent)(JSON.stringify(f))));
    if (P && typeof P == "object" && Object.keys(P).length > 0) try {
      l.set("params", (0, I.compressToEncodedURIComponent)(JSON.stringify(P)));
    } catch (y) {
      Object.keys(P).forEach((w) => {
        n.searchParams.set(w, encodeURIComponent(String(P[w])));
      });
    }
    return x && n.searchParams.set("x", encodeURIComponent(x)), g && n.searchParams.set("headless", "true"), l.toString().length > 0 && (n.hash = l.toString()), n.href;
  }
  var ve = I.compressToEncodedURIComponent;
  var we = I.decompressFromEncodedURIComponent;

  // assets/sample-code/lesson-07/brick-breaker.html
  var brick_breaker_default = '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>Brick Breaker</title>\n  <style>\n    * { box-sizing: border-box; }\n    body { margin: 0; padding: 12px; font-family: system-ui, sans-serif; color: #14213d; background: #eef4ff; text-align: center; }\n    main { width: min(100%, 680px); margin: auto; }\n    h1 { margin: 0 0 4px; font-size: clamp(1.4rem, 5vw, 2rem); }\n    p { margin: 5px 0; }\n    .stats { display: flex; justify-content: center; gap: 2rem; font-weight: 700; }\n    canvas { display: block; width: 100%; height: auto; margin: 10px auto; border: 3px solid #1f4f9f; border-radius: 10px; background: #101a36; }\n    .controls { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }\n    button { min-width: 74px; min-height: 44px; padding: 8px 14px; border: 2px solid #1f4f9f; border-radius: 8px; color: white; background: #1f4f9f; font: inherit; font-weight: 700; cursor: pointer; }\n    button:focus-visible { outline: 3px solid #f6b73c; outline-offset: 2px; }\n    #message { min-height: 1.5em; font-weight: 700; }\n  </style>\n</head>\n<body>\n  <main>\n    <h1>Brick Breaker</h1>\n    <p>Move with \u2190 \u2192 or the buttons. Keep the ball above the paddle.</p>\n    <div class="stats"><span id="score">Score: 0</span><span id="lives">Lives: 3</span></div>\n    <canvas id="game" width="640" height="420">Brick Breaker game area.</canvas>\n    <p id="message" role="status" aria-live="polite">Break every brick.</p>\n    <div class="controls" aria-label="Game controls">\n      <button id="left" type="button" aria-label="Move paddle left">\u2190 Left</button>\n      <button id="right" type="button" aria-label="Move paddle right">Right \u2192</button>\n      <button id="restart" type="button">Restart</button>\n    </div>\n  </main>\n  <script>\n    const canvas = document.querySelector("#game");\n    const ctx = canvas.getContext("2d");\n    const scoreText = document.querySelector("#score");\n    const livesText = document.querySelector("#lives");\n    const message = document.querySelector("#message");\n    const state = {\n      score: 0, lives: 3, running: true, left: false, right: false,\n      paddle: { x: 270, y: 388, width: 100, height: 14 },\n      ball: { x: 320, y: 365, dx: 3.4, dy: -3.4, radius: 8 },\n      bricks: []\n    };\n\n    function makeBricks() {\n      state.bricks = [];\n      for (let row = 0; row < 4; row += 1) {\n        for (let column = 0; column < 7; column += 1) {\n          state.bricks.push({ x: 35 + column * 83, y: 48 + row * 32, width: 70, height: 20, active: true, color: ["#ff6b6b", "#ffd166", "#62d6a7", "#59a5ff"][row] });\n        }\n      }\n    }\n\n    function resetBall() {\n      state.ball.x = 320;\n      state.ball.y = 365;\n      state.ball.dx = 3.4;\n      state.ball.dy = -3.4;\n      state.paddle.x = 270;\n    }\n\n    function restartGame() {\n      state.score = 0;\n      state.lives = 3;\n      state.running = true;\n      makeBricks();\n      resetBall();\n      message.textContent = "Break every brick.";\n      updateLabels();\n    }\n\n    function updateLabels() {\n      scoreText.textContent = `Score: ${state.score}`;\n      livesText.textContent = `Lives: ${state.lives}`;\n    }\n\n    function overlap(ball, box) {\n      const nearestX = Math.max(box.x, Math.min(ball.x, box.x + box.width));\n      const nearestY = Math.max(box.y, Math.min(ball.y, box.y + box.height));\n      const xDistance = ball.x - nearestX;\n      const yDistance = ball.y - nearestY;\n      return xDistance * xDistance + yDistance * yDistance < ball.radius * ball.radius;\n    }\n\n    function update() {\n      if (!state.running) return;\n      if (state.left) state.paddle.x -= 7;\n      if (state.right) state.paddle.x += 7;\n      state.paddle.x = Math.max(0, Math.min(canvas.width - state.paddle.width, state.paddle.x));\n      const ball = state.ball;\n      ball.x += ball.dx;\n      ball.y += ball.dy;\n      if (ball.x > canvas.width - ball.radius) ball.dx = -Math.abs(ball.dx);\n      if (ball.x < ball.radius) ball.dx = Math.abs(ball.dx);\n      if (ball.y < ball.radius) ball.dy = Math.abs(ball.dy);\n      if (ball.dy > 0 && overlap(ball, state.paddle)) {\n        ball.dy = -Math.abs(ball.dy);\n        ball.dx += (ball.x - (state.paddle.x + state.paddle.width / 2)) * 0.025;\n      }\n      for (const brick of state.bricks) {\n        if (brick.active && overlap(ball, brick)) {\n          brick.active = false;\n          ball.dy = -ball.dy;\n          state.score += 10;\n          updateLabels();\n          break;\n        }\n      }\n      if (state.bricks.every(brick => !brick.active)) {\n        state.running = false;\n        message.textContent = "You win! Select Restart to play again.";\n      }\n      if (ball.y > canvas.height + ball.radius) {\n        state.lives -= 1;\n        updateLabels();\n        if (state.lives < 1) {\n          state.running = false;\n          message.textContent = "Game over. Select Restart to try again.";\n        } else {\n          message.textContent = "One life lost. Keep going.";\n          resetBall();\n        }\n      }\n    }\n\n    function draw() {\n      ctx.clearRect(0, 0, canvas.width, canvas.height);\n      for (const brick of state.bricks) {\n        if (!brick.active) continue;\n        ctx.fillStyle = brick.color;\n        ctx.fillRect(brick.x, brick.y, brick.width, brick.height);\n      }\n      ctx.fillStyle = "#59a5ff";\n      ctx.fillRect(state.paddle.x, state.paddle.y, state.paddle.width, state.paddle.height);\n      ctx.beginPath();\n      ctx.arc(state.ball.x, state.ball.y, state.ball.radius, 0, Math.PI * 2);\n      ctx.fillStyle = "#ffffff";\n      ctx.fill();\n    }\n\n    function loop() {\n      update();\n      draw();\n      requestAnimationFrame(loop);\n    }\n\n    function setDirection(direction, pressed) {\n      state[direction] = pressed;\n    }\n\n    document.addEventListener("keydown", event => {\n      if (event.key === "ArrowLeft") setDirection("left", true);\n      if (event.key === "ArrowRight") setDirection("right", true);\n    });\n    document.addEventListener("keyup", event => {\n      if (event.key === "ArrowLeft") setDirection("left", false);\n      if (event.key === "ArrowRight") setDirection("right", false);\n    });\n    for (const direction of ["left", "right"]) {\n      const button = document.querySelector(`#${direction}`);\n      button.addEventListener("pointerdown", () => setDirection(direction, true));\n      button.addEventListener("pointerup", () => setDirection(direction, false));\n      button.addEventListener("pointerleave", () => setDirection(direction, false));\n    }\n    document.querySelector("#restart").addEventListener("click", restartGame);\n    restartGame();\n    loop();\n  <\/script>\n</body>\n</html>\n';

  // assets/sample-code/lesson-07/falling-blocks.html
  var falling_blocks_default = '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>Falling Blocks</title>\n  <style>\n    * { box-sizing: border-box; }\n    body { margin: 0; padding: 10px; font-family: system-ui, sans-serif; color: #f4f6ff; background: #101326; text-align: center; }\n    main { width: min(100%, 500px); margin: auto; }\n    h1 { margin: 0 0 4px; font-size: clamp(1.4rem, 5vw, 2rem); }\n    p { margin: 5px 0; }\n    #score { color: #ffd166; font-weight: 800; }\n    canvas { display: block; width: min(82vw, 300px); height: auto; margin: 8px auto; border: 3px solid #9299c2; border-radius: 8px; background: #090b18; }\n    .controls { display: flex; flex-wrap: wrap; justify-content: center; gap: 7px; }\n    button { min-width: 66px; min-height: 42px; padding: 7px 10px; border: 2px solid #8e9bff; border-radius: 8px; color: white; background: #353f8f; font: inherit; font-weight: 700; cursor: pointer; }\n    button:focus-visible { outline: 3px solid #ffd166; outline-offset: 2px; }\n    #message { min-height: 1.5em; font-weight: 700; }\n  </style>\n</head>\n<body>\n  <main>\n    <h1>Falling Blocks</h1>\n    <p>Use \u2190 \u2192, \u2191 to rotate, and \u2193 for a fast drop.</p>\n    <p id="score">Score: 0</p>\n    <canvas id="game" width="300" height="540">Falling Blocks game area.</canvas>\n    <p id="message" role="status" aria-live="polite">Complete a row to clear it.</p>\n    <div class="controls" aria-label="Game controls">\n      <button id="left" type="button">\u2190</button>\n      <button id="rotate" type="button">Rotate</button>\n      <button id="right" type="button">\u2192</button>\n      <button id="drop" type="button">Drop \u2193</button>\n      <button id="restart" type="button">Restart</button>\n    </div>\n  </main>\n  <script>\n    const canvas = document.querySelector("#game");\n    const ctx = canvas.getContext("2d");\n    const scoreText = document.querySelector("#score");\n    const message = document.querySelector("#message");\n    const columns = 10;\n    const rows = 18;\n    const size = 30;\n    const shapes = [\n      [[1, 1, 1, 1]],\n      [[1, 1], [1, 1]],\n      [[0, 1, 0], [1, 1, 1]],\n      [[1, 0, 0], [1, 1, 1]],\n      [[0, 0, 1], [1, 1, 1]],\n      [[0, 1, 1], [1, 1, 0]],\n      [[1, 1, 0], [0, 1, 1]]\n    ];\n    const colors = ["#59a5ff", "#ffd166", "#b46cff", "#ff8c5a", "#62d6a7", "#ff6b82", "#48cae4"];\n    const state = { board: [], piece: null, score: 0, running: true, timer: null, nextShape: 0 };\n\n    function emptyBoard() {\n      return Array.from({ length: rows }, () => Array(columns).fill(""));\n    }\n\n    function copyShape(shape) {\n      return shape.map(row => [...row]);\n    }\n\n    function nextPiece() {\n      const index = state.nextShape % shapes.length;\n      state.nextShape += 3;\n      state.piece = { shape: copyShape(shapes[index]), color: colors[index], x: 3, y: 0 };\n      if (collides(state.piece, 0, 0, state.piece.shape)) {\n        state.running = false;\n        message.textContent = "Game over. Select Restart to try again.";\n      }\n    }\n\n    function collides(piece, moveX, moveY, shape) {\n      for (let y = 0; y < shape.length; y += 1) {\n        for (let x = 0; x < shape[y].length; x += 1) {\n          if (!shape[y][x]) continue;\n          const boardX = piece.x + x + moveX;\n          const boardY = piece.y + y + moveY;\n          if (boardX < 0) return true;\n          if (boardX >= columns) return true;\n          if (boardY >= rows) return true;\n          if (boardY >= 0 && state.board[boardY][boardX]) return true;\n        }\n      }\n      return false;\n    }\n\n    function rotateShape(shape) {\n      return shape[0].map((value, index) => shape.map(row => row[index]).reverse());\n    }\n\n    function movePiece(amount) {\n      if (!state.running) return;\n      if (!collides(state.piece, amount, 0, state.piece.shape)) state.piece.x += amount;\n      draw();\n    }\n\n    function rotatePiece() {\n      if (!state.running) return;\n      const rotated = rotateShape(state.piece.shape);\n      if (!collides(state.piece, 0, 0, rotated)) state.piece.shape = rotated;\n      draw();\n    }\n\n    function lockPiece() {\n      const piece = state.piece;\n      for (let y = 0; y < piece.shape.length; y += 1) {\n        for (let x = 0; x < piece.shape[y].length; x += 1) {\n          if (piece.shape[y][x]) state.board[piece.y + y][piece.x + x] = piece.color;\n        }\n      }\n      clearRows();\n      nextPiece();\n    }\n\n    function stepDown() {\n      if (!state.running) return;\n      if (collides(state.piece, 0, 1, state.piece.shape)) lockPiece();\n      else state.piece.y += 1;\n      draw();\n    }\n\n    function fastDrop() {\n      if (!state.running) return;\n      let distance = 0;\n      while (!collides(state.piece, 0, distance + 1, state.piece.shape)) distance += 1;\n      state.piece.y += distance;\n      state.score += distance;\n      lockPiece();\n      updateScore();\n      draw();\n    }\n\n    function clearRows() {\n      let cleared = 0;\n      for (let y = rows - 1; y >= 0; y -= 1) {\n        if (state.board[y].every(cell => Boolean(cell))) {\n          state.board.splice(y, 1);\n          state.board.unshift(Array(columns).fill(""));\n          cleared += 1;\n          y += 1;\n        }\n      }\n      if (cleared > 0) {\n        state.score += cleared * cleared * 100;\n        message.textContent = `${cleared} row cleared.`;\n        updateScore();\n      }\n    }\n\n    function updateScore() {\n      scoreText.textContent = `Score: ${state.score}`;\n    }\n\n    function drawCell(x, y, color) {\n      ctx.fillStyle = color;\n      ctx.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);\n    }\n\n    function draw() {\n      ctx.clearRect(0, 0, canvas.width, canvas.height);\n      ctx.strokeStyle = "#242a4d";\n      for (let x = 0; x <= columns; x += 1) {\n        ctx.beginPath(); ctx.moveTo(x * size, 0); ctx.lineTo(x * size, canvas.height); ctx.stroke();\n      }\n      for (let y = 0; y <= rows; y += 1) {\n        ctx.beginPath(); ctx.moveTo(0, y * size); ctx.lineTo(canvas.width, y * size); ctx.stroke();\n      }\n      for (let y = 0; y < rows; y += 1) {\n        for (let x = 0; x < columns; x += 1) {\n          if (state.board[y][x]) drawCell(x, y, state.board[y][x]);\n        }\n      }\n      if (!state.piece) return;\n      for (let y = 0; y < state.piece.shape.length; y += 1) {\n        for (let x = 0; x < state.piece.shape[y].length; x += 1) {\n          if (state.piece.shape[y][x]) drawCell(state.piece.x + x, state.piece.y + y, state.piece.color);\n        }\n      }\n    }\n\n    function restartGame() {\n      if (state.timer) clearInterval(state.timer);\n      state.board = emptyBoard();\n      state.score = 0;\n      state.running = true;\n      state.nextShape = 0;\n      message.textContent = "Complete a row to clear it.";\n      updateScore();\n      nextPiece();\n      draw();\n      state.timer = setInterval(stepDown, 550);\n    }\n\n    document.addEventListener("keydown", event => {\n      if (event.key === "ArrowLeft") movePiece(-1);\n      if (event.key === "ArrowRight") movePiece(1);\n      if (event.key === "ArrowUp") rotatePiece();\n      if (event.key === "ArrowDown") fastDrop();\n    });\n    document.querySelector("#left").addEventListener("click", () => movePiece(-1));\n    document.querySelector("#right").addEventListener("click", () => movePiece(1));\n    document.querySelector("#rotate").addEventListener("click", rotatePiece);\n    document.querySelector("#drop").addEventListener("click", fastDrop);\n    document.querySelector("#restart").addEventListener("click", restartGame);\n    restartGame();\n  <\/script>\n</body>\n</html>\n';

  // assets/sample-code/lesson-07/guess-number.html
  var guess_number_default = '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>Guess the Number</title>\n  <style>\n    :root {\n      color-scheme: light;\n      font-family: system-ui, sans-serif;\n      background: #eef4ff;\n      color: #15213a;\n    }\n\n    body {\n      min-height: 100vh;\n      margin: 0;\n      display: grid;\n      place-items: center;\n    }\n\n    main {\n      width: min(90vw, 34rem);\n      box-sizing: border-box;\n      padding: 2rem;\n      border: 2px solid #2457c5;\n      border-radius: 1rem;\n      background: white;\n      box-shadow: 0 1rem 2rem rgb(21 33 58 / 12%);\n    }\n\n    h1 {\n      margin-top: 0;\n    }\n\n    .controls {\n      display: flex;\n      flex-wrap: wrap;\n      gap: 0.75rem;\n      margin: 1.25rem 0;\n    }\n\n    input,\n    button {\n      min-height: 2.75rem;\n      box-sizing: border-box;\n      border-radius: 0.5rem;\n      font: inherit;\n    }\n\n    input {\n      min-width: 10rem;\n      flex: 1;\n      padding: 0.5rem 0.75rem;\n      border: 2px solid #6d7890;\n    }\n\n    button {\n      padding: 0.5rem 1rem;\n      border: 2px solid #2457c5;\n      background: #2457c5;\n      color: white;\n      cursor: pointer;\n    }\n\n    button.secondary {\n      background: white;\n      color: #2457c5;\n    }\n\n    #message {\n      min-height: 1.5rem;\n      font-weight: 700;\n    }\n\n    #attempts {\n      margin-bottom: 0;\n    }\n  </style>\n</head>\n<body>\n  <main>\n    <h1>Guess the Number</h1>\n    <p>I chose a whole number from 1 to 100. Enter a number and select <strong>Guess</strong>. You can also press Enter.</p>\n\n    <form id="guess-form" novalidate>\n      <label for="guess">Your guess</label>\n      <div class="controls">\n        <input id="guess" name="guess" type="number" min="1" max="100" step="1" inputmode="numeric" autocomplete="off">\n        <button type="submit">Guess</button>\n        <button class="secondary" id="new-game" type="button">New Game</button>\n      </div>\n    </form>\n\n    <p id="message" role="status" aria-live="polite">Make your first guess.</p>\n    <p id="attempts">Attempts: 0</p>\n  </main>\n\n  <script>\n    const form = document.querySelector("#guess-form");\n    const input = document.querySelector("#guess");\n    const message = document.querySelector("#message");\n    const attemptsText = document.querySelector("#attempts");\n    const newGameButton = document.querySelector("#new-game");\n\n    let targetNumber;\n    let attempts;\n    let gameFinished;\n\n    function chooseTargetNumber() {\n      return Math.floor(Math.random() * 100) + 1;\n    }\n\n    function startNewGame() {\n      targetNumber = chooseTargetNumber();\n      attempts = 0;\n      gameFinished = false;\n      input.disabled = false;\n      input.value = "";\n      message.textContent = "Make your first guess.";\n      attemptsText.textContent = "Attempts: 0";\n      input.focus();\n    }\n\n    function readGuess() {\n      const text = input.value.trim();\n      const number = Number(text);\n\n      const invalidGuess = [\n        text === "",\n        !Number.isInteger(number),\n        number < 1,\n        number > 100\n      ].some(Boolean);\n\n      if (invalidGuess) {\n        return null;\n      }\n\n      return number;\n    }\n\n    form.addEventListener("submit", (event) => {\n      event.preventDefault();\n\n      if (gameFinished) {\n        message.textContent = "Select New Game to play again.";\n        return;\n      }\n\n      const guess = readGuess();\n      if (guess === null) {\n        message.textContent = "Enter one whole number from 1 to 100.";\n        input.focus();\n        return;\n      }\n\n      attempts += 1;\n      attemptsText.textContent = `Attempts: ${attempts}`;\n\n      if (guess < targetNumber) {\n        message.textContent = "Too low.";\n      } else if (guess > targetNumber) {\n        message.textContent = "Too high.";\n      } else {\n        message.textContent = `Correct! The number was ${targetNumber}.`;\n        gameFinished = true;\n        input.disabled = true;\n      }\n\n      input.select();\n    });\n\n    newGameButton.addEventListener("click", startNewGame);\n    startNewGame();\n  <\/script>\n</body>\n</html>\n';

  // assets/sample-code/lesson-07/platform-jumper.html
  var platform_jumper_default = '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>Platform Jumper</title>\n  <style>\n    * { box-sizing: border-box; }\n    body { margin: 0; padding: 12px; font-family: system-ui, sans-serif; color: #13304a; background: #e8f8ff; text-align: center; }\n    main { width: min(100%, 560px); margin: auto; }\n    h1 { margin: 0 0 4px; font-size: clamp(1.4rem, 5vw, 2rem); }\n    p { margin: 5px 0; }\n    #score { font-weight: 800; }\n    canvas { display: block; width: min(100%, 480px); height: auto; margin: 10px auto; border: 3px solid #16537e; border-radius: 10px; background: #d7f3ff; }\n    .controls { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }\n    button { min-width: 82px; min-height: 44px; padding: 8px 14px; border: 2px solid #16537e; border-radius: 8px; color: white; background: #16537e; font: inherit; font-weight: 700; cursor: pointer; }\n    button:focus-visible { outline: 3px solid #ffb703; outline-offset: 2px; }\n    #message { min-height: 1.5em; font-weight: 700; }\n  </style>\n</head>\n<body>\n  <main>\n    <h1>Platform Jumper</h1>\n    <p>Move with \u2190 \u2192 or the buttons. The player jumps automatically.</p>\n    <p id="score">Height: 0</p>\n    <canvas id="game" width="480" height="520">Platform Jumper game area.</canvas>\n    <p id="message" role="status" aria-live="polite">Land on higher platforms.</p>\n    <div class="controls" aria-label="Game controls">\n      <button id="left" type="button">\u2190 Left</button>\n      <button id="right" type="button">Right \u2192</button>\n      <button id="restart" type="button">Restart</button>\n    </div>\n  </main>\n  <script>\n    const canvas = document.querySelector("#game");\n    const ctx = canvas.getContext("2d");\n    const scoreText = document.querySelector("#score");\n    const message = document.querySelector("#message");\n    const state = {\n      running: true, left: false, right: false, score: 0,\n      player: { x: 215, y: 425, width: 38, height: 42, dx: 0, dy: -11 },\n      platforms: []\n    };\n\n    function startingPlatforms() {\n      return [\n        { x: 170, y: 480, width: 140, height: 14 },\n        { x: 35, y: 390, width: 120, height: 14 },\n        { x: 270, y: 305, width: 130, height: 14 },\n        { x: 115, y: 220, width: 120, height: 14 },\n        { x: 320, y: 130, width: 105, height: 14 },\n        { x: 55, y: 45, width: 115, height: 14 }\n      ];\n    }\n\n    function restartGame() {\n      state.running = true;\n      state.score = 0;\n      state.left = false;\n      state.right = false;\n      state.player = { x: 215, y: 425, width: 38, height: 42, dx: 0, dy: -11 };\n      state.platforms = startingPlatforms();\n      scoreText.textContent = "Height: 0";\n      message.textContent = "Land on higher platforms.";\n    }\n\n    function addTopPlatform() {\n      const lastX = state.platforms.length * 97;\n      state.platforms.push({ x: 25 + lastX % 320, y: -30, width: 115, height: 14 });\n    }\n\n    function update() {\n      if (!state.running) return;\n      const player = state.player;\n      if (state.left) player.dx = -4.8;\n      if (state.right) player.dx = 4.8;\n      if (!state.left && !state.right) player.dx *= 0.75;\n      player.x += player.dx;\n      if (player.x < 0) player.x = 0;\n      if (player.x > canvas.width - player.width) player.x = canvas.width - player.width;\n      const oldBottom = player.y + player.height;\n      player.dy += 0.45;\n      player.y += player.dy;\n      const newBottom = player.y + player.height;\n      if (player.dy > 0) {\n        for (const platform of state.platforms) {\n          const horizontallyInside = player.x + player.width > platform.x && player.x < platform.x + platform.width;\n          const crossedTop = oldBottom <= platform.y && newBottom >= platform.y;\n          if (horizontallyInside && crossedTop) {\n            player.y = platform.y - player.height;\n            player.dy = -11;\n            break;\n          }\n        }\n      }\n      if (player.y < 145 && player.dy < 0) {\n        const shift = 145 - player.y;\n        player.y = 145;\n        for (const platform of state.platforms) platform.y += shift;\n        state.score += Math.round(shift);\n        scoreText.textContent = `Height: ${state.score}`;\n      }\n      state.platforms = state.platforms.filter(platform => platform.y < canvas.height + 30);\n      if (state.platforms.length < 7) addTopPlatform();\n      if (player.y > canvas.height) {\n        state.running = false;\n        message.textContent = `Game over at height ${state.score}. Select Restart.`;\n      }\n    }\n\n    function draw() {\n      ctx.clearRect(0, 0, canvas.width, canvas.height);\n      ctx.fillStyle = "#2fa866";\n      for (const platform of state.platforms) {\n        ctx.fillRect(platform.x, platform.y, platform.width, platform.height);\n      }\n      const player = state.player;\n      ctx.fillStyle = "#6c4cff";\n      ctx.fillRect(player.x, player.y, player.width, player.height);\n      ctx.fillStyle = "white";\n      ctx.beginPath();\n      ctx.arc(player.x + 12, player.y + 15, 3, 0, Math.PI * 2);\n      ctx.arc(player.x + 27, player.y + 15, 3, 0, Math.PI * 2);\n      ctx.fill();\n    }\n\n    function loop() {\n      update();\n      draw();\n      requestAnimationFrame(loop);\n    }\n\n    function setDirection(direction, pressed) {\n      state[direction] = pressed;\n    }\n    document.addEventListener("keydown", event => {\n      if (event.key === "ArrowLeft") setDirection("left", true);\n      if (event.key === "ArrowRight") setDirection("right", true);\n    });\n    document.addEventListener("keyup", event => {\n      if (event.key === "ArrowLeft") setDirection("left", false);\n      if (event.key === "ArrowRight") setDirection("right", false);\n    });\n    for (const direction of ["left", "right"]) {\n      const button = document.querySelector(`#${direction}`);\n      button.addEventListener("pointerdown", () => setDirection(direction, true));\n      button.addEventListener("pointerup", () => setDirection(direction, false));\n      button.addEventListener("pointerleave", () => setDirection(direction, false));\n    }\n    document.querySelector("#restart").addEventListener("click", restartGame);\n    restartGame();\n    loop();\n  <\/script>\n</body>\n</html>\n';

  // assets/sample-code/lesson-07/space-defender.html
  var space_defender_default = '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>Space Defender</title>\n  <style>\n    * { box-sizing: border-box; }\n    body { margin: 0; padding: 10px; font-family: system-ui, sans-serif; color: #f6f8ff; background: #071126; text-align: center; }\n    main { width: min(100%, 620px); margin: auto; }\n    h1 { margin: 0 0 4px; font-size: clamp(1.4rem, 5vw, 2rem); }\n    p { margin: 5px 0; }\n    .stats { display: flex; justify-content: center; gap: 2rem; color: #8ff0c0; font-weight: 800; }\n    canvas { display: block; width: 100%; height: auto; margin: 9px auto; border: 3px solid #647cff; border-radius: 10px; background: #050b18; }\n    .controls { display: flex; flex-wrap: wrap; justify-content: center; gap: 7px; }\n    button { min-width: 72px; min-height: 44px; padding: 8px 12px; border: 2px solid #7b8fff; border-radius: 8px; color: white; background: #26398f; font: inherit; font-weight: 700; cursor: pointer; }\n    button:focus-visible { outline: 3px solid #ffd166; outline-offset: 2px; }\n    #message { min-height: 1.5em; font-weight: 700; }\n  </style>\n</head>\n<body>\n  <main>\n    <h1>Space Defender</h1>\n    <p>Move with \u2190 \u2192. Fire with Space or the Fire button.</p>\n    <div class="stats"><span id="score">Score: 0</span><span id="lives">Lives: 3</span></div>\n    <canvas id="game" width="600" height="440">Space Defender game area.</canvas>\n    <p id="message" role="status" aria-live="polite">Defend the bottom of the screen.</p>\n    <div class="controls" aria-label="Game controls">\n      <button id="left" type="button">\u2190 Left</button>\n      <button id="fire" type="button">Fire</button>\n      <button id="right" type="button">Right \u2192</button>\n      <button id="restart" type="button">Restart</button>\n    </div>\n  </main>\n  <script>\n    const canvas = document.querySelector("#game");\n    const ctx = canvas.getContext("2d");\n    const scoreText = document.querySelector("#score");\n    const livesText = document.querySelector("#lives");\n    const message = document.querySelector("#message");\n    const state = {\n      score: 0, lives: 3, running: true, left: false, right: false,\n      player: { x: 275, y: 390, width: 50, height: 28 },\n      shots: [], enemies: [], enemyDirection: 1, enemySpeed: 0.5\n    };\n\n    function makeEnemies() {\n      state.enemies = [];\n      for (let row = 0; row < 3; row += 1) {\n        for (let column = 0; column < 8; column += 1) {\n          state.enemies.push({ x: 45 + column * 64, y: 45 + row * 45, width: 38, height: 25, active: true, color: ["#79e6ae", "#ffd166", "#ff7f8d"][row] });\n        }\n      }\n      state.enemyDirection = 1;\n    }\n\n    function restartGame() {\n      state.score = 0;\n      state.lives = 3;\n      state.running = true;\n      state.left = false;\n      state.right = false;\n      state.player.x = 275;\n      state.shots = [];\n      state.enemySpeed = 0.5;\n      makeEnemies();\n      message.textContent = "Defend the bottom of the screen.";\n      updateLabels();\n    }\n\n    function updateLabels() {\n      scoreText.textContent = `Score: ${state.score}`;\n      livesText.textContent = `Lives: ${state.lives}`;\n    }\n\n    function fireShot() {\n      if (!state.running) return;\n      if (state.shots.length >= 3) return;\n      state.shots.push({ x: state.player.x + 22, y: state.player.y - 14, width: 6, height: 14 });\n    }\n\n    function rectanglesTouch(first, second) {\n      const apart = [\n        first.x + first.width < second.x,\n        first.x > second.x + second.width,\n        first.y + first.height < second.y,\n        first.y > second.y + second.height\n      ].some(Boolean);\n      return !apart;\n    }\n\n    function loseLife() {\n      state.lives -= 1;\n      updateLabels();\n      if (state.lives < 1) {\n        state.running = false;\n        message.textContent = "Game over. Select Restart to try again.";\n        return;\n      }\n      message.textContent = "The enemies reached the bottom. One life lost.";\n      state.shots = [];\n      makeEnemies();\n    }\n\n    function update() {\n      if (!state.running) return;\n      if (state.left) state.player.x -= 6;\n      if (state.right) state.player.x += 6;\n      state.player.x = Math.max(0, Math.min(canvas.width - state.player.width, state.player.x));\n      for (const shot of state.shots) shot.y -= 8;\n      state.shots = state.shots.filter(shot => shot.y + shot.height > 0);\n      let changeDirection = false;\n      for (const enemy of state.enemies) {\n        if (!enemy.active) continue;\n        const nextX = enemy.x + state.enemyDirection * state.enemySpeed;\n        if (nextX < 10) changeDirection = true;\n        if (nextX + enemy.width > canvas.width - 10) changeDirection = true;\n      }\n      if (changeDirection) {\n        state.enemyDirection *= -1;\n        for (const enemy of state.enemies) enemy.y += 18;\n      } else {\n        for (const enemy of state.enemies) enemy.x += state.enemyDirection * state.enemySpeed;\n      }\n      for (const shot of state.shots) {\n        for (const enemy of state.enemies) {\n          if (enemy.active && rectanglesTouch(shot, enemy)) {\n            enemy.active = false;\n            shot.y = -100;\n            state.score += 25;\n            state.enemySpeed += 0.025;\n            updateLabels();\n            break;\n          }\n        }\n      }\n      state.shots = state.shots.filter(shot => shot.y > -20);\n      if (state.enemies.every(enemy => !enemy.active)) {\n        state.running = false;\n        message.textContent = "You win! Select Restart to play again.";\n      }\n      const reachedBottom = state.enemies.some(enemy => enemy.active && enemy.y + enemy.height >= state.player.y);\n      if (reachedBottom) loseLife();\n    }\n\n    function drawEnemy(enemy) {\n      ctx.fillStyle = enemy.color;\n      ctx.beginPath();\n      ctx.moveTo(enemy.x + 8, enemy.y);\n      ctx.lineTo(enemy.x + enemy.width - 8, enemy.y);\n      ctx.lineTo(enemy.x + enemy.width, enemy.y + enemy.height / 2);\n      ctx.lineTo(enemy.x + enemy.width - 8, enemy.y + enemy.height);\n      ctx.lineTo(enemy.x + 8, enemy.y + enemy.height);\n      ctx.lineTo(enemy.x, enemy.y + enemy.height / 2);\n      ctx.closePath();\n      ctx.fill();\n    }\n\n    function draw() {\n      ctx.clearRect(0, 0, canvas.width, canvas.height);\n      ctx.fillStyle = "#ffffff";\n      for (let star = 0; star < 24; star += 1) {\n        ctx.fillRect((star * 83) % canvas.width, (star * 47) % 350, 2, 2);\n      }\n      for (const enemy of state.enemies) if (enemy.active) drawEnemy(enemy);\n      ctx.fillStyle = "#ffd166";\n      for (const shot of state.shots) ctx.fillRect(shot.x, shot.y, shot.width, shot.height);\n      const player = state.player;\n      ctx.fillStyle = "#4aa8ff";\n      ctx.beginPath();\n      ctx.moveTo(player.x + player.width / 2, player.y);\n      ctx.lineTo(player.x + player.width, player.y + player.height);\n      ctx.lineTo(player.x, player.y + player.height);\n      ctx.closePath();\n      ctx.fill();\n    }\n\n    function loop() {\n      update();\n      draw();\n      requestAnimationFrame(loop);\n    }\n\n    function setDirection(direction, pressed) {\n      state[direction] = pressed;\n    }\n    document.addEventListener("keydown", event => {\n      if (event.key === "ArrowLeft") setDirection("left", true);\n      if (event.key === "ArrowRight") setDirection("right", true);\n      if (event.code === "Space") { event.preventDefault(); fireShot(); }\n    });\n    document.addEventListener("keyup", event => {\n      if (event.key === "ArrowLeft") setDirection("left", false);\n      if (event.key === "ArrowRight") setDirection("right", false);\n    });\n    for (const direction of ["left", "right"]) {\n      const button = document.querySelector(`#${direction}`);\n      button.addEventListener("pointerdown", () => setDirection(direction, true));\n      button.addEventListener("pointerup", () => setDirection(direction, false));\n      button.addEventListener("pointerleave", () => setDirection(direction, false));\n    }\n    document.querySelector("#fire").addEventListener("click", fireShot);\n    document.querySelector("#restart").addEventListener("click", restartGame);\n    restartGame();\n    loop();\n  <\/script>\n</body>\n</html>\n';

  // assets/ts/e4a-game-demo.ts
  var GAME_DEFINITIONS = Object.fromEntries(
    [
      { id: "guess-number", filename: "guess-number.html", title: "Guess the Number", source: guess_number_default },
      { id: "brick-breaker", filename: "brick-breaker.html", title: "Brick Breaker", source: brick_breaker_default },
      { id: "platform-jumper", filename: "platform-jumper.html", title: "Platform Jumper", source: platform_jumper_default },
      { id: "falling-blocks", filename: "falling-blocks.html", title: "Falling Blocks", source: falling_blocks_default },
      { id: "space-defender", filename: "space-defender.html", title: "Space Defender", source: space_defender_default }
    ].map((definition) => [definition.id, definition])
  );
  function initializeGameDemos(root = document) {
    const demos = Array.from(root.querySelectorAll("[data-e4a-game-demo]"));
    for (const demo of demos) {
      const gameId = demo.dataset.e4aGameId?.trim();
      const definition = gameId ? GAME_DEFINITIONS[gameId] : void 0;
      if (definition) {
        new GameDemo(demo, definition).initialize();
      }
    }
  }
  var GameDemo = class {
    constructor(root, definition) {
      this.root = root;
      this.definition = definition;
    }
    initialize() {
      this.frame = this.root.querySelector("[data-e4a-game-frame]") ?? void 0;
      this.startButton = this.root.querySelector("[data-e4a-game-start]") ?? void 0;
      this.restartButton = this.root.querySelector("[data-e4a-game-restart]") ?? void 0;
      this.status = this.root.querySelector("[data-e4a-game-status]") ?? void 0;
      this.actionStatus = this.root.querySelector("[data-e4a-game-action-status]") ?? void 0;
      const source = this.root.querySelector("[data-e4a-game-source]");
      const copyButton = this.root.querySelector("[data-e4a-game-copy]");
      const downloadButton = this.root.querySelector("[data-e4a-game-download]");
      const editorLink = this.root.querySelector("[data-e4a-game-open-editor]");
      if (!this.frame || !this.startButton || !this.restartButton) {
        return;
      }
      this.frame.title = `Expected result: ${this.definition.title} game`;
      this.frame.hidden = true;
      this.restartButton.disabled = true;
      if (source) {
        source.textContent = this.definition.source;
      }
      if (editorLink) {
        editorLink.href = this.editorUrl();
        editorLink.setAttribute("aria-label", `Open ${this.definition.title} HTML editor in a new tab`);
      }
      this.startButton.addEventListener("click", () => this.start());
      this.restartButton.addEventListener("click", () => this.start());
      copyButton?.addEventListener("click", () => void this.copySource());
      downloadButton?.addEventListener("click", () => this.downloadSource());
      this.root.addEventListener("toggle", () => {
        if (!this.root.open) {
          this.stop();
        }
      });
    }
    editorUrl() {
      return ue({
        appUrl: new URL("livecodes/?disableAI=true", document.baseURI).href,
        config: {
          title: `Lesson 7 - ${this.definition.title} - Student Copy`,
          mode: "full",
          view: "split",
          editor: "codejar",
          layout: "responsive",
          theme: document.documentElement.dataset.bsTheme === "dark" ? "dark" : "light",
          allowLangChange: false,
          activeEditor: "markup",
          languages: ["html"],
          markup: { language: "html", content: this.definition.source },
          style: { language: "css", content: "" },
          script: { language: "javascript", content: "" },
          tools: { enabled: [], status: "closed" },
          autoupdate: false,
          autosave: true,
          formatOnsave: true,
          lineNumbers: true,
          tabSize: 2,
          useTabs: false,
          wordWrap: false,
          recoverUnsaved: false,
          welcome: false
        }
      });
    }
    start() {
      if (!this.frame || !this.startButton || !this.restartButton) {
        return;
      }
      this.stop();
      const blob = new Blob([this.definition.source], { type: "text/html;charset=utf-8" });
      this.blobUrl = URL.createObjectURL(blob);
      this.frame.src = this.blobUrl;
      this.frame.hidden = false;
      this.startButton.disabled = true;
      this.restartButton.disabled = false;
      this.setStatus(`Starting ${this.definition.title}...`);
      this.frame.addEventListener(
        "load",
        () => {
          this.setStatus(`${this.definition.title} is running. Use the controls inside the game.`);
          this.frame?.focus();
        },
        { once: true }
      );
    }
    stop() {
      if (this.blobUrl) {
        URL.revokeObjectURL(this.blobUrl);
        this.blobUrl = void 0;
      }
      if (this.frame) {
        this.frame.removeAttribute("src");
        this.frame.hidden = true;
      }
      if (this.startButton) {
        this.startButton.disabled = false;
      }
      if (this.restartButton) {
        this.restartButton.disabled = true;
      }
      this.setStatus("Game stopped. Select Start game when you are ready.");
    }
    async copySource() {
      try {
        await copyWorkbookText(this.definition.source);
        this.setActionStatus("Lesson HTML copied.");
      } catch {
        this.setActionStatus("Copy failed. Select the code and copy it instead.");
      }
    }
    downloadSource() {
      const blob = new Blob([this.definition.source], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = this.definition.filename;
      anchor.rel = "noopener";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      this.setActionStatus(`Download started: ${this.definition.filename}`);
    }
    setStatus(text) {
      if (this.status) {
        this.status.textContent = text;
      }
    }
    setActionStatus(text) {
      if (this.actionStatus) {
        this.actionStatus.textContent = text;
      }
    }
  };

  // assets/ts/e4a-workbook.ts
  async function initializeWorkbook() {
    initializeTemplateCopyButtons();
    initializeDecisionPollActivities();
    initializeFirstCheckedAnswerActivities();
    initializeSmallChangeActivities();
    initializePromptResultCompareActivities();
    initializeSourceCheckWarmupActivities();
    initializeImageExpanders();
    initializeDataWorkshopActivities();
    initializeGameDemos();
    const blocks = scanWorkbookBlocks();
    if (blocks.length === 0) {
      initializeVocabularyPracticeActivities();
      return;
    }
    const store = await getWorkbookStore(blocks.length > 0);
    const editors = blocks.map((block) => new WorkbookEditor(block, store));
    await Promise.all(editors.map((editor) => editor.initialize()));
    initializeVocabularyPracticeActivities();
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
  function initializeTemplateCopyButtons(root = document) {
    const buttons = Array.from(root.querySelectorAll("[data-e4a-copy-target]"));
    for (const button of buttons) {
      const targetId = button.dataset.e4aCopyTarget?.trim();
      if (!targetId) {
        continue;
      }
      const target = document.getElementById(targetId);
      if (!target) {
        continue;
      }
      const label = button.getAttribute("aria-label") || button.textContent?.trim() || "Copy";
      button.setAttribute("aria-label", label);
      if (!button.title) {
        button.title = label;
      }
      button.addEventListener("click", () => void copyTemplateText(button, target));
    }
  }
  async function copyTemplateText(button, target) {
    const statusId = button.dataset.e4aCopyStatus?.trim();
    const status = statusId ? document.getElementById(statusId) ?? void 0 : void 0;
    try {
      await copyWorkbookText(getCopyableTemplateText(target));
      setText(status, "Copied.");
    } catch {
      setText(status, "Copy failed. Select and copy the text instead.");
    }
  }
  function getCopyableTemplateText(target) {
    if (!target.classList.contains("e4a-readable-copy")) {
      return target.textContent?.trim() || "";
    }
    const lines = Array.from(target.querySelectorAll("p, li")).map((element) => element.textContent?.trim() || "").filter(Boolean);
    return lines.join("\n");
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
