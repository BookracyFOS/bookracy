import { jsPDF } from 'jspdf';
import { fetchFile } from './fetchFile';
import { handleEpub, EpubParsedData, EpubNavPoint } from './handleEpub';
import { htmlToText } from './htmlToText';
import { DOMParser as XMLDOMParser } from '@xmldom/xmldom';
import './polyfills/node-globals';
import { debug, warn, setDebug } from './log';

import * as csstree from 'css-tree';
import type {
  CssNode,
  Rule as CssRule,
  Declaration as CssDeclaration,
  SelectorList as CssSelectorList,
  Selector as CssSelector,
  TypeSelector as CssTypeSelector,
  ClassSelector as CssClassSelector,
  IdSelector as CssIdSelector,
} from 'css-tree';

/* -------------------------------------------------------------- */
/* types                                                          */
type TextAlign = 'left' | 'center' | 'right' | 'justify';

interface PdfStyle {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  textColor: string;
  textAlign: TextAlign;
}

type JsPdfSupportedImageFormat = 'PNG' | 'JPEG' | 'WEBP' | 'GIF' | 'BMP';

interface PdfContext {
  pdf: jsPDF;
  currentPageWidth: number;
  currentPageHeight: number;
  margin: number;
  contentWidth: number;
  contentHeight: number;
  currentY: number;
  currentPdfPageNumber: number;
  addedContentToCurrentPdfPage: boolean;
  defaultStyle: PdfStyle;
  lineHeightMultiplier: number;
  resources: Map<string, ArrayBuffer>;
  opfFileDirectory: string;
  currentHtmlPagePath: string;
  registeredFamilies: Map<string, string>;
  registeredStyles: Map<string, Set<string>>;
  fontKey: string;
  /** Last colour handed to jsPDF, so runs don't re-emit it word by word. */
  colorKey: string;
  /** A registered family that covers non-Latin text, when one was loaded. */
  unicodeFamily?: string;
}

/* A single piece of inline content gathered from a block element. */
type InlineItem =
  | { kind: 'word'; text: string; width: number; style: PdfStyle; href?: string }
  | { kind: 'space'; width: number; style: PdfStyle; href?: string }
  | { kind: 'break' }
  | { kind: 'image'; bytes: Uint8Array; width: number; height: number; format: JsPdfSupportedImageFormat };

/* The subset of inline items the (pure, testable) line packer understands. */
export type LineToken =
  | { kind: 'word'; text: string; width: number; style?: PdfStyle; href?: string }
  | { kind: 'space'; width: number; style?: PdfStyle; href?: string }
  | { kind: 'break' };

export interface ComposedLine {
  tokens: LineToken[];
  naturalWidth: number;
  forced: boolean;
}

interface CssDecls {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  textColor?: string;
  textAlign?: TextAlign;
}

interface CssRules {
  byTag: Map<string, CssDecls>;
  byClass: Map<string, CssDecls>;
  byId: Map<string, CssDecls>;
}

/* -------------------------------------------------------------- */
/* constants                                                      */
const DEFAULT_FONT_FAMILY = 'helvetica';
const DEFAULT_TEXT_COLOR = '#000000';
const PARAGRAPH_SPACING = 8;
const LIST_INDENT_STEP = 20;
const LIST_ITEM_SPACING = 4;
const DEPTH_LIMIT = 750;

/* jsPDF's built-in fonts (helvetica/times/courier) are single-byte WinAnsi: Latin-1
   plus the usual typographic extras. Anything else — Cyrillic, Greek, CJK, most
   symbols — comes out as garbage unless an embedded or fallback TrueType font draws
   it. This is the exact set WinAnsi can show, so text outside it can be re-routed. */
const WIN_ANSI_EXTRA = '\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178';
const NON_WIN_ANSI_RE = new RegExp(`[^\\u0000-\\u00FF${WIN_ANSI_EXTRA}]`);
const isWinAnsi = (text: string): boolean => !NON_WIN_ANSI_RE.test(text);
/** jsPDF's single-byte standard fonts (it lists them in both cases; compare lowercased). */
const STANDARD_FAMILIES = new Set(['helvetica', 'times', 'courier', 'symbol', 'zapfdingbats']);

const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'big', 'cite', 'code', 'data', 'dfn', 'em',
  'i', 'ins', 'kbd', 'label', 'mark', 'q', 's', 'samp', 'small', 'span',
  'strike', 'strong', 'sub', 'sup', 'time', 'tt', 'u', 'var', 'wbr', 'font', 'del',
]);

/* -------------------------------------------------------------- */
/* path + image helpers                                           */
const normalizePath = (base: string, relative: string): string => {
  if (!relative) return base;
  if (relative.startsWith('/')) {
    if (!base || base === '.') return relative.substring(1);
  }
  const stack = base.split('/');
  const parts = relative.split('/');
  if (stack.length && (stack.at(-1) === '' || stack.at(-1) === '.')) stack.pop();
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') {
      if (stack.length && stack.at(-1) !== '') stack.pop();
    } else stack.push(p);
  }
  return stack.join('/');
};

const resolveImagePath = (opfDir: string, htmlHref: string, src: string): string => {
  if (!src || /^(data:|https?:)/i.test(src)) return src;
  const htmlFull = normalizePath(opfDir, htmlHref);
  const htmlDir = htmlFull.includes('/') ? htmlFull.slice(0, htmlFull.lastIndexOf('/') + 1) : '';
  const img = normalizePath(htmlDir, src);
  return opfDir && img.startsWith(opfDir) ? img.slice(opfDir.length) : img;
};

const addNewPage = (ctx: PdfContext) => {
  ctx.pdf.addPage();
  ctx.currentPdfPageNumber++;
  ctx.currentY = ctx.margin;
  ctx.addedContentToCurrentPdfPage = false;
};

/* Browser- and Node-safe base64 (no Buffer, chunked to avoid blowing the
   call stack on String.fromCharCode(...hugeArray) for large fonts/images). */
