// İskelet sistemi: İngilizce (Z-Anatomy / TA2) -> Türkçe ad sözlüğü.
const ORD = { First: 1, Second: 2, Third: 3, Fourth: 4, Fifth: 5, Sixth: 6, Seventh: 7, Eighth: 8, Ninth: 9, Tenth: 10, Eleventh: 11, Twelfth: 12 };
const ord = Object.fromEntries(Object.entries(ORD).map(([k, v]) => [k.toLowerCase(), v]));
const d = {};

// --- kaburgalar ve kıkırdakları ---
for (const [w, n] of Object.entries(ORD)) {
  d[`${w} rib`] = `${n}. kaburga`;
  if (n <= 10) d[`Costal cartilage of ${w.toLowerCase()} rib`] = `${n}. kaburga kıkırdağı`;
}

// --- omurlar ---
for (let n = 3; n <= 7; n++) d[`Vertebra C${n}`] = `C${n} omuru (${n}. boyun omuru)`;
for (let n = 1; n <= 12; n++) d[`Vertebra T${n}`] = `T${n} omuru (${n}. göğüs omuru)`;
for (let n = 1; n <= 5; n++) d[`Vertebra L${n}`] = `L${n} omuru (${n}. bel omuru)`;

// --- parmak kemikleri (falankslar), tarak kemikleri ---
const PH = { Proximal: 'proksimal', Middle: 'orta', Distal: 'distal' };
for (const [w, n] of Object.entries(ord)) {
  if (n > 5) continue;
  for (const [p, tr] of Object.entries(PH)) {
    if (p === 'Middle' && n === 1) continue;   // başparmakta orta falanks yoktur
    d[`${p} phalanx of ${w} finger of hand`] = `El ${n}. parmak ${tr} falanksı`;
    d[`${p} phalanx of ${w} finger of foot`] = `Ayak ${n}. parmak ${tr} falanksı`;
  }
  const W = w[0].toUpperCase() + w.slice(1);
  d[`${W} metacarpal bone`] = `${n}. metakarpal kemik (el tarak kemiği)`;
  d[`${W} metatarsal bone`] = `${n}. metatarsal kemik (ayak tarak kemiği)`;
}

