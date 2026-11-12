import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const workflow = JSON.parse(readFileSync(new URL("./workflow.json", import.meta.url), "utf8"));

// Run the exported n8n Code nodes with local fixtures in place of provider responses.
function runNode(name, input, priorNodes = {}) {
  const node = workflow.nodes.find(node => node.name === name && node.type === "n8n-nodes-base.code");
  assert.ok(node, `V exportu chybí uzel ${name}`);
  return runInNewContext(`(function () {\n${node.parameters.jsCode}\n})()`, {
    Buffer,
    $json: input,
    $: name => ({ item: { json: priorNodes[name] } }),
  }, { filename: name, timeout: 1000 }).json;
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

assert.equal(runNode("Potvrdit převzetí", ok({ replies: [{}, {}] })).committed, true);
assert.equal(runNode("Potvrdit převzetí", { statusCode: 400 }).committed, false);
const draft = runNode("Připravit Gmail koncept", aiResponse, { "Vybrat další kroky": draftTask });
assert.equal(draft.action, "create");
const mime = Buffer.from(draft.body.message.raw, "base64url").toString("utf8");
assert.ok(mime.includes(`To: ${customer}`));
const [, encodedBody] = mime.split("\r\n\r\n");
const body = Buffer.from(encodedBody, "base64").toString("utf8");
assert.ok(body.includes(question));

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
    "Vybrat další kroky": sentTask,
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
console.log(`Zpráva mezi koncepty: ${draftOnly.outcome}.`);
console.log(`Odeslaná zpráva s jiným adresátem nebo referencí: ${wrongRecipient.outcome}.`);
console.log(`Odeslaná zpráva se správnou referencí a adresátem: ${verified.outcome}.`);
