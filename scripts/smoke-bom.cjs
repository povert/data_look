const fs = require('fs')
const path = require('path')
const os = require('os')

const ROOT = path.resolve(__dirname, '..')
const JsonBackend = require(path.join(ROOT, 'public', 'preload', 'libs', 'backends', 'json.js'))

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-bom-'))
const p = path.join(tmp, 'bom.json')
const obj = { id: 1, name: '卡牌', tags: ['a', 'b'] }
// UTF-8 BOM + JSON
fs.writeFileSync(p, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(obj), 'utf8')]))

const st = fs.statSync(p)
const b = new JsonBackend(p, st.size, Math.floor(st.mtimeMs / 1000))
const root = b.rootNode()
console.log('type=', root.type)
console.log('keys=', (root.keys || []).map(k => k.name).join(','))
console.log('message=', root.message || '')

// invalid json
const bad = path.join(tmp, 'bad.json')
fs.writeFileSync(bad, '{not json')
const b2 = new JsonBackend(bad, fs.statSync(bad).size, 1)
const r2 = b2.rootNode()
console.log('bad type=', r2.type, 'msg=', r2.message)

if (root.type === 'object' && root.keys.some(k => k.name === 'name')) {
  console.log('BOM OK')
  process.exit(0)
}
console.log('BOM FAIL')
process.exit(1)
