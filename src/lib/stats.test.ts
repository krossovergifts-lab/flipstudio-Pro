import { describe, expect, it } from 'vitest'
import { COLLECT_FUNCTION, sha256Hex, statsFunction, summarize, type StatRow } from './stats'

type Handlers = Record<string, (context: unknown) => Promise<Response> | Response>
const load = (code: string): Handlers =>
  new Function('exports', code.replace(/export const (\w+)/g, 'const $1 = exports.$1').replace(/export async function (\w+)/g, 'exports.$1 = async function $1') + '\nreturn exports;')({}) as Handlers

function fakeD1() {
  const table = new Map<string, StatRow>()
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    async run() {
      if (sql.startsWith('INSERT')) {
        const [pub, day, metric, key] = args as string[]
        const id = [pub, day, metric, key].join('|')
        const row = table.get(id) ?? [day, metric, key, 0]
        row[3] += 1
        table.set(id, row)
        ;(row as unknown as { pub: string }).pub = pub
      }
      return {}
    },
    async all() {
      const [pub, since] = args as string[]
      return { results: [...table.values()].filter((row) => (row as unknown as { pub: string }).pub === pub && row[0] >= since).map(([day, metric, key, n]) => ({ day, metric, key, n })) }
    },
  })
  return { prepare: (sql: string) => statement(sql), batch: async (list: Array<{ run(): Promise<unknown> }>) => { for (const item of list) await item.run() }, table }
}

describe('own statistics', () => {
  it('collects events and returns them only with the right key', async () => {
    const DB = fakeD1()
    const collect = load(COLLECT_FUNCTION)
    const post = (body: unknown, ua = 'Mozilla/5.0 (iPhone) Mobile') => collect.onRequestPost({ request: new Request('https://s.dev/api/fs-collect', { method: 'POST', body: JSON.stringify(body), headers: { 'user-agent': ua } }), env: { DB } })
    expect((await post({ p: 'book', r: 'google.com', e: [['visit', ''], ['page', '1'], ['page', '4'], ['search', 'mug'], ['bogus', 'x']] })).status).toBe(204)
    await post({ p: 'book', e: [['page', '4']] })
    const key = 'secret-key'
    const reader = load(statsFunction(await sha256Hex(key)))
    const get = (k: string) => reader.onRequestGet({ request: new Request('https://s.dev/api/fs-stats?pub=book&days=7', { headers: { 'x-fs-key': k } }), env: { DB } })
    expect((await get('wrong')).status).toBe(403)
    const ok = await get(key)
    expect(ok.headers.get('access-control-allow-origin')).toBe('*')
    const body = (await ok.json()) as { setup: boolean; rows: StatRow[] }
    expect(body.setup).toBe(true)
    const s = summarize(body.rows, 7)
    expect(s.totals).toMatchObject({ visit: 1, page: 3, search: 1, device: 1, referrer: 1 })
    expect(s.top.page[0]).toEqual({ key: '4', n: 2 })
    expect(s.top.device[0].key).toBe('phone')
    expect(s.days).toHaveLength(7)
    expect(s.days[6].pages).toBe(3)
    // Without a database binding the collector accepts and drops events, and the reader says so.
    expect((await collect.onRequestPost({ request: new Request('https://s.dev/x', { method: 'POST', body: '{}' }), env: {} })).status).toBe(204)
    expect(await (await reader.onRequestGet({ request: new Request('https://s.dev/x', { headers: { 'x-fs-key': key } }), env: {} })).json()).toEqual({ setup: false, rows: [] })
  })
})
