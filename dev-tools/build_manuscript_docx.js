'use strict';
const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');

const src = fs.readFileSync(path.join(__dirname, '..', 'manuscript.md'), 'utf8');
const start = src.indexOf('## Summary');
const end = src.indexOf('## Availability');
if (start < 0 || end < 0) throw new Error('manuscript markers missing');
const body = src.slice(start, end).trim();
// Title (first line) and the author block between the <!-- authors --> markers
const title = src.split(/\r?\n/)[0].replace(/^#\s*/, '').trim();
const authorBlock = (src.match(/<!-- authors[^>]*-->([\s\S]*?)<!-- \/authors -->/) || [, ''])[1]
    .split(/\r?\n/).map(l => l.trim()).filter(Boolean);

const FONT = 'Times New Roman';
const SIZE = 24; // 12 pt

function runsFrom(text, base) {
    const out = [];
    const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
        if (m.index > last) out.push(...plain(text.slice(last, m.index), base));
        if (m[1] != null) out.push(...plain(m[1], { ...base, bold: true }));
        else if (m[2] != null) out.push(...plain(m[2], { ...base, italics: true }));
        else out.push(new TextRun({ text: m[3], font: 'Consolas', size: base.size || SIZE }));
        last = m.index + m[0].length;
    }
    if (last < text.length) out.push(...plain(text.slice(last), base));
    return out;
}

function plain(text, base) {
    const bits = text.split(/(\[email\])/);
    return bits.filter(s => s.length).map(s => new TextRun({
        text: s,
        font: FONT,
        size: base.size || SIZE,
        bold: !!base.bold,
        italics: !!base.italics,
        highlight: s === '[email]' ? 'yellow' : undefined,
    }));
}

function para(text, extra) {
    return new Paragraph({
        spacing: { after: 200, line: 360, lineRule: 'auto' },
        ...extra,
        children: runsFrom(text, extra && extra.runBase ? extra.runBase : {}),
    });
}

const children = [];

children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: 'Application Note', font: FONT, size: 22, italics: true, color: '444444' })],
}));

children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240, line: 276, lineRule: 'auto' },
    children: [new TextRun({
        text: title,
        font: FONT, size: 32, bold: true,
    })],
}));

// Authors line and affiliation(s): ^n^ becomes a superscript affiliation number
function superRuns(text, size) {
    return text.split(/(\^[^^]+\^)/).filter(t => t.length).map(t => /^\^[^^]+\^$/.test(t)
        ? new TextRun({ text: t.slice(1, -1), font: FONT, size, superScript: true })
        : new TextRun({ text: t, font: FONT, size }));
}
const [authorsLine, ...rest] = authorBlock;
if (!authorsLine) throw new Error('author block missing in manuscript.md');
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: superRuns(authorsLine, SIZE) }));
const affs = rest.filter(l => l.startsWith('^'));
affs.forEach((aff, k) => children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: k === affs.length - 1 ? 120 : 20 },
    children: superRuns(aff, 22),
})));
const orcid = rest.find(l => l.startsWith('ORCID'));
if (orcid) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 280 }, children: [new TextRun({ text: orcid, font: FONT, size: 18, color: '555555' })] }));

const lines = body.split(/\r?\n/);
let i = 0;
while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || line.trim() === '---') { i++; continue; }
    if (line.startsWith('### ')) {
        children.push(new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 280, after: 120 },
            children: [new TextRun({ text: line.slice(4).trim(), font: FONT, size: 26, bold: true })],
        }));
        i++;
        continue;
    }
    if (line.startsWith('## ')) {
        children.push(new Paragraph({
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 360, after: 160 },
            children: [new TextRun({ text: line.slice(3).trim(), font: FONT, size: 28, bold: true })],
        }));
        i++;
        continue;
    }
    // References are single lines; body paragraphs are single lines in this file.
    children.push(para(line.trim()));
    i++;
}

const doc = new Document({
    styles: {
        default: {
            document: { styles: [{ id: 'Normal', run: { font: FONT, size: SIZE } }] },
        },
    },
    sections: [{
        properties: {
            page: {
                size: { width: 11906, height: 16838 }, // A4
                margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 }, // 2 cm
            },
        },
        children,
    }],
});

const outDir = path.join(__dirname, '..', 'submission');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'ViewAlign_Application_Note.docx');
Packer.toBuffer(doc).then(buf => {
    fs.writeFileSync(out, buf);
    console.log('wrote', out, buf.length);
}).catch(err => {
    console.error(err);
    process.exit(1);
});
