/** Conformance-only direct access tracing inside the confined generated-tool worker. */
import type { PublicTask } from "../truth/task-split.ts";
import { isBoolean, isNumber, isObject, isString, type JsonValue } from "../meta/json-shape.ts";
import { capturedIsProxy } from "../meta/json-runtime.ts";

export interface GeneratedTaskAccess {
  /** Public-input paths in first-read order, distinct within each snapshot segment — repeated
   *  reads of one path (a loop over a large array) add one entry per tool call, not one per read. */
  events: string[];
  /** Diagnostic count only: enumeration of public data is permitted. */
  opaqueCopies: number;
  truncated: boolean;
}

const ARRAY_INDEX = /^(0|[1-9][0-9]*)$/;
const META_PROPERTIES = new Set(["__proto__", "constructor", "then", "toJSON"]);
export const TASK_ACCESS_EVENT_LIMIT = 4_096;

interface TracePublicTaskResult {
  task: PublicTask<unknown>;
  snapshot: () => GeneratedTaskAccess | undefined;
  materialize: (value: unknown) => JsonValue;
}

/** A plain object's prototype is `Object.prototype` or null; an array's is `Array.prototype`. */
function isPlainPrototype(prototype: unknown, array: boolean): boolean {
  return prototype === null || prototype === (array ? Array.prototype : Object.prototype);
}

/** Remove only our instrumentation proxies. Descriptor reads avoid invoking generated getters;
 *  unknown proxies, executable values and cycles remain invalid transport data. */
function materializeTaskData(
  value: unknown,
  targets: WeakMap<object, object>,
  seen = new Set<object>(),
): JsonValue {
  if (value === null || isString(value) || isBoolean(value)) return value;
  // A non-finite number becomes null, as JSON.stringify would write it, rather than failing the call.
  if (isNumber(value)) return Number.isFinite(value) ? value : null;
  if (!isObject(value)) throw new Error("generated tool result must be plain finite JSON");
  const target = targets.get(value) ?? value;
  if (capturedIsProxy(target) || seen.has(target)) {
    throw new Error("generated tool result contains a proxy or cycle");
  }
  const array = Array.isArray(target);
  const prototype: unknown = Object.getPrototypeOf(target);
  if (!isPlainPrototype(prototype, array)) throw new Error("generated tool result must be plain finite JSON");
  seen.add(target);
  const entries: [string, JsonValue][] = [];
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(target))) {
    if (descriptor.enumerable !== true) continue;
    if (!("value" in descriptor)) throw new Error("generated tool result contains an accessor");
    // JSON omits absent optional object fields; array holes and executable data still refuse.
    if (!array && descriptor.value === undefined) continue;
    entries.push([key, materializeTaskData(descriptor.value, targets, seen)]);
  }
  seen.delete(target);
  if (!array) return Object.fromEntries(entries);
  if (entries.length !== target.length || entries.some(([key], index) => key !== String(index))) {
    throw new Error("generated tool result contains a sparse or extended array");
  }
  return entries.map(([, item]) => item);
}

export function tracePublicTask(
  task: PublicTask<unknown>,
  trace: "traced" | "untraced",
): TracePublicTaskResult {
  const events: string[] = [];
  let segment = new Set<string>();
  let opaqueCopies = 0;
  let truncated = false;
  const proxies = new WeakMap<object, object>();
  const targets = new WeakMap<object, object>();
  const materialize = (value: unknown) => materializeTaskData(value, targets);
  if (trace === "untraced") return { task, snapshot: () => undefined, materialize };
  const record = (path: string): void => {
    if (segment.has(path)) return;
    if (events.length < TASK_ACCESS_EVENT_LIMIT) {
      segment.add(path);
      events.push(path);
    } else truncated = true;
  };
  const wrap = (value: unknown, path: string) => {
    if (!isObject(value)) return value;
    const cached = proxies.get(value);
    if (cached !== undefined) return cached;
    // The receiver is forwarded so an inherited getter runs with the proxy as `this`.
    const proxy = new Proxy(value, {
      get(target, property, receiver) {
        // Reflect.get returns `any`; the trace forwards the value and reads nothing from it.
        const read: unknown = Reflect.get(target, property, receiver);
        if (!isString(property)) return read;
        if (Array.isArray(target)) {
          if (!ARRAY_INDEX.test(property)) return read;
          const itemPath = `${path}[]`;
          record(itemPath);
          return wrap(read, itemPath);
        }
        const propertyPath = `${path}.${property}`;
        if (!META_PROPERTIES.has(property)) record(propertyPath);
        return wrap(read, propertyPath);
      },
      has(target, property) {
        if (isString(property) && !Array.isArray(target) && !META_PROPERTIES.has(property)) {
          record(`${path}.${property}`);
        }
        return Reflect.has(target, property);
      },
      ownKeys(target) {
        opaqueCopies += 1;
        return Reflect.ownKeys(target);
      },
    });
    proxies.set(value, proxy);
    targets.set(proxy, value);
    return proxy;
  };
  return {
    materialize,
    task: { ...task, publicInput: wrap(task.publicInput, "$") },
    // The worker snapshots at ready and after every tool call, so a snapshot closes one
    // attribution segment: the next tool re-records paths earlier tools already read.
    snapshot: () => {
      segment = new Set();
      return { events: [...events], opaqueCopies, truncated };
    },
  };
}
