/** 路径表达式: "" 根 / "results.data" 嵌套 / "rows[3]" 索引 / "[0].meta" 根数组 */

function parsePath(s) {
  s = String(s || '').trim()
  const segs = []
  let i = 0
  const n = s.length
  while (i < n) {
    const c = s[i]
    if (c === '.') { i += 1; continue }
    if (c === '[') {
      const j = s.indexOf(']', i)
      if (j === -1) { segs.push(s.slice(i)); break }
      segs.push(parseInt(s.slice(i + 1, j), 10))
      i = j + 1
      continue
    }
    let j = i
    while (j < n && s[j] !== '.' && s[j] !== '[') j++
    segs.push(s.slice(i, j))
    i = j
  }
  return segs
}

function serializePath(segs) {
  const parts = []
  for (const s of segs) {
    if (typeof s === 'number') parts.push(`[${s}]`)
    else {
      if (parts.length) parts.push('.')
      parts.push(String(s))
    }
  }
  return parts.join('')
}

module.exports = { parsePath, serializePath }
