import { constants, inflateSync } from "node:zlib";

// A paper's details, read from the PDF itself where the file carries them: the XMP metadata
// packet (most publishers), else the document information dictionary (most LaTeX and word
// processors). Best effort: anything missing is left empty, and the title falls back to the
// file name. Nothing here renders or trusts the PDF beyond reading these few fields.

export interface PdfMetadata {
  title: string;
  authors: string;
  year: number | null;
  doi: string;
  pages: number | null;
}

// Compressed object streams are opened to find details stored in them, up to this much.
const MAX_INFLATED = 32 * 1024 * 1024;
const DOI = /\b(10\.\d{4,9}\/[^\s"'<>&]+)/;

const clean = (text: string, max = 1000) => text.replace(/\s+/g, " ").trim().slice(0, max);

// Placeholders that tools write where a real title should be.
const JUNK_TITLE = /^(untitled|title|document\d*|doc\d*|slide \d+|microsoft (word|powerpoint) - .*|.*\.(pdf|docx?|tex|dvi|ps|rtf|odt|pptx?))$/i;
const JUNK_AUTHOR = /^(admin|administrator|user|owner|author|unknown|default)$/i;

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_all, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_all, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// A PDF string starting at `start`: (literal), with escapes and nested parentheses, or <hex>.
// Returns its raw bytes as a Latin-1 string.
export function readPdfString(source: string, start: number): string | null {
  if (source[start] === "(") {
    const escapes: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
    let depth = 0;
    let out = "";
    for (let index = start; index < source.length && index < start + 20000; index += 1) {
      const char = source[index]!;
      if (char === "\\") {
        const next = source[index + 1];
        if (next === undefined) return null;
        const octal = /^[0-7]{1,3}/.exec(source.slice(index + 1, index + 4));
        if (escapes[next] !== undefined) {
          out += escapes[next];
          index += 1;
        } else if (octal) {
          out += String.fromCharCode(Number.parseInt(octal[0], 8) & 0xff);
          index += octal[0].length;
        } else if (next === "\r" || next === "\n") {
          // A backslash at the end of a line continues the string on the next one.
          index += next === "\r" && source[index + 2] === "\n" ? 2 : 1;
        } else {
          out += next;
          index += 1;
        }
        continue;
      }
      if (char === "(") {
        depth += 1;
        if (depth === 1) continue;
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0) return out;
      }
      out += char;
    }
    return null;
  }
  if (source[start] === "<" && source[start + 1] !== "<") {
    const close = source.indexOf(">", start);
    if (close < 0 || close - start > 40000) return null;
    const hex = source.slice(start + 1, close).replace(/[^0-9a-f]/gi, "");
    let out = "";
    for (let index = 0; index < hex.length; index += 2) {
      out += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2).padEnd(2, "0"), 16));
    }
    return out;
  }
  return null;
}

// Text strings are UTF-16BE with a byte order mark, UTF-8 with one (PDF 2.0), or
// PDFDocEncoding, which for the characters titles use is Latin-1.
export function decodePdfText(bytes: string): string {
  if (bytes.startsWith("þÿ")) {
    let out = "";
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      out += String.fromCharCode((bytes.charCodeAt(index) << 8) | bytes.charCodeAt(index + 1));
    }
    return out;
  }
  if (bytes.startsWith("ï»¿")) return Buffer.from(bytes.slice(3), "latin1").toString("utf8");
  return bytes;
}

// The dictionary around a position: back to its "<<", forward to the matching ">>".
function enclosingDictionary(text: string, at: number): string | null {
  const open = text.lastIndexOf("<<", at);
  if (open < 0 || at - open > 8000) return null;
  let depth = 0;
  for (let index = open; index < text.length && index < open + 40000; index += 1) {
    if (text.startsWith("<<", index)) {
      depth += 1;
      index += 1;
    } else if (text.startsWith(">>", index)) {
      depth -= 1;
      index += 1;
      if (depth === 0) return text.slice(open, index + 1);
    }
  }
  return null;
}

function dictionaryValue(dictionary: string, key: string): string {
  const match = new RegExp(`/${key}(?![A-Za-z])\\s*(?=\\(|<[^<])`).exec(dictionary);
  if (!match) return "";
  const raw = readPdfString(dictionary, match.index + match[0].length);
  return raw === null ? "" : clean(decodePdfText(raw));
}

// The plain file, plus its compressed object streams (where PDF 1.5 and later often keep the
// document information and the page tree) and any compressed XMP metadata.
function searchableTexts(data: Buffer): string[] {
  const text = data.toString("latin1");
  const texts = [text];
  let inflated = 0;
  const marker = /\/Type\s*\/(?:ObjStm|Metadata)\b/g;
  for (let match = marker.exec(text); match && inflated < MAX_INFLATED; match = marker.exec(text)) {
    const keyword = text.indexOf("stream", match.index);
    if (keyword < 0) break;
    let begin = keyword + "stream".length;
    if (text[begin] === "\r") begin += 1;
    if (text[begin] === "\n") begin += 1;
    const end = text.indexOf("endstream", begin);
    if (end < 0) break;
    try {
      const contents = inflateSync(data.subarray(begin, end), {
        finishFlush: constants.Z_SYNC_FLUSH,
        maxOutputLength: MAX_INFLATED,
      }).toString("latin1");
      inflated += contents.length;
      texts.push(contents);
    } catch {
      // Not deflated, or damaged: there's still the rest of the file.
    }
    marker.lastIndex = end;
  }
  return texts;
}

