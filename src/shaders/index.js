export async function loadShaderSources() {
  const [vertexSource, fragmentSource] = await Promise.all([
    fetch(new URL("./fullscreen.vert", import.meta.url)).then(assertOkText),
    fetch(new URL("./look.frag", import.meta.url)).then(assertOkText)
  ]);
  return {vertexSource, fragmentSource};
}

async function assertOkText(response) {
  if (!response.ok) throw new Error(`Failed to load shader: ${response.url}`);
  return response.text();
}
