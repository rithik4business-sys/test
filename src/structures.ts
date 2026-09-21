/**
 * Shared memory-efficient primitives.
 *
 * RingBuffer<T>  — fixed-capacity circular buffer, O(1) push, zero copies
 *                    on overflow (replaces `arr.push(x); arr = arr.slice(-N)`).
 * LinkedStack<T> — capped LIFO stack on a doubly-linked list, O(1) push/pop
 *                    and O(1) eviction of the oldest entry (replaces
 *                    `push` + `shift()` which is O(n) per eviction).
 * CappedBuffer   — byte-budgeted chunk accumulator for process output.
 *                    Drops oldest chunks first, never holds more than `maxBytes`.
 */

/** Fixed-capacity circular buffer. Oldest entries are overwritten on overflow. */
export class RingBuffer<T> {
  private buf: (T | undefined)[];
  private head = 0; // index of oldest element
  private count = 0;
  readonly capacity: number;

  constructor(capacity: number) {
    if (!Number.isFinite(capacity) || capacity < 1) {
      throw new Error('RingBuffer capacity must be >= 1');
    }
    this.capacity = Math.floor(capacity);
    this.buf = new Array<T | undefined>(this.capacity);
  }

  get length(): number {
    return this.count;
  }

  get size(): number {
    return this.count;
  }

  push(item: T): void {
    if (this.count < this.capacity) {
      this.buf[(this.head + this.count) % this.capacity] = item;
      this.count++;
    } else {
      // Overwrite oldest slot — no allocation, no copy.
      this.buf[this.head] = item;
      this.head = (this.head + 1) % this.capacity;
    }
  }

  /** 0 = oldest. Returns undefined out of range. */
  at(i: number): T | undefined {
    if (i < 0 || i >= this.count) return undefined;
    return this.buf[(this.head + i) % this.capacity];
  }

  clear(): void {
    // Drop references so GC can reclaim payloads immediately.
    if (this.count === 0) return;
    for (let i = 0; i < this.count; i++) {
      this.buf[(this.head + i) % this.capacity] = undefined;
    }
    this.head = 0;
    this.count = 0;
  }

  /** Oldest → newest. Allocates one array of `length`. */
  toArray(): T[] {
    const out = new Array<T>(this.count);
    for (let i = 0; i < this.count; i++) {
      out[i] = this.buf[(this.head + i) % this.capacity] as T;
    }
    return out;
  }

  /** Last `n` entries, oldest → newest. No full copy when n < length. */
  sliceLast(n: number): T[] {
    const k = Math.max(0, Math.min(n, this.count));
    const out = new Array<T>(k);
    const start = this.count - k;
    for (let i = 0; i < k; i++) {
      out[i] = this.buf[(this.head + start + i) % this.capacity] as T;
    }
    return out;
  }

  forEach(fn: (item: T, i: number) => void): void {
    for (let i = 0; i < this.count; i++) {
      fn(this.buf[(this.head + i) % this.capacity] as T, i);
    }
  }

  *[Symbol.iterator](): Iterator<T> {
    for (let i = 0; i < this.count; i++) {
      yield this.buf[(this.head + i) % this.capacity] as T;
    }
  }
}

interface Link<T> {
  v: T;
  prev: Link<T> | null;
  next: Link<T> | null;
}

/**
 * Capped LIFO stack on a doubly-linked list.
 * push/pop/peek/clear are O(1); exceeding `max` drops the oldest (bottom)
 * entry in O(1) — unlike `array.shift()` which is O(n).
 */
export class LinkedStack<T> {
  private top: Link<T> | null = null;
  private bottom: Link<T> | null = null;
  private n = 0;
  readonly max: number;

  constructor(max = 100) {
    if (!Number.isFinite(max) || max < 1) {
      throw new Error('LinkedStack max must be >= 1');
    }
    this.max = Math.floor(max);
  }

  get length(): number {
    return this.n;
  }

  get size(): number {
    return this.n;
  }

  push(v: T): void {
    const node: Link<T> = { v, prev: this.top, next: null };
    if (this.top) this.top.next = node;
    this.top = node;
    if (!this.bottom) this.bottom = node;
    this.n++;
    if (this.n > this.max) this.dropOldest();
  }

  private dropOldest(): void {
    if (!this.bottom) return;
    const next = this.bottom.next;
    this.bottom.v = undefined as unknown as T; // release payload for GC
    this.bottom.next = null;
    this.bottom = next;
    if (this.bottom) this.bottom.prev = null;
    else this.top = null;
    this.n--;
  }

  pop(): T | undefined {
    const t = this.top;
    if (!t) return undefined;
    this.top = t.prev;
    if (this.top) this.top.next = null;
    else this.bottom = null;
    t.prev = null;
    this.n--;
    return t.v;
  }

  peek(): T | undefined {
    return this.top ? this.top.v : undefined;
  }

  clear(): void {
    let cur = this.bottom;
    while (cur) {
      const nx = cur.next;
      cur.v = undefined as unknown as T;
      cur.prev = null;
      cur.next = null;
      cur = nx;
    }
    this.top = null;
    this.bottom = null;
    this.n = 0;
  }

  /** Top → bottom (most-recent first). */
  toArray(): T[] {
    const out = new Array<T>(this.n);
    let cur = this.top;
    let i = 0;
    while (cur) {
      out[i++] = cur.v;
      cur = cur.prev;
    }
    return out;
  }

  /** Bottom → top (oldest first), last `n` entries. */
  takeLast(n: number): T[] {
    const k = Math.max(0, Math.min(n, this.n));
    const all = this.toArray(); // top → bottom
    return all.slice(0, k).reverse(); // oldest → newest of the newest k
  }
}

/**
 * Byte-budgeted output accumulator. Accepts arbitrary string chunks,
 * keeps at most `maxBytes` (drops oldest first). `toString()` joins once.
 */
export class CappedBuffer {
  private chunks: string[] = [];
  private head = 0; // index of first live chunk
  private bytes = 0;
  private trimmed = false;
  readonly maxBytes: number;

  constructor(maxBytes = 131072) {
    this.maxBytes = Math.max(1024, Math.floor(maxBytes));
  }

  get length(): number {
    return this.bytes;
  }

  get wasTrimmed(): boolean {
    return this.trimmed;
  }

  push(s: string): void {
    if (!s) return;
    // Compact occasionally so `chunks` never grows unboundedly.
    if (this.head > 64 && this.head * 2 > this.chunks.length) {
      this.chunks = this.chunks.slice(this.head);
      this.head = 0;
    }
    this.chunks.push(s);
    this.bytes += s.length;
    while (this.bytes > this.maxBytes && this.head < this.chunks.length) {
      this.bytes -= this.chunks[this.head].length;
      this.head++;
      this.trimmed = true;
    }
  }

  toString(trailer = '\n[output truncated]\n'): string {
    const s = this.chunks.slice(this.head).join('');
    return this.trimmed ? s + trailer : s;
  }

  clear(): void {
    this.chunks = [];
    this.head = 0;
    this.bytes = 0;
    this.trimmed = false;
  }
}
