import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const workflow = JSON.parse(readFileSync(new URL("./workflow.json", import.meta.url), "utf8"));

function findNode(label) {
  const node = workflow.nodes.find(node => node.name.replace(/^\d+ - /, "") === label);
  assert.ok(node, `V exportu chybí uzel ${label}`);
  return node;
}

function evaluate(source, input, priorNodes = {}) {
  return runInNewContext(source, {
    Buffer,
    $json: input,
    $: name => ({ item: { json: priorNodes[name.replace(/^\d+ - /, "")] } }),
  }, { timeout: 1000 });
}

// Run exported Code nodes with local fixtures in place of provider responses.
function runNode(label, input, priorNodes = {}) {
  const node = findNode(label);
  assert.equal(node.type, "n8n-nodes-base.code");
  return evaluate(`(function () {\n${node.parameters.jsCode}\n})()`, input, priorNodes).json;
}

function expression(value, input) {
  assert.match(value, /^=\{\{.*\}\}$/);
  return evaluate(value.slice(3, -2).trim(), input);
}

const id = "DEMO-11111111-1111-4111-8111-111111111111";
const customer = "zakaznik@portfolio.test";
const owner = "majitel@portfolio.test";
const since = "2026-01-12T09:00:00.000Z";
const task = { id, to: customer, account: owner, since };
const draftTask = { ...task, mode: "claim", step: "Koncept" };
const sentTask = { ...task, mode: "search", step: "Odeslaná odpověď" };
const question = "Jaké rozměry má mít jednací stůl?";
const subject = "Upřesnění poptávky";
const ok = body => ({ statusCode: 200, body });
const aiResponse = ok({
  id: "resp_demo", status: "completed", model: "gpt-5-mini",
  usage: { input_tokens: 100, output_tokens: 100 },
  output: [{ type: "message", content: [{
    type: "output_text",
    text: JSON.stringify({
      status: "needs_clarification",
      summary: "Zákazník poptává jednací stůl pro čtyři osoby. Chybí rozměry.",
      missingInformation: { customer: [question], owner: [] },
      subject,
      body: `Dobrý den,\n\n${question}\n\nS pozdravem\nALFA nábytek`,
    }),
  }] }],
});

const reservation = findNode("Pokus je uložený").parameters.conditions.conditions[0];
assert.equal(expression(reservation.leftValue, ok({ replies: [{}, {}] })), reservation.rightValue);
assert.notEqual(expression(reservation.leftValue, { statusCode: 400 }), reservation.rightValue);
assert.notEqual(expression(reservation.leftValue, ok({ replies: [{}] })), reservation.rightValue);

const routes = findNode("Rozdělit úlohy podle režimu").parameters.rules.values;
assert.deepEqual(routes.map(rule => rule.conditions.conditions[0].rightValue), ["claim", "search", "save"]);
const taskNode = "Předat úlohy po ověření účtu";
const draft = runNode("Připravit Gmail koncept", aiResponse, { [taskNode]: draftTask });
assert.equal(draft.action, "create");
const gmail = findNode("Založit koncept");
assert.equal(gmail.type, "n8n-nodes-base.gmail");
assert.equal(gmail.parameters.resource, "draft");
assert.equal(gmail.parameters.operation, "create");
assert.equal(expression(gmail.parameters.options.sendTo, draft), customer);
assert.equal(expression(gmail.parameters.subject, draft), `[ALFA-ODPOVED ${id}] ${subject}`);
const body = expression(gmail.parameters.message, draft);
assert.ok(body.includes(question));

const draftLookup = runNode("Převzít ID z Gmailu", { id: "koncept-demo" }, { [taskNode]: draftTask });
assert.equal(draftLookup.providerId, "koncept-demo");
const ambiguous = runNode("Převzít ID z Gmailu", { error: "Timeout" }, { [taskNode]: draftTask });
assert.equal(ambiguous.url, undefined);
const recovery = runNode("Vyhledat podle reference", {}, { [taskNode]: { ...draftTask, mode: "search" } });
assert.equal(new URL(recovery.url).searchParams.get("labelIds"), "DRAFT");

function verifyMessage(label, recipient = customer, reference = id) {
  return runNode("Ověřit adresáta, referenci a složku", ok({
    id: "zprava-demo",
    labelIds: [label],
    internalDate: String(Date.parse(since) + 60_000),
    payload: { headers: [
      { name: "To", value: recipient },
      { name: "Subject", value: `[ALFA-ODPOVED ${reference}] ${subject}` },
    ] },
  }), {
    [taskNode]: sentTask,
    "Je co ověřit v Gmailu": { providerId: "zprava-demo" },
  }).event;
}

const draftOnly = verifyMessage("DRAFT");
const wrongRecipient = verifyMessage("SENT", "jiny@portfolio.test");
const wrongReference = verifyMessage("SENT", "zakaznik@portfolio.test", "DEMO-JINA-POPTAVKA");
const verified = verifyMessage("SENT");
assert.equal(draftOnly.outcome, "Ruční kontrola");
assert.equal(wrongRecipient.outcome, "Ruční kontrola");
assert.equal(wrongReference.outcome, "Ruční kontrola");
assert.equal(verified.outcome, "Ověřeno");
assert.equal(verified.id, id);

console.log("Fiktivní poptávka: jednací stůl pro čtyři osoby, bez rozměrů.\n");
console.log(`Návrh konceptu\n\n${body}\n`);
console.log("Druhý pokus po odmítnutí rezervace: zpracování nepokračuje.");
console.log("Po timeoutu lze dohledat koncept podle reference ve složce Koncepty.");
console.log(`Zpráva mezi koncepty: ${draftOnly.outcome}.`);
console.log(`Odeslaná zpráva s jiným adresátem nebo referencí: ${wrongRecipient.outcome}.`);
console.log(`Odeslaná zpráva se správnou referencí a adresátem: ${verified.outcome}.`);
