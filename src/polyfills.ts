// pdf.js 6 calls Map/WeakMap.prototype.getOrInsertComputed (TC39 "upsert"),
// which only recent Chromium/WebView2 builds provide. Older WebView2 runtimes on
// Windows 10 would fail every PDF import with "getOrInsertComputed is not a
// function". These guarded shims do nothing when the native methods exist.
type Upsert<K, V> = {
  getOrInsert?: (key: K, value: V) => V
  getOrInsertComputed?: (key: K, compute: (key: K) => V) => V
}

for (const Collection of [Map, WeakMap] as Array<{ prototype: object }>) {
  const proto = Collection.prototype as Upsert<object, unknown> & { has(key: object): boolean; get(key: object): unknown; set(key: object, value: unknown): unknown }
  if (!proto.getOrInsertComputed) {
    Object.defineProperty(proto, 'getOrInsertComputed', {
      configurable: true,
      writable: true,
      value(this: typeof proto, key: object, compute: (key: object) => unknown) {
        if (this.has(key)) return this.get(key)
        const value = compute(key)
        this.set(key, value)
        return value
      },
    })
  }
  if (!proto.getOrInsert) {
    Object.defineProperty(proto, 'getOrInsert', {
      configurable: true,
      writable: true,
      value(this: typeof proto, key: object, value: unknown) {
        if (this.has(key)) return this.get(key)
        this.set(key, value)
        return value
      },
    })
  }
}

export {}
