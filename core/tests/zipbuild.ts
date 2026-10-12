/* A minimal zip writer for synthetic test workbooks (stored entries, CRC-32): no library, so the tests do not
   depend on the zip reader they test. */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xFFFFFFFF; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

export function makeZip(files: Record<string, string | Uint8Array>): ArrayBuffer {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let off = 0;
  for (const [name, data] of Object.entries(files)) {
    const nb = enc.encode(name), body = typeof data === "string" ? enc.encode(data) : data, crc = crc32(body);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034B50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint16(8, 0, true);
    h.setUint32(14, crc, true); h.setUint32(18, body.length, true); h.setUint32(22, body.length, true); h.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(h.buffer), nb, body);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014B50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
    c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, body.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nb);
    off += 30 + nb.length + body.length;
  }
  const cdSize = central.reduce((s, x) => s + x.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054B50, true); e.setUint16(8, Object.keys(files).length, true); e.setUint16(10, Object.keys(files).length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
  let p = 0; for (const x of all) { out.set(x, p); p += x.length; }
  return out.buffer;
}

const NS = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
/** a workbook with the XML features the corpus lacks: gradient fills, a custom theme (sysClr, srgbClr), dxfs,
    an x:-prefixed styles part with a BOM and CRLF line ends, a drawing with mc:AlternateContent, a chart frame,
    one-cell and absolute anchors and an r:embed declared on a nested element; `override` replaces parts */
export function featureWorkbook(override: Record<string, string> = {}): ArrayBuffer {
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
  const files: Record<string, string | Uint8Array> = {
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0"?>\r\n<workbook ${NS}><sheets><sheet name="Data &amp; more" sheetId="1" r:id="rId1"/><sheet name="Hidden" sheetId="2" state="hidden" r:id="rId9"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId3" Type="${REL}/theme" Target="theme/theme1.xml"/></Relationships>`,
    "xl/styles.xml": "﻿" + `<?xml version="1.0" encoding="UTF-8"?>\r\n<x:styleSheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\r\n`
      + `<x:numFmts count="1"><x:numFmt numFmtId="164" formatCode="#,##0.0&quot; m&quot;"/></x:numFmts>\r\n`
      + `<x:fonts count="2"><x:font><x:sz val="11"/><x:color theme="1"/><x:name val="Aptos"/></x:font><x:font><x:b/><x:i val="0"/><x:u val="double"/><x:strike val="1"/><x:sz val="14"/><x:color rgb="FF1F4E79"/><x:name val="Segoe UI"/></x:font></x:fonts>\r\n`
      + `<x:fills count="5"><x:fill><x:patternFill patternType="none"/></x:fill><x:fill><x:patternFill patternType="gray125"/></x:fill>`
      + `<x:fill><x:gradientFill degree="90"><x:stop position="0"><x:color theme="4" tint="0.59999389629810485"/></x:stop><x:stop position="1"><x:color rgb="FFFFFFFF"/></x:stop></x:gradientFill></x:fill>`
      + `<x:fill><x:gradientFill type="path" left="0.5" right="0.5" top="0.5" bottom="0.5"><x:stop position="0"><x:color theme="5"/></x:stop><x:stop position="1"><x:color indexed="10"/></x:stop></x:gradientFill></x:fill>`
      + `<x:fill><x:patternFill patternType="solid"><x:fgColor theme="2" tint="-0.249977111117893"/><x:bgColor indexed="64"/></x:patternFill></x:fill></x:fills>\r\n`
      + `<x:borders count="2"><x:border><x:left/><x:right/><x:top/><x:bottom/></x:border><x:border><x:left style="thin"><x:color auto="1"/></x:left><x:bottom style="double"><x:color theme="4"/></x:bottom></x:border></x:borders>\r\n`
      + `<x:cellXfs count="4"><x:xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><x:xf numFmtId="164" fontId="1" fillId="2" borderId="1" applyFill="1"><x:alignment horizontal="center" vertical="center" wrapText="1" indent="2" textRotation="90"/></x:xf><x:xf numFmtId="14" fontId="0" fillId="3" borderId="0"/><x:xf numFmtId="9" fontId="1" fillId="4" borderId="1"><x:alignment wrapText="true"/></x:xf></x:cellXfs>\r\n`
      + `<x:dxfs count="3"><x:dxf><x:font><x:b/><x:color rgb="FF9C0006"/></x:font><x:fill><x:patternFill><x:bgColor rgb="FFFFC7CE"/></x:patternFill></x:fill></x:dxf><x:dxf><x:font><x:i val="false"/><x:color theme="9"/></x:font></x:dxf><x:dxf><x:fill><x:gradientFill><x:stop position="0"><x:color theme="6"/></x:stop></x:gradientFill></x:fill></x:dxf></x:dxfs>\r\n</x:styleSheet>`,
    "xl/theme/theme1.xml": `<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Custom"><a:themeElements><a:clrScheme name="Bank">`
      + `<a:dk1><a:sysClr val="windowText" lastClr="111111"/></a:dk1><a:lt1><a:sysClr val="window"/></a:lt1><a:dk2><a:srgbClr val="0E2841"/></a:dk2><a:lt2><a:srgbClr val="E8E8E8"/></a:lt2>`
      + `<a:accent1><a:srgbClr val="00553A"/></a:accent1><a:accent2><a:srgbClr val="D97B00"/></a:accent2><a:accent3><a:srgbClr val="7F7F7F"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>`
      + `<a:accent5><a:srgbClr val="4472C4"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:sysClr val="windowText"/></a:folHlink>`
      + `</a:clrScheme></a:themeElements></a:theme>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet ${NS}><sheetData><row r="1"><c r="A1" s="1"><v>1</v></c></row></sheetData><drawing r:id="rId1"/></worksheet>`,
    "xl/worksheets/_rels/sheet1.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
    "xl/drawings/drawing1.xml": `<?xml version="1.0"?>\r\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">`
      + `<xdr:oneCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>9525</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="952500" cy="476250"/>`
      + `<mc:AlternateContent><mc:Choice Requires="a14"><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo &quot;A&quot;"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:srcRect l="10000" r="5000"/></xdr:blipFill><xdr:spPr><a:xfrm rot="5400000" flipH="1"><a:off x="0" y="0"/><a:ext cx="952500" cy="476250"/></a:xfrm></xdr:spPr></xdr:pic></mc:Choice><mc:Fallback/></mc:AlternateContent><xdr:clientData/></xdr:oneCellAnchor>`
      + `<xdr:absoluteAnchor><xdr:pos x="190500" y="95250"/><xdr:ext cx="1905000" cy="952500"/><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="3" name="Box"/></xdr:nvSpPr><xdr:spPr><a:prstGeom prst="roundRect"/><a:solidFill><a:schemeClr val="accent2"/></a:solidFill><a:ln w="19050"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></xdr:spPr>`
      + `<xdr:txBody><a:bodyPr anchor="ctr"/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1400" b="1"><a:solidFill><a:sysClr val="windowText" lastClr="000000"/></a:solidFill></a:rPr><a:t>Line &amp; one</a:t></a:r><a:fld id="{1}" type="slidenum"><a:t>7</a:t></a:fld><a:endParaRPr sz="1200"/></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:absoluteAnchor>`
      + `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>4</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>14</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`
      + `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="4" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`,
    "xl/drawings/_rels/drawing1.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/image" Target="../media/image1.png"/></Relationships>`,
    "xl/media/image1.png": png,
    ...override,
  };
  return makeZip(files);
}
