/**
 * EMITIR ORÇAMENTO AFC — arquivo de USO
 * --------------------------------------------------------------
 * Edite só: CLIENTE, ATT, e o array `pecas` (dados CRUS).
 * O cálculo é todo automático (gerar_orcamento_afc.js).
 * Rode: node emitir_orcamento.js
 * --------------------------------------------------------------
 *
 * TIPOS DE PEÇA aceitos no array `pecas`:
 *  bancada / pia : { tipo, comps:[c1,(c2),(c3)], larg, quant?, chapa?(22), espelho?, cubas?:["40x34x15", ...] }
 *                  espelho: omitir/true = padrão 7cm (+0,13) | false = SEM espelho (+0,06, só a dobra)
 *                           número = altura em METROS, ex 0.10 (+0,16) / 0.15 (+0,21)
 *                  A chapa consome sempre altura_do_espelho + 0,06 de dobra.
 *  coifa         : { tipo:'coifa', comp, larg, quant?, filtro?(default true) }
 *  duto          : { tipo:'duto', diametro(m), comp(m), quant?, chapa?(28) }
 *  exaustor      : { tipo:'exaustor', diametro_cm, quant? }   // 30,40,50
 *  sistema       : { tipo:'sistema', coifa:{...}, duto:{...}, exaustor:{...}, curva90?, chapeu?, quant? }
 *  corrimao      : { tipo:'corrimao', comp, bitola?('1.5'), colunas?, curvas?, acessibilidade?(false), quant? }
 *  sempreco      : { tipo:'sempreco', spec:["texto..."], quant? }   // Total não aparece
 *  fixo          : { tipo:'fixo', spec:["texto..."], valor, quant? } // item manual com valor pronto
 */

const path = require('path');
const { montarItems } = require('./gerar_orcamento_afc.js');

// ═══════════════════════════════════════════════════════════════
// EDITAR AQUI
// ═══════════════════════════════════════════════════════════════
const CLIENTE = "Cliente Teste";
const ATT     = "";

const pecas = [
  { tipo: 'bancada', comps: [2.00], larg: 0.50, quant: 2 },  // 2 bancadas 2,00x0,50 (espelho padrão, chapa 22)
];
// ═══════════════════════════════════════════════════════════════

const ARQUIVO_OUT = "/home/claude/Orcamento_AFC.docx";

// Data automática em português
const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const hoje = new Date();
const DATA = `Fortaleza, ${hoje.getDate()} de ${meses[hoje.getMonth()]} de ${hoje.getFullYear()}`;

const items = montarItems(pecas);

// ── Geração do DOCX (mesma engine do modelo oficial AFC) ──
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, VerticalAlign, ImageRun, Footer,
} = require('docx');
const fs = require('fs');

// Reusa a logo embutida do modelo oficial
const modeloSrc = fs.readFileSync(path.join(__dirname, 'modelo_orcamento_afc.js'), 'utf8');
const m = modeloSrc.match(/const LOGO_AFC_B64 = "([^"]+)"/);
const logoBuffer = Buffer.from(m[1], 'base64');

const noBorder  = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const greenLine = { style: BorderStyle.SINGLE, size: 8, color: "2E7D32" };
const COL_WIDTHS = [900, 900, 6700, 1300];

