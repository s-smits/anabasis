/**
 * The half of an authorization-code login both providers share: one local callback server, a
 * manual paste fallback for headless hosts, and the race between them. The provider modules keep
 * only their endpoints, client ids and token shapes.
 */
import { oauthErrorHtml, oauthHtmlResponse, oauthSuccessHtml } from "./oauth-page.ts";
import { parseAuthorizationInput } from "./paste-input.ts";
import type { OAuthAuthInfo, OAuthPrompt } from "./types.ts";
import { asError } from "../../meta/runtime-values.ts";
import { hasText, textOr } from "../../meta/text.ts";

const CALLBACK_HOST = textOr(Bun.env.ANA_OAUTH_CALLBACK_HOST, "127.0.0.1");

export type OAuthLoginOptions = {
  onAuth: (info: OAuthAuthInfo) => void;
  onPrompt: (prompt: OAuthPrompt) => Promise<string>;
  onProgress?: (message: string) => void;
  onManualCodeInput?: () => Promise<string>;
  /** Called when the browser callback wins, to release the manual stdin reader. */
  onManualCodeCancel?: () => void;
};

type Callback = { code: string; state: string };

type CallbackServer = {
  close: () => void | Promise<void>;
  cancelWait: () => void;
  waitForCode: () => Promise<Callback | null>;
};

type CallbackRoute = {
  port: number;
  path: string;
  /** The state the authorization URL carried; any other state is refused. */
  state: string;
  /** Provider name for the browser page ("Claude", "ChatGPT"). */
  provider: string;
};

/** Open the callback server on its fixed port. A taken port leaves the login to the manual paste
 *  fallback, so a second login session cannot break the first. */
export function startCallbackServer(route: CallbackRoute): CallbackServer {
  let settleWait: ((value: Callback | null) => void) | undefined;
  const waitForCodePromise = new Promise<Callback | null>((resolveWait) => {
    let settled = false;
    settleWait = (value) => {
      if (settled) return;
      settled = true;
      resolveWait(value);
    };
  });

  let bound: ReturnType<typeof Bun.serve> | undefined;
  try {
    bound = Bun.serve({
      port: route.port,
      hostname: CALLBACK_HOST,
      fetch(req) {
        const callbackUrl = new URL(req.url);
        if (callbackUrl.pathname !== route.path) {
          return oauthHtmlResponse(404, oauthErrorHtml("Callback route not found."));
        }
        const error = callbackUrl.searchParams.get("error");
        if (hasText(error)) {
          return oauthHtmlResponse(
            400,
            oauthErrorHtml(`${route.provider} authentication did not complete.`, `Error: ${error}`),
          );
        }
        const code = callbackUrl.searchParams.get("code");
        const state = callbackUrl.searchParams.get("state");
        if (!hasText(code) || !hasText(state)) {
          return oauthHtmlResponse(400, oauthErrorHtml("Missing code or state parameter."));
        }
        if (state !== route.state) return oauthHtmlResponse(400, oauthErrorHtml("State mismatch."));
        settleWait?.({ code, state });
        return oauthHtmlResponse(
          200,
          oauthSuccessHtml(`${route.provider} authentication completed. You can close this window.`),
        );
      },
    });
  } catch {
    settleWait?.(null);
    return { close: () => {}, cancelWait: () => {}, waitForCode: async () => null };
  }

  return {
    close: () => bound?.stop(true),
    cancelWait: () => settleWait?.(null),
    waitForCode: () => waitForCodePromise,
  };
}

/** Code from a pasted value; throws when its state disagrees with the flow that issued the URL. */
function codeFromPasted(value: string, expectedState: string): string | undefined {
  const parsed = parseAuthorizationInput(value);
  if (hasText(parsed.state) && parsed.state !== expectedState) throw new Error("OAuth state mismatch");
  return parsed.code;
}

/**
 * Race the browser callback against a manual paste promise, then fall back to the prompt.
 * Settlement order: callback wins, then the manual input that cancelled it, then a fresh prompt.
 */
export async function resolveAuthorizationCode(
  server: CallbackServer,
  options: OAuthLoginOptions,
  expectedState: string,
  prompt: OAuthPrompt,
): Promise<Callback> {
  let code: string | undefined;
  let state: string | undefined;

  if (options.onManualCodeInput) {
    let manualInput: string | undefined;
    let manualError: Error | undefined;
    const manualPromise = options
      .onManualCodeInput()
      .then((input) => {
        manualInput = input;
        server.cancelWait();
      })
      .catch((error: unknown) => {
        manualError = asError(error);
        server.cancelWait();
      });
    // A closure read keeps `manualError`'s declared type; the checker cannot see the callback assign it.
    const throwManualFailure = (): void => {
      if (manualError !== undefined) throw manualError;
    };

    const result = await server.waitForCode();
    throwManualFailure();
    if (hasText(result?.code)) {
      // Release the manual reader without awaiting it: an embedded manual source may never resolve.
      options.onManualCodeCancel?.();
      code = result.code;
      state = result.state;
    } else if (hasText(manualInput)) code = codeFromPasted(manualInput, expectedState);

    if (!hasText(code)) {
      await manualPromise;
      throwManualFailure();
      if (hasText(manualInput)) code = codeFromPasted(manualInput, expectedState);
    }
  } else {
    const result = await server.waitForCode();
    code = result?.code;
    state = result?.state;
  }

  if (!hasText(code)) code = codeFromPasted(await options.onPrompt(prompt), expectedState);
  if (!hasText(code)) throw new Error("Missing authorization code");
  return { code, state: state ?? expectedState };
}
