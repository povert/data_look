/* smoke-loadvalue —— 钉 loadValue 快路径:根数组/根对象+嵌套数组/Unicode/转义/BOM/空结构
   验证:不构造整文件大字符串、形态正确、值正确(对照 JSON.parse)。 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const stream = require('../public/preload/libs/json-stream')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-lv-'))
let failed = 0
function ok(name, cond, extra) { if (cond) console.log('OK  ' + name); else { failed++; console.log('FAIL ' + name + ' ' + (extra == null ? '' : JSON.stringify(extra))) } }
function chk(name, jsonText) {
  const p = path.join(tmp, name + '.json')
  fs.writeFileSync(p, jsonText)
  const got = stream.loadValue(p)
  const want = JSON.parse(jsonText)
  ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want })
}

chk('rootArray', JSON.stringify([{ id: 0, n: 'n0' }, { id: 1, n: 'n1' }, { id: 2 }]))
chk('objWithItems', JSON.stringify({ meta: { v: 1, tag: 'a' }, items: [{ id: 0, nested: { v: 0, t: ['a', 'b'] } }, { id: 1, n: 'x'.repeat(5) }] }))
chk('objMixed', JSON.stringify({ a: 1, b: 'str', c: true, d: null, e: [1, 2, 3], f: { g: 'h' }, arr: [{ x: 1 }, { y: 2 }] }))
chk('unicode', JSON.stringify({ name: '中文测试 αβγ ☃ end', prompt: 'Create a sticker daring wolf' }))
chk('escapes', JSON.stringify({ q: 'A "quote" and \\ backslash and \n newline \t tab', path: 'C:\\Users\\x' }))
chk('nestedDeep', JSON.stringify({ outer: { inner: { deep: [{ x: [{ y: 'z' }] }] } }, list: [1, [2, [3, [4]]]] }))
chk('bigStrings', JSON.stringify({ items: Array.from({ length: 20 }, (_, i) => ({ id: i, big: 'A'.repeat(50000) })) }))
chk('emptyArr', JSON.stringify({ a: [], b: {}, c: [1] }))
chk('numbers', JSON.stringify({ pi: 3.14159, big: 1e15, neg: -42, zero: 0, arr: [-1, 0, 1.5, 2.25e-3] }))
chk('sparseKeys', JSON.stringify([{ a: 1 }, { b: 2 }, { a: 1, b: 2, c: 3 }, {}]))
chk('rootScalar', '"just a string"')
chk('pretty', '{\n  "overall_score": 97.7,\n  "judge_details": [\n    { "idx": 0, "category": "SVG" },\n    { "idx": 1, "category": "3D Design" }\n  ],\n  "scalar": "ok"\n}')

// BOM 前缀
const bomP = path.join(tmp, 'bom.json')
fs.writeFileSync(bomP, '﻿' + JSON.stringify({ x: 1, arr: [1, 2, 3] }))
ok('bom', JSON.stringify(stream.loadValue(bomP)) === JSON.stringify({ x: 1, arr: [1, 2, 3] }), stream.loadValue(bomP))

// 对照:对照 root-object 真实文件头(像生产文件)
chk('eveShape', JSON.stringify({ overall_score: 97.7, eval_success_rate: 94.84, judge_details: [{ idx: 0, prompt: 'wolf', origin_prediction: 'P'.repeat(8000), eval_result: { score: 1, ok: true } }, { idx: 1, prompt: 'cat', origin_prediction: 'Q'.repeat(6000) }], stats: { count: 2 } }))

// 单个超长(>PARSE_LIMIT)元素仍能正确解析(走递归,不撞字符串上限)
const bigP = path.join(tmp, 'bigElem.json')
const hugeStr = 'Z'.repeat(250 * 1024) // 250KB < 512MB,可单次 parse;元素约 250KB < PARSE_LIMIT 也走单 parse
fs.writeFileSync(bigP, JSON.stringify({ judge_details: [{ idx: 0, txt: hugeStr }, { idx: 1, txt: 'small' }] }))
const bv = stream.loadValue(bigP)
ok('bigElem', bv.judge_details[0].txt.length === 250 * 1024 && bv.judge_details[1].txt === 'small', { len: bv.judge_details[0].txt.length })

console.log(failed ? '\n' + failed + ' FAILED' : '\nLOADVALUE OK')
process.exit(failed ? 1 : 0)
