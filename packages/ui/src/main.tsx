import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useCampaign, useCampaigns } from "./live.ts";
import { useRoute } from "./route.ts";
import { selectionOf, Shell } from "./shell.tsx";
/*
 * The design's four fonts (all OFL), bundled from @fontsource so the page makes no network request at
 * view time and renders the same on every machine, which a pixel comparison needs.
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
 * A reload comes back where it was scrolled: the browser restores the position before the panes have
 * drawn their rows, so the page keeps it as left and scrolls back once the document is tall enough, for
 * at most two seconds. The browser's own restoring stays on for steps back inside the page.
 */
const SCROLLED = "ana.scroll";
try {
  const [search, y] = (window.sessionStorage.getItem(SCROLLED) ?? "").split("\n");
  const until = performance.now() + 2000;
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

function App() {
  const navigation = useRoute();
  const campaigns = useCampaigns();
  const { campaign: key } = selectionOf(campaigns.data, navigation.route);
  const reading = useCampaign(key);
  return <Shell navigation={navigation} campaigns={campaigns} reading={reading} />;
}

const root = document.querySelector("#root");
if (root === null) throw new Error("observatory root element is missing");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
