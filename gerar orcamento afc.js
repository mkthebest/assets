/**
 * GERADOR AUTOMÁTICO DE ORÇAMENTO — AFC INOX
 * ------------------------------------------------------------------
 * OBJETIVO: Maikon passa só os DADOS CRUS de cada peça (tipo + medidas).
 * O script CALCULA sozinho pelas fórmulas oficiais (contexto 4.5–4.8),
 * arredonda (Math.ceil → ,00), monta a descrição no padrão e gera PDF+DOCX.
 * Claude NÃO digita nenhum valor calculado. Tudo sai do código.
 *
 * Todas as constantes abaixo foram lidas da FONTE (contexto v76, seções
 * 4.5/4.6/4.7/4.8) em 11/06/2026. Se alguma regra mudar, corrigir AQUI.
 * ------------------------------------------------------------------
 */

// ╔══════════════════════════════════════════════════════════════╗
// ║  TABELAS OFICIAIS (fonte: contexto 4.5–4.8)                   ║
// ╚══════════════════════════════════════════════════════════════╝

const KG_INOX = 90;            // R$/kg padrão (seção 4.6)

// Indicador por chapa (seção 4.6). PADRÃO = chapa 22 (6,5).
const INDICADOR_CHAPA = {
  28: 4,
  24: 5.4,
  22: 6.5,   // PADRÃO
  20: 8,
  18: 10,
};
const CHAPA_PADRAO = 22;

// Cubas — valores fixos (seção 4.6 + 42.4). Chave = "CxLxP" em cm.
const CUBAS = {
  "40x34x15": 250,   // padrão automático
  "50x40x20": 600,
  "50x40x25": 700,
  "50x40x30": 800,
  "60x50x30": 1900,
  "45x40x30": 1380,
  "57x50x50": 2680,
  "50x70x50": 2480,
  "redonda40x50": 600, // redonda Ø40 prof.50
};
const CUBA_PADRAO = "40x34x15";

// Itens fixos (seção 4.6)
const FIXOS = {
  expurgo: 990,        // Expurgo com tampa
  chapeu: 450,         // Chapéu chinês
  curva90: 400,        // Curva de 90° (duto/coifa)
  pes: 300,            // Pés de mesa (sempre 300)
};

// Exaustores axiais (seção 4.6). Chave = diâmetro em cm.
const EXAUSTOR = { 30: 2000, 40: 2500, 50: 3000 };

// Coifa por m² (seção 4.8)
const COIFA_COM_FILTRO = 2200;
const COIFA_SEM_FILTRO = 1800;

// Corrimão (seção 4.6 corrigida 28/05)
const TUBO = { "1.5": 120, "2": 140, "1": 90, "0.75": 60 }; // R$/m por bitola
const TUBO_PADRAO = "1.5";
const CURVA_180 = 180;

// ── ESPELHO / DOBRA DA CHAPA ──────────────────────────────────
// A chapa consome a ALTURA DO ESPELHO + a DOBRA fixa de 6cm.
// Acréscimo na largura = altura_do_espelho + 0,06
// A dobra de 6cm existe SEMPRE, inclusive quando NÃO há espelho.
//   sem espelho .......  0    + 0,06 = 0,06
//   espelho 7cm  ......  0,07 + 0,06 = 0,13   (PADRÃO)
//   espelho 10cm ......  0,10 + 0,06 = 0,16
//   espelho 15cm ......  0,15 + 0,06 = 0,21
// Vale para bancada, pia, balcão e tampo de mesa.
const DOBRA           = 0.06;   // dobra da chapa — FIXA, nunca muda
const ESPELHO_PADRAO  = 0.07;   // espelho de 7cm é o padrão

/**
 * Acréscimo na largura em função do espelho.
 * @param espelho  undefined/true = padrão 7cm | false = sem espelho | número = altura em metros
 */
