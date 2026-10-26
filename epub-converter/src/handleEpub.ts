// src/handleEpub.ts
import JSZip from 'jszip';
// Remove direct import of Element from xmldom, use standard DOM types
import { DOMParser as XMLDOMParser } from '@xmldom/xmldom';
import './polyfills/node-globals';
import { debug, warn } from './log';

// --- Interfaces (can be moved to a shared types.ts file) ---
export interface EpubManifestItem {
  id: string;
  href: string; // Relative to OPF file
  mediaType: string;
  properties?: string;
}

export interface EpubHtmlPageObject {
  id?: string; // Manifest ID of the spine item
  href: string; // Original href from manifest, relative to OPF
  content: string; // The HTML string
}

export interface EpubFontData {
  /** The `font-family` the book's CSS uses for this file (from its @font-face rule).
   *  This is the name text styles refer to — without it an embedded font can never be
   *  matched to the text that wants it. */
  nameInCss?: string;
  href: string;
  data: ArrayBuffer;
  /** Detected from the file's magic bytes, not the (often wrong) manifest media-type. */
  format: 'truetype' | 'opentype' | 'woff' | 'woff2' | 'embedded-opentype' | 'svg' | 'unknown';
  /** From the @font-face rule: which face of the family this file is. */
  bold?: boolean;
  italic?: boolean;
}

export interface EpubNavPoint {
  id: string;
  playOrder: number;
  label: string;
  src: string; 
  anchor?: string; 
  level: number;
  children: EpubNavPoint[];
}

export interface EpubParsedData {
  htmlPageObjects: EpubHtmlPageObject[];
  resources: Map<string, ArrayBuffer>; 
  coverImageResourceKey?: string;     
  styles: string[];                   
  fonts: Map<string, EpubFontData>;  
  tocNavPoints?: EpubNavPoint[];      
  opfFileDirectory: string;           
  uniqueId?: string;                  
  title?: string;
  language?: string;
}

// --- Helper Functions ---
const normalizePath = (base: string, relative: string): string => {
  if (!relative) return base; 
  if (relative.startsWith('/')) { 
      if (!base) return relative.substring(1); 
  }

  const stack = base.split('/');
  const parts = relative.split('/');

  if (stack.length > 0 && (stack[stack.length - 1] === '' || stack[stack.length - 1] === '.')) {
    stack.pop();
  }
  
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (stack.length > 0) {
        stack.pop();
      }
    } else {
      stack.push(part);
    }
  }
  return stack.join('/');
};

// Use standard 'Element' type for navMapElement
const parseNavPointsRecursive = (navMapElement: Element, level: number, opfFileDir: string): EpubNavPoint[] => {
    const points: EpubNavPoint[] = [];
    // Use standard 'Element' and 'Node.ELEMENT_NODE'
    const childNavPoints = Array.from(navMapElement.childNodes).filter(
        (n): n is Element => n.nodeType === Node.ELEMENT_NODE && n.nodeName === 'navPoint'
    );

    for (const navPointEl of childNavPoints) {
        const labelEl = navPointEl.getElementsByTagName('navLabel')[0]?.getElementsByTagName('text')[0];
        const contentEl = navPointEl.getElementsByTagName('content')[0];
        
        if (labelEl?.textContent && contentEl?.getAttribute('src')) {
            const fullSrc = decodeURIComponent(contentEl.getAttribute('src')!);
            const [srcWithoutAnchor, anchor] = fullSrc.split('#');
            
            points.push({
                id: navPointEl.getAttribute('id') || `nav-${Math.random().toString(36).substr(2, 9)}`,
                playOrder: parseInt(navPointEl.getAttribute('playOrder') || '0', 10),
                label: labelEl.textContent.trim(),
                src: srcWithoutAnchor, 
                anchor: anchor,
                level: level,
                children: parseNavPointsRecursive(navPointEl, level + 1, opfFileDir),
            });
        }
    }
    points.sort((a,b) => a.playOrder - b.playOrder);
    return points;
};


