/* A small XML pull tokenizer and tree (PLAN S2.2): DOMParser does not exist in workers. Enough XML 1.0 for
   OOXML parts: elements, attributes, text, CDATA, character and predefined entities, namespace prefixes;
   comments, processing instructions and a DOCTYPE are skipped. As an XML parser must: line ends become \n,
   and tabs/line ends inside attribute values become spaces (character references keep theirs).
   The tree implements the XmlElement interface of platform.ts with DOM semantics, so the readers of styles,
   theme, rels, workbook and drawings run on it unchanged. Malformed input is read leniently (an unmatched end
   tag closes up to its start tag), where DOMParser would return an error document; entities declared in a
   DOCTYPE are not expanded (OOXML has none). */
import type { XmlDocument, XmlElement, XmlParser } from "../platform";

const XMLNS = "http://www.w3.org/2000/xmlns/", XML_NS = "http://www.w3.org/XML/1998/namespace";
const ENT: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** decode &lt; &#38; &#x26; …; an unknown entity stays as written */
export function decodeEntities(s: string): string {
  if (s.indexOf("&") < 0) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z_][\w.-]*);/g, (m, e: string) => {
    if (e[0] !== "#") return ENT[e] ?? m;
    const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return cp >= 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : m;
  });
}
const attrValue = (raw: string) => decodeEntities(raw.replace(/[\t\n\r]/g, " "));

export const enum Tok { End = 0, Open = 1, Close = 2, Text = 3 }

/** pull tokenizer over one XML string: next() → Tok; name / attrs / selfClosing / text describe the token */
export class XmlReader {
  private s: string; private p = 0;
  name = ""; attrs: [string, string][] = []; selfClosing = false; text = "";
  constructor(xml: string) {
    if (xml.charCodeAt(0) === 0xFEFF) xml = xml.slice(1);
    this.s = xml.indexOf("\r") >= 0 ? xml.replace(/\r\n?/g, "\n") : xml;
  }
  next(): Tok {
    const s = this.s;
    for (;;) {
      if (this.p >= s.length) return Tok.End;
      const lt = s.indexOf("<", this.p);
      if (lt !== this.p) {                                         // text up to the next tag
        const end = lt < 0 ? s.length : lt;
        this.text = decodeEntities(s.slice(this.p, end)); this.p = end;
        return Tok.Text;
      }
      const c = s.charCodeAt(lt + 1);
      if (c === 0x21) {                                            // <!
        if (s.startsWith("<!--", lt)) { const e = s.indexOf("-->", lt + 4); this.p = e < 0 ? s.length : e + 3; continue; }
        if (s.startsWith("<![CDATA[", lt)) {
          const e = s.indexOf("]]>", lt + 9); const end = e < 0 ? s.length : e;
          this.text = s.slice(lt + 9, end); this.p = e < 0 ? s.length : e + 3;
          return Tok.Text;
        }
        this.p = this.skipDecl(lt); continue;                      // <!DOCTYPE …> (with an internal subset)
      }
      if (c === 0x3F) { const e = s.indexOf("?>", lt + 2); this.p = e < 0 ? s.length : e + 2; continue; }   // <?…?>
      if (c === 0x2F) {                                            // </name>
        const e = s.indexOf(">", lt + 2); const end = e < 0 ? s.length : e;
        this.name = s.slice(lt + 2, end).trim(); this.p = e < 0 ? s.length : e + 1;
        return Tok.Close;
      }
      return this.openTag(lt);
    }
  }
  private skipDecl(lt: number): number {
    const s = this.s; let depth = 0;
    for (let i = lt + 2; i < s.length; i++) {
      const ch = s[i];
      if (ch === "[") depth++; else if (ch === "]") depth--;
      else if (ch === ">" && depth <= 0) return i + 1;
    }
    return s.length;
  }
  private openTag(lt: number): Tok {
    const s = this.s; let i = lt + 1;
    while (i < s.length && !isSpace(s.charCodeAt(i)) && s[i] !== ">" && s[i] !== "/") i++;
    this.name = s.slice(lt + 1, i); this.attrs = []; this.selfClosing = false;
    for (;;) {
      while (i < s.length && isSpace(s.charCodeAt(i))) i++;
      if (i >= s.length) { this.p = i; return Tok.Open; }
      const ch = s[i];
      if (ch === ">") { this.p = i + 1; return Tok.Open; }
      if (ch === "/") { this.selfClosing = true; i++; continue; }
      const n0 = i;
      while (i < s.length && s[i] !== "=" && s[i] !== ">" && s[i] !== "/" && !isSpace(s.charCodeAt(i))) i++;
      const an = s.slice(n0, i);
      while (i < s.length && isSpace(s.charCodeAt(i))) i++;
      if (s[i] !== "=") { if (an) this.attrs.push([an, ""]); continue; }
      i++; while (i < s.length && isSpace(s.charCodeAt(i))) i++;
      const q = s[i];
      if (q === '"' || q === "'") {
        const e = s.indexOf(q, i + 1); const end = e < 0 ? s.length : e;
        this.attrs.push([an, attrValue(s.slice(i + 1, end))]); i = end + 1;
      } else {                                                     // unquoted (not XML; tolerated)
        const v0 = i; while (i < s.length && !isSpace(s.charCodeAt(i)) && s[i] !== ">") i++;
        this.attrs.push([an, attrValue(s.slice(v0, i))]);
      }
    }
  }
}
const isSpace = (c: number) => c === 0x20 || c === 0x0A || c === 0x09 || c === 0x0D;

