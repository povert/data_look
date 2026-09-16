/**
 * 大 JSON 流式结构扫描：不整文件 JSON.parse。
 * - 数组根：记录每个顶层元素的字节偏移 → O(1) 任意页
 * - 对象根：记录顶层键/类型/偏移；顶层数组可再索引元素偏移
 */
const fs = require('node:fs')

const CHUNK = 1024 * 256

function isOpen(c) { return c === 0x7b || c === 0x5b } // { [
function isClose(c) { return c === 0x7d || c === 0x5d } // } ]
function isWs(c) {
  return c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09
}

/**
 * 从 start 处开始扫描一个完整 JSON 值，返回结束位置（exclusive，含最后一个字节+1）。
 * start 必须指向值的第一个非空白字符。
 */
function scanValueEnd(buf, start, fileSize, readMore) {
  // readMore(needAbsPos) -> ensures buf covers up to needAbsPos, returns {buf, base}
  // Simpler: caller passes a cursor helper
  throw new Error('use Cursor')
}

class Cursor {
  constructor(fd, size) {
    this.fd = fd
    this.size = size
    this.pos = 0
    this.buf = Buffer.alloc(0)
    this.base = 0 // absolute offset of buf[0]
  }

  ensure(n) {
    // ensure this.pos is valid in buf (absolute)
    if (this.pos >= this.base && this.pos < this.base + this.buf.length) return
    const start = Math.max(0, this.pos)
    const len = Math.min(CHUNK * 4, Math.max(CHUNK, this.size - start))
    if (start >= this.size) {
      this.buf = Buffer.alloc(0)
      this.base = start
      return
    }
    const b = Buffer.allocUnsafe(len)
    const bytes = fs.readSync(this.fd, b, 0, len, start)
    this.buf = b.subarray(0, bytes)
    this.base = start
  }

  peek() {
    this.ensure()
    const i = this.pos - this.base
    if (i < 0 || i >= this.buf.length) return -1
    return this.buf[i]
  }

  next() {
    const c = this.peek()
    if (c >= 0) this.pos += 1
    return c
  }

  skipWs() {
    let c = this.peek()
    while (c >= 0 && isWs(c)) {
      this.pos += 1
      c = this.peek()
    }
    return c
  }
}

/** 从 cursor.pos（已 skipWs 到值起点）扫描到完整值结束，cursor.pos 停在值后第一个字符 */
function scanCompleteValue(cur) {
  const c = cur.peek()
  if (c < 0) return
  if (c === 0x22) { // "
    cur.pos += 1
    let esc = false
    while (cur.pos < cur.size) {
      cur.ensure()
      const i = cur.pos - cur.base
      if (i < 0 || i >= cur.buf.length) {
        cur.ensure()
        if (cur.pos >= cur.size) break
        continue
      }
      const b = cur.buf[i]
      if (esc) { esc = false; cur.pos += 1; continue }
      if (b === 0x5c) { esc = true; cur.pos += 1; continue }
      if (b === 0x22) { cur.pos += 1; return }
      cur.pos += 1
    }
    return
  }
  if (c === 0x7b || c === 0x5b) { // { [
    let depth = 0
    let inStr = false
    let esc = false
    while (cur.pos < cur.size) {
      cur.ensure()
      const i = cur.pos - cur.base
      if (i < 0 || i >= cur.buf.length) continue
      const b = cur.buf[i]
      if (inStr) {
        if (esc) esc = false
        else if (b === 0x5c) esc = true
        else if (b === 0x22) inStr = false
        cur.pos += 1
        continue
      }
      if (b === 0x22) { inStr = true; cur.pos += 1; continue }
      if (b === 0x7b || b === 0x5b) depth += 1
      else if (b === 0x7d || b === 0x5d) {
        depth -= 1
        cur.pos += 1
        if (depth === 0) return
        continue
      }
      cur.pos += 1
    }
    return
  }
  // number / true / false / null — read until delimiter
  while (cur.pos < cur.size) {
    cur.ensure()
    const i = cur.pos - cur.base
    if (i < 0 || i >= cur.buf.length) continue
    const b = cur.buf[i]
    if (isWs(b) || b === 0x2c || b === 0x7d || b === 0x5d) return // , } ]
    cur.pos += 1
  }
}

