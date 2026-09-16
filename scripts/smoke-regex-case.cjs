const nodes = require('../public/preload/libs/nodes.js')
const cols = [{ name: 'a', type: 'string' }]
const rows = [{ a: 'HelloWorld' }, { a: 'helloworld' }]

function run(where, label, expect) {
  const got = rows.map(r => (nodes.itemMatches(r, where, cols) ? 'Y' : 'n')).join('')
  const ok = got === expect
  console.log(ok ? 'OK' : 'FAIL', label, got, 'expect', expect)
  return ok
}

let pass = true
pass = run({ a: 'hello' }, 'literal ignore case', 'YY') && pass
pass = run({ a: 'hello', __opt: { cs: true } }, 'literal case sensitive', 'nY') && pass
pass = run({ a: 'hello', __opt: { re: true } }, 'regex ignore case', 'YY') && pass
pass = run({ a: 'hello', __opt: { re: true, cs: true } }, 'regex case sensitive', 'nY') && pass
pass = run({ a: '^Hello', __opt: { re: true } }, 'regex ^Hello ignore case', 'YY') && pass
pass = run({ a: '^Hello', __opt: { re: true, cs: true } }, 'regex ^Hello case sensitive', 'Yn') && pass
pass = run({ a: '^hello', __opt: { re: true } }, 'regex ^hello ignore case', 'YY') && pass
process.exit(pass ? 0 : 1)
