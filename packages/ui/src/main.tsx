import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
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
import "./campaign.css";
import "./panes.css";

/*
 * A reload comes back where it was scrolled. The browser restores the position as the document
 * loads, before the panes have drawn their rows, so on 31 October a reload put the Log pane back at
 * its top (operator). The page keeps the position as it is left, and scrolls back to it once the
 * document is tall enough, for at most two seconds. The browser's own restoring stays on, since a
 * step back inside the page (a detail's "Back to moves") is restored by it alone.
 */
const SCROLLED = "ana.scroll";
try {
  const [search, y] = (window.sessionStorage.getItem(SCROLLED) ?? "").split("\n");
  const until = performance.now() + 2_000;
  const back = () => {
    if (
      document.scrollingElement !== null &&
      document.scrollingElement.scrollHeight >= Number(y) + innerHeight
    ) {
      window.scrollTo(0, Number(y));
    } else if (performance.now() < until) requestAnimationFrame(back);
  };
  if (search === window.location.search && Number(y) > 0) requestAnimationFrame(back);
  window.addEventListener("pagehide", () =>
    window.sessionStorage.setItem(SCROLLED, `${window.location.search}\n${String(window.scrollY)}`),
  );
} catch {
  // Closed storage keeps no position, and the page opens at its top.
}

const root = document.getElementById("root");
if (root === null) throw new Error("observatory root element is missing");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
