// HuBMAP CCF 3D Reference Object Library v1.2 (CC BY 4.0; Kristen Browne, NIAID; Visible Human Female) kadin
// modellerini convert.mjs icin bir THREE sahnesine cevirir: adlar ve gruplar Z-Anatomy duzeninde (taraf eki .l/.r,
// ust gruplar ebeveyn dugum), malzeme adlari palette.mjs anahtarlari, konumlar hizalama donusumuyle modelin
// koordinatlarinda (cm). Hizalama: tools/hra-register.mjs -> tools/hra-registration.json.
import fs from 'node:fs';
import { THREE, loadFBX } from './fbxnode.mjs';
import { readGLBMeshes } from './glb.mjs';
import { extract, origName } from './geom.mjs';
import { MeshBVH } from 'three-mesh-bvh';
import { makeWarp } from './breastwarp.mjs';

const DIR = '../data/hra';
// Dosya adi klasor iceriyorsa ../data/ altindan okunur (sonraki indirmeler kendi klasorlerinde), yoksa data/hra/ altindan.
const fileOf = f => (f.includes('/') ? `../data/${f}` : `${DIR}/${f}`);

// Meme parcalari (iki taraf ayni adlarla). TA2'ye gore meme deri ve eklerinin (Integumentum commune) parcasidir;
// bez loblari, sut kanallari ve sut sinusleri "Mammary gland" alt grubunda toplanir. Areola tuberkulleri FIPAT'ta
// areola mammae'nin parcasidir ve HRA'da areola agindaki delikleri doldurur: ikisi "Areola" grubunda (grup secilince
// areolanin tamami gorunur).
const BREAST = ['/', 'Integument', 'Breast'], GLAND = [...BREAST, 'Mammary gland'], AREOLA = [...BREAST, 'Areola'];
const breastParts = {};
for (const [S, sd] of [['L', 'l'], ['R', 'r']]) Object.assign(breastParts, {
  [`VH_F_fat_${S}`]: [BREAST, 'Adipose tissue of breast', sd, 'Breast fat'],   // memenin tum dis kitlesi; digerleri icinde
  [`VH_F_mammary_lobes_${S}`]: [GLAND, 'Lobes of mammary gland', sd, 'Mammary lobe'],
  [`VH_F_main_lactiferous_ducts_${S}`]: [GLAND, 'Lactiferous ducts', sd, 'Lactiferous duct'],
  [`VH_F_main_lactiferous_sinuses_${S}`]: [GLAND, 'Lactiferous sinuses', sd, 'Lactiferous sinus'],
  [`VH_F_nipple_${S}`]: [BREAST, 'Nipple', sd, 'Nipple'],
  [`VH_F_areola_${S}`]: [AREOLA, 'Areola', sd, 'Areola'],
  [`VH_F_areolar_tubercles_${S}`]: [AREOLA, 'Areolar tubercles', sd, 'Areolar tubercle'],
  [`VH_F_suspensory_ligaments_${S}`]: [BREAST, 'Suspensory ligaments of breast', sd, 'Ligament'],
});

