import { startApp } from "./src/app-runtime.js";

startApp().catch(error => {
  console.error(error);
  const errorBox = document.getElementById("error");
  if (errorBox) {
    errorBox.hidden = false;
    errorBox.textContent = `Look failed to start: ${error.message || error}`;
  }
});
