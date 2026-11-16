// Papers: adding PDFs, the details read from them, duplicates, the file itself (whole, in
// parts, or not at all when the browser already has it), edits, folders and deletion.
import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { startApi } from "./harness.ts";

const api = await startApi("papers");
const { sql } = api;
const call = (method, path, body, headers = {}) => api.call(method, path, body, { headers });
const upload = (pdf, fileName, folderId) =>
  call("POST", "/api/papers", pdf, {
    "Content-Type": "application/pdf",
    "X-File-Name": encodeURIComponent(fileName),
    ...(folderId ? { "X-Folder-Id": folderId } : {}),
  });

// A small but valid PDF: catalog, page tree, pages, and optionally an information dictionary
// (plain or inside a compressed object stream) and an XMP packet.
function buildPdf({ info, xmp, pages = 3, compressInfo = false }) {
  const objects = [];
  const add = (body) => objects.push(body) && objects.length;
  const catalog = add(null);
  const tree = add(null);
  const kids = Array.from({ length: pages }, () => add(null));
  kids.forEach((id) => (objects[id - 1] = `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 612 792] >>`));
  objects[tree - 1] = `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages} >>`;
  let metadataRef = "";
  if (xmp) {
    const packet = Buffer.from(`<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>${xmp}<?xpacket end="w"?>`, "utf8");
    const id = add({ dict: `<< /Type /Metadata /Subtype /XML /Length ${packet.length} >>`, stream: packet });
    metadataRef = ` /Metadata ${id} 0 R`;
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R${metadataRef} >>`;
  let infoRef = "";
  if (info) {
    if (compressInfo) {
      const infoId = objects.length + 1;
      const body = `${infoId} 0 ${info}`;
      objects.push(null); // the info object lives in the stream below
      const stream = deflateSync(Buffer.from(body, "latin1"));
      add({ dict: `<< /Type /ObjStm /N 1 /First ${`${infoId} 0 `.length} /Filter /FlateDecode /Length ${stream.length} >>`, stream });
      infoRef = ` /Info ${infoId} 0 R`;
    } else {
      infoRef = ` /Info ${add(info)} 0 R`;
    }
  }
  const parts = [Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets = [];
  let length = parts[0].length;
  objects.forEach((body, index) => {
    if (body === null) {
      offsets.push(null);
      return;
    }
    offsets.push(length);
    const chunk =
      typeof body === "string"
        ? Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, "latin1")
        : Buffer.concat([
            Buffer.from(`${index + 1} 0 obj\n${body.dict}\nstream\n`, "latin1"),
            body.stream,
            Buffer.from("\nendstream\nendobj\n", "latin1"),
          ]);
    parts.push(chunk);
    length += chunk.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`];
  for (const offset of offsets) xref.push(offset === null ? "0000000000 65535 f \n" : `${String(offset).padStart(10, "0")} 00000 n \n`);
  parts.push(Buffer.from(`${xref.join("")}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${infoRef} >>\nstartxref\n${length}\n%%EOF\n`, "latin1"));
  return new Uint8Array(Buffer.concat(parts));
}

