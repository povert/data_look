/** 测试 services.js 入口（shim window） */
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const ROOT = path.resolve(__dirname, '..')
const servicesJs = path.join(ROOT, 'public', 'preload', 'services.js')

// load services by eval-in-commonjs
const code = fs.readFileSync(servicesJs, 'utf8')
const sandboxWindow = { services: null }
// execute as CommonJS with fake window
const Module = require('node:module')
const m = new Module(servicesJs)
m.filename = servicesJs
m.paths = Module._nodeModulePaths(path.dirname(servicesJs))
// inject window
global.window = sandboxWindow
m._compile(code, servicesJs)

const services = sandboxWindow.services
if (!services) {
  console.error('FAIL: window.services not set')
  process.exit(1)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-svc-'))
const jsonl = path.join(tmp, 't.jsonl')
const rows = []
for (let i = 0; i < 30; i++) rows.push(JSON.stringify({ id: i, user: { id: i * 10 }, name: 'n' + i }))
fs.writeFileSync(jsonl, rows.join('\n') + '\n')

let failed = 0
function ok(name, cond, extra) {
  if (cond) console.log('OK', name)
  else { failed++; console.error('FAIL', name, extra) }
}

const info = services.getFileInfo(jsonl)
ok('getFileInfo', info.category === 'jsonl' && info.name === 't.jsonl', info)

const v = services.view(jsonl, '', 10, 5, null, ['user.id'])
ok('view node array', v.node.type === 'array', v.node)
ok('view page offset', v.page.rows[0]._idx === 5, v.page.rows[0])
ok('view extra col', v.page.cols.some(c => c.name === 'user.id'), v.page.cols)
ok('extract value', v.page.rows[0]['user.id'] === 50, v.page.rows[0]['user.id'])

const vf = services.view(jsonl, '', 10, 0, { name: 'n1' }, null)
ok('view filter', vf.page.total >= 1 && vf.page.filtered, vf.page)

const r = services.record(jsonl, '[2].user')
ok('record user', r.value && r.value.id === 20, r)

ok('isSupported', services.isSupported(jsonl) && !services.isSupported('a.txt'))

// unsupported
const txt = path.join(tmp, 'nope.txt')
fs.writeFileSync(txt, 'hello')
try {
  services.getFileInfo(txt)
  ok('reject unknown ext', false)
} catch (e) {
  ok('reject unknown ext', /不支持/.test(e.message), e.message)
}

console.log(failed ? `\n${failed} FAILED` : '\nSERVICES OK')
process.exit(failed ? 1 : 0)
