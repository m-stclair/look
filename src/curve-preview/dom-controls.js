export function createDockRange(label, key, min, max, step, options = {}) {
  const wrapper = document.createElement("label");
  wrapper.className = "tone-dock-range";
  wrapper.setAttribute("data-key", key);
  if (options.showLabel === false) wrapper.classList.add("is-label-hidden");

  const name = document.createElement("span");
  name.className = "tone-dock-label";
  name.textContent = label;

  const value = document.createElement("span");
  value.className = "tone-dock-value";

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.setAttribute("aria-label", label);

  wrapper.append(name, input, value);
  return {wrapper, input, value, key};
}
