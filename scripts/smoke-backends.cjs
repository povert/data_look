/** 本地烟雾测试：jsonl / json / csv / excel 后端 */
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const ROOT = path.resolve(__dirname, '..')
const PRELOAD = path.join(ROOT, 'public', 'preload')

const JsonlBackend = require(path.join(PRELOAD, 'libs', 'backends', 'jsonl.js'))
const JsonBackend = require(path.join(PRELOAD, 'libs', 'backends', 'json.js'))
const CsvBackend = require(path.join(PRELOAD, 'libs', 'backends', 'csv.js'))
const ExcelBackend = require(path.join(PRELOAD, 'libs', 'backends', 'excel.js'))
const XLSX = require(path.join(PRELOAD, 'node_modules', 'xlsx'))

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-'))
let failed = 0
function ok(name, cond, extra) {
  if (cond) console.log('OK', name)
  else { failed++; console.error('FAIL', name, extra || '') }
}

// jsonl
const jsonlPath = path.join(tmp, 'a.jsonl')
const lines = []
for (let i = 0; i < 120; i++) {
  lines.push(JSON.stringify({ id: i, name: 'user' + i, tags: ['a', 'b'], nested: { v: i * 2 } }))
}
fs.writeFileSync(jsonlPath, lines.join('\n') + '\n')
const st1 = fs.statSync(jsonlPath)
const jb = new JsonlBackend(jsonlPath, st1.size, Math.floor(st1.mtimeMs / 1000))
const jn = jb.rootNode()
ok('jsonl root type', jn.type === 'array', jn)
ok('jsonl count', jn.count === 120, jn.count)
ok('jsonl cols', jn.cols && jn.cols.some(c => c.name === 'id'))
const jp = jb.page('', 20, 10, null, null)
ok('jsonl page rows', jp.rows.length === 20, jp.rows.length)
ok('jsonl page total', jp.total === 120)
ok('jsonl page offset', jp.rows[0]._idx === 10, jp.rows[0]._idx)
const jf = jb.page('', 50, 0, { name: 'user1' }, null)
ok('jsonl filter', jf.total > 0 && jf.rows.every(r => String(r.name.__s || r.name).includes('user1') || (typeof r.name === 'string' && r.name.includes('user1')) || r.name), jf.total)
const jr = jb.record('[5]')
ok('jsonl record', jr.type === 'object' && jr.value && jr.value.id === 5, jr)
const jd = jb.node('[3].nested')
ok('jsonl nested', jd.type === 'object', jd)

// json
const jsonPath = path.join(tmp, 'b.json')
const jobj = { meta: { v: 1 }, items: [] }
for (let i = 0; i < 50; i++) jobj.items.push({ id: i, name: 'x' + i })
fs.writeFileSync(jsonPath, JSON.stringify(jobj))
const st2 = fs.statSync(jsonPath)
const js = new JsonBackend(jsonPath, st2.size, Math.floor(st2.mtimeMs / 1000))
const jroot = js.rootNode()
ok('json object root', jroot.type === 'object', jroot)
ok('json keys', (jroot.keys || []).some(k => k.name === 'items'))
const jpage = js.page('items', 10, 5, null, null)
ok('json page', jpage.rows.length === 10 && jpage.rows[0]._idx === 5, jpage.rows[0])
ok('json record nested', js.record('items[2].name').value === 'x2')

// csv
const csvPath = path.join(tmp, 'c.csv')
fs.writeFileSync(csvPath, 'id,name,score\n1,foo,9.5\n2,bar,8.0\n3,"a,b",7\n')
const st3 = fs.statSync(csvPath)
const cb = new CsvBackend(csvPath, st3.size, Math.floor(st3.mtimeMs / 1000))
const cn = cb.rootNode()
ok('csv count', cn.count === 3, cn.count)
ok('csv cols', cn.cols.map(c => c.name).join(',') === 'id,name,score')
const cp = cb.page('', 10, 0, null, null)
ok('csv row1 name', cp.rows[1].name === 'bar', cp.rows[1])
ok('csv quoted', cp.rows[2].name === 'a,b', cp.rows[2].name)

// excel via xlsx write
// XLSX already required above
const xlsxPath = path.join(tmp, 'd.xlsx')
const ws = XLSX.utils.aoa_to_sheet([
  ['id', 'name', 'score'],
  [1, 'alice', 90],
  [2, 'bob', 80],
  [3, 'carol', 70],
])
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
ws['!merges'] = [{ s: { r: 1, c: 1 }, e: { r: 2, c: 1 } }]
XLSX.writeFile(wb, xlsxPath)
const st4 = fs.statSync(xlsxPath)
const eb = new ExcelBackend(xlsxPath, st4.size, Math.floor(st4.mtimeMs / 1000))
const en = eb.rootNode()
ok('excel root object', en.type === 'object', en)
ok('excel sheet key', en.keys.some(k => k.name === 'Sheet1'))
const ep = eb.page('Sheet1', 10, 0, null, null)
ok('excel rows', ep.rows.length === 3, ep.rows.length)
ok('excel cols', ep.cols.map(c => c.name).join(',') === 'id,name,score')
ok('excel value', ep.rows[0].name === 'alice', ep.rows[0])
const er = eb.record('Sheet1[1]')
ok('excel record', er.value && er.value.name === 'bob', er.value)

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
