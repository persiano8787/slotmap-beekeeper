# Slot map — versione staff

App per trovare le slot machine in sala. Si apre dallo shortcut Beekeeper:
**https://persiano8787.github.io/slotmap-beekeeper/**

Sul telefono conviene installarla: da Android `⋮` → *Installa app*; da iPhone
Condividi → *Aggiungi a schermata Home*. Installata funziona anche senza rete.

## Questo repo contiene dati reali

`casino_map.sqlite` ha dentro la planimetria e i dati delle slot. È voluto: senza
quel file l'app non ha niente da mostrare. Il repo gemello `slot-map-viewer`
invece è la sola app senza dati, e va tenuto così.

## Aggiornare i dati

Sostituire `casino_map.sqlite` e pushare. Nient'altro. I telefoni si allineano da
soli alla prima apertura con rete, confrontando l'impronta del file; i dati nuovi
compaiono subito se si tocca la fascetta «Dati aggiornati», altrimenti alla
riapertura dopo. **GitHub tiene i file in cache 10 minuti:** dopo il push, dieci
minuti prima di dire in giro che è online.

Dal progetto SLOT_MAP, il modo con i controlli:

    node tools/publish.mjs
    cd ~/workspace/projects/slotmap-beekeeper
    git add -A && git commit -m "dati aggiornati"
    git tag v<data> && git push && git push --tags

`publish.mjs` compatta il database e si ferma se dentro non ci sono né mappa né
slot. Caricando il file a mano dalla pagina di GitHub quel controllo non c'è.

## Versioni

Ogni pubblicazione è un commit con etichetta `v<data>`. Per tornare indietro:
`git checkout v2026-09-09`. Online c'è sempre e solo l'ultima.