// Kaynak duzenleri. parts: HRA dugum adi -> [grup (yoksa null), Ingilizce ad, taraf, malzeme]; listede olmayan dugum atlanir.
const SETS = {
  // Kadin ic genital organlari. Uterus dosyasi ayni yuzeyi iki kez boler (govde/fundus ile on/arka duvar, yuzeylerin
  // yarisi ust uste); klasik bolumleme alinir. "abdominal ostium" adli serit uterusun ustunu boydan boya keser,
  // tubanin karin agzi degildir: atlanir. Serviks agizlari kucuk halkalardir, serviksin kardesi olarak eklenir.
  organs: {
    // Vajina: kutuphanenin ayni surumundeki (ccf-3d-reference-object-library VH_Female/v1.2) ayri dosya, diger
    // organlarla ayni koordinatlarda; ayni hizalama dogrudan uyar.
    files: ['VH_F_Uterus.glb', 'VH_F_Fallopian_Tube_L.glb', 'VH_F_Fallopian_Tube_R.glb', 'VH_F_Ovary_L.glb', 'VH_F_Ovary_R.glb', 'VH_F_Urinary_Bladder.glb', 'hra-vagina/VH_F_Vagina.glb'],
    chain: ['Genital systems', 'Female genital system', 'Female internal genitalia'],
    adnexaShift: [0.25, 1.25, 0.25],   // cm: ice, asagi, geriye (asagidaki aciklamaya bakin)
    // Kadin mesanesi hizalamadan sonra on yuzuyle karin on duvarina (linea alba, rektus) ve simfiz diskine 0.1-0.3 cm
    // giriyordu; 0.5 cm yukari ve 0.25 cm geri alininca carpisma kalmiyor ve uterusa da degmiyor (tarama ile bulundu).
    bladderShift: [0, 0.5, -0.25],
    // Kadin bedeninde ureterler: modelin (erkek) ureterleri erkek mesanesinin arka duvarinda biter, kadin mesanesi daha
    // asagida ve ondedir (uclar 2.8-3.3 cm uzakta kalir). Ureterin alt ucu ayni taraftaki ureter agzina tasinir;
    // kayma alt uctan yukari dogru `bend` cm icinde yumusakca sifira iner, bobrek tarafi aynen kalir.
    ureters: { fbx: 'VisceralSystem100.fbx', name: 'Ureter', path: ['Urinary system'], bend: 10 },
    // Kadin bedeninde rektum: modelin "Sigmoid colon" agi rektumu ve anal kanali da icerir ve erkekte prostata yaslanir.
    // Kadinda prostat yoktur; ag oldugu yerde kalinca vajinanin arka duvari ile rektumun on duvari arasinda 1.6-2.2 cm bos
    // kalir (gercekte aralarinda yalniz birkac milimetrelik rektovajinal septum vardir). Kopyasi y'ye bagli bir profille one
    // alinir: [y cm, one kayma cm], aralarda yumusak gecis. Perine govdesinde az, vajinanin orta kisminda en cok, sigmoid
    // kolonda sifir. Dogrulama olcumu: bosluk y 83-86'da 0.34-0.45 cm, y 82'de 0.54-0.67 cm; vajina, forniks, serviks,
    // koksiks ve dis anal sfinkterle temas yok; levator ani ile cakisma azalir.
    rectum: { fbx: 'VisceralSystem100.fbx', name: 'Sigmoid colon', path: ['Digestive system', 'Digestive canal', 'Large intestine', 'Colon'],
      profile: [[80.4, 0.3], [82, 0.6], [83, 1.7], [84, 1.6], [85, 1.15], [86, 0.75], [88, 0.35], [90, 0]] },
    parts: {
      VH_F_fundus_of_uterus: ['Uterus', 'Fundus of uterus', '', 'Uterus'],
      VH_F_body_of_uterus: ['Uterus', 'Body of uterus', '', 'Uterus'],
      VH_F_cornua: ['Uterus', 'Horns of uterus', '', 'Uterus'],
      VH_F_lower_uterine_segment: ['Uterus', 'Isthmus of uterus', '', 'Uterus'],
      VH_F_cervix: ['Uterus', 'Cervix of uterus', '', 'Cervix'],
      // halka istmusun alt sinirinda, servikal kanalin basinda: TA98'in histolojik ic agzi (anatomik ic agiz istmusun ust sinirindadir)
      VH_F_internal_cervical_os: ['Uterus', 'Histological internal os of uterus', '', 'Cervix'],
      VH_F_external_cervical_os: ['Uterus', 'External os of uterus', '', 'Cervix'],
      VH_F_isthmus_of_fallopian_tube_L: ['Uterine tube', 'Isthmus of uterine tube', 'l', 'Uterine tube'],
      VH_F_ampulla_of_uterine_tube_L: ['Uterine tube', 'Ampulla of uterine tube', 'l', 'Uterine tube'],
      VH_F_uterine_tube_infundibulum_L: ['Uterine tube', 'Infundibulum of uterine tube', 'l', 'Uterine tube'],
      VH_F_fibria_of_uterine_tube_L: ['Uterine tube', 'Fimbriae of uterine tube', 'l', 'Uterine tube'],
      VH_F_isthmus_of_fallopian_tube_R: ['Uterine tube', 'Isthmus of uterine tube', 'r', 'Uterine tube'],
      VH_F_ampulla_of_uterine_tube_R: ['Uterine tube', 'Ampulla of uterine tube', 'r', 'Uterine tube'],
      VH_F_uterine_tube_infundibulum_R: ['Uterine tube', 'Infundibulum of uterine tube', 'r', 'Uterine tube'],
      VH_F_fibria_of_uterine_tube_R: ['Uterine tube', 'Fimbriae of uterine tube', 'r', 'Uterine tube'],
      // Vajina iki agdir: alt ucu kapali, ic ve dis yuzu olan duvar (giristen serviks hizasina) ve HRA'nin "cervicovaginal
      // junction" dedigi ust uc. Ust uc serviksin vajinal bolumunu ~2 mm disaridan sarar: forniks (TA2 Fornix vaginae).
      // Iki ag ayni iki sinir halkasinda (dis ve ic yuz) birlesir; birlikte kapali bir kabuk olusturur.
      VH_F_vagina: ['Vagina', 'Vagina', '', 'Vagina'],
      VH_F_cervicovaginal_junction: ['Vagina', 'Vaginal fornix', '', 'Vagina'],
      VH_F_left_ovary: [null, 'Ovary', 'l', 'Ovary'],
      VH_F_right_ovary: [null, 'Ovary', 'r', 'Ovary'],
      // Kadin mesanesi: kubbe, taban ve boyun tek duvarda birlesir (erkek modeldeki mesane de tek parcadir); trigon ve
      // ureter agizlari icteki ayri yapilardir. Erkek mesanesi kadin bedeninde gizlenir (sex.mjs). '/' ile baslayan yol
      // kaynak kokunden itibarendir (genital zincir eklenmez).
      VH_F_fundus_of_urinary_bladder_dome: [['/', 'Urinary system', 'Urinary bladder'], 'Urinary bladder', '', 'Organ'],
      VH_F_fundus_of_urinary_bladder_base: [['/', 'Urinary system', 'Urinary bladder'], 'Urinary bladder', '', 'Organ'],
      VH_F_urinary_bladder_neck_smooth_muscle: [['/', 'Urinary system', 'Urinary bladder'], 'Urinary bladder', '', 'Organ'],
      VH_F_trigone_of_urinary_bladder: [['/', 'Urinary system', 'Urinary bladder'], 'Trigone of bladder', '', 'Mucosa'],
      VH_F_ureteral_orifice_L: [['/', 'Urinary system', 'Urinary bladder'], 'Ureteric orifice', 'l', 'Mucosa'],
      VH_F_ureteral_orifice_R: [['/', 'Urinary system', 'Urinary bladder'], 'Ureteric orifice', 'r', 'Mucosa'],
    },
  },
  // Kadin kemik pelvisi. Ilium, iskium ve pubis (dis kompakt kemik) tarafta tek "Hip bone" olarak birlestirilir (erkek
  // modeldeki gibi); ic sungerimsi kemik atlanir. Gruplar erkek modeldekiyle ayni yolda, meta.mjs ayni gruplara katar.
  pelvis: {
    files: ['VH_F_Pelvis.glb'],
    parts: {
      VH_F_ilium_compact_bone_L: [['Bones of lower limb', 'Bones of pelvic girdle'], 'Hip bone', 'l', 'Bone'],
      VH_F_ischium_compact_bone_L: [['Bones of lower limb', 'Bones of pelvic girdle'], 'Hip bone', 'l', 'Bone'],
      VH_F_pubis_compact_bone_L: [['Bones of lower limb', 'Bones of pelvic girdle'], 'Hip bone', 'l', 'Bone'],
      VH_F_ilium_compact_bone_R: [['Bones of lower limb', 'Bones of pelvic girdle'], 'Hip bone', 'r', 'Bone'],
      VH_F_ischium_compact_bone_R: [['Bones of lower limb', 'Bones of pelvic girdle'], 'Hip bone', 'r', 'Bone'],
      VH_F_pubis_compact_bone_R: [['Bones of lower limb', 'Bones of pelvic girdle'], 'Hip bone', 'r', 'Bone'],
      VH_F_sacrum: [['Vertebral column'], 'Sacrum', '', 'Bone'],
      VH_F_coccyx: [['Vertebral column'], 'Coccyx', '', 'Bone'],
    },
  },
  // Kadin memeleri: HRA 3D Reference Organ "Breast (mammary gland), Female left/right" v1.1 (CC BY 4.0; Heidi Schlehlein;
  // atlaslara gore sekillendirilmis, ayni VH_F koordinatlarinda). Pelvis hizalamasi memeleri ~11 cm asagi ve geriye
  // koyar; her meme tools/hra-breast-fit.mjs ile bulunan pozla gogus duvarina oturtulur ve tabani duvara bukulur.
  breast: {
    files: ['hra-breast/3d-vh-f-mammary-gland-l.glb', 'hra-breast/3d-vh-f-mammary-gland-r.glb'],
    fit: './hra-breast-fit.json',
    parts: breastParts,
  },
};

