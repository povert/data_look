/* 大 JSON 端到端:services.view 入口,验内存路线。
   用法:node scripts/bigjson-real.cjs /path/to/big.json
   关键证明: (1) 首次加载耗时 (2) 后续筛选/翻页/钻取无源文件二次读取(句柄缓存命中) (3) 筛选缓存。 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const servicesJs = path.join(ROOT, 'public', 'preload', 'services.js')
const code = fs.readFileSync(servicesJs, 'utf8')
const Module = require('node:module')
const m = new Module(servicesJs)
m.filename = servicesJs
m.paths = Module._nodeModulePaths(path.dirname(servicesJs))
global.window = { services: null }
m._compile(code, servicesJs)
const services = global.window.services

const FILE = process.argv[2]
if (!FILE) { console.error('用法: node scripts/bigjson-real.cjs <big.json>'); process.exit(1) }
function t(fn){ const a=Date.now(); const r=fn(); return [Date.now()-a, r] }
function mb(n){ return (n/1024/1024).toFixed(0)+'MB' }

console.log('FILE', (fs.statSync(FILE).size/1024/1024/1024).toFixed(3)+'GB')
let failed = 0
function ok(n,c,e){ if(c)console.log('OK  '+n);else{failed++;console.log('FAIL '+n+' '+(e==null?'':JSON.stringify(e)))} }

let ms, v, r

ms = Date.now(); v = services.view(FILE, '', 50, 0, null, null); ms = Date.now()-ms
console.log('[1] first view(root, triggers load): ' + ms + 'ms')
const rootType = v.node.type
ok('root loaded', rootType === 'object' || rootType === 'array', rootType)
console.log('    heap=' + mb(process.memoryUsage().heapUsed) + ' rss=' + mb(process.memoryUsage().rss))

// 选择一个顶层大数组作为分页/筛选/钻取对象
let arrPath = ''
if (rootType === 'object') {
  const kk = (v.node.keys || []).filter(k => k.type === 'array' || k.clickable)
  if (kk.length) arrPath = kk[0].name
} else {
  arrPath = ''
}

ms = Date.now(); v = services.view(FILE, arrPath, 50, 0, null, null); ms = Date.now()-ms
console.log('[2] first page(' + (arrPath || '<root>') + ' 0-49): ' + ms + 'ms')
ok('page rows=50', v.page && v.page.rows.length === 50, v.page && v.page.rows.length)
const total = v.page.total
console.log('    total=' + total)

const deepOff = Math.max(0, Math.floor(total / 2) - 25)
ms = Date.now(); v = services.view(FILE, arrPath, 50, deepOff, null, null); ms = Date.now()-ms
console.log('[3] deep page(offset ' + deepOff + '): ' + ms + 'ms')
ok('deep page ok', v.page.rows.length > 0 && v.page.rows[0]._idx === deepOff, v.page.rows[0] && v.page.rows[0]._idx)

// 从首页第一行采样一个非空标量列值,构造一次列筛选
let filterWhere = null
if (v.page.cols) {
  const row0 = services.view(FILE, arrPath, 1, 0, null, null).page.rows[0]
  for (const c of v.page.cols) {
    const val = row0[c.name]
    if (val != null && typeof val !== 'object' && String(val).trim()) {
      filterWhere = { [c.name]: String(val) }
      break
    }
  }
}
if (filterWhere) {
  const fk = Object.keys(filterWhere)[0]
  ms = Date.now(); v = services.view(FILE, arrPath, 50, 0, filterWhere, null); ms = Date.now()-ms
  console.log('[4] filter ' + fk + '=' + filterWhere[fk] + ' (first): ' + ms + 'ms')
  ok('filter hits', v.page.filtered && v.page.total > 0, v.page.total)
  ms = Date.now(); v = services.view(FILE, arrPath, 50, 0, filterWhere, null); ms = Date.now()-ms
  console.log('[5] same filter again (cache hit): ' + ms + 'ms')
  ok('cache hit', ms < 50, ms)
  ms = Date.now(); v = services.view(FILE, arrPath, 50, Math.min(5, Math.max(0, v.page.total - 1)), filterWhere, null); ms = Date.now()-ms
  console.log('[6] filter deep page: ' + ms + 'ms')
  ok('filter deep page', v.page.rows.length > 0, v.page.rows.length)
}

const drillPath = arrPath ? arrPath + '[0]' : '[0]'
ms = Date.now(); r = services.record(FILE, drillPath); ms = Date.now()-ms
console.log('[7] drill ' + drillPath + ': ' + ms + 'ms')
ok('drill non-null', r.value != null, r.value)

ms = Date.now(); v = services.view(FILE, '', 50, 0, null, null); ms = Date.now()-ms
console.log('[8] view root again (handle cache, no reload): ' + ms + 'ms')
ok('handle cache hit', ms < 50, ms)

// 全局搜索:从第一条标量字段采样一个短 token
let gq = null
const r0 = services.record(FILE, drillPath)
if (r0.value && typeof r0.value === 'object') {
  for (const k of Object.keys(r0.value)) {
    const vv = r0.value[k]
    if (typeof vv === 'string' && vv.trim().length >= 3 && vv.length <= 40 && /^[A-Za-z0-9 ]+$/.test(vv)) { gq = vv.trim(); break }
  }
}
if (arrPath && gq) {
  ms = Date.now(); v = services.view(FILE, arrPath, 50, 0, { '*': gq }, null); ms = Date.now()-ms
  console.log('[9] global search "' + gq + '" (first): ' + ms + 'ms')
  ok('global search ran', v.page != null, v.page && v.page.total)
}

console.log('\nfinal heap=' + mb(process.memoryUsage().heapUsed) + ' rss=' + mb(process.memoryUsage().rss))
console.log(failed ? '\n' + failed + ' FAILED' : '\nALL OK')
process.exit(failed ? 1 : 0)
