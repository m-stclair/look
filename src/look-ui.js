import { cloneDefaultConfig } from "./config.js";
import { DEFAULT_LOOK, BUILT_IN_LOOKS } from "./look-presets.js";
import { loadUserLooks, saveUserLooks } from "./look-storage.js";
import {
  configFingerprint,
  createLook,
  lookPayload,
  nextCopyName,
  parseLookJson,
  sanitizeLookName,
  serializeLookConfig,
  slugifyLookName
} from "./look-serialization.js";
import { downloadCubeLut } from "./cube-lut.js";

const UNSAVED_LOOK_ID = "__unsaved__";

export function createLookController({
  elements,
  config,
  applyConfig,
  setStatus,
  setError,
  storage = globalThis.localStorage
}) {
  if (!elements?.select || !elements?.nameInput) {
    return createNoopLookController();
  }

  const state = {
    userLooks: loadUserLooks(storage),
    activeLookId: DEFAULT_LOOK.id,
    activeFingerprint: configFingerprint(config),
    activeName: DEFAULT_LOOK.name
  };

  function allLooks() {
    return [...BUILT_IN_LOOKS, ...state.userLooks];
  }

  function findLook(id = state.activeLookId) {
    return allLooks().find(look => look.id === id) || null;
  }

  function currentName() {
    return sanitizeLookName(elements.nameInput.value, "Untitled Look");
  }

  function currentLookPayload() {
    return {
      name: currentName(),
      config: serializeLookConfig(config)
    };
  }

  function isDirty() {
    return state.activeLookId === UNSAVED_LOOK_ID || currentName() !== state.activeName || configFingerprint(config) !== state.activeFingerprint;
  }

  function applyLook(look) {
    const nextLook = look || DEFAULT_LOOK;
    Object.assign(config, cloneDefaultConfig(), nextLook.config);
    state.activeLookId = nextLook.id;
    state.activeFingerprint = configFingerprint(config);
    state.activeName = nextLook.name;
    elements.nameInput.value = nextLook.name;
    applyConfig(config);
    render();
  }

  function markUnsavedFromCurrent(name = currentName()) {
    state.activeLookId = UNSAVED_LOOK_ID;
    state.activeFingerprint = "";
    state.activeName = sanitizeLookName(name, "Untitled Look");
    elements.nameInput.value = state.activeName;
    render();
  }

  function persist() {
    return saveUserLooks(state.userLooks, storage);
  }

  function saveCurrent() {
    const existing = state.userLooks.find(look => look.id === state.activeLookId);
    const nextLook = createLook({
      id: existing?.id,
      name: currentName(),
      config,
      builtIn: false
    });

    if (existing) {
      state.userLooks = state.userLooks.map(look => look.id === existing.id ? nextLook : look);
    } else {
      state.userLooks = [...state.userLooks, nextLook];
    }

    state.activeLookId = nextLook.id;
    state.activeFingerprint = configFingerprint(config);
    state.activeName = nextLook.name;
    elements.nameInput.value = nextLook.name;
    persist();
    render();
    setError?.(null);
    setStatus?.(`Saved look: ${nextLook.name}.`, "good");
  }

  function duplicateCurrent() {
    const names = allLooks().map(look => look.name);
    const duplicate = createLook({
      name: nextCopyName(currentName(), names),
      config,
      builtIn: false
    });
    state.userLooks = [...state.userLooks, duplicate];
    state.activeLookId = duplicate.id;
    state.activeFingerprint = configFingerprint(config);
    state.activeName = duplicate.name;
    elements.nameInput.value = duplicate.name;
    persist();
    render();
    setError?.(null);
    setStatus?.(`Duplicated look: ${duplicate.name}.`, "good");
  }

  function deleteCurrent() {
    const existing = state.userLooks.find(look => look.id === state.activeLookId);
    if (!existing) return;
    state.userLooks = state.userLooks.filter(look => look.id !== existing.id);
    persist();
    markUnsavedFromCurrent(existing.name);
    setError?.(null);
    setStatus?.(`Deleted saved look: ${existing.name}. Current settings are still on canvas.`, "neutral");
  }

  function exportCurrent() {
    const payload = lookPayload({name: currentName(), config});
    downloadText(`${slugifyLookName(payload.name)}.look.json`, JSON.stringify(payload, null, 2), "application/json");
    setStatus?.(`Exported look JSON: ${payload.name}.`, "good");
  }

  function exportCube() {
    const name = currentName();
    downloadCubeLut({name, config});
    setStatus?.(`Exported 33-point CUBE LUT: ${name}.`, "good");
  }

  async function importFiles(files) {
    const [file] = files || [];
    if (!file) return;
    try {
      const imported = parseLookJson(await file.text()).map(look => createLook({
        name: look.name,
        config: look.config,
        builtIn: false
      }));
      state.userLooks = [...state.userLooks, ...imported];
      persist();
      applyLook(imported[0]);
      setError?.(null);
      setStatus?.(`Imported ${imported.length === 1 ? imported[0].name : `${imported.length} looks`}.`, "good");
    } catch (error) {
      setError?.(error);
      setStatus?.("Look import failed.", "bad");
    } finally {
      if (elements.importInput) elements.importInput.value = "";
    }
  }

  function render() {
    renderSelect(elements.select, BUILT_IN_LOOKS, state.userLooks, state.activeLookId);
    const active = findLook();
    const dirty = isDirty();
    elements.root?.classList.toggle("is-dirty", dirty);
    if (elements.dirtyBadge) {
      elements.dirtyBadge.textContent = dirty ? "Edited" : active?.builtIn ? "Built-in" : active ? "Saved" : "Unsaved";
    }
    if (elements.saveButton) elements.saveButton.textContent = active?.builtIn || state.activeLookId === UNSAVED_LOOK_ID ? "Save" : dirty ? "Save*" : "Save";
    if (elements.deleteButton) elements.deleteButton.disabled = !state.userLooks.some(look => look.id === state.activeLookId);
  }

  elements.select.addEventListener("change", () => {
    const value = elements.select.value;
    if (value === UNSAVED_LOOK_ID) return;
    const look = findLook(value);
    if (!look) return;
    applyLook(look);
    setError?.(null);
    setStatus?.(`Loaded look: ${look.name}.`, "neutral");
  });

  elements.nameInput.addEventListener("input", render);
  elements.saveButton?.addEventListener("click", saveCurrent);
  elements.duplicateButton?.addEventListener("click", duplicateCurrent);
  elements.deleteButton?.addEventListener("click", deleteCurrent);
  elements.exportButton?.addEventListener("click", exportCurrent);
  elements.exportCubeButton?.addEventListener("click", exportCube);
  elements.importInput?.addEventListener("change", () => importFiles(elements.importInput.files));

  render();

  return {
    markConfigChanged() {
      render();
    },
    resetToDefault() {
      applyLook(DEFAULT_LOOK);
      return DEFAULT_LOOK;
    },
    resetActiveLook() {
      const look = findLook() || DEFAULT_LOOK;
      applyLook(look);
      return look;
    },
    getCurrentLook() {
      return currentLookPayload();
    },
    saveCurrent,
    duplicateCurrent,
    deleteCurrent,
    exportCurrent,
    exportCube,
    importFiles
  };
}

function createNoopLookController() {
  return {
    markConfigChanged() {},
    resetToDefault() {},
    getCurrentLook() { return null; }
  };
}

function renderSelect(select, builtIns, userLooks, activeLookId) {
  select.textContent = "";
  if (activeLookId === UNSAVED_LOOK_ID) {
    const unsaved = document.createElement("option");
    unsaved.value = UNSAVED_LOOK_ID;
    unsaved.textContent = "Unsaved Look";
    select.append(unsaved);
  }
  appendOptGroup(select, "Built-in", builtIns);
  if (userLooks.length) appendOptGroup(select, "Saved", userLooks);
  select.value = activeLookId;
}

function appendOptGroup(select, label, looks) {
  const group = document.createElement("optgroup");
  group.label = label;
  for (const look of looks) {
    const option = document.createElement("option");
    option.value = look.id;
    option.textContent = look.name;
    group.append(option);
  }
  select.append(group);
}

function downloadText(filename, text, type = "text/plain") {
  const blob = new Blob([text], {type});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