// Meme on donusumu, pozu ve taban bukmesi (tools/hra-breast-fit.mjs): yag govdesinin agirlik merkezi (c0) etrafinda K kat
// buyutme ve disa dx kaydirma, pivot etrafinda donme, yukari (dy) ve one (dz) kaydirma, sonra tools/breastwarp.mjs
// alaniyla tabanin gogus duvarina bukulmesi. Ardindan meme basi-areola kompleksi yaga oturtulur.
function applyBreastFit(merged, file) {
  const F = JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
  const v = new THREE.Vector3();
  for (const sd of ['l', 'r']) {
    const S = F.sides[sd]; if (!S) continue;
    const R = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(S.euler[0], S.euler[1], S.euler[2], 'XYZ'));
    const C = new THREE.Vector3(...S.pivot), c0 = S.c0, K = F.K, D = makeWarp(S.warp);
    for (const e of merged.values()) {
      if (e.side !== sd) continue;
      for (let k = 0; k < e.P.length; k += 3) {
        v.set(c0[0] + K * (e.P[k] - c0[0]) + S.dx, c0[1] + K * (e.P[k + 1] - c0[1]), c0[2] + K * (e.P[k + 2] - c0[2]));
        v.sub(C).applyMatrix4(R).add(C); v.y += S.t[1]; v.z += S.t[2];
        const d = D(v.x, v.y, v.z);
        e.P[k] = v.x + d[0]; e.P[k + 1] = v.y + d[1]; e.P[k + 2] = v.z + d[2];
      }
    }
    seatAreola(merged, sd);
  }
}