type Scope = Record<string, string | null>;
const localOf = (q: string) => { const i = q.indexOf(":"); return i < 0 ? q : q.slice(i + 1); };
const prefixOf = (q: string) => { const i = q.indexOf(":"); return i < 0 ? "" : q.slice(0, i); };

export class XNode implements XmlElement {
  readonly localName: string; readonly prefix: string;
  readonly children: XNode[] = [];
  /** element children and text, in document order */
  readonly content: (XNode | string)[] = [];
  constructor(readonly qName: string, readonly attrs: [string, string][], readonly scope: Scope) {
    this.localName = localOf(qName); this.prefix = prefixOf(qName);
  }
  get namespaceURI(): string | null { return this.scope[this.prefix] ?? null; }
  get textContent(): string {
    let t = ""; const stack: (XNode | string)[] = [this];            // iterative: no stack overflow on deep trees
    while (stack.length) {
      const x = stack.pop()!;
      if (typeof x === "string") t += x;
      else for (let i = x.content.length - 1; i >= 0; i--) stack.push(x.content[i]);
    }
    return t;
  }
  getAttribute(name: string): string | null { for (const a of this.attrs) if (a[0] === name) return a[1]; return null; }
  getAttributeNS(ns: string | null, localName: string): string | null {
    const want = ns || null;
    for (const [q, v] of this.attrs) {
      if (localOf(q) !== localName && !(q === "xmlns" && localName === "xmlns")) continue;
      const p = prefixOf(q);
      const uri = q === "xmlns" || p === "xmlns" ? XMLNS : p === "xml" ? XML_NS : p ? this.scope[p] ?? null : null;
      if (uri === want) return v;
    }
    return null;
  }
  getElementsByTagNameNS(ns: string, localName: string): XNode[] { const out: XNode[] = []; collect(this.children, ns, localName, out); return out; }
}
/** descendants in document order (iterative: no stack overflow on deep trees) */
function collect(kids: XNode[], ns: string, local: string, out: XNode[]) {
  const stack: XNode[] = [];
  for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  while (stack.length) {
    const k = stack.pop()!;
    if ((local === "*" || k.localName === local) && (ns === "*" || (k.namespaceURI ?? "") === ns)) out.push(k);
    for (let i = k.children.length - 1; i >= 0; i--) stack.push(k.children[i]);
  }
}

export class XDoc implements XmlDocument {
  constructor(readonly documentElement: XNode) {}
  get children(): XNode[] { return [this.documentElement]; }
  getElementsByTagNameNS(ns: string, localName: string): XNode[] { const out: XNode[] = []; collect([this.documentElement], ns, localName, out); return out; }
}

const ROOT_SCOPE: Scope = { xml: XML_NS, xmlns: XMLNS };
/** parse a whole document into a tree (text outside the root element is dropped, as in the DOM; a duplicated
    attribute keeps its first value) */
export function parseXmlTree(xml: string): XDoc {
  const r = new XmlReader(xml);
  const stack: XNode[] = []; let root: XNode | null = null;
  for (let t = r.next(); t !== Tok.End; t = r.next()) {
    if (t === Tok.Open) {
      const parent = stack[stack.length - 1];
      let scope = parent ? parent.scope : ROOT_SCOPE;
      for (const [q, v] of r.attrs) {
        if (q === "xmlns") { if (scope === (parent ? parent.scope : ROOT_SCOPE)) scope = { ...scope }; scope[""] = v || null; }
        else if (q.startsWith("xmlns:")) { if (scope === (parent ? parent.scope : ROOT_SCOPE)) scope = { ...scope }; scope[q.slice(6)] = v || null; }
      }
      const el = new XNode(r.name, r.attrs, scope);
      if (parent) { parent.children.push(el); parent.content.push(el); }
      else if (!root) root = el;
      else continue;                                               // a second root: ignored
      if (!r.selfClosing) stack.push(el);
    } else if (t === Tok.Close) {
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i].qName === r.name) { stack.length = i; break; }
    } else if (stack.length) stack[stack.length - 1].content.push(r.text);
  }
  // no element at all (an empty part): like DOMParser's error document, a root without content, so the
  // readers find nothing in it instead of failing
  if (!root) root = new XNode("parsererror", [], ROOT_SCOPE);
  return new XDoc(root);
}

export const coreXml: XmlParser = { parse: parseXmlTree };
