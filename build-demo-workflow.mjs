import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const original = JSON.parse(readFileSync(new URL("./workflow.json", import.meta.url), "utf8"));
const id = name => createHash("sha256").update(`alfa-mock:${name}`).digest("hex").slice(0, 32);
const nodes = [];
const connections = {};
function add(name, type, version, parameters, position, notes) {
  nodes.push({ id: id(name), name, type: `n8n-nodes-base.${type}`, typeVersion: version,
    position, parameters, ...(notes ? { notes, notesInFlow: true } : {}) });
  return name;
}
const code = (name, jsCode, position, notes) => add(name, "code", 2,
  { mode: "runOnceForEachItem", jsCode }, position, notes);
const edge = (from, to, branch = 0) => {
  connections[from] ??= { main: [] };
  while (connections[from].main.length <= branch) connections[from].main.push([]);
  connections[from].main[branch].push({ node: to, type: "main", index: 0 });
};
function reuse(label, name, references, position) {
  const source = original.nodes.find(n => n.name.replace(/^\d+ - /, "") === label);
  if (source?.type !== "n8n-nodes-base.code") throw Error(`Chybí zdrojový uzel: ${label}`);
  const jsCode = source.parameters.jsCode.replace(/\$\('([^']+)'\)/g, (match, ref) => {
    if (!references[ref]) throw Error(`Chybí mapování reference: ${ref}`);
    return `$('${references[ref]}')`;
  });
  return code(name, jsCode, position, `Skutečný kód z workflow.json: ${source.name}. Změněné jsou pouze odkazy na uzly.`);
}

const start = add("Spustit ukázku", "manualTrigger", 1, {}, [0, 240]);
const input = add("Upravit zadání", "set", 3.4, {
  assignments: { assignments: [
    ["scenar", "chybi_rozmery"],
    ["jmeno", "Jana Nováková"],
    ["email", "zakaznik@portfolio.test"],
    ["polozka", "Jednací stůl pro čtyři osoby"],
    ["rozmery", ""],
    ["poznamka", "Hledáme stůl do malé zasedací místnosti."],
  ].map(([name, value]) => ({ id: id(name), name, value, type: "string" })) },
  includeOtherFields: false, options: {},
}, [240, 240], "Změňte scenar: chybi_rozmery / spravna_odpoved / chybny_adresat. Ostatní pole lze také upravit.");
const receive = code("Přijmout poptávku · mock Sheets", `
const scenarios = ['chybi_rozmery', 'spravna_odpoved', 'chybny_adresat'];
if (!scenarios.includes($json.scenar)) throw Error('Pole scenar musí být: ' + scenarios.join(' / '));
for (const key of ['jmeno', 'email', 'polozka', 'rozmery', 'poznamka']) {
  if (typeof $json[key] !== 'string' || $json[key].length > 2000) throw Error('Neplatné pole: ' + key);
}
if (!/^[^\\s@<>\\r\\n]+@[^\\s@<>\\r\\n]+\\.test$/.test($json.email))
  throw Error('Použijte fiktivní adresu s doménou .test, například zakaznik@portfolio.test.');
if (!$json.jmeno.trim() || !$json.polozka.trim()) throw Error('Vyplňte jméno a položku.');
return { json: {
  ...$json, id: 'DEMO-11111111-1111-4111-8111-111111111111',
  receivedAt: new Date().toISOString(), stav: 'Poptávka přijata',
  rezim: 'MOCK — data existují jen v tomto běhu n8n',
} };`, [480, 240], "Simulovaný zápis. Každé spuštění je nový, nezávislý běh se stejným fiktivním ID.");
const acknowledgement = code("Potvrdit přijetí · mock Gmail", `
return { json: { ...$json, potvrzeni: {
  komu: $json.email, predmet: '[ALFA-PRIJETI ' + $json.id + '] Potvrzení přijetí poptávky',
  text: 'Dobrý den, přijali jsme Vaši poptávku: ' + $json.polozka + '.',
  stav: 'Simulováno — žádná zpráva se neodesílá',
} } };`, [720, 240]);
const draftTask = code("Připravit úlohu konceptu", `
return { json: { id: $json.id, to: $json.email, account: 'majitel@portfolio.test',
  since: $json.receivedAt, mode: 'claim', step: 'Koncept' } };`, [960, 240]);
