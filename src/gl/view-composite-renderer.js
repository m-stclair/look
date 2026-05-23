export const VIEW_COMPOSITE_UNIFORM_NAMES = Object.freeze([
  "u_image",
  "u_source",
  "u_resolution",
  "u_viewportOrigin",
  "u_viewCenter",
  "u_viewSpan",
  "u_compareSplit",
  "u_compareEnabled"
]);

// Final viewport pass used for before/after compare. It mirrors the
// palette-synth composite shape: source-resolution processed texture in,
// transformed viewport preview out, with the compare split handled here.
export function renderViewComposite(gl, program, uniforms, {
  processedTexture,
  sourceTexture,
  viewport,
  resolution,
  viewportOrigin,
  viewCenter,
  viewSpan,
  compareSplit,
  compareEnabled
}) {
  gl.useProgram(program);
  gl.viewport(viewport.x, viewport.y, viewport.w, viewport.h);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, processedTexture);
  gl.uniform1i(uniforms.u_image, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, sourceTexture || processedTexture);
  gl.uniform1i(uniforms.u_source, 1);

  gl.uniform2f(uniforms.u_resolution, resolution[0], resolution[1]);
  gl.uniform2f(uniforms.u_viewportOrigin, viewportOrigin[0], viewportOrigin[1]);
  gl.uniform2f(uniforms.u_viewCenter, viewCenter[0], viewCenter[1]);
  gl.uniform2f(uniforms.u_viewSpan, viewSpan[0], viewSpan[1]);
  gl.uniform1f(uniforms.u_compareSplit, Number.isFinite(compareSplit) ? compareSplit : -1);
  gl.uniform1i(uniforms.u_compareEnabled, compareEnabled ? 1 : 0);

  gl.drawArrays(gl.TRIANGLES, 0, 3);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(gl.TEXTURE0);
}
