import { CONTROL_GROUPS, DEFAULT_CONFIG } from "./config.js";
import { tintCssColor } from "./color-utils.js";

export function buildControls(root, config, onChange, options = {}) {
  root.textContent = "";
  const controlsByKey = new Map();
  const groupNodes = new Map();
  const excludeKeys = new Set(options.excludeKeys || []);

  for (const group of CONTROL_GROUPS) {
    const visibleControls = (group.controls || []).filter(control => !excludeKeys.has(control.key));
    if (!visibleControls.length) continue;
    const fieldset = document.createElement("fieldset");
    fieldset.className = "control-panel";
    fieldset.dataset.group = group.id;

    const legend = document.createElement("legend");
    legend.className = "panel-heading";

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "panel-title";
    toggleButton.textContent = group.label;
    toggleButton.setAttribute("aria-expanded", "true");
    toggleButton.setAttribute("aria-label", `Collapse ${group.label}`);
    legend.append(toggleButton);
    fieldset.append(legend);

    const panelBody = document.createElement("div");
    panelBody.className = "panel-body";
    panelBody.id = `control-panel-${group.id}`;
    toggleButton.setAttribute("aria-controls", panelBody.id);

    toggleButton.addEventListener("click", () => {
      const expanded = !fieldset.classList.toggle("is-collapsed");
      toggleButton.setAttribute("aria-expanded", expanded ? "true" : "false");
      toggleButton.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${group.label}`);
    });

    const header = document.createElement("div");
    header.className = "group-header";

    const resetGroupButton = document.createElement("button");
    resetGroupButton.type = "button";
    resetGroupButton.className = "mini-button";
    resetGroupButton.textContent = "Reset";
    resetGroupButton.setAttribute("aria-label", `Reset ${group.label}`);
    resetGroupButton.addEventListener("click", () => {
      for (const control of visibleControls) config[control.key] = DEFAULT_CONFIG[control.key];
      sync(config);
      onChange(config);
    });

    header.append(resetGroupButton);
    panelBody.append(header);

    for (const control of visibleControls) {
      const row = createControlRow(control, config, nextValue => {
        config[control.key] = nextValue;
        sync(config);
        onChange(config);
      });
      panelBody.append(row.wrapper);
      controlsByKey.set(control.key, row);
    }

    fieldset.append(panelBody);
    root.append(fieldset);
    groupNodes.set(group.id, fieldset);
  }

  sync(config);

  return {
    sync,
    groups: groupNodes
  };

  function sync(nextConfig) {
    for (const [key, control] of controlsByKey) {
      const nextValue = sanitizeValue(nextConfig[key], control.definition);
      control.range.value = String(nextValue);
      control.number.value = formatNumber(nextValue, control.definition.step);
      control.value.textContent = `${formatNumber(nextValue, control.definition.step)}${control.definition.suffix || ""}`;
      control.wrapper.classList.toggle("is-default", nextValue === DEFAULT_CONFIG[key]);
      control.wrapper.classList.toggle("is-tint-hue", key === "tintHue");
      if (key === "tintHue") control.swatch.style.background = tintCssColor(nextValue);
    }
  }
}

export function setStatus(element, message, tone = "neutral") {
  if (!element) return;
  element.textContent = message;
  element.dataset.tone = tone;
}

export function setError(element, error) {
  if (!element) return;
  if (!error) {
    element.hidden = true;
    element.textContent = "";
    return;
  }
  element.hidden = false;
  element.textContent = error.message || String(error);
}

function createControlRow(definition, config, onChange) {
  const wrapper = document.createElement("label");
  wrapper.className = "control";

  const header = document.createElement("span");
  header.className = "control-row";

  const name = document.createElement("span");
  name.textContent = definition.label;

  const valueWrap = document.createElement("span");
  valueWrap.className = "control-value-wrap";

  const swatch = document.createElement("span");
  swatch.className = "swatch";
  swatch.setAttribute("aria-hidden", "true");

  const value = document.createElement("span");
  value.className = "value";

  valueWrap.append(swatch, value);
  header.append(name, valueWrap);

  const inputRow = document.createElement("span");
  inputRow.className = "input-row";

  const range = document.createElement("input");
  range.type = "range";
  range.min = String(definition.min);
  range.max = String(definition.max);
  range.step = String(definition.step);
  range.value = String(config[definition.key]);
  range.dataset.key = definition.key;

  const number = document.createElement("input");
  number.type = "number";
  number.min = String(definition.min);
  number.max = String(definition.max);
  number.step = String(definition.step);
  number.value = String(config[definition.key]);
  number.dataset.key = definition.key;
  number.setAttribute("aria-label", `${definition.label} value`);

  range.addEventListener("input", () => onChange(range.valueAsNumber));
  number.addEventListener("input", () => {
    if (number.value === "") return;
    onChange(sanitizeValue(number.valueAsNumber, definition));
  });
  number.addEventListener("blur", () => onChange(sanitizeValue(number.valueAsNumber, definition)));

  inputRow.append(range, number);
  wrapper.append(header, inputRow);

  return {wrapper, range, number, value, swatch, definition};
}

function sanitizeValue(value, definition) {
  if (!Number.isFinite(value)) return DEFAULT_CONFIG[definition.key];
  return Math.min(definition.max, Math.max(definition.min, value));
}

function formatNumber(value, step) {
  const decimals = String(step).includes(".") ? String(step).split(".")[1].length : 0;
  return Number(value).toFixed(Math.min(decimals, 3));
}
