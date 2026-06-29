// Calculated-field expression evaluator for the Report Runner.
//
// Supports a Salesforce-flavored subset of formula expressions:
//
//   Literals:       numbers, single/double-quoted strings, true/false/null
//   Identifiers:    field names, resolved via a row context (or aggregate
//                   context for summary-scope formulas)
//   Arithmetic:     + - * / %
//   Comparison:     == != = <> < > <= >=
//   Logical:        AND OR NOT && || !
//   Grouping:       ( )
//   Functions:      TODAY(), NOW(), IF(cond, a, b), ISNULL(v),
//                   ABS(n), ROUND(n, digits), MIN(a,b,...), MAX(a,b,...),
//                   LEN(s), UPPER(s), LOWER(s), TRIM(s),
//                   CONCATENATE(...) / TEXT(v),
//                   YEAR(d), MONTH(d), DAY(d),
//                   DAYS_BETWEEN(a, b)
//
// For SUMMARY scope, an additional set of aggregate identifiers becomes
// available — they are pre-computed by the caller and passed in via the
// aggregates context: SUM_<field>, COUNT_<field>, AVG_<field>, MIN_<field>,
// MAX_<field>. The expression then uses them as plain identifiers.
//
// The parser is a recursive-descent implementation. No eval(). No Function
// constructor. Identifiers must match a known field/aggregate or the
// expression returns null (with a warning).

// ─── Tokenizer ────────────────────────────────────────────────────────────

const TOKEN_TYPES = {
  NUMBER: 'number', STRING: 'string', IDENT: 'ident', BOOL: 'bool', NULL: 'null',
  PLUS: '+', MINUS: '-', STAR: '*', SLASH: '/', PERCENT: '%',
  LPAREN: '(', RPAREN: ')', COMMA: ',',
  EQ: '==', NEQ: '!=', LT: '<', GT: '>', LTE: '<=', GTE: '>=',
  AND: 'AND', OR: 'OR', NOT: 'NOT',
  EOF: 'eof',
}

function tokenize(input) {
  const tokens = []
  let i = 0
  while (i < input.length) {
    const c = input[i]
    if (/\s/.test(c)) { i++; continue }
    // Numbers
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(input[i+1]))) {
      let j = i
      while (j < input.length && /[0-9.]/.test(input[j])) j++
      tokens.push({ type: TOKEN_TYPES.NUMBER, value: parseFloat(input.slice(i, j)) })
      i = j; continue
    }
    // Strings
    if (c === '"' || c === "'") {
      const quote = c
      let j = i + 1
      let s = ''
      while (j < input.length && input[j] !== quote) {
        if (input[j] === '\\' && j+1 < input.length) { s += input[j+1]; j += 2 }
        else { s += input[j]; j++ }
      }
      tokens.push({ type: TOKEN_TYPES.STRING, value: s })
      i = j + 1; continue
    }
    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(c)) {
      let j = i
      while (j < input.length && /[a-zA-Z0-9_]/.test(input[j])) j++
      const word = input.slice(i, j)
      const upper = word.toUpperCase()
      if (upper === 'AND')   tokens.push({ type: TOKEN_TYPES.AND })
      else if (upper === 'OR')  tokens.push({ type: TOKEN_TYPES.OR })
      else if (upper === 'NOT') tokens.push({ type: TOKEN_TYPES.NOT })
      else if (upper === 'TRUE')  tokens.push({ type: TOKEN_TYPES.BOOL, value: true })
      else if (upper === 'FALSE') tokens.push({ type: TOKEN_TYPES.BOOL, value: false })
      else if (upper === 'NULL')  tokens.push({ type: TOKEN_TYPES.NULL })
      else tokens.push({ type: TOKEN_TYPES.IDENT, value: word })
      i = j; continue
    }
    // Multi-char operators
    if (c === '=' && input[i+1] === '=') { tokens.push({ type: TOKEN_TYPES.EQ }); i += 2; continue }
    if (c === '!' && input[i+1] === '=') { tokens.push({ type: TOKEN_TYPES.NEQ }); i += 2; continue }
    if (c === '<' && input[i+1] === '>') { tokens.push({ type: TOKEN_TYPES.NEQ }); i += 2; continue }
    if (c === '<' && input[i+1] === '=') { tokens.push({ type: TOKEN_TYPES.LTE }); i += 2; continue }
    if (c === '>' && input[i+1] === '=') { tokens.push({ type: TOKEN_TYPES.GTE }); i += 2; continue }
    if (c === '&' && input[i+1] === '&') { tokens.push({ type: TOKEN_TYPES.AND }); i += 2; continue }
    if (c === '|' && input[i+1] === '|') { tokens.push({ type: TOKEN_TYPES.OR }); i += 2; continue }
    // Single-char operators
    switch (c) {
      case '+': tokens.push({ type: TOKEN_TYPES.PLUS });    i++; continue
      case '-': tokens.push({ type: TOKEN_TYPES.MINUS });   i++; continue
      case '*': tokens.push({ type: TOKEN_TYPES.STAR });    i++; continue
      case '/': tokens.push({ type: TOKEN_TYPES.SLASH });   i++; continue
      case '%': tokens.push({ type: TOKEN_TYPES.PERCENT }); i++; continue
      case '(': tokens.push({ type: TOKEN_TYPES.LPAREN });  i++; continue
      case ')': tokens.push({ type: TOKEN_TYPES.RPAREN });  i++; continue
      case ',': tokens.push({ type: TOKEN_TYPES.COMMA });   i++; continue
      case '=': tokens.push({ type: TOKEN_TYPES.EQ });      i++; continue
      case '<': tokens.push({ type: TOKEN_TYPES.LT });      i++; continue
      case '>': tokens.push({ type: TOKEN_TYPES.GT });      i++; continue
      case '!': tokens.push({ type: TOKEN_TYPES.NOT });     i++; continue
    }
    throw new Error(`Unexpected character: ${c}`)
  }
  tokens.push({ type: TOKEN_TYPES.EOF })
  return tokens
}

