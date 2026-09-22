import { hasText } from "../../meta/text.ts";
const ANABASIS_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M16 2 4 30h4.8l2.6-6.4h9.2L23.2 30H28L16 2Zm-2.9 17.2L16 12l2.9 7.2h-5.8Z"/></svg>`;

const PAGE_CSS = `
    :root {
      --text: #ffffff;
      --text-dim: #a1a1aa;
      --page-bg: #000000;
      --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
    * { box-sizing: border-box; }
    html { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: var(--page-bg);
      color: var(--text);
      font-family: var(--font-sans);
      text-align: center;
    }
    main {
      width: 100%;
      max-width: 560px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .logo {
      width: 72px;
      height: 72px;
      display: block;
      margin-bottom: 28px;
      color: var(--text);
    }
    .logo svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 28px;
      line-height: 1.15;
      font-weight: 650;
      color: var(--text);
    }
    p {
      margin: 0;
      line-height: 1.7;
      color: var(--text-dim);
      font-size: 15px;
    }
    .details {
      margin-top: 16px;
      font-family: var(--font-mono);
      font-size: 13px;
      color: var(--text-dim);
      white-space: pre-wrap;
      word-break: break-word;
    }
`;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderPage(options: {
  title: string;
  heading: string;
  message: string;
  details?: string | undefined;
}): string {
  const title = escapeHtml(options.title);
  const heading = escapeHtml(options.heading);
  const message = escapeHtml(options.message);
  const details = hasText(options.details) ? escapeHtml(options.details) : undefined;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${PAGE_CSS}</style>
</head>
<body>
  <main>
    <div class="logo" aria-label="Anabasis">${ANABASIS_MARK_SVG}</div>
    <h1>${heading}</h1>
    <p>${message}</p>
    ${hasText(details) ? `<div class="details">${details}</div>` : ""}
  </main>
</body>
</html>`;
}

/** Return callback HTML with an explicit charset header. */
export function oauthHtmlResponse(status: number, html: string): Response {
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export function oauthSuccessHtml(message: string): string {
  return renderPage({
    title: "Anabasis authentication successful",
    heading: "Authentication successful",
    message,
  });
}

export function oauthErrorHtml(message: string, details?: string): string {
  return renderPage({
    title: "Anabasis authentication failed",
    heading: "Authentication failed",
    message,
    details,
  });
}
