const nodes = require('../public/preload/libs/nodes.js')
const cols = [
  { name: 'a', type: 'string' },
  { name: 'b', type: 'string' },
]
const rows = [
  { a: '', b: 'x' },
  { a: null, b: 'y' },
  { a: 'hello', b: '' },
  { a: [], b: 'z' },
  { a: 'hi', b: 'ok' },
]
function run(where, label) {
  console.log(label, rows.map(r => (nodes.itemMatches(r, where, cols) ? 'Y' : 'n')).join(''))
}
run({ a: '""' }, 'col a empty   ') // expect YYYnn
run({ b: '""' }, 'col b empty   ') // expect nnnYn
run({ a: 'hello' }, 'col a hello  ') // expect nnnYn wait row3 a=hello -> nnnYn? rows:0 '',1 null,2 hello,3 [],4 hi -> nnYnn
run({ a: 'hello' }, 'col a hello  ')
run({ a: 'h', __opt: { re: true } }, 'regex h      ') // hi and hello
console.log('expected a-empty: YYYnn, b-empty: nnnYn (index3 a=[] not empty so n for b? b of row3 is z) ')
// recheck
// row0 a='' b=x -> a empty Y, b empty n
// row1 a=null b=y -> a empty Y, b empty n
// row2 a=hello b='' -> a empty n, b empty Y
// row3 a=[] b=z -> a empty Y (array length 0), b empty n
// row4 a=hi b=ok -> n, n
// so a-empty: YYnYn, b-empty: nnYnn
run({ a: '""' }, 'recheck a    ')
run({ b: '""' }, 'recheck b    ')
