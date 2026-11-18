# ALFA nábytek · automatizace poptávek v n8n

Zákazník odešle poptávku z webového košíku. Automatizace ji uloží do Google Sheets, potvrdí přijetí a připraví koncept odpovědi v Gmailu. Majitel koncept zkontroluje, případně upraví a sám odešle. n8n ověří odeslanou zprávu a aktualizuje stav poptávky v evidenci.

![Plátno n8n se třemi částmi workflow od příjmu z webu po ověření odeslání](n8n-workflow.png)

## Co jsem řešil

- **Příjem z webu.** Web dostane potvrzení po ověřeném zápisu do Google Sheets. Opakovaný požadavek se stejným ID vrátí původní potvrzení.
- **Návrh odpovědi.** Pokud v poptávce chybí podklady, AI navrhne doplňující otázku. Majitel dostane odkaz na koncept v Gmailu.
- **Rozdělení úloh.** Jeden uzel Switch směruje nový pokus, dohledání v Gmailu nebo zápis výsledku. Plánovač ověřuje Gmail účet až tehdy, když má úlohu ke zpracování. Vestavěné Gmail uzly zakládají koncepty a odesílají systémové zprávy.
- **Opakování a výpadky.** Workflow nejdřív rezervuje pokus v evidenci. Po nejasném výsledku dohledává existující zprávu nebo koncept. Nejednoznačný výsledek předá k ruční kontrole.
- **Ověření odeslání.** Stav „Odpověď odeslána“ vznikne po ověření adresáta, reference poptávky a složky Odeslané.

**Technologie** · n8n, Next.js, TypeScript, Google Sheets, Gmail, OpenAI.
