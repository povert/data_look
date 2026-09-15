const nodes = require('../public/preload/libs/nodes.js')

function ok(name, cond, extra) {
  if (cond) console.log('OK', name)
  else { console.error('FAIL', name, extra); process.exitCode = 1 }
}

const cols = [{ name: 'name', type: 'string' }, { name: 'id', type: 'number' }]
const item = { name: 'HelloWorld', id: 3 }

ok('default ci', nodes.itemMatches(item, { name: 'hello' }, cols))
ok('cs off', nodes.itemMatches(item, { name: 'hello', __opt: { cs: false, re: false } }, cols))
ok('cs on fail', !nodes.itemMatches(item, { name: 'hello', __opt: { cs: true, re: false } }, cols))
ok('cs on pass', nodes.itemMatches(item, { name: 'Hello', __opt: { cs: true, re: false } }, cols))
ok('regex', nodes.itemMatches(item, { name: '^Hello.*World$', __opt: { re: true } }, cols))
ok('regex ci', nodes.itemMatches(item, { name: '^hello.*world$', __opt: { re: true, cs: false } }, cols))
ok('regex cs fail', !nodes.itemMatches(item, { name: '^hello.*world$', __opt: { re: true, cs: true } }, cols))
ok('bad regex fallback', nodes.itemMatches({ name: 'abc test[ def', id: 1 }, { name: 'test[', __opt: { re: true } }, cols))
ok('global', nodes.itemMatches(item, { '*': 'world', __opt: { cs: false } }, cols))
ok('skip opt key', nodes.itemMatches(item, { __opt: { cs: true } }, cols))

console.log('done')
