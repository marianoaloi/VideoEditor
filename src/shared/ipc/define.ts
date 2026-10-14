/**
 * Typed IPC channel definitions.
 *
 * Zod is imported here as a TYPE only. `contract.ts` and the `channels/*.names.ts` files depend on
 * this module, and the sandboxed preload bundles them, so none of them may pull zod (or anything
 * else) in at runtime. The zod schemas live in `channels/<domain>.ts`, which only main imports at
 * runtime (through `schemas.ts`).
 *
 * Owner: frozen (lead).
 */
import type { z } from 'zod';

declare const RESPONSE: unique symbol;

/** One invoke channel: its request schema plus a phantom response type. */
export interface InvokeDef<S extends z.ZodType = z.ZodType, R = unknown> {
  readonly req: S;
  /** Type-level only; never present at runtime. */
  readonly [RESPONSE]?: R;
}

/** `defineInvoke(RequestSchema).returns<Response>()` */
export function defineInvoke<S extends z.ZodType>(req: S): { returns<R>(): InvokeDef<S, R> } {
  return {
    returns<R>(): InvokeDef<S, R> {
      return { req };
    }
  };
}

/**
 * channel → `{ req, parsed, res }`:
 * `req` is what the renderer sends (zod input), `parsed` what the handler receives (zod output,
 * defaults applied), `res` what the handler returns.
 */
export type InvokeMapOf<D extends Record<string, InvokeDef>> = {
  [K in keyof D]: D[K] extends InvokeDef<infer S extends z.ZodType, infer R>
    ? { req: z.input<S>; parsed: z.output<S>; res: R }
    : never;
};

type MissingChannels<K extends string, A extends readonly string[]> = {
  readonly 'channels missing from the list': Exclude<K, A[number]>;
};

/**
 * Lists the channel names of one domain at runtime and checks at compile time that the list is
 * exactly the key set of the domain's map: `channelNames<keyof FooInvoke & string>()([...])`.
 */
export function channelNames<K extends string>() {
  return <const A extends readonly K[]>(
    names: A & ([K] extends [A[number]] ? unknown : MissingChannels<K, A>)
  ): A => names;
}