// ─── Parser ───────────────────────────────────────────────────────────────

class Parser {
  constructor(tokens) { this.tokens = tokens; this.pos = 0 }
  peek() { return this.tokens[this.pos] }
  consume() { return this.tokens[this.pos++] }
  check(type) { return this.peek().type === type }
  match(type) { if (this.check(type)) { this.pos++; return true } return false }

  parse() {
    const expr = this.parseOr()
    if (!this.check(TOKEN_TYPES.EOF)) throw new Error('Unexpected trailing tokens')
    return expr
  }
  parseOr() {
    let left = this.parseAnd()
    while (this.match(TOKEN_TYPES.OR)) left = { type: 'or', left, right: this.parseAnd() }
    return left
  }
  parseAnd() {
    let left = this.parseNot()
    while (this.match(TOKEN_TYPES.AND)) left = { type: 'and', left, right: this.parseNot() }
    return left
  }
  parseNot() {
    if (this.match(TOKEN_TYPES.NOT)) return { type: 'not', operand: this.parseNot() }
    return this.parseComparison()
  }
  parseComparison() {
    let left = this.parseAddSub()
    const cmpTypes = [TOKEN_TYPES.EQ, TOKEN_TYPES.NEQ, TOKEN_TYPES.LT, TOKEN_TYPES.GT, TOKEN_TYPES.LTE, TOKEN_TYPES.GTE]
    if (cmpTypes.includes(this.peek().type)) {
      const op = this.consume().type
      const right = this.parseAddSub()
      return { type: 'cmp', op, left, right }
    }
    return left
  }
  parseAddSub() {
    let left = this.parseMulDiv()
    while (this.check(TOKEN_TYPES.PLUS) || this.check(TOKEN_TYPES.MINUS)) {
      const op = this.consume().type
      const right = this.parseMulDiv()
      left = { type: 'binop', op, left, right }
    }
    return left
  }
  parseMulDiv() {
    let left = this.parseUnary()
    while ([TOKEN_TYPES.STAR, TOKEN_TYPES.SLASH, TOKEN_TYPES.PERCENT].includes(this.peek().type)) {
      const op = this.consume().type
      const right = this.parseUnary()
      left = { type: 'binop', op, left, right }
    }
    return left
  }
  parseUnary() {
    if (this.match(TOKEN_TYPES.MINUS)) return { type: 'neg', operand: this.parseUnary() }
    return this.parsePrimary()
  }
  parsePrimary() {
    const tk = this.peek()
    if (tk.type === TOKEN_TYPES.NUMBER) { this.consume(); return { type: 'num', value: tk.value } }
    if (tk.type === TOKEN_TYPES.STRING) { this.consume(); return { type: 'str', value: tk.value } }
    if (tk.type === TOKEN_TYPES.BOOL)   { this.consume(); return { type: 'bool', value: tk.value } }
    if (tk.type === TOKEN_TYPES.NULL)   { this.consume(); return { type: 'null' } }
    if (tk.type === TOKEN_TYPES.LPAREN) {
      this.consume()
      const inner = this.parseOr()
      if (!this.match(TOKEN_TYPES.RPAREN)) throw new Error('Expected closing )')
      return inner
    }
    if (tk.type === TOKEN_TYPES.IDENT) {
      this.consume()
      if (this.check(TOKEN_TYPES.LPAREN)) {
        this.consume()
        const args = []
        if (!this.check(TOKEN_TYPES.RPAREN)) {
          args.push(this.parseOr())
          while (this.match(TOKEN_TYPES.COMMA)) args.push(this.parseOr())
        }
        if (!this.match(TOKEN_TYPES.RPAREN)) throw new Error('Expected closing ) after function args')
        return { type: 'call', name: tk.value.toUpperCase(), args }
      }
      return { type: 'ident', name: tk.value }
    }
    throw new Error(`Unexpected token: ${tk.type}`)
  }
}

