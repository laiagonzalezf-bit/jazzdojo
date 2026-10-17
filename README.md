<p align="center"><img src="public/icons/logo.svg" alt="JazzDojo" width="460"></p>

JazzDojo és una web app per entrenar arpegis de jazz sobre progressions d'acords. Substitueix la pràctica habitual
amb iReal Pro: la secció rítmica sona, però a la pantalla no surten els acords. Només hi surten **xifres de graus**
(per exemple `5 3 9 7 1`) que has de tocar sobre l'acord que sona.

Funciona a l'iPhone, a l'iPad i al Mac des del navegador, i es pot instal·lar com una app que funciona sense connexió.

## Com s'utilitza

- **Pantalla de pràctica:**
  - Hi ha dues files d'arpegis de la mateixa mida. La que estàs tocant té el primer número en vermell; l'altra mostra
    el següent arpegi, tot en blanc.
  - Quan canvia l'arpegi, el següent no puja de lloc: es queda on era i el seu primer número es posa vermell. Llavors
    l'altra fila passa a mostrar el que vindrà després.
  - Els punts marquen els temps que queden fins al canvi; en mode segons és una barra.
  - Pots triar quan apareix el següent arpegi: tot seguit, uns temps abans del canvi (menys temps per pensar) o mai.
  - Si fas servir els teus patrons en ordre i en tens 4 o menys, es veuen tots alhora com a files fixes, i el vermell
    va passant d'una fila a l'altra.
- **Mostra l'acord** (tecla `A`): ensenya l'acord actual i els dos següents, les notes reals de l'arpegi, i la
  posició (acord, compàs i volta). La música no s'atura en cap moment.
- **Arpegis:**
  - Pots fer-los aleatoris, triant quins graus surten (1–13) i quantes notes té cada arpegi, o fer servir els teus
    propis conjunts de patrons, amb nom, en ordre o barrejats.
  - Opcions extra: limitar-los als graus escrits a l'acord, i triar si l'11 dels acords majors i dominants és ♯11 o
    natural.
- **Quan canvia l'arpegi:**
  - Pot canviar a cada acord, cada N temps, cada N compassos o cada N segons.
  - Opcionalment, també quan canvia l'acord. Quan l'acord canvia però l'arpegi no, surt l'avís «Canvi d'acord».
- **Bucle:**
  - Pots no fer bucle, repetir-ho tot o repetir un tram.
  - A cada volta, tries si surten arpegis nous o els mateixos.
