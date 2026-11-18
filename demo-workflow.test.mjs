import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const workflow = JSON.parse(readFileSync(new URL("./demo-workflow.json", import.meta.url), "utf8"));
const original = JSON.parse(readFileSync(new URL("./workflow.json", import.meta.url), "utf8"));

function execute(edits = {}, mutate = () => {}) {
  const graph = structuredClone(workflow);
  mutate(graph);
  const outputs = new Map();
  const visited = [];
  const run = (name, input = {}) => {
    const node = graph.nodes.find(n => n.name === name);
    assert.ok(node, `Chybí uzel ${name}`);
    visited.push(name);
    const context = {
      Buffer, $json: input,
      $: prior => ({ item: { json: outputs.get(prior) } }),
    };
    const evaluate = source => runInNewContext(source, context, { timeout: 1000 });
    let output = input;
    let branch = 0;
    if (node.type.endsWith('.set')) {
      output = { ...Object.fromEntries(node.parameters.assignments.assignments.map(a => [a.name, a.value])), ...edits };
    } else if (node.type.endsWith('.code')) {
      output = evaluate(`(function(){\n${node.parameters.jsCode}\n})()`).json;
    } else if (node.type.endsWith('.if')) {
      const condition = node.parameters.conditions.conditions[0];
      const value = evaluate(condition.leftValue.slice(3, -2));
      branch = value === condition.rightValue ? 0 : 1;
    } else assert.equal(node.type, 'n8n-nodes-base.manualTrigger');
    outputs.set(name, output);
    const edges = graph.connections[name]?.main[branch] ?? [];
    for (const edge of edges) run(edge.node, output);
  };
  run('Spustit ukázku');
  return { result: outputs.get('Výsledek ukázky'), outputs, visited };
}

test('Výchozí běh připraví skutečně validovaný koncept s otázkou na rozměry', () => {
  const { result, visited } = execute();
  assert.equal(result.stav, 'Koncept připraven');
  assert.equal(result.vysledek, 'Scénář prošel');
  assert.match(result.koncept.text, /Jaké rozměry/);
  assert.equal(result.evidence.overeni, 'Čeká na ruční odeslání');
  assert.ok(!visited.includes('Načíst odeslanou zprávu · mock Gmail'));
});

test('Doplnění rozměrů změní návrh, upravené údaje projdou až do výsledku', () => {
  const { result } = execute({ rozmery: '160 × 80 cm', jmeno: 'Petr Novák', email: 'petr@firma.test', polozka: 'Pracovní stůl' });
  assert.equal(result.poptavka.jmeno, 'Petr Novák');
  assert.equal(result.koncept.komu, 'petr@firma.test');
  assert.match(result.koncept.text, /160 × 80 cm/);
  assert.match(result.koncept.text, /Pracovní stůl/);
  assert.doesNotMatch(result.koncept.text, /Jaké rozměry/);
});

test('Správně odeslaná simulovaná odpověď je ověřená skutečným kódem', () => {
  const { result } = execute({ scenar: 'spravna_odpoved' });
  assert.equal(result.stav, 'Odpověď odeslána');
  assert.equal(result.evidence.overeni, 'Ověřeno');
});

test('Nesprávný adresát končí ruční kontrolou', () => {
  const { result } = execute({ scenar: 'chybny_adresat' });
  assert.equal(result.stav, 'Ruční kontrola');
  assert.equal(result.evidence.overeni, 'Ruční kontrola');
  assert.match(result.evidence.poznamka, /Gmail neprokázal/);
});

for (const [name, edits, message] of [
  ['Neznámý scénář', { scenar: 'unknown' }, /Pole scenar/],
  ['Skutečná adresa', { email: 'someone@example.com' }, /fiktivní adresu/],
  ['Hlavičková injekce', { email: 'user@firma.test\r\nBcc: other@firma.test' }, /fiktivní adresu/],
  ['Prázdná položka', { polozka: '  ' }, /Vyplňte/],
]) test(name + ' se odmítne před přípravou konceptu', () => assert.throws(() => execute(edits), message));

test('Chybná reference nesmí projít jako správně odeslaná zpráva', () => {
  assert.throws(() => execute({ scenar: 'spravna_odpoved' }, graph => {
    const node = graph.nodes.find(n => n.name === 'Načíst odeslanou zprávu · mock Gmail');
    node.parameters.jsCode = node.parameters.jsCode.replace("value: draft.subject", "value: '[ALFA-ODPOVED DEMO-JINA] Cizí odpověď'");
  }), /Výsledek neodpovídá/);
});

test('Koncept bez štítku SENT nesmí potvrdit odeslání', () => {
  assert.throws(() => execute({ scenar: 'spravna_odpoved' }, graph => {
    const node = graph.nodes.find(n => n.name === 'Načíst odeslanou zprávu · mock Gmail');
    node.parameters.jsCode = node.parameters.jsCode.replace("labelIds: ['SENT']", "labelIds: ['DRAFT']");
  }), /Výsledek neodpovídá/);
});

test('Sdílený export obsahuje pouze ruční vstup, data a logiku bez připojení', () => {
  const allowed = new Set(['manualTrigger', 'set', 'code', 'if', 'stickyNote'].map(n => 'n8n-nodes-base.' + n));
  for (const node of workflow.nodes) {
    assert.ok(allowed.has(node.type), node.type);
    assert.equal(node.credentials, undefined);
    assert.equal(node.webhookId, undefined);
    if (node.type.endsWith('.code')) assert.doesNotMatch(node.parameters.jsCode, /\b(fetch|require|process|globalThis|eval)\s*[.(]/);
  }
  assert.equal(workflow.active, false);
  assert.equal(workflow.id, undefined);
  assert.equal(workflow.nodes.filter(n => n.type.endsWith('.manualTrigger')).length, 1);
  const names = new Set(workflow.nodes.map(n => n.name));
  assert.equal(names.size, workflow.nodes.length);
  for (const [from, { main }] of Object.entries(workflow.connections)) {
    assert.ok(names.has(from));
    for (const edge of main.flat()) assert.ok(names.has(edge.node));
  }
});

test('Dvě skutečné kontroly se od původního exportu liší pouze odkazy na uzly', () => {
  for (const [sourceLabel, demoLabel] of [
    ['Připravit Gmail koncept', 'Připravit Gmail koncept'],
    ['Ověřit adresáta, referenci a složku', 'Ověřit odeslanou zprávu'],
  ]) {
    const source = original.nodes.find(n => n.name.replace(/^\d+ - /, '') === sourceLabel);
    const actual = workflow.nodes.find(n => n.name === demoLabel);
    const normalize = code => code.replace(/\$\('[^']+'\)/g, '$NODE');
    assert.equal(normalize(actual.parameters.jsCode), normalize(source.parameters.jsCode));
  }
});
