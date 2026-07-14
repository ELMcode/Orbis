export function csv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(',')),
  ].join('\n');
}

export function csvCell(value: unknown): string {
  const raw = value == null ? '' : String(value);
  const text = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function simplePdf(title: string, sections: Array<{ heading: string; lines: string[] }>): Buffer {
  const renderer = new PdfRenderer(title);
  renderer.render(sections);
  return renderer.toBuffer();
}

class PdfRenderer {
  private objects: string[] = [];
  private pages: string[] = [];
  private page = '';
  private y = 0;
  private pageNumber = 0;

  private readonly width = 595;
  private readonly height = 842;
  private readonly margin = 44;
  private readonly footerY = 34;
  private readonly generatedAt = new Date().toLocaleString('fr-FR');

  constructor(private readonly title: string) {}

  render(sections: Array<{ heading: string; lines: string[] }>) {
    this.newPage();
    this.coverHeader();
    for (const section of sections) {
      this.section(section.heading, section.lines);
    }
    this.finishPage();
  }

  toBuffer(): Buffer {
    const fontRegular = this.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const fontBold = this.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    const fontMono = this.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');

    const pageRefs: number[] = [];
    for (const content of this.pages) {
      const contentObj = this.addObject(`<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`);
      const pageObj = this.addObject([
        '<< /Type /Page /Parent 0 0 R',
        `/MediaBox [0 0 ${this.width} ${this.height}]`,
        `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R /F3 ${fontMono} 0 R >> >>`,
        `/Contents ${contentObj} 0 R >>`,
      ].join(' '));
      pageRefs.push(pageObj);
    }

    const kids = pageRefs.map((page) => `${page} 0 R`).join(' ');
    const pagesObj = this.addObject(`<< /Type /Pages /Kids [${kids}] /Count ${pageRefs.length} >>`);
    for (const pageRef of pageRefs) {
      this.objects[pageRef - 1] = this.objects[pageRef - 1].replace('/Parent 0 0 R', `/Parent ${pagesObj} 0 R`);
    }
    const catalogObj = this.addObject(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [0];
    this.objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(pdf, 'utf8'));
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n`;
    for (let index = 1; index < offsets.length; index += 1) {
      pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${this.objects.length + 1} /Root ${catalogObj} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(pdf, 'utf8');
  }

  private coverHeader() {
    this.rect(0, this.height - 104, this.width, 104, '#0f172a');
    this.rect(0, this.height - 108, this.width, 4, '#2563eb');
    this.rect(this.margin, this.height - 76, 36, 36, '#2563eb');
    this.text('IS', this.margin + 9, this.height - 62, 14, 'F2', '#ffffff');
    this.text('Orbis', this.margin + 50, this.height - 50, 16, 'F2', '#ffffff');
    this.text('The Single Source of Infrastructure Truth.', this.margin + 50, this.height - 70, 9, 'F1', '#cbd5e1');

    this.text(this.title, this.margin, this.height - 144, 24, 'F2', '#0f172a');
    this.text(`Genere le ${ascii(this.generatedAt)}`, this.margin, this.height - 164, 10, 'F1', '#64748b');
    this.badge('Rapport confidentiel', this.width - this.margin - 132, this.height - 158, 132);
    this.y = this.height - 198;
  }

  private section(heading: string, lines: string[]) {
    const cleanLines = lines.length ? lines : ['Aucune donnee'];
    this.ensureSpace(72);
    this.text(heading, this.margin, this.y, 15, 'F2', '#0f172a');
    this.rect(this.margin, this.y - 10, 36, 3, '#2563eb');
    this.y -= 28;

    const tableRows = cleanLines.filter((line) => line.includes('|')).map((line) => line.split('|').map((cell) => cell.trim()));
    if (tableRows.length >= Math.max(2, cleanLines.length * 0.6)) {
      this.table(tableRows);
      return;
    }

    for (const line of cleanLines) {
      if (line.trim() === '') {
        this.y -= 6;
        continue;
      }
      this.ensureSpace(24);
      this.infoRow(line);
    }
    this.y -= 12;
  }

  private table(rows: string[][]) {
    const maxCols = Math.min(5, Math.max(...rows.map((row) => row.length)));
    const tableWidth = this.width - this.margin * 2;
    const widths = Array.from({ length: maxCols }, (_, index) => {
      if (index === 0) return tableWidth * 0.28;
      if (index === maxCols - 1) return tableWidth * 0.18;
      return (tableWidth * 0.54) / Math.max(1, maxCols - 2);
    });

    for (let index = 0; index < rows.length; index += 1) {
      this.ensureSpace(24);
      const row = rows[index];
      const bg = index % 2 === 0 ? '#f8fafc' : '#ffffff';
      this.rect(this.margin, this.y - 15, tableWidth, 22, bg);
      this.line(this.margin, this.y - 16, this.margin + tableWidth, this.y - 16, '#e2e8f0');
      let x = this.margin + 8;
      for (let col = 0; col < maxCols; col += 1) {
        this.text(truncate(row[col] ?? '', Math.floor(widths[col] / 5.2)), x, this.y - 7, 8.5, col === 0 ? 'F2' : 'F1', col === 0 ? '#0f172a' : '#334155');
        x += widths[col];
      }
      this.y -= 22;
    }
    this.y -= 12;
  }

  private infoRow(line: string) {
    const normalized = line.trim();
    const isBullet = normalized.startsWith('- ');
    const separator = normalized.indexOf(':');
    const x = this.margin;
    const width = this.width - this.margin * 2;
    this.rect(x, this.y - 13, width, 22, '#f8fafc');
    if (separator > 0 && !isBullet) {
      this.text(normalized.slice(0, separator), x + 10, this.y - 6, 9, 'F2', '#334155');
      this.text(normalized.slice(separator + 1).trim(), x + 170, this.y - 6, 9, 'F1', '#0f172a');
    } else {
      this.text(normalized.replace(/^- /, ''), x + 10, this.y - 6, 9, 'F1', '#334155');
    }
    this.y -= 24;
  }

  private newPage() {
    this.page = '';
    this.pageNumber += 1;
    this.y = this.height - 84;
  }

  private finishPage() {
    this.footer();
    this.pages.push(this.page);
  }

  private ensureSpace(required: number) {
    if (this.y - required > 58) return;
    this.finishPage();
    this.newPage();
    this.compactHeader();
  }

  private compactHeader() {
    this.rect(0, this.height - 54, this.width, 54, '#0f172a');
    this.rect(0, this.height - 58, this.width, 4, '#2563eb');
    this.text('Orbis', this.margin, this.height - 32, 13, 'F2', '#ffffff');
    this.text(truncate(this.title, 58), this.width - this.margin - 250, this.height - 32, 10, 'F1', '#cbd5e1');
    this.y = this.height - 86;
  }

  private footer() {
    this.line(this.margin, this.footerY + 18, this.width - this.margin, this.footerY + 18, '#e2e8f0');
    this.text('Orbis', this.margin, this.footerY, 8, 'F2', '#64748b');
    this.text(`Page ${this.pageNumber}`, this.width - this.margin - 42, this.footerY, 8, 'F1', '#64748b');
  }

  private badge(label: string, x: number, y: number, width: number) {
    this.rect(x, y - 14, width, 24, '#eff6ff');
    this.text(label, x + 12, y - 5, 9, 'F2', '#1d4ed8');
  }

  private text(value: string, x: number, y: number, size: number, font: 'F1' | 'F2' | 'F3', color: string) {
    this.page += [
      colorOp(color),
      'BT',
      `/${font} ${size} Tf`,
      `${num(x)} ${num(y)} Td`,
      `(${escapePdfText(ascii(value))}) Tj`,
      'ET',
    ].join('\n') + '\n';
  }

  private rect(x: number, y: number, width: number, height: number, color: string) {
    this.page += `${colorOp(color)}\n${num(x)} ${num(y)} ${num(width)} ${num(height)} re f\n`;
  }

  private line(x1: number, y1: number, x2: number, y2: number, color: string) {
    this.page += `${strokeOp(color)}\n0.7 w\n${num(x1)} ${num(y1)} m\n${num(x2)} ${num(y2)} l\nS\n`;
  }

  private addObject(body: string): number {
    this.objects.push(body);
    return this.objects.length;
  }
}

function colorOp(hex: string) {
  const [r, g, b] = rgb(hex);
  return `${r} ${g} ${b} rg`;
}

function strokeOp(hex: string) {
  const [r, g, b] = rgb(hex);
  return `${r} ${g} ${b} RG`;
}

function rgb(hex: string): [string, string, string] {
  const clean = hex.replace('#', '');
  const values = [0, 2, 4].map((index) => (parseInt(clean.slice(index, index + 2), 16) / 255).toFixed(3));
  return [values[0], values[1], values[2]];
}

function num(value: number) {
  return value.toFixed(2).replace(/\.00$/, '');
}

function truncate(value: string, max: number) {
  const text = ascii(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}.`;
}

function ascii(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/[^\x20-\x7E]/g, '');
}

function escapePdfText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