function acrescimoEspelho(espelho) {
  if (espelho === false)            return DOBRA;                  // sem espelho: só a dobra
  if (typeof espelho === 'number')  return espelho + DOBRA;        // altura informada
  return ESPELHO_PADRAO + DOBRA;                                   // padrão 7cm
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  ARREDONDAMENTO OFICIAL (seção 4.5)                           ║
// ║  Eliminar TODO centavo, SEMPRE pra cima → termina ,00         ║
// ╚══════════════════════════════════════════════════════════════╝
function arred(v) { return Math.ceil(v - 1e-9); }

// ╔══════════════════════════════════════════════════════════════╗
// ║  CALCULADORAS POR TIPO DE PEÇA                                ║
// ║  Cada uma retorna { valor, spec } — valor JÁ arredondado.     ║
// ╚══════════════════════════════════════════════════════════════╝

function indicadorDe(chapa) {
  const ch = chapa || CHAPA_PADRAO;
  const ind = INDICADOR_CHAPA[ch];
  if (ind === undefined) throw new Error(`Chapa ${ch} não existe na tabela (4.6).`);
  return ind;
}

function valorCuba(cuba) {
  const v = CUBAS[cuba];
  if (v === undefined) throw new Error(`Cuba "${cuba}" não está na tabela de cubas (4.6).`);
  return v;
}

// fmtMed: "2,00 x 0,50m" a partir de números
function fmtMed(...dims) {
  return dims.map(d => d.toFixed(2).replace('.', ',')).join(' x ') + 'm';
}

/**
 * BANCADA / PIA (mesma fórmula). Linear, L ou U conforme nº de comprimentos.
 * p = {
 *   tipo:'bancada'|'pia', comps:[c1,(c2),(c3)], larg, chapa?, espelho?(true), cubas?:[ "40x34x15", ... ]
 * }
 * Fórmula 4.7: (Σcomp + 0,10) × (larg + espelho) × indicador × 90 + Σcubas
 */
function calcBancada(p) {
  const comps = p.comps;
  const somaComp = comps.reduce((a, b) => a + b, 0);
  const larg = p.larg;
  const esp = acrescimoEspelho(p.espelho); // altura do espelho + dobra de 6cm
  const ind = indicadorDe(p.chapa);
  const cubas = p.cubas || [];
  const valorCubas = cubas.reduce((a, c) => a + valorCuba(c), 0);

  const bruto = (somaComp + 0.10) * (larg + esp) * ind * KG_INOX + valorCubas;
  const valor = arred(bruto);

  // Descrição no padrão. Bancada vs Pia. Forma (linear/L/U) pelo nº de comps.
  const nome = (p.tipo === 'pia') ? 'Pia' : 'Bancada';
  const medida = (comps.length === 1)
    ? fmtMed(comps[0], larg)
    : comps.map(c => c.toFixed(2).replace('.', ',')).join(' + ') + ` x ${larg.toFixed(2).replace('.', ',')}m`;
  let desc = `${nome} em aço inox AISI 304/18.8, medindo ${medida}`;
  if (p.espelho === false) {
    // sem espelho: não escreve nada na descrição
  } else if (typeof p.espelho === 'number') {
    desc += `, com espelho de ${Math.round(p.espelho * 100)}cm`;
  } else {
    desc += ', com espelho de 7cm';
  }
  if (cubas.length === 1) {
    desc += `, com 01 cuba de ${cubaTxt(cubas[0])}`;
  } else if (cubas.length > 1) {
    const cont = {};
    cubas.forEach(c => cont[c] = (cont[c] || 0) + 1);
    const partes = Object.entries(cont).map(([c, n]) => `${String(n).padStart(2, '0')} cuba${n > 1 ? 's' : ''} de ${cubaTxt(c)}`);
    desc += `, com ${partes.join(' e ')}`;
  }
  desc += '.';
  return { valor, spec: [desc] };
}

function cubaTxt(c) {
  if (c.startsWith('redonda')) {
    const m = c.replace('redonda', '').split('x'); // 40x50 -> Ø40 prof.50
    return `Ø${m[0]}cm prof. ${m[1]}cm`;
  }
  return c.replace(/x/g, 'x') + 'cm';
}

/**
 * COIFA. p = { comp, larg, filtro?(true) }
 * Fórmula 4.8: comp × larg × (2200 com filtro | 1800 sem)
 */
function calcCoifa(p) {
  const taxa = (p.filtro === false) ? COIFA_SEM_FILTRO : COIFA_COM_FILTRO;
  const valor = arred(p.comp * p.larg * taxa);
  const tipo = (p.filtro === false) ? 'sem filtro' : 'com filtro';
  return { valor, spec: [`Coifa em aço inox, medindo ${fmtMed(p.comp, p.larg)}, ${tipo}.`] };
}

/**
 * DUTO. p = { diametro(m), comp(m), chapa?(28) }
 * Fórmula 4.8: π × diâmetro × comprimento × indicador(4) × 90
 * Descrição: "X metros de duto Ø Y" — NUNCA citar tipo de chapa (regra).
 */
function calcDuto(p) {
  const ind = indicadorDe(p.chapa || 28);
  const valor = arred(Math.PI * p.diametro * p.comp * ind * KG_INOX);
  const diamCm = Math.round(p.diametro * 100);
  return { valor, spec: [`${p.comp.toFixed(2).replace('.', ',')} metros de duto Ø ${diamCm}cm.`] };
}

/**
 * EXAUSTOR. p = { diametro_cm }
 */
function calcExaustor(p) {
  const v = EXAUSTOR[p.diametro_cm];
  if (v === undefined) throw new Error(`Exaustor Ø${p.diametro_cm}cm não está na tabela (4.6).`);
  return { valor: v, spec: [`Exaustor axial Ø ${p.diametro_cm}cm.`] };
}

/**
 * SISTEMA (coifa+duto+exaustor agrupados em 1 item — regra 4.8).
 * p = { coifa:{...}, duto:{...}, exaustor:{...}, curva90?:n, chapeu?:n }
 */
function calcSistema(p) {
  let total = 0; const linhas = [];
  if (p.coifa)    { const r = calcCoifa(p.coifa);       total += r.valor; linhas.push(r.spec[0]); }
  if (p.duto)     { const r = calcDuto(p.duto);         total += r.valor; linhas.push(r.spec[0]); }
  if (p.exaustor) { const r = calcExaustor(p.exaustor); total += r.valor; linhas.push(r.spec[0]); }
  if (p.curva90)  { total += FIXOS.curva90 * p.curva90; linhas.push(`${String(p.curva90).padStart(2,'0')} curva${p.curva90>1?'s':''} de 90°.`); }
  if (p.chapeu)   { total += FIXOS.chapeu * p.chapeu;   linhas.push(`${String(p.chapeu).padStart(2,'0')} chapéu${p.chapeu>1?'s':''} chinês.`); }
  return { valor: total, spec: linhas };
}

/**
 * CORRIMÃO. p = { comp, bitola?('1.5'), colunas?, curvas?, acessibilidade?(false) }
 * tubos = 2 × comp × R$/m (ida e volta);  colunas = qtd × 1m × R$/m;
 * curvas 180° = qtd × 180 (acessibilidade: mínimo 2).
 */
function calcCorrimao(p) {
  const rpm = TUBO[p.bitola || TUBO_PADRAO];
  const tubos = 2 * p.comp * rpm;
  const nCol = (p.colunas != null) ? p.colunas : Math.max(2, Math.ceil(p.comp / 1.30));
  const colunas = nCol * rpm;
  const nCurv = p.acessibilidade ? Math.max(2, p.curvas || 0) : (p.curvas || 0);
  const curvas = nCurv * CURVA_180;
  const valor = arred(tubos + colunas + curvas);
  const bit = (p.bitola || TUBO_PADRAO).replace('.', '.') ;
  return { valor, spec: [`Corrimão em aço inox, ${p.comp.toFixed(2).replace('.', ',')}m, tubo ${bit}", ${nCol} colunas${nCurv? `, ${nCurv} curvas 180°`:''}.`] };
}

/**
 * ITEM SEM PREÇO (Maikon calcula depois). p = { spec:["..."] }
 * Valor null → Total não aparece (regra 4.5).
 */
function calcSemPreco(p) { return { valor: null, spec: p.spec }; }

const CALC = {
  bancada: calcBancada,
  pia: calcBancada,
  coifa: calcCoifa,
  duto: calcDuto,
  exaustor: calcExaustor,
  sistema: calcSistema,
  corrimao: calcCorrimao,
  sempreco: calcSemPreco,
  fixo: (p) => ({ valor: p.valor ?? null, spec: p.spec }), // item manual avulso
};

// ╔══════════════════════════════════════════════════════════════╗
// ║  MONTA O ARRAY items[] NO FORMATO DO MODELO OFICIAL           ║
// ╚══════════════════════════════════════════════════════════════╝
function montarItems(pecas) {
  return pecas.map((p, i) => {
    const fn = CALC[p.tipo];
    if (!fn) throw new Error(`Tipo de peça desconhecido: "${p.tipo}"`);
    const r = fn(p);
    return {
      num: String(i + 1).padStart(2, '0'),
      quant: p.quant || 1,
      spec: r.spec,
      valor: r.valor,   // pode ser null (sem preço)
    };
  });
}

module.exports = { montarItems, arred, CALC };

// ── Se rodado direto, faz um autoteste das fórmulas contra a fonte ──
if (require.main === module) {
  const testes = [
    { nome: 'Pia 1,00x0,60 + cuba padrão (esperado 720)', peca: { tipo:'pia', comps:[1.00], larg:0.60, cubas:[CUBA_PADRAO] }, esperado: 720 },
    { nome: 'Bancada 2,00x0,50 c/ espelho chapa22 (esperado 774)', peca: { tipo:'bancada', comps:[2.00], larg:0.50 }, esperado: 774 },
    { nome: 'Bancada 1,60x0,70 + cuba padrão (esperado 1076)', peca: { tipo:'bancada', comps:[1.60], larg:0.70, cubas:[CUBA_PADRAO] }, esperado: 1076 },
    // ── Testes do espelho (dobra 6cm) ──
    // Bancada 2,00x0,50 SEM espelho: (2,10) x (0,50+0,06) x 6,5 x 90 = 687,96 -> 688
    { nome: 'Bancada 2,00x0,50 SEM espelho, com dobra 6cm (esperado 688)', peca: { tipo:'bancada', comps:[2.00], larg:0.50, espelho:false }, esperado: 688 },
    // Bancada 2,00x0,50 espelho 10cm: (2,10) x (0,50+0,16) x 6,5 x 90 = 810,81 -> 811
    { nome: 'Bancada 2,00x0,50 espelho 10cm (esperado 811)', peca: { tipo:'bancada', comps:[2.00], larg:0.50, espelho:0.10 }, esperado: 811 },
    // Bancada 2,00x0,50 espelho 15cm: (2,10) x (0,50+0,21) x 6,5 x 90 = 872,24 -> 873
    { nome: 'Bancada 2,00x0,50 espelho 15cm (esperado 873)', peca: { tipo:'bancada', comps:[2.00], larg:0.50, espelho:0.15 }, esperado: 873 },
  ];
  let ok = true;
  for (const t of testes) {
    const r = CALC[t.peca.tipo](t.peca);
    const passou = r.valor === t.esperado;
    ok = ok && passou;
    console.log(`${passou ? '✓' : '✗'} ${t.nome} → R$ ${r.valor}` + (passou ? '' : ` (ESPERADO ${t.esperado})`));
  }
  console.log(ok ? '\nTODOS OS TESTES PASSARAM ✓' : '\nFALHOU ✗');
  process.exit(ok ? 0 : 1);
}
