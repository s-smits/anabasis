import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
/*
 * Bundle the four fonts the design uses.
 *
 * The stylesheet already named Electrolize, Newsreader, Manrope and Space Grotesk. Nothing loaded
 * them: there was no @font-face, no link, no asset, so on any machine without them installed the
 * page silently fell back to system-ui and Georgia instead of the intended fonts.
 * These are the same four faces, all OFL, bundled from @fontsource so the page is
 * self-contained: no network request at view time, which an evidence page opened from a local
 * file or an air-gapped host needs, and a fixed set of resolved assets, which is what makes a
 * pixel comparison mean anything.
 */
import "@fontsource/electrolize/400.css";
import "@fontsource-variable/manrope";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/newsreader/wght-italic.css";
import "@fontsource-variable/space-grotesk";
import "./styles.css";
import "./observatory.css";

const root = document.getElementById("root");
if (root === null) throw new Error("observatory root element is missing");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
