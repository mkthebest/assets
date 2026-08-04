#!/usr/bin/env node
/**
 * AUDITORIA DO FLUXO — MV iStore / MV HomeWare        (arquivo unico)
 * ================================================================
 * Substitui e absorve o antigo `auditoria_conta_fluxo.js` (07/06/2026).
 * Depois de subir este, APAGAR o antigo: dois auditores sobre o mesmo
 * Fluxo uma hora discordam e ninguem sabe em qual acreditar.
 *
 * Faz DUAS auditorias que se completam:
 *
 *  [1] INVARIANTE DO CAIXA  (Ordem 17.7 / Ordem 93) — o dinheiro fecha?
 *        Fechamento do mes anterior
 *        + entradas RECEBIDAS no mes (Fluxo, Tipo Mov = Entrada)
 *        - saidas PAGAS no mes        (Contas a Pagar)
 *        = PARAM calculado
 *      GAP = PARAM real - PARAM calculado.  Tem que ser 0,00.
 *
 *  [2] VALIDACAO DE CONTA (herdada do auditor de 07/06) — o rotulo esta certo?
 *      Pega lancamento gravado na conta errada, ex.: movimentacao de
 *      "Caixa fisico" gravada como "Conta Bancaria".
 *
 * SO LE. Nunca escreve no Airtable.
 *
 * USO
 *   export AIRTABLE_TOKEN="pat..."
 *   node auditoria_fluxo_mv.js                # audita hoje
 *   node auditoria_fluxo_mv.js 2026-08-03     # audita uma data
 *   node auditoria_fluxo_mv.js --teste        # autoteste, SEM rede
 *
 * Tambem da pra usar como modulo, que e como o Claudio chama a parte [2]
 * depois de gravar um lancamento pelo conector:
 *   const { auditarLancamento } = require('./auditoria_fluxo_mv.js');
 *   auditarLancamento({ loja:'HomeWare', conta:'Maquineta Lucas', descricao:'...' });
 */

// ================================================================ CONFIG
const BASE = 'appPUyd51POUsJ9KO';
const T = { fluxo: 'tblEGOcuJM6xcJe7K', cap: 'tbliQAh9FZx4Uh6SG', param: 'tblLd1Thn5RsgH7wI' };

const F = { tipoMov:'fldx8MvAfTBx2GXWv', conta:'fld7esOPDRetK2b3Y', loja:'fld8nBfhxKk9a5Ae3',
            status:'fldZENQxh7WMw7loy', bruto:'fldWJvgsbmbzEKUjp', taxa:'fldxSeV8fYghvki6v',
            liquido:'fldbAEFuW7TnOlI83', dataVenc:'fldX9kMKaGNGt64fp',
            dataPgto:'fldxVsiP4TSId6t8t', descr:'fldRurW4bIxPqtOnD' };

// ATENCAO: no CaP os nomes dos dois campos de data estao TROCADOS no schema.
//   capVenc = o que a formula do Status usa como VENCIMENTO
//   capPago = o que, preenchido, dispara "Pago"
const C = { descr:'fldMxA6uZyEAVz6i2', loja:'fld65thPoU3n5V7Zb', valor:'fldXxdaUldC3dxASN',
            capVenc:'fldDQOMFcDcQi0yCa', capPago:'fldswuQqvYyLQzQYM', status:'fldo3Fea4P7FsCRQC' };

const P = { nome:'fldMNrTDtX7aYwe6r', tipo:'fldN9FEojTY4J7fyZ', valor:'fldTXH5TZ198aJTBI',
            data:'fldaYt6f9DHFPr75d', loja:'fldtZJcjkeXMVtckm' };

const LOJAS = ['iStore', 'HomeWare'];

// ================================================================ [2] CONTAS
// ATUALIZADO 03/08/2026. O auditor antigo dizia que as maquinetas da HomeWare
// (Lucas/Rosa/Valdiane) NAO eram opcao do campo Conta e deviam ir como
// "Conta Bancaria" com a maquineta na descricao. Isso valeu ate meados de
// junho/2026. Desde 20/06 existem 21+ lancamentos usando as maquinetas
// diretamente no campo Conta, e o campo tem essas opcoes. A regra antiga
// reprovava lancamento CERTO — foi corrigida aqui.
const CONTAS_VALIDAS = {
  iStore:   ['Conta Bancária', 'Maquineta Principal', 'Maquineta Solutions',
             'Maquineta SumUp', 'Caixa físico'],
  HomeWare: ['Conta Bancária', 'Maquineta Rosa', 'Maquineta Valdiane',
             'Maquineta Lucas', 'Caixa físico'],
};