const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

const prepareImage = (
  pdf: jsPDF,
  data: ArrayBuffer,
): { bytes: Uint8Array; width: number; height: number; format: JsPdfSupportedImageFormat } => {
  const bytes = new Uint8Array(data);
  const props = pdf.getImageProperties(bytes);
  let format = String(props.fileType || '').toUpperCase();
  if (format === 'JPG') format = 'JPEG';
  return {
    bytes,
    width: props.width,
    height: props.height,
    format: (format || 'JPEG') as JsPdfSupportedImageFormat,
  };
};

/* -------------------------------------------------------------- */
/* CSS parsing (tag / class / id cascade) + inline style attrs     */
const NAMED_COLORS: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000',
  blue: '#0000ff', gray: '#808080', grey: '#808080', silver: '#c0c0c0',
  maroon: '#800000', navy: '#000080', purple: '#800080', orange: '#ffa500',
  yellow: '#ffff00', teal: '#008080', olive: '#808000', lime: '#00ff00',
};

const parseColor = (raw: string): string | undefined => {
  const v = raw.trim().toLowerCase();
  if (!v) return undefined;
  if (v.startsWith('#')) {
    if (v.length === 4) return '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    if (v.length === 7) return v;
    return undefined;
  }
  const m = v.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(',').map((s) => parseFloat(s));
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      return '#' + parts.slice(0, 3)
        .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'))
        .join('');
    }
  }
  return NAMED_COLORS[v];
};

const parseFontSize = (raw: string, baseSize: number): number | undefined => {
  const v = raw.trim().toLowerCase();
  let n = NaN;
  if (v.endsWith('pt')) n = parseFloat(v);
  else if (v.endsWith('px')) n = parseFloat(v) * 0.75;
  else if (v.endsWith('rem')) n = parseFloat(v) * baseSize;
  else if (v.endsWith('em')) n = parseFloat(v) * baseSize;
  else if (v.endsWith('%')) n = (parseFloat(v) / 100) * baseSize;
  else if (!isNaN(parseFloat(v))) n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.max(5, Math.min(48, n));
};