// ─── Evaluator ────────────────────────────────────────────────────────────

function evalNode(node, ctx) {
  switch (node.type) {
    case 'num':  return node.value
    case 'str':  return node.value
    case 'bool': return node.value
    case 'null': return null
    case 'neg':  return -toNumber(evalNode(node.operand, ctx))
    case 'not':  return !toBool(evalNode(node.operand, ctx))
    case 'and':  return toBool(evalNode(node.left, ctx)) && toBool(evalNode(node.right, ctx))
    case 'or':   return toBool(evalNode(node.left, ctx)) || toBool(evalNode(node.right, ctx))
    case 'binop': {
      const a = evalNode(node.left, ctx)
      const b = evalNode(node.right, ctx)
      switch (node.op) {
        case TOKEN_TYPES.PLUS:    return (typeof a === 'string' || typeof b === 'string') ? String(a) + String(b) : toNumber(a) + toNumber(b)
        case TOKEN_TYPES.MINUS:   return toNumber(a) - toNumber(b)
        case TOKEN_TYPES.STAR:    return toNumber(a) * toNumber(b)
        case TOKEN_TYPES.SLASH:   { const d = toNumber(b); return d === 0 ? null : toNumber(a) / d }
        case TOKEN_TYPES.PERCENT: { const d = toNumber(b); return d === 0 ? null : toNumber(a) % d }
      }
      return null
    }
    case 'cmp': {
      const a = evalNode(node.left, ctx)
      const b = evalNode(node.right, ctx)
      switch (node.op) {
        case TOKEN_TYPES.EQ:  return a == b   // eslint-disable-line eqeqeq
        case TOKEN_TYPES.NEQ: return a != b   // eslint-disable-line eqeqeq
        case TOKEN_TYPES.LT:  return toComparable(a) < toComparable(b)
        case TOKEN_TYPES.GT:  return toComparable(a) > toComparable(b)
        case TOKEN_TYPES.LTE: return toComparable(a) <= toComparable(b)
        case TOKEN_TYPES.GTE: return toComparable(a) >= toComparable(b)
      }
      return null
    }
    case 'ident': return resolveIdent(node.name, ctx)
    case 'call':  return callFunction(node.name, node.args.map(a => evalNode(a, ctx)), ctx)
  }
  return null
}

function resolveIdent(name, ctx) {
  if (ctx.aggregates && Object.prototype.hasOwnProperty.call(ctx.aggregates, name)) {
    return ctx.aggregates[name]
  }
  if (ctx.row && Object.prototype.hasOwnProperty.call(ctx.row, name)) {
    return ctx.row[name]
  }
  return null
}