Object.assign(d, {
  // alt ekstremite
  'Femur': 'Femur (uyluk kemiği)',
  'Tibia': 'Tibia (kaval kemiği)',
  'Fibula': 'Fibula (kamış kemiği)',
  'Patella': 'Patella (diz kapağı kemiği)',
  'Hip bone': 'Kalça kemiği',
  'Talus': 'Talus (aşık kemiği)',
  'Calcaneus': 'Kalkaneus (topuk kemiği)',
  'Navicular bone': 'Naviküler kemik',
  'Cuboid bone': 'Küboid kemik',
  'Medial cuneiform bone': 'Medial kuneiform kemik',
  'Intermediate cuneiform bone': 'Orta kuneiform kemik',
  'Lateral cuneiform bone': 'Lateral kuneiform kemik',
  'Sesamoid bones of foot': 'Ayağın sesamoid kemikleri',
  // üst ekstremite
  'Humerus': 'Humerus (pazı kemiği)',
  'Radius': 'Radius (döner kemik)',
  'Ulna': 'Ulna (dirsek kemiği)',
  'Scapula': 'Skapula (kürek kemiği)',
  'Clavicle': 'Klavikula (köprücük kemiği)',
  'Scaphoid bone': 'Skafoid kemik',
  'Lunate bone': 'Lunat kemik',
  'Triquetrum bone': 'Trikuetrum kemiği',
  'Pisiform bone': 'Pisiform kemik',
  'Trapezium bone': 'Trapezium kemiği',
  'Trapezoid bone': 'Trapezoid kemik',
  'Capitate bone': 'Kapitat kemik',
  'Hamate bone': 'Hamat kemik',
  // omurga ve göğüs
  'Atlas (C1)': 'Atlas (C1, 1. boyun omuru)',
  'Axis (C2)': 'Aksis (C2, 2. boyun omuru)',
  'Sacrum': 'Sakrum (kuyruk sokumu kemiği)',
  'Coccyx': 'Koksiks (kuyruk kemiği)',
  'Manubrium of sternum': 'Sternum sapı (manubrium)',
  'Body of sternum': 'Sternum gövdesi',
  'Xiphoid process': 'Ksifoid çıkıntı',
  // baş
  'Mandible': 'Mandibula (alt çene kemiği)',
  'Maxilla': 'Maksilla (üst çene kemiği)',
  'Hyoid bone': 'Hiyoid kemik (dil kemiği)',
  'Frontal bone': 'Frontal kemik (alın kemiği)',
  'Parietal bone': 'Parietal kemik (yan kafa kemiği)',
  'Temporal bone': 'Temporal kemik (şakak kemiği)',
  'Occipital bone': 'Oksipital kemik (artkafa kemiği)',
  'Sphenoid bone': 'Sfenoid kemik (kelebek kemik)',
  'Ethmoid bone': 'Etmoid kemik (kalbur kemik)',
  'Zygomatic bone': 'Zigomatik kemik (elmacık kemiği)',
  'Nasal bone': 'Nazal kemik (burun kemiği)',
  'Lacrimal bone': 'Lakrimal kemik (gözyaşı kemiği)',
  'Palatine bone': 'Palatin kemik (damak kemiği)',
  'Vomer': 'Vomer (sapan kemiği)',
  'Inferior nasal concha bone': 'Alt burun konkası',
  'Sinus of frontal bone': 'Frontal sinüs (alın sinüsü)',
  'Sinus of sphenoid bone': 'Sfenoid sinüs',
  'Anterior cells of ethmoid bone': 'Etmoid kemiğin ön hücreleri',
  'Middle cells of ethmoid bone': 'Etmoid kemiğin orta hücreleri',
  'Posterior cells of ethmoid bone': 'Etmoid kemiğin arka hücreleri',
  'Malleus': 'Malleus (çekiç kemiği)',
  'Incus': 'İnkus (örs kemiği)',
  'Stapes': 'Stapes (üzengi kemiği)',
  // kıkırdaklar
  'Thyroid cartilage': 'Tiroid kıkırdak',
  'Cricoid cartilage': 'Krikoid kıkırdak',
  'Arytenoid cartilage': 'Aritenoid kıkırdak',
  'Corniculate cartilage': 'Kornikulat kıkırdak',
  'Major alar cartilage': 'Büyük alar kıkırdak (burun kanadı)',
  'Nasal septal cartilage': 'Burun septumu kıkırdağı',
  'Lateral process of nasal septal cartilage': 'Burun septumu kıkırdağının yan çıkıntısı',
  // dişler
  'Upper medial incisor': 'Üst orta kesici diş',
  'Upper lateral incisor': 'Üst yan kesici diş',
  'Upper canine': 'Üst köpek dişi',
  'Upper first premolar': 'Üst 1. küçük azı dişi',
  'Upper second premolar': 'Üst 2. küçük azı dişi',
  'Upper first molar tooth': 'Üst 1. büyük azı dişi',
  'Upper second molar tooth': 'Üst 2. büyük azı dişi',
  'Lower medial incisor': 'Alt orta kesici diş',
  'Lower lateral incisor': 'Alt yan kesici diş',
  'Lower canine': 'Alt köpek dişi',
  'Lower first premolar': 'Alt 1. küçük azı dişi',
  'Lower second premolar': 'Alt 2. küçük azı dişi',
  'Lower first molar tooth': 'Alt 1. büyük azı dişi',
  'Lower second molar tooth': 'Alt 2. büyük azı dişi',

  // --- gruplar ---
  'Cranium': 'Kafatası',
  'Bones of cranium': 'Kafatası kemikleri',
  'Extracranial bones of head': 'Başın kafatası dışındaki kemikleri',
  'Auditory ossicles': 'Kulak kemikçikleri',
  'Nasal cartilages': 'Burun kıkırdakları',
  'Laryngeal cartilages': 'Gırtlak (larinks) kıkırdakları',
  'Teeth': 'Dişler',
  'Anterior teeth': 'Ön dişler',
  'Posterior teeth': 'Arka dişler',
  'Vertebral column': 'Omurga',
  'Cervical vertebrae': 'Boyun omurları (servikal)',
  'Thoracic vertebrae': 'Göğüs omurları (torakal)',
  'Lumbar vertebrae': 'Bel omurları (lumbar)',
  'Thoracic skeleton': 'Göğüs iskeleti',
  'Bones of thorax': 'Göğüs kafesi kemikleri',
  'Sternum': 'Sternum (göğüs kemiği)',
  'Ribs': 'Kaburgalar',
  'True ribs': 'Gerçek kaburgalar',
  'False ribs': 'Yalancı kaburgalar',
  'Floating ribs': 'Yüzücü kaburgalar',
  'Costal cartilages': 'Kaburga kıkırdakları',
  'Bones of upper limb': 'Üst ekstremite (kol) kemikleri',
  'Bones of free part of upper limb': 'Serbest üst ekstremite kemikleri',
  'Bones of pectoral girdle': 'Omuz kemeri kemikleri',
  'Bones of lower limb': 'Alt ekstremite (bacak) kemikleri',
  'Bones of free part of lower limb': 'Serbest alt ekstremite kemikleri',
  'Bones of pelvic girdle': 'Kalça kemeri kemikleri',
  'Bones of foot': 'Ayak kemikleri',
  'Tarsal bones': 'Tarsal kemikler (ayak bileği kemikleri)',
  'Metatarsal bones': 'Metatarsal kemikler (ayak tarak kemikleri)',
  'Phalanges of foot': 'Ayak parmak kemikleri (falankslar)',
});

export default d;