function txt(text, opts = {})  { return new TextRun({ text, font: "Arial", size: 20, ...opts }); }
function fmtMoney(n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function headerCell(text, width) {
  return new TableCell({
    borders: { top: greenLine, bottom: greenLine, left: noBorder, right: noBorder },
    width: { size: width, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 80, right: 80 },
    children: [new Paragraph({ children: [txt(text, { bold: true, italics: true })] })]
  });
}
function dataCell(paragraphs, width, isLast = false) {
  return new TableCell({
    borders: { top: noBorder, bottom: isLast ? greenLine : noBorder, left: noBorder, right: noBorder },
    width: { size: width, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 80, right: 80 },
    verticalAlign: VerticalAlign.TOP,
    children: paragraphs,
  });
}

const temDoisOuMais = items.length >= 2;
const tableRows = [
  new TableRow({ children: [
    headerCell("Item", COL_WIDTHS[0]), headerCell("Quant", COL_WIDTHS[1]),
    headerCell("Especificação", COL_WIDTHS[2]), headerCell("Valor R$", COL_WIDTHS[3]),
  ]}),
];

items.forEach((item, idx) => {
  const isLast = idx === items.length - 1;
  const specParas = item.spec.map(l => new Paragraph({ children: [txt(l)] }));
  // Valor Unitário só quando quant > 1
  if (item.quant > 1 && item.valor != null) {
    specParas.push(new Paragraph({ children: [txt(`Valor Unitário R$ ${fmtMoney(item.valor)}`)] }));
  }
  // Valor Total só quando há 2+ itens e o item tem preço
  const valorCell = (temDoisOuMais && item.valor != null)
    ? fmtMoney(item.valor * item.quant) : (item.valor != null && !temDoisOuMais ? fmtMoney(item.valor * item.quant) : "");
  tableRows.push(new TableRow({ children: [
    dataCell([new Paragraph({ children: [txt(item.num)] })], COL_WIDTHS[0], isLast),
    dataCell([new Paragraph({ children: [txt(String(item.quant).padStart(2,'0'))] })], COL_WIDTHS[1], isLast),
    dataCell(specParas, COL_WIDTHS[2], isLast),
    dataCell([new Paragraph({ children: [txt(valorCell)] })], COL_WIDTHS[3], isLast),
  ]}));
});

const footerPara = new Paragraph({ alignment: AlignmentType.CENTER, children: [
  new TextRun({ text: "AFONSO C IND. E COM. DE INOX LTDA", font: "Arial", size: 16, bold: true, italics: true }),
]});
const footer2 = new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "CNPJ: 01.475.443/0001-00  I.E: 06.977.928-7.", font: "Arial", size: 16, bold: true, italics: true })]});
const footer3 = new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Av. Bernardo Manuel, 8305 – Itaperi", font: "Arial", size: 16 })]});
const footer4 = new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Fones: (85) 3232.7753 / 9988.3038   E-mail: afcinox@gmail.com", font: "Arial", size: 16 })]});
const footer5 = new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Fabricamos pias, bancadas, coifas e sistemas de exaustão, corrimões, fogões, peças decorativas, tudo sobre encomenda.", font: "Arial", size: 16 })]});

const doc = new Document({
  sections: [{
    properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } },
    footers: { default: new Footer({ children: [footerPara, footer2, footer3, footer4, footer5] }) },
    children: [
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder },
        rows: [ new TableRow({ children: [
          new TableCell({ borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }, width: { size: 30, type: WidthType.PERCENTAGE },
            children: [ new Paragraph({ children: [ new ImageRun({ data: logoBuffer, transformation: { width: 144, height: 102 } }) ] }) ] }),
          new TableCell({ borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }, width: { size: 70, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({ alignment: AlignmentType.RIGHT, children: [txt(DATA)] }),
              new Paragraph({ alignment: AlignmentType.RIGHT, children: [txt("A", { bold: true })] }),
              new Paragraph({ alignment: AlignmentType.RIGHT, children: [txt(CLIENTE, { bold: true })] }),
              new Paragraph({ alignment: AlignmentType.RIGHT, children: [txt(`Att${ATT ? ': ' + ATT : ':'}`, { bold: true })] }),
            ] }),
        ]}) ],
      }),
      new Paragraph({ text: "", spacing: { after: 200 } }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: "P R O P O S T A   D E   I N V E S T I M E N T O", font: "Arial", size: 22, bold: true })] }),
      new Table({ width: { size: 9800, type: WidthType.DXA }, columnWidths: COL_WIDTHS,
        borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder },
        rows: tableRows }),
      new Paragraph({ text: "", spacing: { after: 200 } }),
      new Paragraph({ children: [ new TextRun({ text: "Contato: ", font: "Arial", size: 20, bold: true }), txt("Afonso – 99988-3038") ] }),
      new Paragraph({ children: [ txt("              Maikon – 98730-0482") ] }),
      new Paragraph({ text: "", spacing: { after: 200 } }),
      new Paragraph({ alignment: AlignmentType.RIGHT, children: [txt("Atenciosamente,")] }),
    ],
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(ARQUIVO_OUT, buf);
  console.log("Gerado:", ARQUIVO_OUT);
  // Resumo no terminal pra conferência
  console.log("\n── RESUMO ──");
  let total = 0;
  items.forEach(it => {
    const sub = it.valor != null ? it.valor * it.quant : null;
    if (sub != null) total += sub;
    console.log(`${it.num} | ${String(it.quant).padStart(2,'0')}x | ${it.spec[0]} | ${it.valor!=null?('R$ '+fmtMoney(it.valor)+'/un → R$ '+fmtMoney(sub)):'(sem preço)'}`);
  });
  console.log(`TOTAL: R$ ${fmtMoney(total)}`);
});