- **Graella d'acords (Estructura):**
  - Toca un acord per triar-lo i prem el ▶ que hi apareix, o fes-hi doble toc: sona des d'allà, amb compte d'entrada.
  - Mantén premut i arrossega sobre uns quants acords: aquell tram queda en bucle. Amb el ratolí, n'hi ha prou
    d'arrossegar.
  - Doble toc a qualsevol acord per sortir del bucle (també s'atura la música).
- **Altres controls:**
  - Restart (`R`), play/pausa (espai), stop (`Esc`) i tempo (fletxes).
- **So:**
  - Estil: swing, bossa, pop/8es o balada.
  - Harmonia: piano, Rhodes o guitarra.
  - Mesclador de baix, bateria, harmonia i volum general.
- **Compàs:** es tria a la barra inferior, al costat del tempo (2/4 … 7/4, 6/8, 9/8, 12/8). Cada acord manté els
  compassos que durava.
- **Exercicis:**
  - Pots importar d'iReal Pro, escriure acords a mà o generar cicles amb els tipus d'acord en l'ordre que vulguis.
  - Els cicles poden anar per qualsevol interval: quartes, quintes, cromàtic, tons, terceres menors o majors (pujant
    o baixant) i trítons. Si un interval no passa per les dotze notes, el cicle continua des d'un semitò més enllà.
  - Cada exercici té nom, tonalitat, objectius i una dificultat per colors de cinturó. Es poden editar, duplicar,
    esborrar, cercar i filtrar.

### Importar d'iReal Pro

1. A iReal Pro: Comparteix → Exporta → **HTML** (o copia l'enllaç `irealb://`).
2. A JazzDojo: Exercicis → tria el fitxer o enganxa l'enllaç.

S'interpreten els acords, el compàs, les repeticions, les caselles de 1a i 2a, la repetició de compàs (`x`, `r`)
i l'estil. Els acords que no s'entenen es llisten i sonen com a silenci. L'àudio d'iReal Pro no es pot fer servir:
l'acompanyament el genera JazzDojo.

### Instal·lar-la

- **iPhone o iPad:** obre l'adreça de GitHub Pages amb Safari i fes Comparteix → «Afegeix a la pantalla d'inici».
- **Mac:** a Safari, fes Fitxer → «Afegeix al Dock».

Després de la primera visita funciona sense connexió.

## Arquitectura

| Mòdul | Què fa |
|---|---|
| `src/theory.js` | Llegeix els símbols d'acord (text i notació iReal), calcula els intervals de cada grau, els graus escrits a l'acord i la família de l'acord. |
| `src/ireal.js` | Importa d'iReal Pro (desofuscació, repeticions, caselles i compàs) i d'acords escrits a mà. També genera cicles. Format intermedi propi: `{label, bars}`. |
| `src/arps.js` | Motor de patrons: aleatoris sense repeticions seguides, llistes pròpies, filtre de graus escrits. Desa els arpegis per posició (*slot*). |
| `src/sequencer.js` | Rellotge musical: decideix l'acord, el temps i el compàs de cada moment, quan comença un arpegi nou (per acord, temps, compassos o segons), els bucles i els salts. |
| `src/groove.js` | Acompanyament: baix walking amb notes d'aproximació, voicings sense fonamental enllaçats, patrons de comping i bateria humanitzada, per a cada estil i compàs. |
| `src/audio.js` | Web Audio: mostres d'àudio (amb so sintetitzat de reserva mentre carreguen), busos, mesclador i reverberació. |
| `src/app.js` | Estat, desament local, planificador i interfície. |

El planificador avança temps a temps uns 150 ms per davant del rellotge d'àudio. La interfície només aplica
canvis quan aquell rellotge arriba al moment programat, i per això la pantalla no es desfasa de la música.

## Desenvolupament

```bash
npm install        # esbuild
npm test           # proves (node:test): acords, iReal, arpegis, seqüenciador, acompanyament
npm run build      # genera docs/ (GitHub Pages) i artifact/ (versió per a Claude)
npm run dev        # build + servidor local a http://localhost:8080
```

Per regenerar les mostres cal fer clons parcials dels repositoris originals, i després:

```bash
python3 tools/samples.py   # variables SF i VD: on són les fonts
python3 tools/logo.py <Saira-Black.ttf> <Saira-SemiBold.ttf> public/icons
```

## Limitacions conegudes

- **Durada dels acords d'iReal:** quan en un compàs hi ha diversos acords, la durada es reparteix pel nombre
  d'acords (2+2, 2+1+1), no per la posició exacta de cada cel·la d'iReal.
- **Signes ignorats:** el segno, la coda i els finals alternatius més enllà de 1a/2a casella no s'interpreten.
- **iPhone:** el so s'atura si es bloqueja la pantalla, i per això l'app manté la pantalla encesa mentre sona. Si no
  se sent res, comprova l'interruptor de silenci.
- **Dades locals:** els exercicis i els ajustos es guarden al navegador de cada dispositiu i no se sincronitzen.
- **Ajuda:** les notes de l'arpegi s'escriuen amb la lletra que toca (el 7 de C7 és B♭, no A♯). Els dobles sostinguts i
  bemolls se simplifiquen.
- **Mostres:** són d'una sola capa de dinàmica per nota (bancs de so General MIDI), així que el so és més senzill que
  el d'iReal Pro.

## Crèdits i llicències

- **Codi:** MIT.
- **Contrabaix, piano, Rhodes i guitarra:** MusyngKite, de [gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts),
  llicència CC BY-SA 3.0. Les mostres s'han convertit a mono i s'han retallat.
- **Bateria:** [Virtuosity Drums](https://github.com/sfzinstruments/virtuosity_drums), de Versilian Studios / Virtuosity
  Musical Instruments, llicència CC0.
- **Tipografia:** [Saira](https://github.com/google/fonts/tree/main/ofl/sairasemicondensed), llicència SIL OFL 1.1.
- **Desofuscació del format d'iReal Pro:** basada en el treball de la comunitat (pianosnake/ireal-reader).