const utf16 = (text) => `<FEFF${[...text].map((char) => char.charCodeAt(0).toString(16).padStart(4, "0")).join("")}>`;
const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:prism="http://prismstandard.org/namespaces/basic/2.0/">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Attention Is All You Need &amp; More</rdf:li></rdf:Alt></dc:title>
<dc:creator><rdf:Seq><rdf:li>Ashish Vaswani</rdf:li><rdf:li>Noam Shazeer</rdf:li><rdf:li>Niki Parmar</rdf:li></rdf:Seq></dc:creator>
<prism:doi>10.48550/arXiv.1706.03762</prism:doi><prism:publicationDate>2017-06-12</prism:publicationDate>
</rdf:Description></rdf:RDF></x:xmpmeta>`;

test("papers: adding PDFs, their details, the file, folders and deletion", async (t) => {
  const ok = (label) => t.diagnostic(label);

  let res = await call("GET", "/api/papers");
  assert.deepEqual(res.data, { papers: [], folders: [] });
  ok("the papers list starts empty");

  const attention = buildPdf({ xmp, info: "<< /Title (Wrong title from Info) /Producer (pdfTeX) >>", pages: 11 });
  res = await upload(attention, "1706.03762v7.pdf");
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.duplicate, false);
  const paper = res.data.paper;
  assert.equal(paper.title, "Attention Is All You Need & More");
  assert.equal(paper.authors, "Ashish Vaswani, Noam Shazeer, Niki Parmar");
  assert.equal(paper.year, 2017);
  assert.equal(paper.doi, "10.48550/arXiv.1706.03762");
  assert.equal(paper.pages, 11);
  assert.equal(paper.fileName, "1706.03762v7.pdf");
  assert.equal(paper.byteSize, attention.length);
  assert.equal(paper.folderId, null);
  assert.equal(res.data.papers.length, 1);
  ok("XMP metadata gives the title, authors, year and DOI; the page tree gives the page count");

  res = await upload(attention, "copy of it.pdf");
  assert.equal(res.status, 200);
  assert.equal(res.data.duplicate, true);
  assert.equal(res.data.paper.id, paper.id);
  assert.equal(res.data.papers.length, 1);
  assert.equal(await sql("SELECT count(*) FROM paper_files"), "1");
  ok("the same file added again is stored once and comes back as the existing paper");

  const plain = buildPdf({
    info: `<< /Title ${utf16("Évaluation des réseaux (2ᵉ édition)")} /Author (Marie Curie\\, Pierre Curie) /Subject (doi:10.1000/xyz123.) /Producer (LaTeX) >>`,
    pages: 2,
  });
  res = await upload(plain, "reseaux.pdf");
  assert.equal(res.status, 201);
  assert.equal(res.data.paper.title, "Évaluation des réseaux (2ᵉ édition)");
  assert.equal(res.data.paper.authors, "Marie Curie, Pierre Curie");
  assert.equal(res.data.paper.doi, "10.1000/xyz123");
  assert.equal(res.data.paper.year, null);
  assert.equal(res.data.paper.pages, 2);
  ok("without XMP, the information dictionary gives the title (UTF-16), authors and a DOI from the subject");

  const packed = buildPdf({
    info: "<< /Title (Deep Residual Learning for Image Recognition) /Author (Kaiming He) /CreationDate (D:20151210) >>",
    compressInfo: true,
    pages: 1,
  });
  res = await upload(packed, "resnet.pdf");
  assert.equal(res.data.paper.title, "Deep Residual Learning for Image Recognition");
  assert.equal(res.data.paper.authors, "Kaiming He");
  assert.equal(res.data.paper.pages, 1);
  ok("details kept in a compressed object stream are found too");

  const junk = buildPdf({ info: "<< /Title (Microsoft Word - draft_v3.docx) /Author (Administrator) /Creator (Word) >>", pages: 4 });
  res = await upload(junk, "Graph_neural_networks_survey.pdf");
  assert.equal(res.data.paper.title, "Graph neural networks survey");
  assert.equal(res.data.paper.authors, "");
  ok("placeholder titles and authors are ignored; the file name gives the title instead");

  res = await upload(new TextEncoder().encode("hello, not a pdf"), "notes.pdf");
  assert.equal(res.status, 415);
  assert.match(res.data.error, /Only PDF files/);
  const huge = new Uint8Array(50 * 1024 * 1024 + 10);
  huge.set(new TextEncoder().encode("%PDF-1.7\n"));
  res = await upload(huge, "huge.pdf");
  assert.equal(res.status, 413);
  assert.match(res.data.error, /at most 50 MB/);
  ok("a file that isn't a PDF is refused, and so is one over 50 MB");

  res = await call("GET", `/api/papers/${paper.id}/file`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.match(res.headers.get("content-disposition"), /^inline; filename="1706\.03762v7\.pdf"; filename\*=UTF-8''1706\.03762v7\.pdf$/);
  assert.match(res.headers.get("cache-control"), /immutable/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.ok(Buffer.compare(res.data, Buffer.from(attention)) === 0);
  assert.equal((await call("GET", "/api/papers/00000000-0000-4000-8000-000000000000/file")).status, 404);
  assert.equal((await call("GET", "/api/papers/not-an-id/file")).status, 404);
  ok("the PDF comes back byte for byte, shown inline under its name and cached for good");

  res = await call("PATCH", `/api/papers/${paper.id}`, {
    title: "  Attention   Is All You Need ",
    authors: "Vaswani et al.",
    year: 2017,
    doi: "https://doi.org/10.48550/arXiv.1706.03762",
  });
  assert.equal(res.status, 200);
  const edited = res.data.papers.find((candidate) => candidate.id === paper.id);
  assert.equal(edited.title, "Attention Is All You Need");
  assert.equal(edited.authors, "Vaswani et al.");
  assert.equal(edited.doi, "10.48550/arXiv.1706.03762");
  for (const [body, pattern] of [
    [{ title: "   " }, /can't be empty/],
    [{ year: 17 }, /year/],
    [{ year: "2017" }, /year/],
    [{ folderId: "00000000-0000-4000-8000-000000000000" }, /no longer exists/],
    [{}, /Nothing to change/],
  ]) {
    res = await call("PATCH", `/api/papers/${paper.id}`, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(res.data.error, pattern);
  }
  assert.equal((await call("PATCH", "/api/papers/00000000-0000-4000-8000-000000000000", { title: "x" })).status, 404);
  res = await call("PATCH", `/api/papers/${paper.id}`, { year: null });
  assert.equal(res.data.papers.find((candidate) => candidate.id === paper.id).year, null);
  ok("details can be edited (a DOI link is cut to the DOI); bad values are refused, a year can be cleared");

  res = await call("POST", "/api/paper-folders", { name: "Transformers" });
  assert.equal(res.status, 201);
  const folder = res.data.folder;
  assert.equal(folder.name, "Transformers");
  res = await call("POST", "/api/paper-folders", { name: "transformers" });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /already a folder/);
  res = await call("PATCH", `/api/papers/${paper.id}`, { folderId: folder.id });
  assert.equal(res.data.papers.find((candidate) => candidate.id === paper.id).folderId, folder.id);
  const vision = buildPdf({ info: "<< /Title (An Image is Worth 16x16 Words) /Author (Alexey Dosovitskiy) /Producer (pdfTeX) >>" });
  res = await upload(vision, "vit.pdf", folder.id);
  assert.equal(res.data.paper.folderId, folder.id);
  res = await call("PATCH", `/api/paper-folders/${folder.id}`, { name: "Attention models" });
  assert.equal(res.status, 200);
  assert.equal(res.data.folders[0].name, "Attention models");
  ok("folders: made, not twice with one name, papers filed by moving or straight on upload, renamed");

  res = await call("DELETE", `/api/paper-folders/${folder.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.folders.length, 0);
  assert.ok(res.data.papers.every((candidate) => candidate.folderId === null));
  assert.equal(res.data.papers.length, 5);
  assert.equal((await call("DELETE", `/api/paper-folders/${folder.id}`)).status, 404);
  ok("deleting a folder keeps its papers, in no folder");

  res = await call("DELETE", `/api/papers/${paper.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.papers.some((candidate) => candidate.id === paper.id), false);
  assert.equal((await call("GET", `/api/papers/${paper.id}/file`)).status, 404);
  assert.equal(await sql(`SELECT count(*) FROM paper_files WHERE paper_id = '${paper.id}'`), "0");
  assert.equal((await call("DELETE", `/api/papers/${paper.id}`)).status, 404);
  ok("deleting a paper deletes its PDF too");

  const someId = res.data.papers[0].id;
  res = await call("PATCH", "/api/state/workspace", { openPaperIds: [someId], activeTab: `paper:${someId}` });
  assert.equal(res.status, 204);
  res = await call("GET", "/api/state");
  assert.deepEqual(res.data.workspace.openPaperIds, [someId]);
  assert.equal(res.data.workspace.activeTab, `paper:${someId}`);
  for (const body of [{ activeTab: "paper:not-an-id" }, { openPaperIds: ["x"] }, { openPaperIds: "nope" }]) {
    assert.equal((await call("PATCH", "/api/state/workspace", body)).status, 400, JSON.stringify(body));
  }
  res = await call("PATCH", "/api/state/preferences", { collapsedSections: ["notes", "works", "tests", "papers"] });
  assert.equal(res.status, 204);
  ok("the workspace keeps paper tabs, and the Papers section can be closed like the others");
});

test("papers: the file in parts, and not at all when the browser already has it", async (t) => {
  const ok = (label) => t.diagnostic(label);
  const pdf = buildPdf({ info: "<< /Title (Read in parts) >>", pages: 40 });
  const whole = Buffer.from(pdf);
  const size = whole.length;
  const added = await upload(pdf, "parts.pdf");
  assert.equal(added.status, 201);
  const path = `/api/papers/${added.data.paper.id}/file`;
  const get = (headers) => call("GET", path, undefined, headers);

  let res = await get();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("accept-ranges"), "bytes");
  assert.equal(res.headers.get("content-length"), String(size));
  assert.deepEqual(res.data, whole);
  const etag = res.headers.get("etag");
  ok("the whole file comes back, and says it can be asked for in parts");

  for (const [range, start, end] of [
    ["bytes=0-99", 0, 99],
    ["bytes=100-", 100, size - 1],
    ["bytes=-50", size - 50, size - 1],
    [`bytes=${size - 10}-${size + 500}`, size - 10, size - 1],
  ]) {
    res = await get({ Range: range });
    assert.equal(res.status, 206, range);
    assert.equal(res.headers.get("content-range"), `bytes ${start}-${end}/${size}`);
    assert.equal(res.headers.get("content-length"), String(end - start + 1));
    assert.deepEqual(res.data, whole.subarray(start, end + 1), range);
  }
  ok("a range answers 206 with exactly those bytes: from the start, to the end, or the last few");

  res = await get({ Range: `bytes=${size}-` });
  assert.equal(res.status, 416);
  assert.equal(res.headers.get("content-range"), `bytes */${size}`);
  for (const range of ["bytes=0-1,5-6", "bytes=10-5", "pages=1-2", "bytes=-"]) {
    res = await get({ Range: range });
    assert.equal(res.status, 200, range);
    assert.deepEqual(res.data, whole);
  }
  ok("a range past the end is a 416; several ranges or a malformed one get the whole file");

  for (const value of [etag, `W/${etag}`, `"something-else", ${etag}`, "*"]) {
    res = await get({ "If-None-Match": value });
    assert.equal(res.status, 304, value);
    assert.equal(res.data.length, 0);
  }
  res = await get({ "If-None-Match": '"another-file"' });
  assert.equal(res.status, 200);
  ok("a browser that already holds the file is told it hasn't changed, and no bytes are sent");

  res = await get({ Range: "bytes=0-9", "If-Range": etag });
  assert.equal(res.status, 206);
  res = await get({ Range: "bytes=0-9", "If-Range": '"an-older-copy"' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, whole);
  ok("a range made for another copy of the file gets the whole of this one");

  res = await call("HEAD", path);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-length"), String(size));
  assert.equal(res.data.length, 0);
  ok("asking about the file without fetching it works too");
});