function callFunction(name, args, ctx) {
  switch (name) {
    case 'TODAY': return new Date(new Date().toISOString().slice(0, 10))
    case 'NOW':   return new Date()
    case 'IF':    return toBool(args[0]) ? args[1] : args[2]
    case 'ISNULL': return args[0] == null
    case 'ABS':   return Math.abs(toNumber(args[0]))
    case 'ROUND': {
      const digits = toNumber(args[1] ?? 0)
      const f = Math.pow(10, digits)
      return Math.round(toNumber(args[0]) * f) / f
    }
    case 'MIN': return args.length === 0 ? null : Math.min(...args.map(toNumber))
    case 'MAX': return args.length === 0 ? null : Math.max(...args.map(toNumber))
    case 'LEN': return String(args[0] ?? '').length
    case 'UPPER': return String(args[0] ?? '').toUpperCase()
    case 'LOWER': return String(args[0] ?? '').toLowerCase()
    case 'TRIM':  return String(args[0] ?? '').trim()
    case 'CONCATENATE': return args.map(a => a == null ? '' : String(a)).join('')
    case 'TEXT':  return args[0] == null ? '' : String(args[0])
    case 'YEAR':  { const d = toDate(args[0]); return d ? d.getFullYear() : null }
    case 'MONTH': { const d = toDate(args[0]); return d ? d.getMonth() + 1 : null }
    case 'DAY':   { const d = toDate(args[0]); return d ? d.getDate() : null }
    case 'DAYS_BETWEEN': {
      const a = toDate(args[0]); const b = toDate(args[1])
      if (!a || !b) return null
      return Math.floor((a.getTime() - b.getTime()) / 86400000)
    }
    // ── Extended catalog (additive; existing behavior unchanged) ──────────
    // Logical
    case 'AND': return args.every(toBool)
    case 'OR':  return args.some(toBool)
    case 'NOT': return !toBool(args[0])
    case 'CASE': {
      // CASE(value, match1, result1, [match2, result2, ...], else)
      const subject = args[0]
      let i = 1
      for (; i + 1 < args.length; i += 2) {
        if (subject == args[i]) return args[i + 1]   // eslint-disable-line eqeqeq
      }
      return i < args.length ? args[i] : null         // trailing else
    }
    case 'ISBLANK': return args[0] == null || args[0] === ''
    case 'BLANKVALUE': return (args[0] == null || args[0] === '') ? args[1] : args[0]
    case 'ISNUMBER': return Number.isFinite(typeof args[0] === 'number' ? args[0] : parseFloat(args[0]))
    // Math
    case 'CEILING': return Math.ceil(toNumber(args[0]))
    case 'FLOOR':   return Math.floor(toNumber(args[0]))
    case 'MOD':     { const d = toNumber(args[1]); return d === 0 ? null : toNumber(args[0]) % d }
    case 'POWER':   return Math.pow(toNumber(args[0]), toNumber(args[1]))
    case 'SQRT':    return Math.sqrt(toNumber(args[0]))
    case 'SUM':     return args.reduce((a, b) => a + toNumber(b), 0)
    case 'AVERAGE': return args.length ? args.reduce((a, b) => a + toNumber(b), 0) / args.length : null
    // Text
    case 'LEFT':  return String(args[0] ?? '').slice(0, Math.max(0, toNumber(args[1])))
    case 'RIGHT': { const s = String(args[0] ?? ''); const n = Math.max(0, toNumber(args[1])); return n === 0 ? '' : s.slice(-n) }
    case 'MID':   { const s = String(args[0] ?? ''); const start = Math.max(0, toNumber(args[1]) - 1); return s.slice(start, start + Math.max(0, toNumber(args[2]))) }
    case 'CONTAINS':    return String(args[0] ?? '').includes(String(args[1] ?? ''))
    case 'BEGINS':      return String(args[0] ?? '').startsWith(String(args[1] ?? ''))
    case 'ENDS':        return String(args[0] ?? '').endsWith(String(args[1] ?? ''))
    case 'SUBSTITUTE':  return String(args[0] ?? '').split(String(args[1] ?? '')).join(String(args[2] ?? ''))
    // Date
    case 'ADDDAYS': { const d = toDate(args[0]); if (!d) return null; const r = new Date(d); r.setDate(r.getDate() + toNumber(args[1])); return r }
    case 'WEEKDAY': { const d = toDate(args[0]); return d ? d.getDay() + 1 : null }   // 1=Sun … 7=Sat
    case 'DATEVALUE': return toDate(args[0])
  }
  throw new Error(`Unknown function: ${name}`)
}

