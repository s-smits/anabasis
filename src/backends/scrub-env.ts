// Shared removal of likely secrets from child-process environments.
// Check both names and values: a credential can be stored under an ordinary variable name,
// so the value pattern also removes URL credentials, sk- keys and JWTs.
// These patterns recognise common forms; they do not prove that every retained value is public.
// Callers still decide which environment values the child needs.
import { isString } from "../meta/json-shape.ts";

const SECRET_ENV_KEY =
  /(?:^|_)(?:API_?KEY|APIKEY|TOKEN|AUTH(?:ORIZATION)?|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_?KEY|DATABASE_?URL|SESSION(?:_?COOKIE)?)(?:_|$)/i;
const SECRET_ENV_VALUE =
  /(:\/\/[^/\s:@]+:[^/\s@]+@)|(\bsk-[A-Za-z0-9-]{12,})|(\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/;
/** An environment block. The names come from the host, so the key set cannot be written down; the
 *  value type can, and that is what the callers of these functions actually need to know. */
export interface EnvValues {
  [name: string]: string;
}

/** An environment block as the host hands it over, where a declared name may still hold nothing. */
export interface OptionalEnvValues {
  [name: string]: string | undefined;
}

export function scrubSecretEnv(env: OptionalEnvValues): OptionalEnvValues {
  const scrubbed: OptionalEnvValues = {};
  for (const [key, value] of Object.entries(env)) {
    if (SECRET_ENV_KEY.test(key)) continue;
    if (isString(value) && SECRET_ENV_VALUE.test(value)) continue;
    scrubbed[key] = value;
  }
  return scrubbed;
}