// Opcao legada do campo, mantida por causa de registros antigos.
const ALIAS_CONTA = { 'Bancária': 'Conta Bancária' };

// Pistas na descricao que apontam para uma conta. As maquinetas EXIGEM a palavra
// "maquineta" antes do nome — senao "Venda Lucas - Garrafa GoCase" (cliente
// chamado Lucas, conta Maquineta Principal) viraria alarme falso.
const PISTAS = [
  { re: /caixa\s*f[ií]sico/i,        conta: 'Caixa físico' },
  { re: /maquineta\s*principal/i,    conta: 'Maquineta Principal' },
  { re: /maquineta\s*solutions/i,    conta: 'Maquineta Solutions' },
  { re: /maquineta\s*sumup/i,        conta: 'Maquineta SumUp' },
  { re: /maquineta\s*rosa/i,         conta: 'Maquineta Rosa' },
  { re: /maquineta\s*valdiane/i,     conta: 'Maquineta Valdiane' },
  { re: /maquineta\s*lucas/i,        conta: 'Maquineta Lucas' },
  { re: /conta\s*banc[áa]ria/i,      conta: 'Conta Bancária' },
];

const norm = s => (s == null ? '' : String(s)).trim();
const nomeSel = v => norm(v && typeof v === 'object' ? v.name : v);

/** Audita UM lancamento do Fluxo. Retorna lista de problemas (vazia = OK). */
function auditarLancamento(lanc) {
  const problemas = [];
  const loja = norm(lanc.loja);
  const desc = norm(lanc.descricao);
  let conta = norm(lanc.conta);

  if (ALIAS_CONTA[conta]) {
    problemas.push(`Conta gravada como "${conta}" (opcao legada). O nome atual e "${ALIAS_CONTA[conta]}".`);
    conta = ALIAS_CONTA[conta];
  }

  if (!CONTAS_VALIDAS[loja]) {
    problemas.push(`Loja "${loja}" nao reconhecida (esperado: iStore ou HomeWare).`);
    return problemas;
  }
  if (!CONTAS_VALIDAS[loja].includes(conta))
    problemas.push(`Conta "${conta}" nao e valida para ${loja}. Validas: ${CONTAS_VALIDAS[loja].join(', ')}.`);

  for (const p of PISTAS)
    if (p.re.test(desc) && conta !== p.conta)
      problemas.push(`Descricao menciona "${p.conta}" mas o campo Conta esta "${conta}". Provavel conta errada.`);

  return problemas;
}

const auditarFluxo = lancs =>
  lancs.map(l => ({ ...l, problemas: auditarLancamento(l) })).filter(x => x.problemas.length);

// ================================================================ HELPERS
const money = n => (n < 0 ? '-' : '') + 'R$ ' +
  Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
// soma em centavos: evita o erro de ponto flutuante que vira "GAP de 1 centavo"
const somar = a => r2(a.reduce((s, v) => s + Math.round((v || 0) * 100), 0) / 100);
const primeiroDia = iso => iso.slice(0, 8) + '01';
function mesAnterior(iso) {
  const [y, m] = iso.split('-').map(Number);
  return `${String(m === 1 ? 12 : m - 1).padStart(2, '0')}/${m === 1 ? y - 1 : y}`;
}

