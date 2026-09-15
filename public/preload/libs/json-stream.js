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

module.exports = {
  Cursor,
  scanCompleteValue,
  readSlice,
  scanJsonFile,
  indexArrayAt,
  readElementAt,
}