function toNumber(v) {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v instanceof Date) return v.getTime()
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}
function toBool(v) {
  if (v == null) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v.length > 0 && v.toLowerCase() !== 'false'
  return !!v
}
function toComparable(v) {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'string') {
    // Try ISO date parse
    const d = new Date(v)
    if (!isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(v)) return d.getTime()
  }
  return v
}
function toDate(v) {
  if (v == null) return null
  if (v instanceof Date) return v
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Evaluate a calculated-field expression in the context of a single row.
 * Used for row-scope formulas. The row argument is a flat object mapping
 * column name → value (after FK label / picklist resolution).
 *
 * Returns the evaluated value, or null on parse/eval error (logged).
 */
export function evaluateRowExpression(expression, row) {
  try {
    const tokens = tokenize(expression)
    const ast = new Parser(tokens).parse()
    return evalNode(ast, { row, aggregates: null })
  } catch (err) {
    console.warn(`Calc-field eval failed for "${expression}":`, err.message)
    return null
  }
}

/**
 * Evaluate a summary-scope expression with pre-computed aggregates.
 * `aggregates` is an object keyed by SUM_<field> / COUNT_<field> /
 * AVG_<field> / MIN_<field> / MAX_<field>, computed by the runner from
 * a group's row set before the expression is evaluated.
 */
export function evaluateSummaryExpression(expression, aggregates) {
  try {
    const tokens = tokenize(expression)
    const ast = new Parser(tokens).parse()
    return evalNode(ast, { row: null, aggregates })
  } catch (err) {
    console.warn(`Summary calc-field eval failed for "${expression}":`, err.message)
    return null
  }
}

/**
 * Validate an expression's SYNTAX (tokenize + parse) without evaluating it.
 * Powers the formula editor's "Check syntax" + live error feedback, using the
 * exact same parser the runtime uses — so a formula that validates here will
 * parse at run time. Returns { ok: true } or { ok: false, error: string }.
 */
export function validateExpression(expression) {
  if (!expression || !expression.trim()) return { ok: false, error: 'Empty formula' }
  try {
    const ast = new Parser(tokenize(expression)).parse()
    checkFunctionsExist(ast)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// Walk the AST and reject calls to unknown functions at validate time (rather
// than only at eval time), so the editor catches typos like SUMM(...).
function checkFunctionsExist(node) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'call' && !FUNCTION_NAMES.has(node.name)) {
    throw new Error(`Unknown function: ${node.name}`)
  }
  for (const k of Object.keys(node)) {
    const v = node[k]
    if (Array.isArray(v)) v.forEach(checkFunctionsExist)
    else if (v && typeof v === 'object') checkFunctionsExist(v)
  }
}

/**
 * Catalog of supported functions, grouped for the formula editor's insert
 * picker (name, signature template, one-line description). The set mirrors the
 * cases in callFunction above.
 */
export const FORMULA_FUNCTIONS = [
  { category: 'Logical', items: [
    { name: 'IF', template: 'IF(condition, value_if_true, value_if_false)', desc: 'Returns one value if a condition is true, another if false.' },
    { name: 'CASE', template: 'CASE(expression, match1, result1, else_result)', desc: 'Compares an expression to matches and returns the matching result.' },
    { name: 'ISBLANK', template: 'ISBLANK(value)', desc: 'TRUE if the value is null or empty.' },
    { name: 'BLANKVALUE', template: 'BLANKVALUE(value, fallback)', desc: 'Returns fallback when value is blank.' },
    { name: 'ISNUMBER', template: 'ISNUMBER(value)', desc: 'TRUE if the value is numeric.' },
  ] },
  { category: 'Math', items: [
    { name: 'ABS', template: 'ABS(number)', desc: 'Absolute value.' },
    { name: 'ROUND', template: 'ROUND(number, digits)', desc: 'Rounds to the given decimal places.' },
    { name: 'CEILING', template: 'CEILING(number)', desc: 'Rounds up to the nearest integer.' },
    { name: 'FLOOR', template: 'FLOOR(number)', desc: 'Rounds down to the nearest integer.' },
    { name: 'MOD', template: 'MOD(number, divisor)', desc: 'Remainder after division.' },
    { name: 'POWER', template: 'POWER(number, exponent)', desc: 'Raises a number to a power.' },
    { name: 'SQRT', template: 'SQRT(number)', desc: 'Square root.' },
    { name: 'MIN', template: 'MIN(a, b)', desc: 'Smallest of the arguments.' },
    { name: 'MAX', template: 'MAX(a, b)', desc: 'Largest of the arguments.' },
    { name: 'SUM', template: 'SUM(a, b)', desc: 'Adds the arguments.' },
    { name: 'AVERAGE', template: 'AVERAGE(a, b)', desc: 'Mean of the arguments.' },
  ] },
  { category: 'Text', items: [
    { name: 'CONCATENATE', template: 'CONCATENATE(text1, text2)', desc: 'Joins text values.' },
    { name: 'TEXT', template: 'TEXT(value)', desc: 'Converts a value to text.' },
    { name: 'LEN', template: 'LEN(text)', desc: 'Number of characters.' },
    { name: 'LEFT', template: 'LEFT(text, count)', desc: 'Leftmost characters.' },
    { name: 'RIGHT', template: 'RIGHT(text, count)', desc: 'Rightmost characters.' },
    { name: 'MID', template: 'MID(text, start, count)', desc: 'Characters from the middle (1-based).' },
    { name: 'UPPER', template: 'UPPER(text)', desc: 'Uppercase.' },
    { name: 'LOWER', template: 'LOWER(text)', desc: 'Lowercase.' },
    { name: 'TRIM', template: 'TRIM(text)', desc: 'Removes leading/trailing spaces.' },
    { name: 'CONTAINS', template: 'CONTAINS(text, substring)', desc: 'TRUE if text contains the substring.' },
    { name: 'BEGINS', template: 'BEGINS(text, prefix)', desc: 'TRUE if text starts with the prefix.' },
    { name: 'ENDS', template: 'ENDS(text, suffix)', desc: 'TRUE if text ends with the suffix.' },
    { name: 'SUBSTITUTE', template: 'SUBSTITUTE(text, old, new)', desc: 'Replaces occurrences of old with new.' },
  ] },
  { category: 'Date', items: [
    { name: 'TODAY', template: 'TODAY()', desc: "Today's date." },
    { name: 'NOW', template: 'NOW()', desc: 'Current date and time.' },
    { name: 'YEAR', template: 'YEAR(date)', desc: 'Year component.' },
    { name: 'MONTH', template: 'MONTH(date)', desc: 'Month (1–12).' },
    { name: 'DAY', template: 'DAY(date)', desc: 'Day of month.' },
    { name: 'WEEKDAY', template: 'WEEKDAY(date)', desc: 'Day of week (1=Sun … 7=Sat).' },
    { name: 'DAYS_BETWEEN', template: 'DAYS_BETWEEN(date1, date2)', desc: 'Whole days between two dates.' },
    { name: 'ADDDAYS', template: 'ADDDAYS(date, n)', desc: 'Adds n days to a date.' },
    { name: 'DATEVALUE', template: 'DATEVALUE(text)', desc: 'Parses text into a date.' },
  ] },
]

const FUNCTION_NAMES = new Set(FORMULA_FUNCTIONS.flatMap(g => g.items.map(i => i.name)))

/**
 * Compute aggregates over a group of rows. Looks up each numeric column
 * once and emits SUM_, COUNT_, AVG_, MIN_, MAX_ values keyed by column.
 */
export function computeAggregates(rows, columnNames) {
  const out = {}
  for (const col of columnNames) {
    const values = rows.map(r => r[col]).filter(v => v != null && v !== '').map(toNumber)
    out[`COUNT_${col}`] = rows.filter(r => r[col] != null && r[col] !== '').length
    if (values.length === 0) {
      out[`SUM_${col}`] = 0
      out[`AVG_${col}`] = null
      out[`MIN_${col}`] = null
      out[`MAX_${col}`] = null
    } else {
      const sum = values.reduce((a, b) => a + b, 0)
      out[`SUM_${col}`] = sum
      out[`AVG_${col}`] = sum / values.length
      out[`MIN_${col}`] = Math.min(...values)
      out[`MAX_${col}`] = Math.max(...values)
    }
  }
  return out
}
