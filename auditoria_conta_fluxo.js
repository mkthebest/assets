/**
 * AUDITORIA DE CONTA — FLUXO MV (base appPUyd51POUsJ9KO, tbl tblEGOcuJM6xcJe7K)
 * Maikon Pinheiro | criada 07/06/2026
 *
 * OBJETIVO
 *  Pegar o erro recorrente: lançamento gravado com a conta ERRADA no campo Conta
 *  do Fluxo (ex.: atualização de "Caixa físico" gravada como "Conta Bancária").
 *
 * COMO O CLAUDIO USA (via MCP, não roda no Worker):
 *  1. Após CRIAR/ATUALIZAR qualquer registro no Fluxo, montar o objeto do lançamento
 *     com os valores que ACABOU de gravar (loja, conta, descrição).
 *  2. Rodar auditarLancamento(lanc). Se retornar problemas, CORRIGIR antes de reportar.
 *  3. Para varredura geral, rodar auditarFluxo(todosOsLancamentos).
 *
 * Esta função NÃO acessa a rede. Ela recebe os dados já lidos via MCP e valida.
 */

// ─────────────────────────────────────────
// MAPA DE CONTAS VÁLIDAS POR LOJA
// Fonte: PARAM (tipo "Saldo Conta"), nomes canônicos do campo Conta do Fluxo.
// ─────────────────────────────────────────
const CONTAS_VALIDAS = {
  iStore:   ["Conta Bancária", "Maquineta Principal", "Maquineta Solutions", "Caixa físico"],
  HomeWare: ["Conta Bancária", "Caixa físico"],
  // Maquinetas HomeWare (Lucas/Rosa/Valdiane) NÃO são opção do campo Conta do Fluxo:
  // pela regra, lançadas como "Conta Bancária" com a maquineta na DESCRIÇÃO.
};

// Apelidos PARAM -> nome canônico do campo Conta do Fluxo.
// Em 07/06/2026 os nomes foram UNIFICADOS no PARAM (Caixa físico; Maquineta Principal),
// então não há mais descasamento. Mantido vazio como defesa: se algum nome antigo
// reaparecer, basta mapear aqui.
const ALIAS_PARAM = {};

// Maquinetas HomeWare que devem aparecer na DESCRIÇÃO (não no campo Conta).
const MAQUINETAS_HW = ["Lucas", "Rosa", "Valdiane"];

// Palavras-chave na descrição que apontam para uma conta específica.
// Usado para cruzar descrição x campo Conta e pegar o descasamento.
const PISTAS_DESCRICAO = [
  { regex: /caixa\s*f[ií]sico/i,        contaEsperada: "Caixa físico" },
  { regex: /maquineta\s*principal/i,    contaEsperada: "Maquineta Principal" },
  { regex: /maquineta\s*solutions/i,    contaEsperada: "Maquineta Solutions" },
  { regex: /conta\s*banc[áa]ria/i,      contaEsperada: "Conta Bancária" },
  { regex: /\bbanco\b/i,                contaEsperada: "Conta Bancária" },
];

function normalizar(s) {
  return (s || "").toString().trim();
}

/**
 * Audita um único lançamento.
 * @param {{loja:string, conta:string, descricao:string, id?:string}} lanc
 * @returns {string[]} lista de problemas (vazia = OK)
 */
function auditarLancamento(lanc) {
  const problemas = [];
  const loja = normalizar(lanc.loja);
  let conta = normalizar(lanc.conta);
  const desc = normalizar(lanc.descricao);

  // Resolve apelido PARAM -> canônico (defensivo)
  if (ALIAS_PARAM[conta]) conta = ALIAS_PARAM[conta];

  // 1. Loja reconhecida?
  if (!CONTAS_VALIDAS[loja]) {
    problemas.push(`Loja "${loja}" não reconhecida (esperado: iStore ou HomeWare).`);
    return problemas; // sem loja válida não dá pra validar conta
  }

  // 2. Conta existe nessa loja?
  if (!CONTAS_VALIDAS[loja].includes(conta)) {
    problemas.push(
      `Conta "${conta}" não é válida para ${loja}. ` +
      `Válidas: ${CONTAS_VALIDAS[loja].join(", ")}.`
    );
  }

  // 3. Cruzamento descrição x campo Conta (pega o erro do tipo 07/06/26)
  for (const pista of PISTAS_DESCRICAO) {
    if (pista.regex.test(desc) && conta !== pista.contaEsperada) {
      // Exceção: maquineta HW na descrição é lançada como Conta Bancária de propósito.
      const ehMaquinetaHW = MAQUINETAS_HW.some(m => new RegExp(m, "i").test(desc));
      if (ehMaquinetaHW && conta === "Conta Bancária") continue;
      problemas.push(
        `Descrição menciona "${pista.contaEsperada}" mas o campo Conta está "${conta}". ` +
        `Provável conta errada.`
      );
    }
  }

  // 4. Maquineta HW: se a descrição cita Lucas/Rosa/Valdiane, conta deve ser Conta Bancária.
  if (loja === "HomeWare") {
    const m = MAQUINETAS_HW.find(x => new RegExp(x, "i").test(desc));
    if (m && conta !== "Conta Bancária") {
      problemas.push(
        `Maquineta ${m} (HomeWare) deve ser lançada na conta "Conta Bancária" ` +
        `com a maquineta na descrição; está em "${conta}".`
      );
    }
  }

  return problemas;
}

/**
 * Audita uma lista de lançamentos.
 * @param {Array} lancs - cada item: {loja, conta, descricao, id}
 * @returns {Array} [{id, loja, conta, descricao, problemas:[...]}] só dos que têm problema
 */
function auditarFluxo(lancs) {
  const achados = [];
  for (const l of lancs) {
    const problemas = auditarLancamento(l);
    if (problemas.length) achados.push({ ...l, problemas });
  }
  return achados;
}

module.exports = { auditarLancamento, auditarFluxo, CONTAS_VALIDAS, ALIAS_PARAM };

// ─────────────────────────────────────────
// AUTOTESTE
// ─────────────────────────────────────────
if (require.main === module) {
  const casos = [
    // O erro real de hoje (antes da correção):
    { id: "ERRO", loja: "iStore", conta: "Conta Bancária",
      descricao: "Movimentação de Vendas 07/06/2026 (Caixa físico)" },
    // Já corrigido:
    { id: "OK1", loja: "iStore", conta: "Caixa físico",
      descricao: "Movimentação de Vendas 07/06/2026 (Caixa físico)" },
    // Maquineta HW lançada certo (Conta Bancária + maquineta na descrição):
    { id: "OK2", loja: "HomeWare", conta: "Conta Bancária",
      descricao: "Movimentação Maquineta Rosa 07/06/2026" },
    // Conta inexistente na loja:
    { id: "ERRO2", loja: "HomeWare", conta: "Maquineta Solutions",
      descricao: "Venda qualquer" },
    // Venda normal banco, sem pista conflitante:
    { id: "OK3", loja: "iStore", conta: "Conta Bancária",
      descricao: "Venda controle Xbox" },
  ];
  const achados = auditarFluxo(casos);
  console.log("Lançamentos com problema:", achados.length);
  for (const a of achados) {
    console.log(`\n[${a.id}] ${a.loja} | Conta: ${a.conta} | "${a.descricao}"`);
    a.problemas.forEach(p => console.log("   ⚠ " + p));
  }
}
