// Quality Control: checklist di esempio (usata come bozza finché il
// tenant non la personalizza, stesso pattern già usato per WhatsappTemplate)
// e piccoli helper puri per decidere se un'ispezione può essere approvata.

export const DEFAULT_CHECKLIST = [
  { chiave: "verniciatura", etichetta: "Controllo verniciatura", critico: true },
  { chiave: "differenza_colore", etichetta: "Differenza colore", critico: true },
  { chiave: "lucidatura", etichetta: "Lucidatura", critico: false },
  { chiave: "assemblaggio", etichetta: "Assemblaggio", critico: true },
  { chiave: "giochi_pannelli", etichetta: "Giochi pannelli", critico: true },
  { chiave: "fari", etichetta: "Fari", critico: true },
  { chiave: "indicatori", etichetta: "Indicatori", critico: true },
  { chiave: "spie_quadro", etichetta: "Spie quadro", critico: true },
  { chiave: "sensori", etichetta: "Sensori", critico: true },
  { chiave: "adas", etichetta: "ADAS (quando applicabile)", critico: true },
  { chiave: "pulizia", etichetta: "Pulizia", critico: false },
  { chiave: "oggetti_cliente", etichetta: "Oggetti cliente", critico: false },
  { chiave: "fotografie_finali", etichetta: "Fotografie finali", critico: false },
].map((v, i) => ({ ...v, ordine: i }));

export const ESITI = ["OK", "DA_VERIFICARE", "NON_CONFORME", "NA"];

// Voci critiche non conformi: se non è vuoto, l'approvazione QC deve
// essere impedita ("Se esistono controlli critici non conformi, impedisci
// il passaggio automatico a Pronta").
export function vociCriticheBloccanti(checkResults) {
  return checkResults.filter((r) => r.critico && r.esito === "NON_CONFORME");
}

// Voci non ancora valutate: la checklist va "eseguita" prima di poter
// chiudere il QC, non solo priva di non conformità critiche.
export function vociNonValutate(checkResults) {
  return checkResults.filter((r) => r.esito == null);
}

export function puoApprovare(checkResults) {
  return vociCriticheBloccanti(checkResults).length === 0 && vociNonValutate(checkResults).length === 0;
}
