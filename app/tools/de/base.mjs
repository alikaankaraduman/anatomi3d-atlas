// Almanca adlar: düzenli kalıba sahip adlar kuralla üretilir; geri kalanı tools/de/gen/ içindedir.
// Kurallar için bkz. STYLE.md.
const ORD = { First: 1, Second: 2, Third: 3, Fourth: 4, Fifth: 5, Sixth: 6, Seventh: 7, Eighth: 8, Ninth: 9, Tenth: 10, Eleventh: 11, Twelfth: 12 };
const d = {};

// --- Rippen und Rippenknorpel ---
for (const [w, n] of Object.entries(ORD)) {
  d[`${w} rib`] = `${n}. Rippe`;
  if (n <= 10) d[`Costal cartilage of ${w.toLowerCase()} rib`] = `Rippenknorpel der ${n}. Rippe`;
}

// --- Wirbel (Brustwirbel werden im Deutschen mit Th abgekürzt) ---
d['Atlas (C1)'] = 'Atlas (1. Halswirbel, C1)';
d['Axis (C2)'] = 'Axis (2. Halswirbel, C2)';
for (let n = 3; n <= 7; n++) d[`Vertebra C${n}`] = `${n}. Halswirbel (C${n})`;
for (let n = 1; n <= 12; n++) d[`Vertebra T${n}`] = `${n}. Brustwirbel (Th${n})`;
for (let n = 1; n <= 5; n++) d[`Vertebra L${n}`] = `${n}. Lendenwirbel (L${n})`;

// --- Finger- und Zehenglieder, Mittelhand- und Mittelfußknochen ---
const PH = { Proximal: 'Grundglied', Middle: 'Mittelglied', Distal: 'Endglied' };
for (const [w, n] of Object.entries(ORD)) {
  if (n > 5) continue;
  const lw = w.toLowerCase();
  for (const [p, de] of Object.entries(PH)) {
    if (p === 'Middle' && n === 1) continue;       // Daumen und Großzehe haben kein Mittelglied
    d[`${p} phalanx of ${lw} finger of hand`] = n === 1 ? `${de} des Daumens` : `${de} des ${n}. Fingers`;
    d[`${p} phalanx of ${lw} finger of foot`] = n === 1 ? `${de} der Großzehe` : `${de} der ${n}. Zehe`;
  }
  d[`${w} metacarpal bone`] = `${n}. Mittelhandknochen`;
  d[`${w} metatarsal bone`] = `${n}. Mittelfußknochen`;
}

// --- Bandscheiben ---
const LEVELS = ['C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12', 'L1', 'L2', 'L3', 'L4', 'L5', 'S1'];
const deLevel = l => l.replace(/^T/, 'Th');
for (let i = 0; i + 1 < LEVELS.length; i++) {
  const en = `${LEVELS[i]}-${LEVELS[i + 1]}`; const de = `${deLevel(LEVELS[i])}/${deLevel(LEVELS[i + 1])}`;
  d[`Intervertebral disc ${en}`] = `Bandscheibe ${de}`;
  d[`Nucleus pulposus ${en}`] = `Gallertkern der Bandscheibe ${de}`;
}

export default d;
