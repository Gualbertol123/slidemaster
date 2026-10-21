/* Italian search words for the icon picker (S15.2, 09 §9 Q11: the owner's decision of 2026-10-21). Maintained by us, not
   by Tabler: about 300 common words chosen for a bank's planning slides and general use, each with the English it stands
   for in the vendored set (core/src/icons/data.ts). One line per entry: the Italian word and its forms ("/"-separated:
   singular, plural, a synonym; a phrase may have spaces), a colon, then the targets, best first. A target is a Tabler
   icon name (it ranks that icon first, in this order) or an English word that is a whole word of icon names or a tag.
   Accents are written as in Italian; the search folds them, so "citta" finds "città" (core/tests/icons-it.test.ts
   checks that every target exists in the set, that no word is listed twice and the count).
   Adding a word: add or extend a line here, run that test; nothing else to build. On a Tabler update, the same test
   names any target the new release renamed or dropped. */
export const IT_WORDS = `
banca: building-bank bank vault
conto/conto corrente: building-bank wallet report-money
prestito/finanziamento: cash-banknote moneybag cash
mutuo: home-dollar mortgage
deposito: pig-money deposit cash-banknote-plus
prelievo: cash-banknote-minus cash-banknote
risparmio/salvadanaio: pig-money savings coins
investimento: chart-line trending-up chart-candle coins
crescita: trending-up growth chart-line
calo/perdita: trending-down chart-line
aumento/incremento: trending-up increase arrow-up
diminuzione/riduzione: trending-down decrease arrow-down
obiettivo: target target-arrow goal
traguardo: flag-check flag goal
budget: moneybag budget calculator
previsione/stima: chart-arrows chart-line trending-up
grafico/grafici: chart-bar chart-line chart-pie chart-area graph chart
torta: chart-pie chart-donut pie
ciambella: chart-donut
barre/istogramma: chart-bar chart-histogram
linea: chart-line line
area: chart-area
dispersione: chart-dots chart-scatter
imbuto: chart-funnel filter
tabella: table table-column
cruscotto: dashboard gauge
indicatore/kpi: gauge dashboard chart-bar
freccia/frecce: arrow
su/sopra/alto/in alto: up
giù/sotto/basso/in basso: down
destra/a destra: right
sinistra/a sinistra: left
avanti: arrow-right player-track-next forward
indietro: arrow-left arrow-back-up back
avviso: alert-triangle warning bell
attenzione: alert-triangle alert-circle warning
errore: alert-circle x error
pericolo/rischio: alert-triangle alert-octagon risk danger
ok: check circle-check thumb-up
spunta/fatto: check circle-check square-check
sì: check thumb-up
no: x ban thumb-down
annulla: x trash
stella/preferito: star bookmark
persona/persone: user users
cliente/clienti: user-dollar user users customer
utente: user users user-circle
squadra/team/gruppo: users-group users team
dipendente: user-check id-badge users
ufficio: building briefcase office
edificio: building building-skyscraper
azienda/società: building-factory building briefcase company
fabbrica: building-factory
negozio/filiale/sportello: building-store building-bank store
magazzino: building-warehouse package
casa/immobile/immobili: home home-2 house
auto: car
camion: truck truck-delivery
aereo/viaggio: plane
treno: train
nave: ship anchor
bicicletta: bike
mappa: map map-2
luogo/sede: map-pin location
strada/percorso: road route
bussola: compass
paese: flag world country
mondo/globale: world globe
città: building-community buildings city
euro: currency-euro coin-euro euro
dollaro: currency-dollar
denaro/soldi/contanti/banconota: cash-banknote cash money
moneta/monete: coin coins
carta/carta di credito/bancomat: credit-card
portafoglio: wallet
pagamento: credit-card-pay cash payment
ricevuta: receipt
fattura: file-invoice invoice
tassa/tasse: receipt-tax tax-euro tax
sconto: discount
prezzo/costo: tag price cost
interesse/interessi/tasso: percentage circle-percentage interest
calcolatrice: calculator
cassaforte: lock-square vault
profitto/utile/ricavi/fatturato: report-money trending-up cash profit
borsa/mercato: chart-candle trending-up-down market
calendario/agenda: calendar calendar-event
orologio/ora: clock clock-hour-3
tempo/durata: clock hourglass time
scadenza: calendar-due alarm hourglass
giorno/oggi: calendar-event sun
settimana: calendar-week
mese: calendar-month
anno/trimestre: calendar calendar-stats
cronologia: history timeline
sveglia: alarm bell
documento: file-text file document
file: file files
cartella: folder folders
archivio: archive folder
foglio di calcolo: file-spreadsheet table
pdf: file-type-pdf
contratto: contract license writing-sign
firma: signature writing-sign
appunti/nota: note notes clipboard
elenco: list list-check list-numbers
lista di controllo/checklist: checklist list-check clipboard-check
libro: book books
email: mail mail-opened
messaggio/chat: message messages message-circle
telefono: phone phone-call
cellulare: device-mobile
computer: device-desktop device-laptop
stampante: printer
ricerca/cerca: search zoom
lente: zoom search zoom-in
impostazioni: settings adjustments
ingranaggio: settings cog
strumento: tool tools
martello: hammer
lucchetto: lock
aperto: lock-open
chiave/password: key password
sicurezza/protezione: shield-check shield-lock shield security
scudo: shield
impronta: fingerprint
idea/innovazione: bulb idea sparkles
lampadina: bulb
cervello: brain
foglia: leaf
albero: tree trees leaf
pianta: plant seedling
ambiente/sostenibilità/esg: leaf recycle world plant
riciclo: recycle
energia: bolt energy plug
batteria: battery battery-charging
sole: sun
luna: moon
pioggia: cloud-rain cloud sun
acqua: droplet
fuoco: flame
premio: award trophy medal prize
coppa/trofeo: trophy
medaglia: medal
diamante: diamond
bilancia: scale
legge/giustizia: gavel scale law
mano: hand-stop hand-finger hand-click hand
stretta di mano/accordo: heart-handshake handshake contract agreement
pollice in su/mi piace: thumb-up
pollice in giù: thumb-down
cuore: heart
regalo: gift
razzo: rocket
puzzle: puzzle
rete/connessione: network affiliate wifi
collegamento/link: link external-link
catena: link
gerarchia/organigramma: hierarchy sitemap hierarchy-2
processo: arrows-split git-branch route
nuvola: cloud
download: download cloud-download
caricamento: upload cloud-upload
aggiorna/aggiornamento: refresh reload rotate
ripeti: repeat refresh
scambio/bonifico: arrows-exchange transfer arrows-left-right
filtro: filter
ordina: arrows-sort sort-ascending sort-descending
più/aggiungi/somma: plus circle-plus math
meno: minus circle-minus
uguale: equal
percentuale: percentage percent
punto interrogativo/domanda: question-mark help-circle help question
punto esclamativo: exclamation-mark exclamation-circle
info/informazioni: info-circle info-square info
aiuto/supporto: help-circle lifebuoy headset help
ombrello/assicurazione: umbrella shield-check
salute: heartbeat building-hospital first-aid-kit
medico: stethoscope pill first-aid-kit
scuola/formazione: school certificate book
certificato: certificate file-certificate
valigetta/lavoro: briefcase briefcase-2 business
piano/pianificazione/strategia: businessplan presentation-analytics chess target
presentazione/riunione: presentation presentation-analytics
rapporto/report: report report-analytics file-analytics
analisi/dati: report-analytics chart-dots chart-histogram database
database: database server
codice: code
robot/automazione: robot settings-automation brain
ingrandisci/zoom: zoom-in maximize
riduci: zoom-out minimize
occhio: eye
nascosto: eye-off
campanella/notifica: bell bell-ringing notification
megafono: speakerphone ad
notizie: news
modifica: pencil edit
cestino/elimina: trash
copia: copy
incolla: clipboard
condividi: share share-2
invia: send
posta in arrivo: inbox
segnalibro: bookmark
graffetta/allegato: paperclip
foto: photo
fotocamera: camera
pacco/consegna: package truck-delivery box
carrello/acquisti: shopping-cart basket shopping-bag
etichetta: tag tags
porta: door door-enter
uscita: door-exit logout
accesso: login lock-access
spegni: power
cerchio: circle
quadrato: square
triangolo: triangle
punto: point dots
griglia: layout-grid grid-dots
livelli: stack-2 stack
matematica: math-function calculator sigma
media: math-avg
massimo: math-max
minimo: math-min
numero: number hash numbers
lingua: language
scrittura: writing typography text
colore: palette color
righello: ruler ruler-measure
forbici: scissors cut
sorriso: mood-smile mood-happy
triste: mood-sad
famiglia: friends baby-carriage family
bambino: baby-carriage baby-bottle
uomo: man
donna: woman
caffè: coffee cup
cibo: tools-kitchen-2 chef-hat
festa: confetti balloon cake
biglietto: ticket
scala: stairs-up stairs ladder
podio/classifica: podium chart-bar-popular
cronometro: stopwatch gauge speed
tachimetro: gauge dashboard
attività: activity heartbeat
`;
