export function loadImageFile(file) {
  if (!file) return Promise.reject(new Error("No image file selected."));
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load image: ${file.name}`));
    };
    image.src = url;
  });
}

export function createDemoImage(width = 960, height = 540) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#151827");
  gradient.addColorStop(0.35, "#375f83");
  gradient.addColorStop(0.68, "#bd7851");
  gradient.addColorStop(1, "#f5d76e");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const vignette = ctx.createRadialGradient(width * 0.52, height * 0.45, 40, width * 0.52, height * 0.45, width * 0.68);
  vignette.addColorStop(0, "rgba(255,255,255,0.2)");
  vignette.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.font = "700 48px system-ui, sans-serif";
  ctx.fillText("Look", 48, 82);
  ctx.font = "24px system-ui, sans-serif";
  ctx.fillText("Open an image to grade it.", 50, 122);

  return canvas;
}
