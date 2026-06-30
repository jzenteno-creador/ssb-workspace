// Test estático Tanda A — nueva orderFromName + cadena de asignación + cross-check
function digitsOnly(s) { return String(s || "").replace(/[^\d]/g, ""); }
function orderFromName(name) {
  const toks = String(name || "").match(/\d+/g) || [];
  return toks.find((t) => t.length === 9 || t.length === 10) || "";
}
const stripZeros = (s) => String(s || "").replace(/^0+/, "");

// Las 7 dropeadas: filename real + orden esperada + estado IA real (todas 429 → iaOrder vacío)
const CASES = [
  { file: "48193819_118828268_ZCB3_BA.pdf",  expect: "118828268",  ia: "" },
  { file: "48181307_4010552411_ZCB3_BA.pdf", expect: "4010552411", ia: "" },
  { file: "48179875_118829334_ZCB3_BA.pdf",  expect: "118829334",  ia: "" },
  { file: "48212605_118782218_ZCB3_BA.pdf",  expect: "118782218",  ia: "" },
  { file: "48214308_4010573051_ZCB3_BA.pdf", expect: "4010573051", ia: "" },
  { file: "48147561_4010531225_ZCB3_BA.pdf", expect: "4010531225", ia: "" },
  { file: "48193642_118828225_ZCB3_BA.pdf",  expect: "118828225",  ia: "" },
];

// Casos de borde adicionales
const EDGE = [
  // IA viva y coincide → sin flag
  { file: "48193819_118828268_ZCB3_BA.pdf", expect: "118828268", ia: "118828268", wantFlag: false },
  // IA viva zero-padded (del header del raw) → normaliza, sin flag
  { file: "48193819_118828268_ZCB3_BA.pdf", expect: "118828268", ia: "0118828268", wantFlag: false },
  // IA viva pero difiere → flag mismatch
  { file: "48193819_118828268_ZCB3_BA.pdf", expect: "118828268", ia: "4010552411", wantFlag: true },
  // filename sin token 9-10 (solo shipment) → cae a IA
  { file: "48193819_ZCB3_BA.pdf", expect: "4010999999", ia: "4010999999", wantFlag: false },
  // filename sin nada + IA caída → vacío (joinKey '' → left join lo marca missing)
  { file: "BA_sin_numeros.pdf", expect: "", ia: "", wantFlag: false },
];

let fails = 0;
console.log("=== 7 dropeadas (IA caída por 429 — el filename decide) ===");
for (const c of CASES) {
  const fileOrder = orderFromName(c.file);
  const iaOrder = digitsOnly(c.ia);
  const result = fileOrder || iaOrder || "";
  const flag = !!(fileOrder && iaOrder && stripZeros(fileOrder) !== stripZeros(iaOrder));
  const ok = result === c.expect && !flag;
  if (!ok) fails++;
  console.log(`${ok ? "✅" : "❌"} ${c.file} → "${result}" (esperado "${c.expect}", flag=${flag})`);
}
console.log("=== casos de borde ===");
for (const c of EDGE) {
  const fileOrder = orderFromName(c.file);
  const iaOrder = digitsOnly(c.ia);
  const result = fileOrder || iaOrder || "";
  const flag = !!(fileOrder && iaOrder && stripZeros(fileOrder) !== stripZeros(iaOrder));
  const ok = result === c.expect && flag === c.wantFlag;
  if (!ok) fails++;
  console.log(`${ok ? "✅" : "❌"} ${c.file} ia="${c.ia}" → "${result}" flag=${flag} (esperado "${c.expect}" flag=${c.wantFlag})`);
}
console.log(fails === 0 ? "\nTODO PASS" : `\n${fails} FAILS`);
process.exit(fails === 0 ? 0 : 1);
