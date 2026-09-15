/** 强制走 stream 模式，验证大 JSON 索引/分页/钻取 */
process.env.JSON_MEM_LIMIT = '1'

const fs = require('fs')
const path = require('path')
const os = require('os')

// env must be set before requiring backend
const JsonBackend = require('../public/preload/libs/backends/json.js')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-big-'))
const p = path.join(tmp, 'big.json')

const items = []
for (let i = 0; i < 500; i++) {
  items.push({
    id: i,
    name: 'n' + i,
    nested: { v: i * 2, tags: ['a', i % 2 ? 'odd' : 'even'] },
    desc: 'x'.repeat(i % 20),
  })
}
fs.writeFileSync(p, JSON.stringify({ meta: { v: 1 }, items }, null, 0))

const st = fs.statSync(p)
const b = new JsonBackend(p, st.size, Math.floor(st.mtimeMs / 1000))

let failed = 0
function ok(name, cond, extra) {
  if (cond) console.log('OK', name)
  else { failed++; console.error('FAIL', name, extra) }
}

const root = b.rootNode()
ok('object root', root.type === 'object', root)
ok('has items key', root.keys.some(k => k.name === 'items'), root.keys.map(k => k.name))

const page = b.page('items', 10, 15, null, null)
ok('page len', page.rows.length === 10, page.rows.length)
ok('page offset idx', page.rows[0]._idx === 15, page.rows[0]._idx)
ok('page name', page.rows[0].name === 'n15', page.rows[0].name)
ok('page total', page.total === 500, page.total)

const node = b.node('items[20].nested')
ok('drill nested object', node.type === 'object', node)

const rec = b.record('items[7]')
ok('record id', rec.value && rec.value.id === 7, rec.value && rec.value.id)

const filtered = b.page('items', 50, 0, { name: 'n1' }, null)
ok('filter', filtered.total > 0 && filtered.filtered, filtered.total)

// root array file
const p2 = path.join(tmp, 'arr.json')
fs.writeFileSync(p2, JSON.stringify(items))
const b2 = new JsonBackend(p2, fs.statSync(p2).size, 1)
const r2 = b2.rootNode()
ok('array root count', r2.type === 'array' && r2.count === 500, r2)
const pg2 = b2.page('', 5, 100, null, null)
ok('array page', pg2.rows[0]._idx === 100 && pg2.rows[0].id === 100, pg2.rows[0])
const nd2 = b2.node('[3].nested.v')
ok('array nested scalar', nd2.type === 'scalar' && nd2.value === 6, nd2)

console.log(failed ? `\n${failed} FAILED` : '\nSTREAM MODE OK')
process.exit(failed ? 1 : 0)