// HRA'da areola ve tuberkuller yag govdesinin 3-5 mm onunde durur (deri katmani yok; areola ~1.4 mm kalinliginda iki
// katli bir kabuk). Meme basi-areola kompleksi meme basi ekseni boyunca yaga dogru tek bir duzgun alanla indirilir:
// eksene uzakliga gore 1 mm'lik halkalarda olculen en kucuk bosluk - 0.03 cm (halkalar arasi yumusatilmis); meme basi ve
// sut sinusleri meme basi tabaninin halkasindaki kadar, sut kanallari areola duzleminin 1.5 cm altina kadar azalarak.
function seatAreola(merged, sd) {
  const get = n => [...merged.values()].find(e => e.side === sd && e.name === n);
  const fat = get('Adipose tissue of breast'), ar = get('Areola'), tub = get('Areolar tubercles'), nip = get('Nipple'), sin = get('Lactiferous sinuses'), duct = get('Lactiferous ducts');
  if (!fat || !ar || !nip) return;
  const cen = P => { const c = new THREE.Vector3(); for (let k = 0; k < P.length; k += 3) c.add(new THREE.Vector3(P[k], P[k + 1], P[k + 2])); return c.divideScalar(P.length / 3); };
  const ca = cen(ar.P), ax = cen(nip.P).sub(ca).normalize();
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(fat.P, 3)); g.setIndex(fat.I);
  const bvh = new MeshBVH(g), ray = new THREE.Ray(), p = new THREE.Vector3(), down = ax.clone().negate();
  const radial = (x, y, z) => { p.set(x - ca.x, y - ca.y, z - ca.z); const t = p.dot(ax); return Math.hypot(p.x - t * ax.x, p.y - t * ax.y, p.z - t * ax.z); };
  const BIN = 0.1, minC = new Map();
  for (const e of [ar, tub].filter(Boolean)) for (let k = 0; k < e.P.length; k += 3) {
    ray.set(p.set(e.P[k], e.P[k + 1], e.P[k + 2]), down); const h = bvh.raycastFirst(ray, THREE.DoubleSide); if (!h) continue;
    const b = Math.floor(radial(e.P[k], e.P[k + 1], e.P[k + 2]) / BIN); minC.set(b, Math.min(minC.get(b) ?? Infinity, h.distance));
  }
  const sAt = r => { const b = Math.floor(r / BIN); let m = Infinity; for (const q of [b - 1, b, b + 1]) if (minC.has(q)) m = Math.min(m, minC.get(q)); return m === Infinity ? 0 : Math.max(0, m - 0.03); };
  let rNip = 0; for (let k = 0; k < nip.P.length; k += 3) rNip = Math.max(rNip, radial(nip.P[k], nip.P[k + 1], nip.P[k + 2]));
  const sNip = sAt(rNip);
  const move = (e, f) => { if (e) for (let k = 0; k < e.P.length; k += 3) { const s = f(e.P[k], e.P[k + 1], e.P[k + 2]); e.P[k] -= s * ax.x; e.P[k + 1] -= s * ax.y; e.P[k + 2] -= s * ax.z; } };
  const areaS = (x, y, z) => { const r = radial(x, y, z); return r <= rNip ? sNip : sAt(r); };
  move(ar, areaS); move(tub, areaS); move(nip, () => sNip); move(sin, () => sNip);
  move(duct, (x, y, z) => { const depth = (ca.x - x) * ax.x + (ca.y - y) * ax.y + (ca.z - z) * ax.z; const fade = Math.min(1, Math.max(0, 1 - depth / 1.5)); return areaS(x, y, z) * fade; });
}