interface Found {
  title: string;
  authors: string;
  year: number | null;
  doi: string;
}

function fromXmp(text: string): Found | null {
  const packets = text.match(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/g) ?? [];
  const packet = packets.map((raw) => Buffer.from(raw, "latin1").toString("utf8")).find((xml) => /<dc:(title|creator)\b/.test(xml));
  if (!packet) return null;
  const titleBlock = /<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/.exec(packet)?.[1] ?? "";
  const title = clean(decodeEntities(/<rdf:li\b[^>]*>([\s\S]*?)<\/rdf:li>/.exec(titleBlock)?.[1] ?? titleBlock.replace(/<[^>]+>/g, "")));
  const creatorBlock = /<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/.exec(packet)?.[1] ?? "";
  const authors = [...creatorBlock.matchAll(/<rdf:li\b[^>]*>([\s\S]*?)<\/rdf:li>/g)]
    .map((match) => clean(decodeEntities(match[1] ?? "")))
    .filter((name) => name && !JUNK_AUTHOR.test(name))
    .join(", ");
  const year =
    /prism:(?:publicationDate|coverDate|coverDisplayDate)(?:>|=")\s*(\d{4})/.exec(packet)?.[1] ??
    /<dc:date\b[^>]*>(?:\s*<[^>]+>)*\s*(\d{4})/.exec(packet)?.[1];
  const doi =
    /(?:prism:doi|crossmark:DOI|dc:identifier)[^>]*>\s*(?:doi:)?\s*(10\.[^<\s]+)/i.exec(packet)?.[1] ?? DOI.exec(packet)?.[1] ?? "";
  return { title, authors, year: year ? Number(year) : null, doi: trimDoi(doi) };
}

// A DOI read out of running text can pick up the full stop after it.
const trimDoi = (doi: string) => doi.replace(/[.,;:]+$/, "");

function fromInfo(texts: string[]): Found | null {
  for (const text of texts) {
    const title = /\/Title\s*[(<]/g;
    for (let match = title.exec(text); match; match = title.exec(text)) {
      const dictionary = enclosingDictionary(text, match.index);
      // The document information dictionary, not an outline entry or an annotation.
      if (!dictionary || /\/(Parent|Subtype|Dest|Type)\b/.test(dictionary)) continue;
      if (!/\/(Producer|Creator|CreationDate|ModDate|Author)\b/.test(dictionary)) continue;
      const subject = dictionaryValue(dictionary, "Subject");
      const keywords = dictionaryValue(dictionary, "Keywords");
      return {
        title: dictionaryValue(dictionary, "Title"),
        authors: dictionaryValue(dictionary, "Author"),
        year: null,
        doi: trimDoi(DOI.exec(`${subject} ${keywords} ${dictionaryValue(dictionary, "doi")}`)?.[1] ?? ""),
      };
    }
  }
  return null;
}

function pageCount(texts: string[]): number | null {
  for (const text of texts) {
    const pages = /\/Type\s*\/Pages\b/g;
    for (let match = pages.exec(text); match; match = pages.exec(text)) {
      const dictionary = enclosingDictionary(text, match.index);
      // The root of the page tree has no parent, and counts every page.
      if (!dictionary || /\/Parent\b/.test(dictionary)) continue;
      const count = /\/Count\s+(\d+)/.exec(dictionary);
      if (count) return Number(count[1]);
    }
  }
  const leaves = texts.reduce((sum, text) => sum + (text.match(/\/Type\s*\/Page\b(?!s)/g)?.length ?? 0), 0);
  return leaves > 0 ? leaves : null;
}

// "attention_is_all_you_need.pdf" → "attention is all you need"
export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.pdf$/i, "").replace(/_+/g, " ");
  return clean(base, 300) || "Untitled paper";
}

export function readPdfMetadata(data: Buffer, fileName: string): PdfMetadata {
  const texts = searchableTexts(data);
  const xmp = fromXmp(texts[0]!) ?? texts.slice(1).map(fromXmp).find((found) => found !== null) ?? null;
  const info = fromInfo(texts);
  const usable = (title: string | undefined) => (title && !JUNK_TITLE.test(title) ? title : "");
  const authors = (value: string | undefined) => (value && !JUNK_AUTHOR.test(value) ? value : "");
  return {
    title: clean(usable(xmp?.title) || usable(info?.title) || titleFromFileName(fileName), 300),
    authors: clean(authors(xmp?.authors) || authors(info?.authors)),
    year: xmp?.year && xmp.year >= 1600 && xmp.year <= 2200 ? xmp.year : null,
    doi: clean(xmp?.doi || info?.doi || "", 200),
    pages: pageCount(texts),
  };
}
