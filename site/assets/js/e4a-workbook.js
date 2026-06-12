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

  // assets/ts/e4a-small-change-activity.ts
  var smallChangeQuestions = [
    {
      question: "Which sentence means the person likes dogs as animals?",
      options: ["I like dogs.", "I like dog."],
      correctAnswerIndex: 0,
      imagePath: "assets/images/lesson-02/01-dogs.png",
      imageAlt: "A split-screen image showing liking dogs as animals versus a funny food misunderstanding.",
      correctFeedback: 'Correct. "Dogs" means dogs in general.',
      wrongFeedback: 'Not quite. "Dog" can sound like a type of food or meat.'
    },
    {
      question: "Which sentence means Grandma is invited to eat?",
      options: ["Let's eat, Grandma.", "Let's eat Grandma."],
      correctAnswerIndex: 0,
      imagePath: "assets/images/lesson-02/02-grandma.png",
      imageAlt: "A split-screen image showing Grandma joining dinner versus a silly comma misunderstanding.",
      correctFeedback: "Correct. The comma shows Grandma is the person you are speaking to.",
      wrongFeedback: "Not quite. Without the comma, it sounds like Grandma is the food."
    },
    {
      question: "Which sentence means the person has some friends?",
      options: ["I have a few friends.", "I have few friends."],
      correctAnswerIndex: 0,
      imagePath: "assets/images/lesson-02/03-friends.png",
      imageAlt: "A split-screen image showing a person with several friends versus a person almost alone.",
      correctFeedback: 'Correct. "A few" means some.',
      wrongFeedback: 'Not quite. "Few" means almost none.'
    },
    {
      question: 'In the sentence "I saw her duck," which meaning is an action?',
      options: ["I saw the woman move down quickly.", "I saw the duck that belongs to her."],
      correctAnswerIndex: 0,
      imagePath: "assets/images/lesson-02/04-duck.png",
      imageAlt: "A split-screen image showing duck as an action and duck as an animal.",
      correctFeedback: 'Correct. "Duck" can be a verb meaning move down quickly.',
      wrongFeedback: 'Not quite. That meaning uses "duck" as a noun: the animal.'
    },
    {
      question: 'Which sentence means "She is quite smart"?',
      options: ["She is pretty smart.", "She is pretty, smart."],
      correctAnswerIndex: 0,
      imagePath: "assets/images/lesson-02/05-pretty-smart.png",
      imageAlt: "A split-screen image showing quite smart versus beautiful and smart.",
      correctFeedback: 'Correct. "Pretty smart" means quite smart.',
      wrongFeedback: 'Not quite. With a comma, "pretty" means beautiful.'
    },
    {
      question: "Which prompt gives the AI clearer instructions?",
      options: ["Write about New York.", "Write a 5-sentence paragraph about New York for beginner English students."],
      correctAnswerIndex: 1,
      imagePath: "assets/images/lesson-02/06-clear-prompt.png",
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
      imageAlt: "A split-screen image showing an AI editing and damaging a document versus analyzing it safely in read-only mode.",
      correctFeedback: "Correct. The second prompt gives a clear limit: the AI can analyze, but it cannot change the document.",
      wrongFeedback: 'Not quite. The first prompt does not say "read-only," so the AI may start editing the document instead of only analyzing it.'
    },
    {
      question: "Which prompt asks for a clear format?",
      options: ["Explain commas.", "Explain commas in a table with 3 columns: sentence, meaning, and warning."],
      correctAnswerIndex: 1,
      imagePath: "assets/images/lesson-02/08-format.png.png",
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
            <img data-e4a-small-change-image alt="">
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
      if (!progressText || !progressBar || !questionPanel || !questionText || optionButtons.length !== 2 || !feedback || !feedbackStatus || !feedbackText || !figure || !image || !previousButton || !retryButton || !nextButton || !quizView || !finalView || !scoreText || !presentButton || !exitButton || !restartButton) {
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
      this.elements.image.src = question.imagePath;
      this.elements.image.alt = question.imageAlt;
      this.elements.figure.hidden = false;
      this.elements.retryButton.hidden = false;
      this.elements.nextButton.hidden = false;
      this.elements.progressBar.style.width = `${(this.currentQuestionIndex + 1) / smallChangeQuestions.length * 100}%`;
      focusWithoutScrolling(this.elements.nextButton);
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
      focusWithoutScrolling(this.elements.restartButton);
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
      focusWithoutScrolling(this.elements.questionText);
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
      document.body.classList.remove("e4a-small-change-presenting");
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
    const image = document.createElement("img");
    image.src = src;
    image.alt = alt;
    image.decoding = "async";
    figure.append(image);
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
    document.body.classList.add("e4a-image-expand-open");
    document.body.append(overlay);
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

  // assets/ts/e4a-workbook.ts
  async function initializeWorkbook() {
    initializeTemplateCopyButtons();
    initializeSmallChangeActivities();
    initializePromptResultCompareActivities();
    initializeImageExpanders();
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
      await copyWorkbookText(target.textContent?.trim() || "");
      setText(status, "Copied.");
    } catch {
      setText(status, "Copy failed. Select and copy the text instead.");
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