/** Font container format from the first bytes. Manifests routinely lie (a WOFF
 *  declared as `font/ttf`), and jsPDF can only embed TrueType/OpenType. */
export const sniffFontFormat = (data: ArrayBuffer): EpubFontData['format'] => {
  const b = new Uint8Array(data, 0, Math.min(4, data.byteLength));
  const tag = String.fromCharCode(...b);
  if (tag === 'wOFF') return 'woff';
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'OTTO') return 'opentype';
  if (tag === 'true' || tag === 'ttcf' || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0)) return 'truetype';
  return 'unknown';
};

export interface FontFaceRule {
  family: string;
  /** url() targets in source order, un-decoded. */
  sources: string[];
  bold: boolean;
  italic: boolean;
}

/** The @font-face rules in a stylesheet. Regex-based on purpose: this runs on every
 *  stylesheet of every book and only needs four properties. */
export const parseFontFaces = (css: string): FontFaceRule[] => {
  const out: FontFaceRule[] = [];
  const re = /@font-face\s*\{([^}]*)\}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const body = m[1];
    const prop = (name: string) => {
      const pm = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i').exec(body);
      return pm ? pm[1].trim() : '';
    };
    const family = prop('font-family').replace(/^["']|["']$/g, '').trim();
    if (!family) continue;
    const sources: string[] = [];
    const src = prop('src');
    const urlRe = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
    let um: RegExpExecArray | null;
    while ((um = urlRe.exec(src))) sources.push(um[1].trim());
    const weight = prop('font-weight').toLowerCase();
    const wnum = parseInt(weight, 10);
    const style = prop('font-style').toLowerCase();
    out.push({
      family,
      sources,
      bold: weight === 'bold' || weight === 'bolder' || (Number.isFinite(wnum) && wnum >= 600),
      italic: style === 'italic' || style === 'oblique',
    });
  }
  return out;
};