/** 读取 [start, end) 并 JSON.parse（UTF-8，自动去 BOM） */
function readSlice(fd, start, end) {
  const len = Math.max(0, end - start)
  if (len === 0) return null
  const buf = Buffer.allocUnsafe(len)
  fs.readSync(fd, buf, 0, len, start)
  let text = buf.toString('utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * 扫描文件根结构。
 * 返回:
 *   { root:'array', count, offsets:[num...], sampleStart, sampleEnds? }
 *   { root:'object', keys:[{name,type,start,end,count?}], arrays:{name:{offsets}} }
 */
function scanJsonFile(filePath, sampleN = 200, indexArrays = true) {
  const size = fs.statSync(filePath).size
  const fd = fs.openSync(filePath, 'r')
  try {
    const cur = new Cursor(fd, size)
    // skip BOM
    if (size >= 3) {
      const head = Buffer.allocUnsafe(3)
      fs.readSync(fd, head, 0, 3, 0)
      if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) cur.pos = 3
    }
    const c = cur.skipWs()
    if (c < 0) return { root: 'scalar', value: null }

    if (c === 0x5b) { // root array
      cur.pos += 1 // past [
      const offsets = []
      for (;;) {
        const ch = cur.skipWs()
        if (ch < 0 || ch === 0x5d) break // ]
        const start = cur.pos
        scanCompleteValue(cur)
        offsets.push(start)
        const after = cur.skipWs()
        if (after === 0x2c) { cur.pos += 1; continue } // ,
        if (after === 0x5d) { cur.pos += 1; break }
        break
      }
      // sample first N as complete values
      const sample = []
      const n = Math.min(sampleN, offsets.length)
      for (let i = 0; i < n; i++) {
        const s = offsets[i]
        const e = i + 1 < offsets.length ? offsets[i + 1] : /* to end of value */ null
        // better: rescan end from s
        const c2 = new Cursor(fd, size)
        c2.pos = s
        scanCompleteValue(c2)
        sample.push(readSlice(fd, s, c2.pos))
      }
      return { root: 'array', count: offsets.length, offsets, sample, size }
    }

    if (c === 0x7b) { // root object
      cur.pos += 1 // past {
      const keys = []
      const arrays = {}
      const scalars = {}
      for (;;) {
        const ch = cur.skipWs()
        if (ch < 0 || ch === 0x7d) break // }
        if (ch !== 0x22) break
        const keyStart = cur.pos
        scanCompleteValue(cur)
        const key = readSlice(fd, keyStart, cur.pos)
        if (typeof key !== 'string') break
        const colon = cur.skipWs()
        if (colon === 0x3a) cur.pos += 1 // :
        const vStart = cur.skipWs()
        const vStartPos = cur.pos
        scanCompleteValue(cur)
        const vEnd = cur.pos
        // peek type by first byte
        let type = 'scalar'
        let previewVal
        const first = (() => {
          const c3 = new Cursor(fd, size)
          c3.pos = vStartPos
          return c3.peek()
        })()
        let arrIndex = null
        if (first === 0x5b) {
          type = 'array'
          if (indexArrays) {
            arrIndex = indexArrayAt(fd, size, vStartPos)
            arrays[key] = arrIndex
          }
        } else if (first === 0x7b) {
          type = 'object'
        } else {
          previewVal = readSlice(fd, vStartPos, vEnd)
        }
        keys.push({
          name: key,
          type,
          start: vStartPos,
          end: vEnd,
          preview: type === 'array'
            ? `Array(${arrIndex ? arrIndex.count : '?'})`
            : type === 'object'
              ? 'Object'
              : previewVal,
          clickable: type === 'array' || type === 'object',
          value: type === 'scalar' ? previewVal : undefined,
        })
        if (type === 'scalar') scalars[key] = previewVal
        const after = cur.skipWs()
        if (after === 0x2c) { cur.pos += 1; continue }
        if (after === 0x7d) { cur.pos += 1; break }
        break
      }
      return { root: 'object', keys, arrays, scalars, size }
    }

    // root scalar
    const start = cur.pos
    scanCompleteValue(cur)
    return { root: 'scalar', value: readSlice(fd, start, cur.pos), size }
  } finally {
    fs.closeSync(fd)
  }
}

function indexArrayAt(fd, size, arrayStart) {
  const cur = new Cursor(fd, size)
  cur.pos = arrayStart
  const c = cur.skipWs()
  if (c !== 0x5b) return { count: 0, offsets: [] }
  cur.pos += 1
  const offsets = []
  for (;;) {
    const ch = cur.skipWs()
    if (ch < 0 || ch === 0x5d) break
    const start = cur.pos
    scanCompleteValue(cur)
    offsets.push(start)
    const after = cur.skipWs()
    if (after === 0x2c) { cur.pos += 1; continue }
    if (after === 0x5d) break
    break
  }
  return { count: offsets.length, offsets }
}

function readElementAt(fd, size, offsets, i) {
  if (i < 0 || i >= offsets.length) return null
  const start = offsets[i]
  const cur = new Cursor(fd, size)
  cur.pos = start
  scanCompleteValue(cur)
  return readSlice(fd, start, cur.pos)
}

/**
 * 用一个 fd 把 scanJsonFile 的结果重建为完整 JS 根对象（in-memory 模式加载用）。
 * 关键:逐个值 readSlice+JSON.parse,绝不构造整文件单字符串(否则超出 V8 ~512MB 单字符串上限)。
 * - array 根:逐条 readElementAt
 * - object 栁:按源序遍历 keys;标量取 scan.scalars、object 取 readSlice(start,end)、array 逐元素重建
 * - scalar 根:scan.value
 * scan 必须用 sampleN=0、indexArrays=true 产出(避免多余采样 parse)。
 */
function buildValue(fd, size, scan) {
  if (!scan) return null
  if (scan.root === 'array') {
    const offsets = scan.offsets || []
    const out = new Array(offsets.length)
    for (let i = 0; i < offsets.length; i++) out[i] = readElementAt(fd, size, offsets, i)
    return out
  }
  if (scan.root === 'object') {
    const out = {}
    for (const k of (scan.keys || [])) {
      if (k.type === 'scalar') {
        out[k.name] = (scan.scalars && k.name in scan.scalars) ? scan.scalars[k.name] : readSlice(fd, k.start, k.end)
      } else if (k.type === 'array') {
        const idx = scan.arrays && scan.arrays[k.name]
        const offs = idx ? idx.offsets : []
        const arr = new Array(offs.length)
        for (let i = 0; i < offs.length; i++) arr[i] = readElementAt(fd, size, offs, i)
        out[k.name] = arr
      } else if (k.type === 'object') {
        out[k.name] = readSlice(fd, k.start, k.end)
      }
    }
    return out
  }
  // scalar root
  return scan.value
}

module.exports = {
  Cursor,
  scanCompleteValue,
  readSlice,
  scanJsonFile,
  indexArrayAt,
  readElementAt,
  buildValue,
  loadValue,
}

/* ----------------------------------------------------------------------
 * loadValue —— 大文件进内存模式的快路径:整文件读成 Buffer(不受 V8 ~512MB
 * 单字符串上限约束),原生 Uint8Array 索引循环单遍扫描 + 就地 JSON.parse。
 * 相比 scan+buildValue 双遍,省掉一整遍全文件扫描,且逐字节循环无函数调用开销。
 * 解析仍按元素/标量切片(单切片 < PARSE_LIMIT 才整体 JSON.parse,否则对结构体
 * 递归切片解析),绝不构造整文件大字符串。
 * ---------------------------------------------------------------------- */
const PARSE_LIMIT = 200 * 1024 * 1024

function skipWsB(b, p, n) {
  for (; p < n; p++) { const c = b[p]; if (c !== 0x20 && c !== 0x0a && c !== 0x0d && c !== 0x09) break }
  return p
}
function strEndB(b, p, n) {
  p++
  for (; p < n; p++) { const c = b[p]; if (c === 0x5c) { p++; continue } if (c === 0x22) return p + 1 }
  return n
}
function structEndB(b, p, n) {
  const open = b[p]
  const close = open === 0x7b ? 0x7d : 0x5d
  let depth = 0, inStr = false
  for (; p < n; p++) {
    const c = b[p]
    if (inStr) { if (c === 0x5c) { p++; continue } if (c === 0x22) inStr = false; continue }
    if (c === 0x22) { inStr = true; continue }
    if (c === open) depth++
    else if (c === close) { depth--; if (depth === 0) return p + 1 }
  }
  return n
}
function scalarEndB(b, p, n) {
  for (; p < n; p++) {
    const c = b[p]
    if (c === 0x2c || c === 0x7d || c === 0x5d || c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) return p
  }
  return n
}
function valueEndB(b, p, n) {
  const c = b[p]
  if (c === 0x22) return strEndB(b, p, n)
  if (c === 0x7b || c === 0x5b) return structEndB(b, p, n)
  return scalarEndB(b, p, n)
}
function loadArrayB(b, p, n) {
  p++
  const out = []
  for (;;) {
    p = skipWsB(b, p, n)
    if (p >= n || b[p] === 0x5d) { if (p < n) p++; break }
    const s = p
    const c = b[p]
    const e = valueEndB(b, p, n)
    if (e - s >= PARSE_LIMIT && (c === 0x7b || c === 0x5b)) {
      const r = c === 0x7b ? loadObjectB(b, s, n) : loadArrayB(b, s, n)
      out.push(r.v); p = r.end
    } else {
      out.push(JSON.parse(b.subarray(s, e))); p = e
    }
    p = skipWsB(b, p, n)
    if (p >= n) break
    if (b[p] === 0x2c) { p++; continue }
    if (b[p] === 0x5d) { p++; break }
    break
  }
  return { v: out, end: p }
}
function loadObjectB(b, p, n) {
  p++
  const out = {}
  for (;;) {
    p = skipWsB(b, p, n)
    if (p >= n || b[p] === 0x7d) { if (p < n) p++; break }
    if (b[p] !== 0x22) break
    const ks = p
    const ke = strEndB(b, p, n)
    const key = JSON.parse(b.subarray(ks, ke))
    p = ke
    p = skipWsB(b, p, n)
    if (b[p] === 0x3a) p++
    p = skipWsB(b, p, n)
    const vs = p
    const c = b[p]
    if (c === 0x7b) {
      // object:直接递归(自定限,返回 end)。绝不先 structEndB 整扫——否则对嵌套大对象/数组会与递归重复扫一遍。
      const r = loadObjectB(b, vs, n); out[key] = r.v; p = r.end
    } else if (c === 0x5b) {
      const r = loadArrayB(b, vs, n); out[key] = r.v; p = r.end
    } else {
      // 字符串/标量:小切片,一次性 JSON.parse
      const ve = valueEndB(b, vs, n)
      out[key] = JSON.parse(b.subarray(vs, ve)); p = ve
    }
    p = skipWsB(b, p, n)
    if (p >= n) break
    if (b[p] === 0x2c) { p++; continue }
    if (b[p] === 0x7d) { p++; break }
    break
  }
  return { v: out, end: p }
}
function loadValue(filePath) {
  const b = fs.readFileSync(filePath)
  const n = b.length
  let i = (n >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) ? 3 : 0
  i = skipWsB(b, i, n)
  if (i >= n) return null
  const c = b[i]
  if (c === 0x5b) return loadArrayB(b, i, n).v
  if (c === 0x7b) return loadObjectB(b, i, n).v
  if (c === 0x22) return JSON.parse(b.subarray(i, strEndB(b, i, n))) // 根字符串(空格属串内)
  return JSON.parse(b.subarray(i, scalarEndB(b, i, n))) // 数字/true/false/null
}