// ================================================================ AIRTABLE
async function fetchAll(tableId) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) { console.error('\nFALTA O TOKEN:  export AIRTABLE_TOKEN="pat..."\n'); process.exit(2); }
  const out = []; let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE}/${tableId}`);
    url.searchParams.set('returnFieldsByFieldId', 'true');
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { console.error(`\nERRO Airtable ${res.status} em ${tableId}: ${await res.text()}\n`); process.exit(2); }
    const j = await res.json();
    out.push(...j.records); offset = j.offset;
  } while (offset);
  return out;
}

// ================================================================ AUDITORIA
function auditarLoja(loja, hoje, fluxo, cap, param) {
  const ini = primeiroDia(hoje);
  const alertas = [];

  const rotulo = `Fechamento ${mesAnterior(hoje)}`;
  const recFech = param.find(r => nomeSel(r.fields[P.loja]) === loja && norm(r.fields[P.nome]) === rotulo);
  const fechamento = recFech ? (recFech.fields[P.valor] || 0) : null;
  if (fechamento === null)
    alertas.push(`Nao achei "${rotulo}" no PARAM — a invariante nao pode ser conferida.`);

  const contas = param.filter(r => nomeSel(r.fields[P.loja]) === loja && nomeSel(r.fields[P.tipo]) === 'Saldo Conta');
  const paramReal = somar(contas.map(r => r.fields[P.valor]));

  const entradas = fluxo.filter(r => {
    const f = r.fields;
    if (nomeSel(f[F.loja]) !== loja) return false;
    if (nomeSel(f[F.tipoMov]) !== 'Entrada') return false;   // ignora "NAO USAR" e "Saida"
    if (nomeSel(f[F.status]) !== 'Recebido') return false;
    const d = f[F.dataPgto] || f[F.dataVenc];
    return d && d >= ini && d <= hoje;
  });
  const totEntradas = somar(entradas.map(r => r.fields[F.liquido]));

  const saidas = cap.filter(r => {
    const f = r.fields;
    if (nomeSel(f[C.loja]) !== loja) return false;
    const d = f[C.capPago];
    return d && d >= ini && d <= hoje;
  });
  const totSaidas = somar(saidas.map(r => r.fields[C.valor]));

  const calculado = fechamento === null ? null : r2(fechamento + totEntradas - totSaidas);
  const gap = calculado === null ? null : r2(paramReal - calculado);

  // ---- checagens estruturais
  for (const r of entradas) {
    const f = r.fields;
    if (f[F.bruto] != null) {
      const esperado = r2((f[F.bruto] || 0) - (f[F.taxa] || 0));
      if (r2(f[F.liquido] || 0) !== esperado)
        alertas.push(`Bruto-Taxa != Liquido: "${f[F.descr]}" (${money(f[F.bruto])} - ${money(f[F.taxa] || 0)} != ${money(f[F.liquido] || 0)})`);
    }
    if (!f[F.liquido])
      alertas.push(`Entrada Recebida com Liquido vazio/zero: "${f[F.descr]}"`);
  }

  // duplicidade: descricao entra na chave (parcelas de clientes diferentes podem
  // ter o mesmo valor no mesmo dia legitimamente)
  const mapa = new Map();
  for (const r of entradas) {
    const f = r.fields;
    const k = `${nomeSel(f[F.conta])}|${f[F.liquido]}|${f[F.dataPgto] || f[F.dataVenc]}|${norm(f[F.descr]).toLowerCase()}`;
    mapa.set(k, [...(mapa.get(k) || []), f[F.descr]]);
  }
  for (const [, ds] of mapa)
    if (ds.length > 1) alertas.push(`Registro repetido ${ds.length}x (mesma conta, valor, data e descricao): "${ds[0]}"`);

  // [2] validacao de conta nas entradas do mes
  const contaRuim = auditarFluxo(entradas.map(r => ({
    id: r.id, loja: nomeSel(r.fields[F.loja]),
    conta: nomeSel(r.fields[F.conta]), descricao: norm(r.fields[F.descr]),
  })));
  for (const x of contaRuim) x.problemas.forEach(p => alertas.push(`[conta] ${p}  -> "${x.descricao}"`));

  const ajustes = saidas.filter(r => /ajuste|reconcilia/i.test(norm(r.fields[C.descr])))
    .concat(entradas.filter(r => /ajuste|reconcilia/i.test(norm(r.fields[F.descr]))).map(r => ({
      fields: { [C.capPago]: r.fields[F.dataPgto], [C.valor]: r.fields[F.liquido], [C.descr]: r.fields[F.descr] },
    })));

  const atrasados = cap.filter(r => {
    const f = r.fields;
    return nomeSel(f[C.loja]) === loja && !f[C.capPago] && f[C.capVenc] && f[C.capVenc] < hoje;
  });

  return { loja, fechamento, totEntradas, totSaidas, calculado, paramReal, gap,
           nEntradas: entradas.length, nSaidas: saidas.length, contas, alertas, ajustes, atrasados };
}

function imprimir(a) {
  console.log(`\n${'='.repeat(64)}\n  ${a.loja}\n${'='.repeat(64)}`);
  for (const c of a.contas)
    console.log(`  ${norm(c.fields[P.nome]).padEnd(24)} ${money(c.fields[P.valor] || 0).padStart(16)}   (${c.fields[P.data] || 's/ data'})`);
  console.log(`  ${'TOTAL CAIXA HOJE'.padEnd(24)} ${money(a.paramReal).padStart(16)}`);

  console.log('\n  [1] INVARIANTE DO CAIXA');
  if (a.fechamento === null) {
    console.log('      nao calculavel (falta o fechamento do mes anterior)');
  } else {
    console.log(`      fechamento mes anterior        ${money(a.fechamento).padStart(16)}`);
    console.log(`    + entradas recebidas (${String(a.nEntradas).padStart(3)} reg)  ${money(a.totEntradas).padStart(16)}`);
    console.log(`    - saidas pagas       (${String(a.nSaidas).padStart(3)} reg)  ${money(a.totSaidas).padStart(16)}`);
    console.log(`    = PARAM calculado                ${money(a.calculado).padStart(16)}`);
    console.log(`      PARAM real                     ${money(a.paramReal).padStart(16)}`);
    console.log(`      ${'-'.repeat(46)}`);
    console.log(`      GAP                            ${money(a.gap).padStart(16)}   ${a.gap === 0 ? '[OK]' : '[!!] NAO BATE'}`);
    if (a.gap !== 0) {
      console.log(`\n    >> Faltam ${money(Math.abs(a.gap))} de ${a.gap < 0 ? 'SAIDA' : 'ENTRADA'} para o Fluxo explicar o saldo real.`);
      console.log('    >> NAO passe numero adiante antes de achar o lancamento que falta.');
    }
  }

  if (a.ajustes.length) {
    console.log(`\n  AJUSTES MANUAIS NO MES (${a.ajustes.length}) — cada um e um erro que virou remendo:`);
    for (const r of a.ajustes)
      console.log(`    ${r.fields[C.capPago] || '??'}  ${money(r.fields[C.valor] || 0).padStart(14)}  ${r.fields[C.descr]}`);
    if (a.ajustes.length > 2) console.log('    >> Mais de 2 ajustes no mes: o problema esta no PROCESSO, nao no mes.');
  }

  if (a.atrasados.length) {
    console.log(`\n  CONTAS VENCIDAS E NAO PAGAS (${a.atrasados.length}):`);
    a.atrasados.slice(0, 15).forEach(r =>
      console.log(`    ${r.fields[C.capVenc]}  ${money(r.fields[C.valor]).padStart(14)}  ${r.fields[C.descr]}`));
    if (a.atrasados.length > 15) console.log(`    ... e mais ${a.atrasados.length - 15}`);
  }

  console.log(a.alertas.length ? `\n  [2] ALERTAS (${a.alertas.length}):` : '\n  [2] Sem alertas estruturais nem de conta.');
  a.alertas.forEach(x => console.log(`    - ${x}`));
}

// ================================================================ AUTOTESTE
function autoteste() {
  const casos = [
    // o erro real de 07/06 que criou o auditor antigo
    { id:'ERRO-conta', esperaProblema:true, loja:'iStore', conta:'Conta Bancária',
      descricao:'Movimentação de Vendas 07/06/2026 (Caixa físico)' },
    { id:'OK-corrigido', esperaProblema:false, loja:'iStore', conta:'Caixa físico',
      descricao:'Movimentação de Vendas 07/06/2026 (Caixa físico)' },
    // pratica ATUAL da HomeWare: maquineta direto no campo Conta (o antigo reprovava)
    { id:'OK-maq-hw', esperaProblema:false, loja:'HomeWare', conta:'Maquineta Lucas',
      descricao:'Ajuste de saldo (fechamento 03/08) - Maquineta Lucas' },
    { id:'OK-maq-hw2', esperaProblema:false, loja:'HomeWare', conta:'Maquineta Rosa',
      descricao:'Movimentação da semana — Maquineta Rosa HomeWare' },
    // cliente chamado Lucas na iStore nao pode virar alarme falso
    { id:'OK-cliente-lucas', esperaProblema:false, loja:'iStore', conta:'Maquineta Principal',
      descricao:'Venda Lucas - Garrafa GoCase 2x (2/2)' },
    // conta de outra loja
    { id:'ERRO-loja', esperaProblema:true, loja:'HomeWare', conta:'Maquineta Solutions',
      descricao:'Venda qualquer' },
    // opcao legada
    { id:'ERRO-legado', esperaProblema:true, loja:'iStore', conta:'Bancária',
      descricao:'Venda antiga' },
    { id:'OK-normal', esperaProblema:false, loja:'iStore', conta:'Conta Bancária',
      descricao:'Venda controle Xbox' },
  ];
  let falhas = 0;
  console.log('\nAUTOTESTE — validacao de conta\n');
  for (const c of casos) {
    const p = auditarLancamento(c);
    const ok = (p.length > 0) === c.esperaProblema;
    if (!ok) falhas++;
    console.log(`  ${ok ? 'PASSOU' : 'FALHOU'}  ${c.id.padEnd(18)} ${p.length ? p[0] : '(sem problema)'}`);
  }

  console.log('\nAUTOTESTE — soma em centavos');
  const t = [0.1, 0.2, 0.3, 1723.86, 125.53];
  const ok2 = somar(t) === 1849.99;
  if (!ok2) falhas++;
  console.log(`  ${ok2 ? 'PASSOU' : 'FALHOU'}  soma = ${somar(t)} (esperado 1849.99)`);

  console.log(falhas ? `\n>> ${falhas} FALHA(S)\n` : '\n>> TODOS OS TESTES PASSARAM\n');
  process.exit(falhas ? 1 : 0);
}

// ================================================================ MAIN
async function main() {
  const arg = process.argv[2];
  if (arg === '--teste') return autoteste();

  const hoje = arg || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hoje)) { console.error('Data invalida. Use AAAA-MM-DD.'); process.exit(2); }

  console.log(`\nAUDITORIA DO FLUXO — ${hoje.split('-').reverse().join('/')}`);
  const [fluxo, cap, param] = await Promise.all([fetchAll(T.fluxo), fetchAll(T.cap), fetchAll(T.param)]);

  const naoUsar = fluxo.filter(r => /N[AÃ]O USAR/i.test(nomeSel(r.fields[F.tipoMov])));
  const res = LOJAS.map(l => auditarLoja(l, hoje, fluxo, cap, param));
  res.forEach(imprimir);

  console.log(`\n${'='.repeat(64)}\n  RESUMO\n${'='.repeat(64)}`);
  let tudoOk = true;
  for (const a of res) {
    const st = a.gap === null ? 'SEM FECHAMENTO' : (a.gap === 0 ? 'OK' : 'GAP ' + money(a.gap));
    const nAl = a.alertas.length;
    if (a.gap !== 0 || nAl) tudoOk = false;
    console.log(`  ${a.loja.padEnd(12)} caixa ${money(a.paramReal).padStart(16)}   ${st}${nAl ? `   (${nAl} alerta[s])` : ''}`);
  }
  if (naoUsar.length)
    console.log(`\n  ${naoUsar.length} registros "NAO USAR" ainda vivos na Fluxo de Caixa (ignorados no calculo).`);
  console.log(tudoOk
    ? '\n  >> Tudo bate. Pode passar numero.\n'
    : '\n  >> TEM PENDENCIA. Resolva ANTES de reportar qualquer numero.\n');
  process.exit(tudoOk ? 0 : 1);
}

module.exports = { auditarLancamento, auditarFluxo, auditarLoja, CONTAS_VALIDAS, somar };

if (require.main === module) main().catch(e => { console.error(e); process.exit(2); });
