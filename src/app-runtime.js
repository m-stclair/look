import { compareSplitFromClientX, clientNearCompareSplit } from "./compare-split.js";
import { cloneDefaultConfig } from "./config.js";
import { createDemoImage, loadImageFile } from "./image.js";
import { createLookRenderer } from "./renderer.js";
import { loadShaderSources } from "./shaders/index.js";
import { buildControls, setError, setStatus } from "./ui.js";

export async function startApp() {
  const canvas = mustFind("preview");
  const imageInput = mustFind("imageInput");
  const resetButton = mustFind("resetButton");
  const exportButton = mustFind("exportButton");
  const controlsRoot = mustFind("controls");
  const status = mustFind("status");
  const error = mustFind("error");
  const zoomOutButton = document.getElementById("zoomOutButton");
  const zoomInButton = document.getElementById("zoomInButton");
  const viewStatus = document.getElementById("viewStatus");
  const compareToggle = document.getElementById("compareToggle");
  const compareSplit = document.getElementById("compareSplit");
  const compareSplitValue = document.getElementById("compareSplitValue");
  const workbench = document.getElementById("workbench");
  const toolPaneToggle = document.getElementById("toolPaneToggle");

  if (workbench && toolPaneToggle) {
    toolPaneToggle.addEventListener("click", () => {
      const expanded = workbench.classList.toggle("is-tools-collapsed") === false;
      toolPaneToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      toolPaneToggle.setAttribute("aria-label", expanded ? "Collapse tools" : "Expand tools");
    });
  }

  const shaderSources = await loadShaderSources();
  const renderer = createLookRenderer(canvas, shaderSources);
  const config = cloneDefaultConfig();
  const controls = buildControls(controlsRoot, config, nextConfig => renderer.setConfig(nextConfig));
  const compareControls = bindCompareControls({
    canvas,
    renderer,
    compareToggle,
    compareSplit,
    compareSplitValue
  });
  const syncViewUi = () => {
    const view = renderer.getView();
    if (viewStatus) viewStatus.textContent = `${Math.round(view.zoom * 100)}%`;
    if (zoomOutButton) zoomOutButton.disabled = view.zoom <= 1.001;
  };

  bindViewportInteractions(canvas, renderer, syncViewUi, compareControls);
  bindViewButtons({canvas, renderer, zoomOutButton, zoomInButton, syncViewUi});

  if (typeof ResizeObserver !== "undefined") {
    const resizeObserver = new ResizeObserver(() => {
      renderer.resizeToDisplay();
      syncViewUi();
    });
    resizeObserver.observe(canvas);
  } else {
    window.addEventListener("resize", () => {
      renderer.resizeToDisplay();
      syncViewUi();
    });
  }

  const demo = createDemoImage();
  renderer.loadImage(demo);
  renderer.setConfig(config);
  syncViewUi();
  compareControls.sync();
  setStatus(status, imageSummary("Demo image", demo), "neutral");

  imageInput.addEventListener("change", async () => {
    const [file] = imageInput.files || [];
    if (!file) return;
    try {
      const image = await loadImageFile(file);
      renderer.loadImage(image);
      syncViewUi();
      setError(error, null);
      setStatus(status, imageSummary(file.name, image), "good");
    } catch (loadError) {
      setError(error, loadError);
      setStatus(status, "Image load failed.", "bad");
    }
  });

  resetButton.addEventListener("click", () => {
    Object.assign(config, cloneDefaultConfig());
    controls.sync(config);
    renderer.setConfig(config);
    setStatus(status, "Reset all controls to Vandal Look defaults.", "neutral");
  });

  exportButton.addEventListener("click", async () => {
    try {
      await renderer.exportPng("look.png");
      setError(error, null);
      setStatus(status, "Exported PNG.", "good");
    } catch (exportError) {
      console.error(exportError);
      setError(error, exportError);
      setStatus(status, "PNG export failed.", "bad");
    }
  });

  return {renderer, config, controls, compareControls};
}

