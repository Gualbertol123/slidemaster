/* A small typed RPC endpoint over postMessage (PLAN S2.4): calls with promised answers, in both directions, and
   one-way events. The page and the core worker each hold one; tests connect two in one thread (`pair`). Large
   buffers travel as transferables. Errors come back as Error objects with their message (and `code`/`status`
   when the thrower set them). */

export interface Wire { postMessage(msg: unknown, transfer?: Transferable[]): void; onmessage: ((e: { data: unknown }) => void) | null }

type Msg =
  | { k: "call"; id: number; m: string; a: unknown }
  | { k: "ok"; id: number; v: unknown }
  | { k: "err"; id: number; e: { message: string; code?: string; status?: number } }
  | { k: "ev"; m: string; a: unknown };

type Arg<F> = F extends (a: infer A) => unknown ? A : never;
type Res<F> = F extends (...a: never[]) => infer R ? Awaited<R> : never;

/** marks values to transfer instead of copying (ArrayBuffers) */
export class Transfer<T> { constructor(readonly value: T, readonly list: Transferable[]) {} }
export const transfer = <T>(value: T, list: Transferable[]) => new Transfer(value, list);

export class Port<Local extends object, Remote extends object, InEvents extends object, OutEvents extends object> {
  private seq = 0;
  private waiting = new Map<number, { ok: (v: unknown) => void; err: (e: Error) => void }>();
  private handlers: Partial<Local> = {};
  private listeners = new Map<string, Set<(a: unknown) => void>>();
  constructor(private readonly wire: Wire) {
    wire.onmessage = e => { void this.receive(e.data as Msg); };
  }
  /** answer calls of `m` from the other side */
  handle<K extends keyof Local & string>(m: K, fn: (a: Arg<Local[K]>) => Res<Local[K]> | Transfer<Res<Local[K]>> | Promise<Res<Local[K]> | Transfer<Res<Local[K]>>>) { (this.handlers as Record<string, unknown>)[m] = fn; }
  call<K extends keyof Remote & string>(m: K, arg: Arg<Remote[K]> | Transfer<Arg<Remote[K]>>): Promise<Res<Remote[K]>> {
    const id = ++this.seq;
    return new Promise((ok, err) => {
      this.waiting.set(id, { ok: ok as (v: unknown) => void, err });
      this.send({ k: "call", id, m, a: arg instanceof Transfer ? arg.value : arg }, arg instanceof Transfer ? arg.list : undefined);
    });
  }
  emit<K extends keyof OutEvents & string>(m: K, arg: OutEvents[K] | Transfer<OutEvents[K]>) {
    this.send({ k: "ev", m, a: arg instanceof Transfer ? arg.value : arg }, arg instanceof Transfer ? arg.list : undefined);
  }
  on<K extends keyof InEvents & string>(m: K, fn: (a: InEvents[K]) => void): () => void {
    let set = this.listeners.get(m); if (!set) this.listeners.set(m, set = new Set());
    set.add(fn as (a: unknown) => void); return () => set!.delete(fn as (a: unknown) => void);
  }
  private send(msg: Msg, list?: Transferable[]) { this.wire.postMessage(msg, list && list.length ? list : undefined); }
  private async receive(msg: Msg) {
    if (msg.k === "ev") { for (const f of this.listeners.get(msg.m) || []) f(msg.a); return; }
    if (msg.k === "ok" || msg.k === "err") {
      const w = this.waiting.get(msg.id); if (!w) return; this.waiting.delete(msg.id);
      if (msg.k === "ok") w.ok(msg.v);
      else { const e = new Error(msg.e.message) as Error & { code?: string; status?: number }; if (msg.e.code) e.code = msg.e.code; if (msg.e.status) e.status = msg.e.status; w.err(e); }
      return;
    }
    const fn = this.handlers[msg.m as keyof Local] as ((a: unknown) => unknown) | undefined;
    try {
      if (!fn) throw new Error("no handler for " + msg.m);
      const v = await fn(msg.a);
      if (v instanceof Transfer) this.send({ k: "ok", id: msg.id, v: v.value }, v.list); else this.send({ k: "ok", id: msg.id, v });
    } catch (e) {
      const x = e as { message?: string; code?: unknown; status?: unknown };
      this.send({ k: "err", id: msg.id, e: { message: String(x?.message || e), ...(typeof x?.code === "string" ? { code: x.code } : {}), ...(typeof x?.status === "number" ? { status: x.status } : {}) } });
    }
  }
}

/** two wires connected in this thread (tests, and a page without workers): messages are cloned and delivered
    on a later task, as between a page and a worker */
export function pair(): [Wire, Wire] {
  const a: Wire = { postMessage: m => deliver(b, m), onmessage: null };
  const b: Wire = { postMessage: m => deliver(a, m), onmessage: null };
  function deliver(to: Wire, m: unknown) { const data = structuredClone(m); setTimeout(() => to.onmessage?.({ data }), 0); }
  return [a, b];
}
