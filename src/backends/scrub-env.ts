// Shared removal of likely secrets from child-process environments, by name and by value (URL
// credentials, sk- keys, JWTs). The patterns catch common forms; they do not prove a retained
// value is public.
import { isString } from "../meta/json-shape.ts";

const SECRET_ENV_KEY =
  /(?:^|_)(?:API_?KEY|APIKEY|TOKEN|AUTH(?:ORIZATION)?|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_?KEY|DATABASE_?URL|SESSION(?:_?COOKIE)?)(?:_|$)/i;
const SECRET_ENV_VALUE =
  /(:\/\/[^/\s:@]+:[^/\s@]+@)|(\bsk-[A-Za-z0-9-]{12,})|(\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/;
/** An environment block with host-supplied names. */
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
