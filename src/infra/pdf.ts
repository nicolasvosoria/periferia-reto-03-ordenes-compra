import { PDFDocument, StandardFonts } from 'pdf-lib';

const MARGEN = 50;
const TAMANO_LETRA = 11;
const INTERLINEADO = 15;
const CARACTERES_POR_LINEA = 90;

function partirLinea(linea: string): string[] {
  if (linea.length <= CARACTERES_POR_LINEA) return [linea];
  const palabras = linea.split(' ');
  const lineas: string[] = [''];
  for (const palabra of palabras) {
    const actual = lineas[lineas.length - 1] ?? '';
    if (`${actual} ${palabra}`.trim().length > CARACTERES_POR_LINEA) lineas.push(palabra);
    else lineas[lineas.length - 1] = `${actual} ${palabra}`.trim();
  }
  return lineas;
}

export async function pdfDeTexto(titulo: string, texto: string): Promise<Uint8Array> {
  const documento = await PDFDocument.create();
  documento.setTitle(titulo);
  const fuente = await documento.embedFont(StandardFonts.Helvetica);
  const negrita = await documento.embedFont(StandardFonts.HelveticaBold);
  let pagina = documento.addPage();
  let y = pagina.getHeight() - MARGEN;
  pagina.drawText(titulo, { x: MARGEN, y, size: TAMANO_LETRA + 3, font: negrita });
  y -= INTERLINEADO * 2;
  for (const linea of texto.split('\n').flatMap(partirLinea)) {
    if (y < MARGEN) {
      pagina = documento.addPage();
      y = pagina.getHeight() - MARGEN;
    }
    pagina.drawText(linea, { x: MARGEN, y, size: TAMANO_LETRA, font: fuente });
    y -= INTERLINEADO;
  }
  return documento.save();
}