const ai = code("Navrhnout text · mock AI", `
const inquiry = $('Přijmout poptávku · mock Sheets').item.json;
const missing = !inquiry.rozmery.trim();
const question = 'Jaké rozměry má mít ' + inquiry.polozka.toLowerCase() + '?';
const text = missing ? question : 'Evidujeme požadované rozměry: ' + inquiry.rozmery + '. Podklady předáváme majiteli k posouzení.';
const output = {
  status: missing ? 'needs_clarification' : 'ready_for_review',
  summary: inquiry.jmeno + ' poptává: ' + inquiry.polozka + '. ' + inquiry.poznamka,
  missingInformation: { customer: missing ? [question] : [], owner: [] },
  subject: missing ? 'Upřesnění poptávky' : 'Přijetí podkladů k poptávce',
  body: 'Dobrý den,\\n\\nděkujeme za poptávku: ' + inquiry.polozka + '.\\n' + text + '\\n\\nS pozdravem\\nALFA nábytek',
};
return { json: { statusCode: 200, body: {
  id: 'resp_mock', status: 'completed', model: 'gpt-5-mini',
  usage: { input_tokens: 0, output_tokens: 0 },
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
} } };`, [1200, 240], "Pevná šablona reagující na vstup. Model se nevolá; lze upravit rozměry a porovnat výsledek.");
const draft = reuse("Připravit Gmail koncept", "Připravit Gmail koncept", {
  "20 - Předat úlohy po ověření účtu": draftTask,
}, [1200, 580]);
const saveDraft = code("Uložit koncept · mock Gmail", `
if ($json.action !== 'create') throw Error('Návrh neprošel skutečnou validací. Zkontrolujte výstup předchozího uzlu.');
return { json: { ...$json, draftId: 'koncept-mock', stav: 'Koncept připraven',
  upozorneni: 'Simulované upozornění majiteli: koncept čeká na ruční kontrolu.' } };`, [960, 580]);
const send = add("Simulovat ruční odeslání?", "if", 2.2, {
  conditions: { options: { caseSensitive: true, typeValidation: "strict", version: 2 },
    conditions: [{ id: id("send-if"), leftValue: "={{ String($('Upravit zadání').item.json.scenar !== 'chybi_rozmery') }}",
      rightValue: "true", operator: { type: "string", operation: "equals" } }], combinator: "and" }, options: {},
}, [720, 580], "Scénář chybi_rozmery končí připraveným konceptem. Zbylé dva simulují i ruční odeslání majitelem.");
const sentTask = code("Připravit ověření odeslání", `
const inquiry = $('Přijmout poptávku · mock Sheets').item.json;
return { json: { id: inquiry.id, to: inquiry.email, account: 'majitel@portfolio.test',
  since: inquiry.receivedAt, mode: 'search', step: 'Odeslaná odpověď', providerId: 'zprava-mock' } };`, [720, 920]);
const sent = code("Načíst odeslanou zprávu · mock Gmail", `
const inquiry = $('Přijmout poptávku · mock Sheets').item.json;
const draft = $('Připravit Gmail koncept').item.json;
return { json: { statusCode: 200, body: { id: 'zprava-mock', labelIds: ['SENT'],
  internalDate: String(Date.parse(inquiry.receivedAt) + 1000), payload: { headers: [
    { name: 'To', value: inquiry.scenar === 'chybny_adresat' ? 'jiny@portfolio.test' : inquiry.email },
    { name: 'Subject', value: draft.subject },
  ] } } } };`, [960, 920], "Změní pouze simulovaná data; neexistuje zde žádný uzel pro odeslání skutečného e-mailu.");