function bindCompareControls({canvas, renderer, compareToggle, compareSplit, compareSplitValue}) {
  function sync() {
    const compare = renderer.getCompare();
    if (compareToggle) compareToggle.checked = compare.enabled;
    if (compareSplit) {
      compareSplit.value = String(Math.round(compare.split * 100));
      compareSplit.disabled = !compare.enabled;
      compareSplit.closest?.(".compare-control")?.classList.toggle("is-disabled", !compare.enabled);
    }
    if (compareSplitValue) compareSplitValue.textContent = `${Math.round(compare.split * 100)}%`;
    canvas.classList.toggle("is-comparing", compare.enabled);
    if (!compare.enabled) canvas.classList.remove("is-near-split", "is-splitting");
  }

  function setCompareEnabled(enabled) {
    renderer.setCompareEnabled(enabled);
    sync();
  }

  function setCompareSplit(value) {
    renderer.setCompareSplit(value);
    sync();
  }

  function setCompareSplitFromClientX(clientX) {
    setCompareSplit(compareSplitFromClientX(clientX, renderer.getDisplayViewRect()));
  }

  function isNearCompareSplit(clientX, clientY) {
    const compare = renderer.getCompare();
    return clientNearCompareSplit({
      clientX,
      clientY,
      rect: renderer.getDisplayViewRect(),
      split: compare.split,
      enabled: compare.enabled
    });
  }

  function updateNearClass(clientX, clientY) {
    canvas.classList.toggle("is-near-split", isNearCompareSplit(clientX, clientY));
  }

  compareToggle?.addEventListener("change", () => setCompareEnabled(compareToggle.checked));
  compareSplit?.addEventListener("input", () => setCompareSplit(compareSplit.valueAsNumber / 100));
  sync();

  return {
    sync,
    setCompareSplitFromClientX,
    isNearCompareSplit,
    updateNearClass
  };
}

function bindViewButtons({canvas, renderer, zoomOutButton, zoomInButton, syncViewUi}) {
  zoomOutButton?.addEventListener("click", () => {
    const rect = renderer.getDisplayViewRect();
    renderer.zoomBy(220, rect.left + rect.width / 2, rect.top + rect.height / 2);
    syncViewUi();
  });

  zoomInButton?.addEventListener("click", () => {
    const rect = renderer.getDisplayViewRect();
    renderer.zoomBy(-220, rect.left + rect.width / 2, rect.top + rect.height / 2);
    syncViewUi();
  });

  canvas.addEventListener("dblclick", event => {
    event.preventDefault();
    renderer.resetView();
    syncViewUi();
  });
}

function bindViewportInteractions(canvas, renderer, syncViewUi, compareControls) {
  const drag = {mode: null, pointerId: null, lastClientX: 0, lastClientY: 0};

  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    renderer.zoomBy(event.deltaY, event.clientX, event.clientY);
    compareControls?.updateNearClass(event.clientX, event.clientY);
    syncViewUi();
  }, {passive: false});

  canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    drag.pointerId = event.pointerId;
    drag.lastClientX = event.clientX;
    drag.lastClientY = event.clientY;
    canvas.setPointerCapture?.(event.pointerId);

    if (compareControls?.isNearCompareSplit(event.clientX, event.clientY)) {
      event.preventDefault();
      drag.mode = "split";
      canvas.classList.add("is-splitting");
      compareControls.setCompareSplitFromClientX(event.clientX);
      return;
    }

    drag.mode = "pan";
    canvas.classList.add("is-panning");
  });

  canvas.addEventListener("pointermove", event => {
    if (drag.pointerId !== event.pointerId) {
      compareControls?.updateNearClass(event.clientX, event.clientY);
      return;
    }

    if (drag.mode === "split") {
      compareControls.setCompareSplitFromClientX(event.clientX);
      return;
    }

    if (drag.mode !== "pan") return;
    const dx = event.clientX - drag.lastClientX;
    const dy = event.clientY - drag.lastClientY;
    drag.lastClientX = event.clientX;
    drag.lastClientY = event.clientY;
    renderer.panByClientDelta(dx, dy);
    compareControls?.updateNearClass(event.clientX, event.clientY);
    syncViewUi();
  });

  const stopDrag = event => {
    if (event && drag.pointerId !== null && event.pointerId !== drag.pointerId) return;
    drag.pointerId = null;
    drag.mode = null;
    canvas.classList.remove("is-panning", "is-splitting");
    if (event) compareControls?.updateNearClass(event.clientX, event.clientY);
  };

  canvas.addEventListener("pointerup", stopDrag);
  canvas.addEventListener("pointercancel", stopDrag);
  canvas.addEventListener("lostpointercapture", stopDrag);
  canvas.addEventListener("pointerleave", () => {
    if (drag.pointerId === null) canvas.classList.remove("is-near-split");
  });
}

function imageSummary(name, source) {
  const width = source.naturalWidth || source.width;
  const height = source.naturalHeight || source.height;
  return `${name} · ${width} × ${height}`;
}

function mustFind(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element;
}