export function hraMatrix() {
  const reg = JSON.parse(fs.readFileSync(new URL('./hra-registration.json', import.meta.url), 'utf8'));
  const { R, s, t } = reg;
  return new THREE.Matrix4().set(
    s * R[0][0], s * R[0][1], s * R[0][2], t[0],
    s * R[1][0], s * R[1][1], s * R[1][2], t[1],
    s * R[2][0], s * R[2][1], s * R[2][2], t[2],
    0, 0, 0, 1);
}

export function loadHRA(setName) {
  const set = SETS[setName]; if (!set) throw new Error(`HRA duzeni yok: ${setName}`);
  const M = hraMatrix(); const v = new THREE.Vector3();
  const root = new THREE.Group(); root.name = 'HRA';
  const groupAt = path => {   // ebeveyn zinciri (ad yolu) -> dugum; yoksa olusturulur
    let node = root;
    for (const name of path) {
      let c = node.children.find(o => !o.isMesh && o.name === name);
      if (!c) { c = new THREE.Group(); c.name = name; node.add(c); }
      node = c;
    }
    return node;
  };
  // ayni ada ve tarafa dusen agler (kalca kemiginin uc bolumu) tek geometride birlesir
  const merged = new Map();
  for (const f of set.files) {
    for (const m of readGLBMeshes(fileOf(f))) {
      const spec = set.parts[m.name]; if (!spec) continue;
      const [grp, name, side, mat] = spec;
      const abs = Array.isArray(grp) && grp[0] === '/';
      const path = abs ? grp.slice(1) : [...(set.chain || []), ...(grp === null ? [] : Array.isArray(grp) ? grp : [grp])];
      const key = path.join('/') + '|' + name + '|' + side;
      let e = merged.get(key); if (!e) merged.set(key, e = { path, name, side, mat, P: [], I: [] });
      const base = e.P.length / 3;
      for (let k = 0; k < m.P.length; k += 3) { v.set(m.P[k], m.P[k + 1], m.P[k + 2]).applyMatrix4(M); e.P.push(v.x, v.y, v.z); }
      for (const i of m.idx) e.I.push(base + i);
    }
  }
  if (set.fit) applyBreastFit(merged, set.fit);
  // Adneksler (tuba + over): HRA'da pelvis girisi hizasinda dururlar; hizalamadan sonra modelin (erkek) dis iliak
  // damarlarini, psoas fasyasini ve inen kolonu keserler. Kadinda over, dis iliak damarlarin altindaki over cukurundadir.
  // Bu yuzden uzak parcalar asagi (ve hafifce ice, geriye) alinir; kayma uterus boynuzundan uzaklikla artar (0.5 cm'de 0,
  // 3 cm'de tam), tubanin uterus ucu yerinde kalir. Deger, modeldeki carpisma taramasiyla bulundu (145 -> 1 ornek nokta).
  if (set.adnexaShift) {
    const horns = [...merged.values()].find(e => e.name === 'Horns of uterus');
    if (horns) {
      let mnx = Infinity, mxx = -Infinity, sy = 0, sz = 0;
      for (let k = 0; k < horns.P.length; k += 3) { mnx = Math.min(mnx, horns.P[k]); mxx = Math.max(mxx, horns.P[k]); sy += horns.P[k + 1]; sz += horns.P[k + 2]; }
      const n = horns.P.length / 3; const my = sy / n, mz = sz / n;
      const [med, down, back] = set.adnexaShift;
      for (const e of merged.values()) {
        if (!e.side || !e.path.includes('Female internal genitalia')) continue;   // yalniz tuba ve over
        const ax = e.side === 'l' ? mxx : mnx, sign = e.side === 'l' ? -1 : 1;   // sol taraf +x: ice dogru -x
        for (let k = 0; k < e.P.length; k += 3) {
          const d = Math.hypot(e.P[k] - ax, e.P[k + 1] - my, e.P[k + 2] - mz);
          const w = Math.min(1, Math.max(0, (d - 0.5) / 2.5));
          e.P[k] += sign * med * w; e.P[k + 1] -= down * w; e.P[k + 2] -= back * w;
        }
      }
    }
  }
  if (set.bladderShift) {
    const [bx, by, bz] = set.bladderShift;
    for (const e of merged.values()) {
      if (!e.path.includes('Urinary system')) continue;
      for (let k = 0; k < e.P.length; k += 3) { e.P[k] += bx; e.P[k + 1] += by; e.P[k + 2] += bz; }
    }
  }
  if (set.ureters) {
    const U = set.ureters;
    const centre = e => { let x = 0, y = 0, z = 0; const n = e.P.length / 3; for (let k = 0; k < e.P.length; k += 3) { x += e.P[k]; y += e.P[k + 1]; z += e.P[k + 2]; } return [x / n, y / n, z / n]; };
    const fbx = loadFBX(`../data/zanatomy/${U.fbx}`);
    fbx.traverse(o => {
      if (!o.isMesh) return;
      const mm = /^(.*?)\.([lr])$/.exec(origName(o).trim()); if (!mm || mm[1].trim() !== U.name) return;
      const side = mm[2];
      const orifice = [...merged.values()].find(e => e.name === 'Ureteric orifice' && e.side === side);
      if (!orifice) throw new Error('ureter agzi yok: ' + side);
      const tgt = centre(orifice);
      const ex = extract(o); const P = Array.from(ex.P);
      let low = 1; for (let k = 4; k < P.length; k += 3) if (P[k] < P[low]) low = k;   // en alcak kosenin y indisi
      const end = [P[low - 1], P[low], P[low + 1]]; const dv = [tgt[0] - end[0], tgt[1] - end[1], tgt[2] - end[2]];
      for (let k = 0; k < P.length; k += 3) {
        const s = Math.max(0, 1 - (P[k + 1] - end[1]) / U.bend); const w = s * s * (3 - 2 * s);
        P[k] += dv[0] * w; P[k + 1] += dv[1] * w; P[k + 2] += dv[2] * w;
      }
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      merged.set(`ureter|${side}`, { path: U.path, name: U.name, side, mat: mats[0].name, P, I: Array.from(ex.idx) });
    });
  }
  if (set.rectum) {
    const Rc = set.rectum, pr = Rc.profile;
    const dzAt = y => {
      if (y <= pr[0][0]) return pr[0][1];
      for (let i = 0; i < pr.length - 1; i++) { const [y0, a] = pr[i], [y1, b] = pr[i + 1]; if (y <= y1) { const t = (y - y0) / (y1 - y0), s = t * t * (3 - 2 * t); return a + (b - a) * s; } }
      return pr[pr.length - 1][1];
    };
    let found = 0;
    loadFBX(`../data/zanatomy/${Rc.fbx}`).traverse(o => {
      if (!o.isMesh || origName(o).replace(/\.[rlg]$/, '').replace(/\.+$/, '').trim() !== Rc.name) return;
      const ex = extract(o); const P = Array.from(ex.P);
      for (let k = 0; k < P.length; k += 3) P[k + 2] += dzAt(P[k + 1]);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      merged.set('rectum', { path: Rc.path, name: Rc.name, side: '', mat: mats[0].name, P, I: Array.from(ex.idx) }); found++;
    });
    if (found !== 1) throw new Error(`rektum kopyasi: ${Rc.name} ${found} kez bulundu`);
  }
  for (const e of merged.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(e.P, 3));
    g.setIndex(e.I);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ name: e.mat }));
    mesh.name = e.name + (e.side ? '.' + e.side : '');
    groupAt(e.path).add(mesh);
  }
  root.updateMatrixWorld(true);
  return root;
}