const verify = reuse("Ověřit adresáta, referenci a složku", "Ověřit odeslanou zprávu", {
  "20 - Předat úlohy po ověření účtu": sentTask,
  "38 - Je co ověřit v Gmailu": sentTask,
}, [1200, 920]);
const finish = code("Výsledek ukázky", `
const inquiry = $('Přijmout poptávku · mock Sheets').item.json;
const draft = $('Připravit Gmail koncept').item.json;
const acknowledgement = $('Potvrdit přijetí · mock Gmail').item.json.potvrzeni;
const event = $json.event;
const state = !event ? 'Koncept připraven' : event.outcome === 'Ověřeno' ? 'Odpověď odeslána' : 'Ruční kontrola';
const expected = { chybi_rozmery: 'Koncept připraven', spravna_odpoved: 'Odpověď odeslána', chybny_adresat: 'Ruční kontrola' };
if (state !== expected[inquiry.scenar]) throw Error('Výsledek neodpovídá zvolenému scénáři.');
return { json: {
  scenar: inquiry.scenar, stav: state, vysledek: 'Scénář prošel',
  poptavka: { id: inquiry.id, jmeno: inquiry.jmeno, email: inquiry.email, polozka: inquiry.polozka, rozmery: inquiry.rozmery, poznamka: inquiry.poznamka },
  potvrzeni: acknowledgement,
  koncept: { komu: draft.to, predmet: draft.subject, text: draft.body },
  evidence: { id: inquiry.id, stav: state, overeni: event?.outcome ?? 'Čeká na ruční odeslání',
    poznamka: event?.note ?? 'Koncept je připraven ke kontrole majitelem.' },
  skutecneOperace: 'Žádné. Google Sheets, Gmail i AI jsou simulované. Toto je ukázka vybraných kontrol, nikoli celý živý provoz.',
} };`, [240, 580], "Zde otevřete OUTPUT → JSON. Najdete stav, potvrzení, text konceptu a výsledek ověření.");

const chain = [start, input, receive, acknowledgement, draftTask, ai, draft, saveDraft, send];
for (let i = 1; i < chain.length; i++) edge(chain[i - 1], chain[i]);
edge(send, sentTask); edge(send, finish, 1);
edge(sentTask, sent); edge(sent, verify); edge(verify, finish);
const note = (name, content, position, width, height, color) => add(name, "stickyNote", 1,
  { content, width, height, color }, position);
note("Začněte zde", "# ALFA nábytek · vyzkoušejte automatizaci\n\n1. V uzlu **Upravit zadání** změňte `scenar` nebo údaje.\n2. Klikněte **Execute workflow**.\n3. Otevřete **Výsledek ukázky → OUTPUT → JSON**.\n\n**Bez připojených účtů a bez sítě.** Veškeré údaje a služby jsou fiktivní. Každý běh začíná od začátku.", [-40, -180], 1500, 300, 5);
note("Scénáře", "## Vyberte scenar\n\n`chybi_rozmery` → Koncept připraven\n\n`spravna_odpoved` → Odpověď odeslána\n\n`chybny_adresat` → Ruční kontrola\n\nVyplňte `rozmery` a sledujte změnu připravené odpovědi. Pole `poznamka` je v rekapitulaci; mock AI ji jazykově nevyhodnocuje.", [-40, 820], 650, 330, 4);
note("Skutečné kontroly", "## Co se skutečně vykonává\n\n**Připravit Gmail koncept** a **Ověřit odeslanou zprávu** obsahují kód z anonymizovaného `workflow.json`.\n\nVnější služby nahrazují uzly s označením **mock**. Není zde živý zápis do tabulky, volání AI ani odeslání e-mailu. Ruční odeslání majitelem je ve dvou scénářích simulované.", [1500, 200], 520, 640, 7);

const workflow = { name: "ALFA nábytek · demo s mock daty", nodes, connections,
  active: false, pinData: {}, settings: { executionOrder: "v1", timezone: "Europe/Prague",
    saveDataSuccessExecution: "none", saveDataErrorExecution: "none", saveManualExecutions: false } };
writeFileSync(new URL("./demo-workflow.json", import.meta.url), JSON.stringify(workflow, null, 2) + "\n");
console.log(`Připraveno ${nodes.length} uzlů bez credentials a externích služeb.`);