// --- Main Exported Function ---
export const handleEpub = async (buffer: ArrayBuffer): Promise<EpubParsedData> => {
  const zip = await JSZip.loadAsync(buffer);
  let opfFilePath: string | undefined;
  let opfFileDirectory = ''; 

  const containerFile = zip.file('META-INF/container.xml');
  if (containerFile) {
    try {
      const containerXml = await containerFile.async('text');
      const metaParser = new XMLDOMParser();
      const containerDoc = metaParser.parseFromString(containerXml, 'application/xml');
      const rootfileElement = containerDoc.getElementsByTagName('rootfile')[0];
      if (rootfileElement) {
        opfFilePath = rootfileElement.getAttribute('full-path') || undefined;
        if (opfFilePath) debug(`HANDLEEPUB_INFO - OPF path from container.xml: ${opfFilePath}`);
      }
    } catch (e) { warn('HANDLEEPUB_WARN - Error parsing META-INF/container.xml:', e); }
  }

  if (!opfFilePath) {
    // Corrected quotes for ESLint
    warn('HANDLEEPUB_WARN - No valid OPF path in META-INF/container.xml. Trying common OPF names.');
    const commonOpfLocations = ['content.opf', 'package.opf', 'OEBPS/content.opf', 'OEBPS/package.opf', 'EPUB/content.opf', 'EPUB/package.opf'];
    for (const loc of commonOpfLocations) {
      if (zip.file(loc)) { opfFilePath = loc; debug(`HANDLEEPUB_INFO - Found OPF file via fallback: ${opfFilePath}`); break; }
    }
  }

  if (!opfFilePath) throw new Error('EPUB OPF file could not be reliably located.');

  if (opfFilePath.includes('/')) {
    opfFileDirectory = opfFilePath.substring(0, opfFilePath.lastIndexOf('/') + 1);
  }

  const opfFile = zip.file(opfFilePath);
  if (!opfFile) throw new Error(`FATAL: OPF file '${opfFilePath}' cannot be read.`);
  
  const contentOpfText = await opfFile.async('text');
  const opfParser = new XMLDOMParser();
  const opfDoc = opfParser.parseFromString(contentOpfText, 'application/xml');

  const metadataElement = opfDoc.getElementsByTagName('metadata')[0];
  let epubTitle: string | undefined;
  let epubLanguage: string | undefined;
  let epubUniqueId: string | undefined;

  if (metadataElement) {
    const titleElement = metadataElement.getElementsByTagNameNS('*', 'title')[0] || metadataElement.getElementsByTagName('dc:title')[0];
    if (titleElement) epubTitle = titleElement.textContent?.trim();

    const langElement = metadataElement.getElementsByTagNameNS('*', 'language')[0] || metadataElement.getElementsByTagName('dc:language')[0];
    if (langElement) epubLanguage = langElement.textContent?.trim();
    
    const uniqueIdAtt = opfDoc.documentElement.getAttribute('unique-identifier');
    if (uniqueIdAtt) {
        // Use standard Element type
        const identifierElement = Array.from(metadataElement.getElementsByTagNameNS('*', 'identifier') as HTMLCollectionOf<Element>)
                                   .find(el => el.getAttribute('id') === uniqueIdAtt);
        if (identifierElement) epubUniqueId = identifierElement.textContent?.trim();
    }
    if (!epubUniqueId) { 
        const firstIdentifier = metadataElement.getElementsByTagNameNS('*', 'identifier')[0] || metadataElement.getElementsByTagName('dc:identifier')[0];
        if(firstIdentifier) epubUniqueId = firstIdentifier.textContent?.trim();
    }
  }

  const manifestItems = new Map<string, EpubManifestItem>();
  const manifestItemElements = Array.from(opfDoc.getElementsByTagName('item'));
  for (const itemEl of manifestItemElements) {
    const id = itemEl.getAttribute('id');
    const href = itemEl.getAttribute('href');
    const mediaType = itemEl.getAttribute('media-type');
    if (id && href && mediaType) {
      manifestItems.set(id, {
        id,
        href: decodeURIComponent(href),
        mediaType,
        properties: itemEl.getAttribute('properties') || undefined,
      });
    }
  }

  const resources = new Map<string, ArrayBuffer>();
  const styles: string[] = [];
  // The href of each stylesheet, index-aligned with `styles`, so @font-face url()s
  // can be resolved relative to the sheet that declares them.
  const styleHrefs: string[] = [];
  const fonts = new Map<string, EpubFontData>();
  let actualCoverImageResourceKey: string | undefined;
  let coverItemXhtmlHref: string | undefined;

  const metaCoverElement = Array.from(opfDoc.getElementsByTagName('meta')).find(m => m.getAttribute('name') === 'cover');
  let coverItemId = metaCoverElement?.getAttribute('content');
  if (!coverItemId) {
    for (const item of manifestItems.values()) {
      if (item.properties?.includes('cover-image')) { coverItemId = item.id; break; }
    }
  }

  if (coverItemId) {
    const coverManifestItem = manifestItems.get(coverItemId);
    if (coverManifestItem) {
      if (coverManifestItem.mediaType.startsWith('image/')) {
        actualCoverImageResourceKey = coverManifestItem.href;
      } else if (coverManifestItem.mediaType === 'application/xhtml+xml') {
        coverItemXhtmlHref = coverManifestItem.href;
        const coverXhtmlPath = normalizePath(opfFileDirectory, coverItemXhtmlHref);
        const coverXhtmlFile = zip.file(coverXhtmlPath);
        if (coverXhtmlFile) {
          try {
            const coverXhtmlContent = await coverXhtmlFile.async('text');
            const xhtmlParser = new XMLDOMParser();
            const coverDoc = xhtmlParser.parseFromString(coverXhtmlContent, 'application/xhtml+xml');
            let imgSrc: string | null = null;
            const htmlImgEl = coverDoc.getElementsByTagName('img')[0];
            if (htmlImgEl) imgSrc = htmlImgEl.getAttribute('src');
            else {
              const svgImgEl = coverDoc.getElementsByTagName('svg')[0]?.getElementsByTagName('image')[0];
              if (svgImgEl) imgSrc = svgImgEl.getAttribute('href') || svgImgEl.getAttribute('xlink:href');
            }
            if (imgSrc) {
              imgSrc = decodeURIComponent(imgSrc);
              const coverXhtmlDir = coverItemXhtmlHref.includes('/') ? coverItemXhtmlHref.substring(0, coverItemXhtmlHref.lastIndexOf('/') + 1) : '';
              const resolvedImgKeyInOpf = normalizePath(coverXhtmlDir, imgSrc);
              const manifestImageEntry = Array.from(manifestItems.values()).find(
                item => item.href === resolvedImgKeyInOpf && item.mediaType.startsWith('image/')
              );
              if (manifestImageEntry) {
                actualCoverImageResourceKey = manifestImageEntry.href;
              } else {
                 actualCoverImageResourceKey = resolvedImgKeyInOpf; 
                 warn(`HANDLEEPUB_WARN - Image '${imgSrc}' from cover XHTML '${coverItemXhtmlHref}' (resolved to '${resolvedImgKeyInOpf}') not found as a distinct image item in manifest. Using resolved path as key.`);
              }
            } else warn(`HANDLEEPUB_WARN - No <img> or <svg:image> found in cover XHTML: ${coverItemXhtmlHref}`);
          } catch (e) { warn(`HANDLEEPUB_WARN - Error parsing cover XHTML '${coverXhtmlPath}':`, e); }
        } else warn(`HANDLEEPUB_WARN - Cover XHTML file '${coverXhtmlPath}' not found.`);
      } else warn(`HANDLEEPUB_WARN - Cover item '${coverItemId}' is not image/XHTML: ${coverManifestItem.mediaType}`);
    } else warn(`HANDLEEPUB_WARN - Cover ID '${coverItemId}' not found in manifest.`);
  } else debug('HANDLEEPUB_INFO - No standard cover metadata found.');

  let ncxFileHref: string | undefined; 
  const spineElement = opfDoc.getElementsByTagName('spine')[0];
  const tocIdFromSpine = spineElement?.getAttribute('toc');
  if (tocIdFromSpine && manifestItems.has(tocIdFromSpine)) {
      ncxFileHref = manifestItems.get(tocIdFromSpine)!.href;
  }

  for (const item of manifestItems.values()) {
    const itemFullPath = normalizePath(opfFileDirectory, item.href);
    const contentFile = zip.file(itemFullPath);
    if (!contentFile) { warn(`HANDLEEPUB_WARN - Manifest file not found: ${itemFullPath}`); continue; }

    try {
      const content = await contentFile.async('arraybuffer');
      if (item.mediaType.startsWith('image/')) {
        resources.set(item.href, content);
      } else if (item.mediaType === 'text/css') {
        styles.push(new TextDecoder().decode(content));
        styleHrefs.push(item.href);
      } else if (
        item.mediaType.includes('font') ||
        item.mediaType.includes('opentype') ||
        item.mediaType.includes('truetype') ||
        item.mediaType.includes('woff') ||
        /\.(ttf|otf|woff2?)$/i.test(item.href)
      ) {
        fonts.set(item.href, { href: item.href, data: content, format: sniffFontFormat(content) });
      }
    } catch (e) { warn(`HANDLEEPUB_WARN - Error loading resource ${itemFullPath}:`, e); }
  }

  // Link each font file to the family name the CSS gives it. Without this the text
  // styles say "Bookerly" while the file is `fonts/font-001.ttf`, and nothing matches.
  styles.forEach((css, i) => {
    const cssHref = styleHrefs[i] ?? '';
    const cssDir = cssHref.includes('/') ? cssHref.slice(0, cssHref.lastIndexOf('/') + 1) : '';
    for (const face of parseFontFaces(css)) {
      for (const src of face.sources) {
        let key: string;
        try { key = normalizePath(cssDir, decodeURIComponent(src.split('#')[0].split('?')[0])); }
        catch { continue; }
        const font = fonts.get(key);
        if (!font) continue;
        // First rule that claims a file wins; a file rarely belongs to two families.
        if (font.nameInCss === undefined) {
          font.nameInCss = face.family;
          font.bold = face.bold;
          font.italic = face.italic;
        }
        break;
      }
    }
  });

  const htmlPageObjects: EpubHtmlPageObject[] = [];
  if (spineElement) {
    const itemrefElements = Array.from(spineElement.getElementsByTagName('itemref'));
    for (const itemrefEl of itemrefElements) {
      const idref = itemrefEl.getAttribute('idref');
      if (!idref) continue;
      
      const linear = (itemrefEl.getAttribute('linear') || 'yes') === 'yes';
      if (!linear) { debug(`HANDLEEPUB_INFO - Skipping non-linear spine item: ${idref}`); continue; }

      const manifestItem = manifestItems.get(idref);
      if (manifestItem && manifestItem.mediaType === 'application/xhtml+xml') {
        if (manifestItem.href === coverItemXhtmlHref) {
          debug(`HANDLEEPUB_INFO - Spine item '${manifestItem.href}' is the cover XHTML, skipping from htmlPageObjects.`);
          continue;
        }
        const itemFullPath = normalizePath(opfFileDirectory, manifestItem.href);
        const contentFile = zip.file(itemFullPath);
        if (contentFile) {
          try {
            const htmlContent = await contentFile.async('text');
            htmlPageObjects.push({ id: manifestItem.id, href: manifestItem.href, content: htmlContent });
          } catch (e) { warn(`HANDLEEPUB_WARN - Error loading HTML spine item ${itemFullPath}:`, e); }
        } else warn(`HANDLEEPUB_WARN - HTML spine item file not found: ${itemFullPath}`);
      } else if (manifestItem) {
        debug(`HANDLEEPUB_INFO - Spine item '${idref}' not XHTML (${manifestItem.mediaType}), skipping.`);
      } else warn(`HANDLEEPUB_WARN - Spine IDRef '${idref}' not in manifest.`);
    }
  } else {
    throw new Error('EPUB spine not found, cannot determine content order.');
  }

  let tocNavPoints: EpubNavPoint[] | undefined;
  if (ncxFileHref) {
      const ncxFullPath = normalizePath(opfFileDirectory, ncxFileHref);
      const ncxFile = zip.file(ncxFullPath);
      if (ncxFile) {
          try {
              const ncxXml = await ncxFile.async('text');
              const ncxParser = new XMLDOMParser();
              const ncxDoc = ncxParser.parseFromString(ncxXml, 'application/xml');
              const navMapElement = ncxDoc.getElementsByTagName('navMap')[0];
              if (navMapElement) {
                  const ncxDir = ncxFileHref.includes('/') ? ncxFileHref.substring(0, ncxFileHref.lastIndexOf('/') + 1) : '';
                  tocNavPoints = parseNavPointsRecursive(navMapElement, 0, ncxDir);
                  const resolveNavPointSrc = (points: EpubNavPoint[]) => {
                      for(const point of points) {
                          point.src = normalizePath(ncxDir, point.src);
                          if (point.children.length > 0) resolveNavPointSrc(point.children);
                      }
                  };
                  if (tocNavPoints) resolveNavPointSrc(tocNavPoints);
              }
          } catch (e) { warn(`HANDLEEPUB_WARN - Error parsing NCX file '${ncxFullPath}':`, e); }
      } else warn(`HANDLEEPUB_WARN - NCX file '${ncxFullPath}' (from spine toc='${tocIdFromSpine}') not found.`);
  }

  return {
    htmlPageObjects,
    resources,
    coverImageResourceKey: actualCoverImageResourceKey,
    styles,
    fonts,
    tocNavPoints,
    opfFileDirectory,
    uniqueId: epubUniqueId,
    title: epubTitle,
    language: epubLanguage,
  };
};