const declFromProp = (prop: string, valueStr: string, baseSize: number): CssDecls => {
  const v = valueStr.trim();
  if (!v) return {};
  switch (prop) {
    case 'color': { const c = parseColor(v); return c ? { textColor: c } : {}; }
    case 'font-family': { const fam = v.split(',')[0].replace(/["']/g, '').trim(); return fam ? { fontFamily: fam } : {}; }
    case 'font-size': { const s = parseFontSize(v, baseSize); return s ? { fontSize: s } : {}; }
    case 'font-weight': {
      const lw = v.toLowerCase();
      const num = parseInt(lw, 10);
      if (lw === 'bold' || lw === 'bolder' || (Number.isFinite(num) && num >= 600)) return { bold: true };
      if (lw === 'normal' || lw === 'lighter' || (Number.isFinite(num) && num < 600)) return { bold: false };
      return {};
    }
    case 'font-style': {
      const lw = v.toLowerCase();
      if (lw === 'italic' || lw === 'oblique') return { italic: true };
      if (lw === 'normal') return { italic: false };
      return {};
    }
    case 'text-align': {
      const lw = v.toLowerCase();
      if (lw === 'left' || lw === 'center' || lw === 'right' || lw === 'justify') return { textAlign: lw };
      return {};
    }
    default: return {};
  }
};

const parseInlineDecls = (styleAttr: string, baseSize: number): CssDecls => {
  const decls: CssDecls = {};
  for (const part of styleAttr.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const p = part.slice(0, i).trim().toLowerCase();
    const val = part.slice(i + 1).trim();
    if (p && val) Object.assign(decls, declFromProp(p, val, baseSize));
  }
  return decls;
};

const mergeInto = (map: Map<string, CssDecls>, key: string, decls: CssDecls) => {
  if (!key) return;
  map.set(key, { ...(map.get(key) || {}), ...decls });
};

const parseCss = (cssArr: string[], baseSize: number): CssRules => {
  const rules: CssRules = { byTag: new Map(), byClass: new Map(), byId: new Map() };
  for (const css of cssArr) {
    try {
      const ast = csstree.parse(css);
      csstree.walk(ast, (node: CssNode) => {
        if (node.type !== 'Rule') return;
        const rule = node as CssRule;
        if (rule.prelude.type !== 'SelectorList') return;

        const decls: CssDecls = {};
        if (rule.block && rule.block.type === 'Block') {
          rule.block.children.forEach((dn: CssNode) => {
            if (dn.type !== 'Declaration') return;
            const d = dn as CssDeclaration;
            let valueStr = '';
            try { valueStr = csstree.generate(d.value); } catch { valueStr = ''; }
            Object.assign(decls, declFromProp(d.property.toLowerCase(), valueStr, baseSize));
          });
        }
        if (!Object.keys(decls).length) return;

        (rule.prelude as CssSelectorList).children.forEach((selNode: CssNode) => {
          if (selNode.type !== 'Selector') return;
          const types: string[] = [];
          const classes: string[] = [];
          const ids: string[] = [];
          let complex = false;
          (selNode as CssSelector).children.forEach((c: CssNode) => {
            switch (c.type) {
              case 'TypeSelector': types.push((c as CssTypeSelector).name.toLowerCase()); break;
              case 'ClassSelector': classes.push((c as CssClassSelector).name); break;
              case 'IdSelector': ids.push((c as CssIdSelector).name); break;
              case 'Combinator': case 'WhiteSpace':
              case 'PseudoClassSelector': case 'PseudoElementSelector':
              case 'AttributeSelector': case 'Nth': complex = true; break;
              default: break;
            }
          });
          if (complex) return;
          if (ids.length === 1 && !types.length && !classes.length) { mergeInto(rules.byId, ids[0], decls); return; }
          if (classes.length === 1 && !ids.length) { mergeInto(rules.byClass, classes[0], decls); return; }
          if (types.length === 1 && !classes.length && !ids.length) { mergeInto(rules.byTag, types[0], decls); return; }
        });
      });
    } catch (e) {
      warn('BUILDPDF_WARN - CSS parse error:', e);
    }
  }
  return rules;
};

const applyCssToStyle = (style: PdfStyle, el: Element, css: CssRules, baseSize: number): PdfStyle => {
  const apply = (d?: CssDecls) => {
    if (!d) return;
    if (d.fontFamily !== undefined) style.fontFamily = d.fontFamily;
    if (d.fontSize !== undefined) style.fontSize = d.fontSize;
    if (d.bold !== undefined) style.bold = d.bold;
    if (d.italic !== undefined) style.italic = d.italic;
    if (d.textColor !== undefined) style.textColor = d.textColor;
    if (d.textAlign !== undefined) style.textAlign = d.textAlign;
  };
  apply(css.byTag.get(el.nodeName.toLowerCase()));
  const clsAttr = el.getAttribute('class');
  if (clsAttr) for (const c of clsAttr.split(/\s+/)) if (c) apply(css.byClass.get(c));
  const id = el.getAttribute('id');
  if (id) apply(css.byId.get(id));
  const inlineStyle = el.getAttribute('style');
  if (inlineStyle) apply(parseInlineDecls(inlineStyle, baseSize));
  return style;
};

/* -------------------------------------------------------------- */
/* font safety: never let an unknown CSS font crash setFont()      */
const buildRegisteredFonts = (pdf: jsPDF, ctx: { registeredFamilies: Map<string, string>; registeredStyles: Map<string, Set<string>> }) => {
  const list = pdf.getFontList();
  for (const fam of Object.keys(list)) {
    ctx.registeredFamilies.set(fam.toLowerCase(), fam);
    const styles = (list[fam] && list[fam].length ? list[fam] : ['normal']) as string[];
    ctx.registeredStyles.set(fam, new Set(styles));
  }
};

const resolveFamily = (ctx: PdfContext, fam: string): string => {
  const f = (fam || '').toLowerCase().replace(/["']/g, '').trim();
  const exact = ctx.registeredFamilies.get(f);
  if (exact) return exact;
  if (f.includes('mono') || f.includes('courier') || f.includes('consol') || f.includes('menlo')) return 'courier';
  if (f.includes('sans')) return 'helvetica';
  if (f.includes('serif') || f.includes('times') || f.includes('georgia') || f.includes('roman') || f.includes('garamond') || f.includes('minion')) return 'times';
  return ctx.registeredFamilies.get(DEFAULT_FONT_FAMILY) || DEFAULT_FONT_FAMILY;
};

const resolveStyle = (ctx: PdfContext, family: string, bold: boolean, italic: boolean): string => {
  const want = bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal';
  const avail = ctx.registeredStyles.get(family) || new Set(['normal']);
  const cascade: Record<string, string[]> = {
    bolditalic: ['bolditalic', 'bold', 'italic', 'normal'],
    bold: ['bold', 'bolditalic', 'normal'],
    italic: ['italic', 'bolditalic', 'normal'],
    normal: ['normal'],
  };
  for (const c of cascade[want]) if (avail.has(c)) return c;
  const first = avail.values().next().value;
  return first || 'normal';
};

const setFontSafe = (ctx: PdfContext, style: PdfStyle) => {
  const fam = resolveFamily(ctx, style.fontFamily);
  const st = resolveStyle(ctx, fam, style.bold, style.italic);
  const key = fam + '|' + st;
  if (ctx.fontKey !== key) {
    try { ctx.pdf.setFont(fam, st); }
    catch { try { ctx.pdf.setFont(DEFAULT_FONT_FAMILY, 'normal'); } catch { /* ignore */ } }
    ctx.fontKey = key;
  }
  ctx.pdf.setFontSize(style.fontSize);
};

const measureWidth = (ctx: PdfContext, text: string, style: PdfStyle): number => {
  setFontSafe(ctx, style);
  return ctx.pdf.getTextWidth(text);
};

/* -------------------------------------------------------------- */
/* inline collection: flatten a block's inline content into tokens */
const tokenizeText = (raw: string, style: PdfStyle, href: string | undefined, out: InlineItem[], ctx: PdfContext) => {
  const norm = raw.replace(/\s+/g, ' ');
  if (norm === '') return;
  const spaceWidth = measureWidth(ctx, ' ', style);
  if (norm[0] === ' ') out.push({ kind: 'space', width: spaceWidth, style, href });
  const words = norm.trim().split(' ').filter((w) => w.length);
  for (let i = 0; i < words.length; i++) {
    // A word the current font can't encode is drawn with the Unicode fallback (same
    // size/weight) when one was loaded; without it jsPDF would emit garbage bytes.
    let wordStyle = style;
    if (ctx.unicodeFamily && !isWinAnsi(words[i]) && STANDARD_FAMILIES.has(resolveFamily(ctx, style.fontFamily).toLowerCase())) {
      wordStyle = { ...style, fontFamily: ctx.unicodeFamily };
    }
    out.push({ kind: 'word', text: words[i], width: measureWidth(ctx, words[i], wordStyle), style: wordStyle, href });
    if (i < words.length - 1) out.push({ kind: 'space', width: spaceWidth, style, href });
  }
  if (norm.length > 1 && norm[norm.length - 1] === ' ') out.push({ kind: 'space', width: spaceWidth, style, href });
};

const makeImageItem = (ctx: PdfContext, el: Element): InlineItem | null => {
  const src = el.getAttribute('src');
  if (!src) return null;
  const key = resolveImagePath(ctx.opfFileDirectory, ctx.currentHtmlPagePath, src);
  if (!ctx.resources.has(key)) return null;
  try {
    const { bytes, width, height, format } = prepareImage(ctx.pdf, ctx.resources.get(key)!);
    return { kind: 'image', bytes, width, height, format };
  } catch (e) {
    warn('BUILDPDF_WARN - inline image skipped', e);
    return null;
  }
};

const collectInlineNode = (node: ChildNode, ctx: PdfContext, style: PdfStyle, css: CssRules, out: InlineItem[], href: string | undefined) => {
  if (node.nodeType === Node.TEXT_NODE) {
    tokenizeText(node.textContent || '', style, href, out, ctx);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tag = el.nodeName.toLowerCase();
  if (tag === 'br') { out.push({ kind: 'break' }); return; }
  if (tag === 'img') { const it = makeImageItem(ctx, el); if (it) out.push(it); return; }

  const s: PdfStyle = { ...style };
  if (tag === 'b' || tag === 'strong') s.bold = true;
  if (tag === 'i' || tag === 'em' || tag === 'cite' || tag === 'dfn' || tag === 'var') s.italic = true;
  if (tag === 'code' || tag === 'kbd' || tag === 'samp' || tag === 'tt') s.fontFamily = 'courier';
  if (tag === 'small' || tag === 'sub' || tag === 'sup') s.fontSize = Math.max(6, s.fontSize * 0.83);
  if (tag === 'big') s.fontSize = s.fontSize * 1.15;
  applyCssToStyle(s, el, css, ctx.defaultStyle.fontSize);

  let nextHref = href;
  if (tag === 'a') {
    const h = el.getAttribute('href');
    if (h && !h.startsWith('#')) nextHref = h;
  }
  for (const c of Array.from(el.childNodes)) collectInlineNode(c, ctx, s, css, out, nextHref);
};

const collectInline = (el: Element, ctx: PdfContext, style: PdfStyle, css: CssRules): InlineItem[] => {
  const out: InlineItem[] = [];
  for (const c of Array.from(el.childNodes)) collectInlineNode(c, ctx, style, css, out, undefined);
  return out;
};

/* -------------------------------------------------------------- */
/* pure line packer (exported for unit tests): the heart of the    */
/* one-word-per-line fix. Greedily packs words+spaces into lines   */
/* up to availWidth; honours <br>; trims trailing spaces.          */
export function composeLines(tokens: LineToken[], availWidth: number): ComposedLine[] {
  const lines: ComposedLine[] = [];
  let cur: LineToken[] = [];
  let curWidth = 0;

  const flush = (forced: boolean, allowEmpty: boolean) => {
    let last = cur[cur.length - 1];
    while (last && last.kind === 'space') {
      curWidth -= last.width;
      cur.pop();
      last = cur[cur.length - 1];
    }
    if (cur.length > 0 || allowEmpty) lines.push({ tokens: cur, naturalWidth: curWidth, forced });
    cur = [];
    curWidth = 0;
  };

  // A single word wider than the line (a URL, a long compound, a run of dashes)
  // used to be placed whole and run off the page. Split it into pieces that fit,
  // proportionally by character count — exact per-glyph widths aren't needed for
  // a break that is already typographically ugly.
  const fit = (t: LineToken): LineToken[] => {
    if (t.kind !== 'word' || t.width <= availWidth || t.text.length < 2) return [t];
    const perChar = t.width / t.text.length;
    const chunkLen = Math.max(1, Math.floor(availWidth / perChar));
    const out: LineToken[] = [];
    for (let i = 0; i < t.text.length; i += chunkLen) {
      const piece = t.text.slice(i, i + chunkLen);
      out.push({ ...t, text: piece, width: piece.length * perChar });
    }
    return out;
  };

  for (const raw of tokens) {
    for (const t of fit(raw)) {
      if (t.kind === 'break') { flush(true, true); continue; }
      if (t.kind === 'space') {
        if (cur.length === 0) continue;
        if (cur[cur.length - 1].kind === 'space') continue;
        cur.push(t); curWidth += t.width;
        continue;
      }
      if (cur.length > 0 && curWidth + t.width > availWidth) flush(false, false);
      cur.push(t); curWidth += t.width;
    }
  }
  flush(true, false);
  return lines;
}

/* -------------------------------------------------------------- */
/* drawing                                                         */
const lineMaxFontSize = (line: ComposedLine, fallback: number): number => {
  let max = 0;
  for (const t of line.tokens) if (t.kind === 'word' && t.style) max = Math.max(max, t.style.fontSize);
  return max || fallback;
};

const drawComposedLine = (ctx: PdfContext, line: ComposedLine, leftX: number, availWidth: number, align: TextAlign, fallbackSize: number) => {
  const maxSize = lineMaxFontSize(line, fallbackSize);
  const lineHeight = maxSize * ctx.lineHeightMultiplier;

  if (ctx.currentY + lineHeight > ctx.currentPageHeight - ctx.margin) {
    if (ctx.addedContentToCurrentPdfPage) addNewPage(ctx);
    else ctx.currentY = ctx.margin;
  }

  const gap = availWidth - line.naturalWidth;
  let startX = leftX;
  let extraPerSpace = 0;
  if (align === 'center') startX = leftX + Math.max(0, gap) / 2;
  else if (align === 'right') startX = leftX + Math.max(0, gap);
  else if (align === 'justify' && !line.forced) {
    const spaces = line.tokens.filter((t) => t.kind === 'space').length;
    if (spaces > 0 && gap > 0) extraPerSpace = gap / spaces;
  }

  /* Draw in RUNS of consecutive tokens that share a style and link, one pdf.text()
     per run. Word-by-word drawing emitted a text object per word — a 120-page book
     was 5.9 MB — and it is also why justification had to be simulated. A run's
     width is the sum of its measured tokens, so the layout is unchanged. */
  type Run = { text: string; width: number; spaces: number; style: PdfStyle; href?: string; x: number };
  const runs: Run[] = [];
  let x = startX;
  let cur: Run | null = null;
  const same = (a: Exclude<LineToken, { kind: 'break' }>, r: Run) => (a.style || ctx.defaultStyle) === r.style && a.href === r.href;
  for (const t of line.tokens) {
    if (t.kind !== 'word' && t.kind !== 'space') continue;
    const st = t.style || ctx.defaultStyle;
    if (!cur || !same(t, cur)) {
      if (cur) x += cur.width + cur.spaces * extraPerSpace;
      cur = { text: '', width: 0, spaces: 0, style: st, href: t.href, x };
      runs.push(cur);
    }
    if (t.kind === 'space') { cur.text += ' '; cur.spaces += 1; }
    else cur.text += t.text;
    cur.width += t.width;
  }

  for (const r of runs) {
    if (!r.text.trim()) continue;
    setFontSafe(ctx, r.style);
    const color = r.style.textColor || DEFAULT_TEXT_COLOR;
    if (ctx.colorKey !== color) { ctx.pdf.setTextColor(color); ctx.colorKey = color; }
    const drawnWidth = r.width + r.spaces * extraPerSpace;
    if (extraPerSpace > 0 && r.spaces > 0) {
      if (STANDARD_FAMILIES.has(resolveFamily(ctx, r.style.fontFamily).toLowerCase())) {
        // Real justification: PDF word spacing (Tw) widens every space in the run.
        // It only applies to single-byte fonts, which the standard fonts are.
        const write = (ctx.pdf.internal as unknown as { write: (s: string) => void }).write;
        write.call(ctx.pdf.internal, `${extraPerSpace.toFixed(3)} Tw`);
        ctx.pdf.text(r.text, r.x, ctx.currentY, { baseline: 'top' });
        write.call(ctx.pdf.internal, '0 Tw');
      } else {
        // An embedded/Unicode font is two-byte: Tw is ignored, so place words by hand.
        let wx = r.x;
        const spaceW = measureWidth(ctx, ' ', r.style);
        for (const w of r.text.split(' ')) {
          if (w) { ctx.pdf.text(w, wx, ctx.currentY, { baseline: 'top' }); wx += measureWidth(ctx, w, r.style); }
          wx += spaceW + extraPerSpace;
        }
      }
    } else {
      ctx.pdf.text(r.text, r.x, ctx.currentY, { baseline: 'top' });
    }
    if (r.href) {
      try { ctx.pdf.link(r.x, ctx.currentY, drawnWidth, lineHeight, { url: r.href }); } catch { /* ignore */ }
    }
  }

  ctx.currentY += lineHeight;
  ctx.addedContentToCurrentPdfPage = true;
};

const placeImageBlock = (ctx: PdfContext, item: Extract<InlineItem, { kind: 'image' }>, leftX: number, availWidth: number) => {
  let w = item.width;
  let h = item.height;
  const r = h > 0 ? w / h : 1;
  if (w > availWidth) { w = availWidth; h = w / r; }
  const maxH = ctx.currentPageHeight - 2 * ctx.margin;
  if (h > maxH) { h = maxH; w = h * r; }
  if (ctx.currentY + h > ctx.currentPageHeight - ctx.margin && ctx.addedContentToCurrentPdfPage) addNewPage(ctx);
  const x = leftX + Math.max(0, (availWidth - w) / 2);
  try {
    ctx.pdf.addImage(item.bytes, item.format, x, ctx.currentY, w, h);
    ctx.currentY += h + 10;
    ctx.addedContentToCurrentPdfPage = true;
  } catch (e) {
    warn('BUILDPDF_WARN - addImage failed', e);
  }
};

/* Render a flat run of inline items as a paragraph: split out block-ish
   images, pack the rest into wrapped lines, then draw. */
const renderInlineFlow = (
  ctx: PdfContext,
  items: InlineItem[],
  style: PdfStyle,
  leftIndent: number,
  spacingBefore: number,
  spacingAfter: number,
) => {
  const hasContent = items.some((it) => it.kind === 'word' || it.kind === 'image');
  if (!hasContent) return;

  ctx.currentY += spacingBefore;
  const leftX = ctx.margin + leftIndent;
  const availWidth = ctx.contentWidth - leftIndent;

  let seg: LineToken[] = [];
  const flushSeg = () => {
    if (!seg.length) return;
    for (const ln of composeLines(seg, availWidth)) drawComposedLine(ctx, ln, leftX, availWidth, style.textAlign, style.fontSize);
    seg = [];
  };

  for (const it of items) {
    if (it.kind === 'image') { flushSeg(); placeImageBlock(ctx, it, leftX, availWidth); continue; }
    seg.push(it);
  }
  flushSeg();
  ctx.currentY += spacingAfter;
};

/* -------------------------------------------------------------- */
/* block processing (mutually recursive -> function declarations)  */
function hasBlockChildren(el: Element): boolean {
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      const tag = (n as Element).nodeName.toLowerCase();
      if (!INLINE_TAGS.has(tag) && tag !== 'img' && tag !== 'br') return true;
    }
  }
  return false;
}

function listStart(el: Element): number {
  const s = parseInt(el.getAttribute('start') || '1', 10);
  return Number.isFinite(s) ? s : 1;
}

function textToInlineItems(text: string, style: PdfStyle, ctx: PdfContext): InlineItem[] {
  const out: InlineItem[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    tokenizeText(lines[i], style, undefined, out, ctx);
    if (i < lines.length - 1) out.push({ kind: 'break' });
  }
  return out;
}

function processContainer(el: Element, ctx: PdfContext, style: PdfStyle, css: CssRules, indent: number, depth: number): void {
  if (depth > DEPTH_LIMIT) { warn(`BUILDPDF_WARN - depth>${DEPTH_LIMIT} skip ${ctx.currentHtmlPagePath}`); return; }
  let buf: InlineItem[] = [];
  const flushInline = () => {
    if (buf.length) { renderInlineFlow(ctx, buf, style, indent, 0, PARAGRAPH_SPACING / 2); buf = []; }
  };
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as Element;
      const tag = child.nodeName.toLowerCase();
      if (INLINE_TAGS.has(tag) || tag === 'img' || tag === 'br') {
        collectInlineNode(child, ctx, style, css, buf, undefined);
      } else {
        flushInline();
        processBlock(child, ctx, style, css, indent, depth);
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      collectInlineNode(node, ctx, style, css, buf, undefined);
    }
  }
  flushInline();
}

function processList(list: Element, ctx: PdfContext, style: PdfStyle, css: CssRules, start: number | undefined, indent: number, depth: number): void {
  const lis = Array.from(list.childNodes).filter(
    (n): n is Element => n.nodeType === Node.ELEMENT_NODE && (n as Element).nodeName.toLowerCase() === 'li',
  );
  const contentIndent = indent + LIST_INDENT_STEP;
  let n = start ?? 1;
  for (const li of lis) {
    const liStyle = applyCssToStyle({ ...style }, li, css, ctx.defaultStyle.fontSize);
    const lineHeight = liStyle.fontSize * ctx.lineHeightMultiplier;
    if (ctx.currentY + lineHeight > ctx.currentPageHeight - ctx.margin) {
      if (ctx.addedContentToCurrentPdfPage) addNewPage(ctx);
      else ctx.currentY = ctx.margin;
    }
    const bullet = start !== undefined ? `${n}.` : '\u2022';
    n++;
    setFontSafe(ctx, { ...liStyle, bold: false });
    ctx.pdf.setTextColor(liStyle.textColor || DEFAULT_TEXT_COLOR);
    ctx.colorKey = liStyle.textColor || DEFAULT_TEXT_COLOR;
    ctx.pdf.text(bullet, ctx.margin + indent, ctx.currentY, { baseline: 'top' });

    if (hasBlockChildren(li)) processContainer(li, ctx, liStyle, css, contentIndent, depth + 1);
    else renderInlineFlow(ctx, collectInline(li, ctx, liStyle, css), liStyle, contentIndent, 0, 0);

    ctx.currentY += LIST_ITEM_SPACING;
  }
}

function renderPre(el: Element, ctx: PdfContext, parentStyle: PdfStyle, css: CssRules, indent: number): void {
  const style = applyCssToStyle({ ...parentStyle, fontFamily: 'courier' }, el, css, ctx.defaultStyle.fontSize);
  const text = (el.textContent || '').replace(/\t/g, '    ');
  ctx.currentY += PARAGRAPH_SPACING / 2;
  const leftX = ctx.margin + indent;
  const avail = ctx.contentWidth - indent;
  const lh = style.fontSize * ctx.lineHeightMultiplier;
  setFontSafe(ctx, style);
  for (const srcLine of text.split('\n')) {
    const wrapped = srcLine.length ? (ctx.pdf.splitTextToSize(srcLine, avail) as string[]) : [''];
    for (const wl of wrapped) {
      if (ctx.currentY + lh > ctx.currentPageHeight - ctx.margin) {
        if (ctx.addedContentToCurrentPdfPage) addNewPage(ctx);
        else ctx.currentY = ctx.margin;
      }
      setFontSafe(ctx, style);
      ctx.pdf.setTextColor(style.textColor || DEFAULT_TEXT_COLOR);
      ctx.colorKey = style.textColor || DEFAULT_TEXT_COLOR;
      ctx.pdf.text(wl, leftX, ctx.currentY, { baseline: 'top' });
      ctx.currentY += lh;
      ctx.addedContentToCurrentPdfPage = true;
    }
  }
  ctx.currentY += PARAGRAPH_SPACING / 2;
}

function processBlock(el: Element, ctx: PdfContext, parentStyle: PdfStyle, css: CssRules, indent: number, depth: number): void {
  if (depth > DEPTH_LIMIT) return;
  const tag = el.nodeName.toLowerCase();
  const base = ctx.defaultStyle.fontSize;

  switch (tag) {
    case 'ul': case 'ol': {
      const style = applyCssToStyle({ ...parentStyle }, el, css, base);
      processList(el, ctx, style, css, tag === 'ol' ? listStart(el) : undefined, indent, depth);
      ctx.currentY += LIST_ITEM_SPACING;
      return;
    }
    case 'hr': {
      if (ctx.currentY + 12 > ctx.currentPageHeight - ctx.margin && ctx.addedContentToCurrentPdfPage) addNewPage(ctx);
      ctx.pdf.setDrawColor(0);
      ctx.pdf.setLineWidth(0.5);
      ctx.pdf.line(ctx.margin + indent, ctx.currentY + 6, ctx.currentPageWidth - ctx.margin, ctx.currentY + 6);
      ctx.currentY += 12;
      ctx.addedContentToCurrentPdfPage = true;
      return;
    }
    case 'pre': { renderPre(el, ctx, parentStyle, css, indent); return; }
    case 'blockquote': {
      ctx.currentY += PARAGRAPH_SPACING / 2;
      const style = applyCssToStyle({ ...parentStyle }, el, css, base);
      processContainer(el, ctx, style, css, indent + LIST_INDENT_STEP, depth + 1);
      ctx.currentY += PARAGRAPH_SPACING / 2;
      return;
    }
    case 'table': {
      const style = applyCssToStyle({ ...parentStyle }, el, css, base);
      const text = htmlToText(el.toString()).trim();
      if (text) renderInlineFlow(ctx, textToInlineItems(text, style, ctx), style, indent, PARAGRAPH_SPACING / 2, PARAGRAPH_SPACING / 2);
      return;
    }
    case 'p': {
      const style = applyCssToStyle({ ...parentStyle }, el, css, base);
      renderInlineFlow(ctx, collectInline(el, ctx, style, css), style, indent, PARAGRAPH_SPACING / 2, PARAGRAPH_SPACING / 2);
      return;
    }
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const delta: Record<string, number> = { h1: 8, h2: 6, h3: 4, h4: 2, h5: 1, h6: 0 };
      const start: PdfStyle = { ...parentStyle, bold: true, fontSize: base + delta[tag] };
      const style = applyCssToStyle(start, el, css, base);
      renderInlineFlow(ctx, collectInline(el, ctx, style, css), style, indent, style.fontSize * 0.5, style.fontSize * 0.4);
      return;
    }
    default: {
      const style = applyCssToStyle({ ...parentStyle }, el, css, base);
      if (hasBlockChildren(el)) processContainer(el, ctx, style, css, indent, depth + 1);
      else renderInlineFlow(ctx, collectInline(el, ctx, style, css), style, indent, 0, PARAGRAPH_SPACING / 2);
      return;
    }
  }
}

/* -------------------------------------------------------------- */
/* fonts                                                           */
const sniffFontFormatLocal = (data: ArrayBuffer): 'truetype' | 'opentype' | 'unknown' => {
  const b = new Uint8Array(data, 0, Math.min(4, data.byteLength));
  const tag = String.fromCharCode(...b);
  if (tag === 'OTTO') return 'opentype';
  if (tag === 'true' || tag === 'ttcf' || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0)) return 'truetype';
  return 'unknown';
};

/** Add one face of a family to jsPDF. Returns false (and warns) instead of throwing. */
const registerFont = (pdf: jsPDF, family: string, data: ArrayBuffer, format: string, face: 'normal' | 'bold' | 'italic' | 'bolditalic'): boolean => {
  try {
    if (format !== 'truetype' && format !== 'opentype') return false;
    const vfs = `${family}-${face}.${format === 'opentype' ? 'otf' : 'ttf'}`;
    if (!pdf.getFileFromVFS?.(vfs)) pdf.addFileToVFS(vfs, arrayBufferToBase64(data));
    if (!pdf.getFontList()[family]?.includes(face)) pdf.addFont(vfs, family, face);
    debug(`BUILDPDF_INFO - registered ${family} ${face}`);
    return true;
  } catch (e) {
    warn(`BUILDPDF_WARN - font ${family} ${face} skipped`, e);
    return false;
  }
};

/** A font that can draw text outside Latin-1 when the book embeds none. Each face is
 *  a URL (fetched) or raw bytes; only `normal` is required. */
export interface FallbackFont {
  family: string;
  sources: Partial<Record<'normal' | 'bold' | 'italic' | 'bolditalic', string | ArrayBuffer>>;
}

export interface ConvertOptions {
  /** Print per-item diagnostics to the console. Off by default. */
  debug?: boolean;
  /** Called after each chapter (spine item) is laid out. */
  onProgress?: (done: number, total: number) => void;
  /** Abort between chapters; the returned promise rejects with the signal's reason. */
  signal?: AbortSignal;
  fallbackFont?: FallbackFont;
}

/* -------------------------------------------------------------- */
/* main entry                                                      */

/**
 * Convert an EPUB into a jsPDF document, WITHOUT triggering a download.
 * Accepts either a URL (fetched) or a raw ArrayBuffer (e.g. for tests/Node).
 * Returns the jsPDF instance so callers can .save(), .output('arraybuffer'), etc.
 */
export const convertEpubToPdf = async (source: string | ArrayBuffer, options: ConvertOptions = {}): Promise<jsPDF> => {
  setDebug(Boolean(options.debug));
  const throwIfAborted = () => {
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Conversion aborted', 'AbortError');
  };
  let buffer: ArrayBuffer;
  if (typeof source === 'string') {
    const fetched = await fetchFile(source, options.signal);
    const generic = fetched.mimeType === 'application/octet-stream' || fetched.mimeType === '';
    const isEpub = fetched.mimeType === 'application/epub+zip' || (generic && source.toLowerCase().endsWith('.epub'));
    if (!isEpub) throw new Error(`Unsupported mime-type ${fetched.mimeType}`);
    buffer = fetched.buffer;
  } else {
    buffer = source;
  }

  const epubData: EpubParsedData = await handleEpub(buffer);
  const { htmlPageObjects, resources, coverImageResourceKey, styles: cssArr, fonts, opfFileDirectory } = epubData;

  // `compress` runs every page stream through Flate. A 120-page text-only book was
  // 5.9 MB without it and is a fraction of that with it; there is no visual difference.
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
  pdf.setProperties({ title: epubData.title || '', creator: 'Bookracy' });

  /* embed the book's own fonts (best-effort; a bad font must not abort the book) */
  if (fonts) {
    for (const [, f] of fonts) {
      // jsPDF embeds TrueType/OpenType only. A WOFF registered as .ttf doesn't fail
      // here — it fails later, inside pdf.text(), and takes the whole conversion with it.
      if (f.format !== 'truetype' && f.format !== 'opentype') { debug(`BUILDPDF_INFO - skipping ${f.format} font ${f.href}`); continue; }
      // Without a @font-face mapping the file name is the only name we have; the CSS
      // will almost never refer to it, but a book that names its file after the family
      // still gets its font.
      const fam = f.nameInCss ?? f.href.split('/').pop()!.split('.')[0];
      registerFont(pdf, fam, f.data, f.format, f.bold ? (f.italic ? 'bolditalic' : 'bold') : f.italic ? 'italic' : 'normal');
    }
  }

  /* Non-Latin text needs a real Unicode font. Load one only when the book has such
     text and nothing embedded can draw it. Scanning the raw HTML is enough — markup
     is ASCII, so any offending character comes from the prose. */
  const needsUnicode = htmlPageObjects.some((hp) => !isWinAnsi(hp.content));
  let unicodeFamily: string | undefined;
  if (needsUnicode && options.fallbackFont) {
    const fb = options.fallbackFont;
    for (const face of ['normal', 'bold', 'italic', 'bolditalic'] as const) {
      const src = fb.sources[face];
      if (!src) continue;
      try {
        const data = typeof src === 'string' ? (await fetchFile(src, options.signal)).buffer : src;
        if (registerFont(pdf, fb.family, data, sniffFontFormatLocal(data), face)) unicodeFamily = fb.family;
      } catch (e) {
        warn(`BUILDPDF_WARN - fallback font ${face} unavailable`, e);
      }
    }
  }

  const defaultStyle: PdfStyle = {
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize: 12,
    bold: false,
    italic: false,
    textColor: DEFAULT_TEXT_COLOR,
    textAlign: 'left',
  };
  const cssStyles = parseCss(cssArr, defaultStyle.fontSize);

  const ctx: PdfContext = {
    pdf,
    currentPageWidth: pdf.internal.pageSize.getWidth(),
    currentPageHeight: pdf.internal.pageSize.getHeight(),
    margin: 40,
    get contentWidth() { return this.currentPageWidth - 2 * this.margin; },
    get contentHeight() { return this.currentPageHeight - 2 * this.margin; },
    currentY: 40,
    currentPdfPageNumber: 1,
    addedContentToCurrentPdfPage: false,
    defaultStyle,
    lineHeightMultiplier: 1.5,
    resources,
    opfFileDirectory,
    currentHtmlPagePath: '',
    registeredFamilies: new Map(),
    registeredStyles: new Map(),
    fontKey: '',
    colorKey: '',
    unicodeFamily,
  };
  buildRegisteredFonts(pdf, ctx);

  /* cover image (centered, fit-to-page) */
  if (coverImageResourceKey && resources.has(coverImageResourceKey)) {
    try {
      const { bytes, width, height, format } = prepareImage(pdf, resources.get(coverImageResourceKey)!);
      let w = width, h = height;
      const r = h > 0 ? w / h : 1;
      if (w > ctx.contentWidth) { w = ctx.contentWidth; h = w / r; }
      if (h > ctx.contentHeight) { h = ctx.contentHeight; w = h * r; }
      const x = ctx.margin + (ctx.contentWidth - w) / 2;
      const y = ctx.margin + (ctx.contentHeight - h) / 2;
      pdf.addImage(bytes, format, x, y, w, h);
      ctx.addedContentToCurrentPdfPage = true;
    } catch (e) { warn('BUILDPDF_ERROR - cover add', e); }
  }

  /* Tolerant parser: real-world EPUBs frequently contain minor XML quirks.
     Throwing on those silently dropped entire chapters, producing near-empty
     PDFs. xmldom still returns a best-effort tree, so we only warn. */
  const parser = new XMLDOMParser({
    locator: {},
    errorHandler: {
      warning: () => {},
      error: () => {},
      fatalError: (e) => { warn('BUILDPDF_WARN - XML fatal (recovering):', e); },
    },
  });

  const pageOfHref = new Map<string, number>();
  const total = htmlPageObjects.length;
  for (let i = 0; i < total; i++) {
    const hp = htmlPageObjects[i];
    throwIfAborted();
    if (hp.content.trim()) {
      if (ctx.addedContentToCurrentPdfPage) addNewPage(ctx);
      ctx.currentHtmlPagePath = hp.href;
      pageOfHref.set(hp.href, ctx.currentPdfPageNumber);

      let doc: Document | undefined;
      try { doc = parser.parseFromString(hp.content, 'application/xhtml+xml'); }
      catch (e) { warn(`BUILDPDF_WARN - could not parse ${hp.href}, skipping:`, e); }

      const body = doc?.getElementsByTagName('body')[0];
      if (body) processContainer(body, ctx, defaultStyle, cssStyles, 0, 0);
    }
    options.onProgress?.(i + 1, total);
    // Give the event loop a turn between chapters so a caller on the main thread can
    // paint progress (and an abort can land) instead of freezing until the end.
    if (i + 1 < total) await new Promise((r) => setTimeout(r, 0));
  }

  if (pdf.getNumberOfPages() > 1 && !ctx.addedContentToCurrentPdfPage) {
    pdf.deletePage(ctx.currentPdfPageNumber);
  }

  addOutline(pdf, epubData.tocNavPoints, pageOfHref);

  return pdf;
};

/** PDF bookmarks from the EPUB's table of contents. Best-effort: jsPDF's outline
 *  plugin is unofficial, so any failure here leaves a perfectly good PDF without
 *  a sidebar rather than no PDF at all. */
function addOutline(pdf: jsPDF, nav: EpubNavPoint[] | undefined, pageOfHref: Map<string, number>): void {
  if (!nav?.length) return;
  const outline = (pdf as unknown as { outline?: { add: (parent: unknown, title: string, options: { pageNumber: number }) => unknown } }).outline;
  if (!outline?.add) return;
  try {
    const walk = (points: EpubNavPoint[], parent: unknown, depth: number) => {
      if (depth > 3) return;
      for (const p of points) {
        const page = pageOfHref.get(p.src);
        if (!page || !p.label) continue;
        const node = outline.add(parent, p.label, { pageNumber: page });
        if (p.children.length) walk(p.children, node, depth + 1);
      }
    };
    walk(nav, null, 0);
  } catch (e) {
    warn('BUILDPDF_WARN - outline skipped', e);
  }
}

/**
 * Convenience wrapper: convert an EPUB at `epubUrl` and trigger a browser
 * download. (Backwards-compatible entry point.)
 */
export const buildPdf = async (epubUrl: string, filename = 'downloaded_epub.pdf', options: ConvertOptions = {}): Promise<void> => {
  const pdf = await convertEpubToPdf(epubUrl, options);
  pdf.save(filename);
};

/**
 * Attach a click handler to a button that converts `epubUrl` to a PDF and
 * downloads it. Matches the documented public API.
 */
export const buildPDFConvertor = (epubUrl: string, button: HTMLElement): void => {
  button.addEventListener('click', () => {
    void buildPdf(epubUrl).catch((e) => warn('BUILDPDF_ERROR - conversion failed', e));
  });
};
