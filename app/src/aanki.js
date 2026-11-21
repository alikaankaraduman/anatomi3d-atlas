// Aanki (Fachschaft Medizin Aachen'in Anki destesi) konuları ile atlastaki yapıların eşleştirmesi.
// Konular public/data/aanki.json'da: ÄBP öğrenme planının anatomi günleri ve dönemlerin anatomi dersleri. Her konu
// yapıları ad kurallarıyla seçer; kurallar burada, meta.json'daki grup ve yapı adlarına göre çözülür (tarayıcıda da
// Node'da da: tools/aanki-check.mjs aynı çözücüyü kullanır).
//
// Kural biçimi:
//   groups:  grup adları (İngilizce ad, tam eşleşme); grubun bütün alt yapıları. Aynı ad birden çok yerde varsa hepsi
//            alınır; "sistem:Ad" (ör. "muscle:Fasciae of upper limb") ya da "Üst > Alt" yolu (üst grup herhangi bir
//            atadır) daraltır.
//   items:   yapı adları (İngilizce ad, tam eşleşme); her iki taraf ve iki cinsiyet. "sistem:Ad" de olur.
//   exclude: grup ya da yapı adları, aynı biçimde; birleşimden çıkarılır.
const SYS = /^(bone|muscle|nerve|vessel|organ|joint):(.*)$/;

// meta: { items: [{ id, n, s, g }], groups: [{ n, p, s }] } (meta.json ya da Model'in listeleri)
export function makeResolver(meta) {
  const { items, groups } = meta;
  const kids = groups.map(() => []), own = groups.map(() => []);
  groups.forEach((g, i) => { if (g.p >= 0) kids[g.p].push(i); });
  for (const it of items) if (it.g >= 0) own[it.g].push(it);
  const groupsByName = new Map(), itemsByName = new Map();
  groups.forEach((g, i) => { if (!groupsByName.has(g.n)) groupsByName.set(g.n, []); groupsByName.get(g.n).push(i); });
  for (const it of items) { if (!itemsByName.has(it.n)) itemsByName.set(it.n, []); itemsByName.get(it.n).push(it); }
  const subtree = gi => { const out = [...own[gi]]; for (const k of kids[gi]) out.push(...subtree(k)); return out; };
  const parse = spec => { const m = SYS.exec(spec); return { sys: m ? m[1] : null, path: (m ? m[2] : spec).split(' > ').map(s => s.trim()) }; };
  // Yoldaki üst adlar (sondan başa) sırayla p grubunda ya da onun atalarında bulunmalı.
  const ancestorsMatch = (p, path) => {
    for (let k = path.length - 2; k >= 0; k--) {
      while (p >= 0 && groups[p].n !== path[k]) p = groups[p].p;
      if (p < 0) return false;
      p = groups[p].p;
    }
    return true;
  };
  const findGroups = spec => {
    const { sys, path } = parse(spec);
    return (groupsByName.get(path[path.length - 1]) || []).filter(i => (!sys || groups[i].s === sys) && ancestorsMatch(groups[i].p, path));
  };
  const findItems = spec => {
    const { sys, path } = parse(spec);
    return (itemsByName.get(path[path.length - 1]) || []).filter(it => (!sys || it.s === sys) && (path.length < 2 || ancestorsMatch(it.g, path)));
  };
  // spec önce grup, yoksa yapı adı olarak aranır
  const anyOf = spec => { const g = findGroups(spec); return g.length ? g.flatMap(subtree) : findItems(spec); };

  return topic => {
    const set = new Set(), missing = [];
    for (const spec of topic.groups || []) { const g = findGroups(spec); if (!g.length) missing.push(spec); for (const gi of g) for (const it of subtree(gi)) set.add(it); }
    for (const spec of topic.items || []) { const r = findItems(spec); if (!r.length) missing.push(spec); for (const it of r) set.add(it); }
    for (const spec of topic.exclude || []) { const r = anyOf(spec); if (!r.length) missing.push('-' + spec); for (const it of r) set.delete(it); }
    return { items: [...set], missing };
  };
}

// Blok adları: tablodaki ve ÄBP planındaki kısaltmalar (3. dönem tablosunda "SB Bewegungsapparat", "SB Herz-
// Kreislaufsystem", 6. dönemde "SB Endo" geçer; plan BWA, HKL, BuA, Atmung, Neuro, Gastro, HuGO, Endo, SOK yazar).
export const BLOCKS = {
  IPO: 'IPO', BWA: 'SB Bewegungsapparat', HKL: 'SB Herz-Kreislaufsystem', BuA: 'SB Blut und Abwehr', ATM: 'SB Atmung',
  NEU: 'SB Neuro', GIT: 'SB Gastro', HuGO: 'SB HuGO', Endo: 'SB Endo', SOK: 'SB SOK', Gelenke: 'Gelenke',
};
export const BLOCK_SHORT = { BWA: 'BWA', HKL: 'HKL', BuA: 'BuA', ATM: 'Atmung', NEU: 'Neuro', GIT: 'Gastro', HuGO: 'HuGO', Endo: 'Endo', SOK: 'SOK' };
const TYP = { vl: 'VL', pr: 'Prakt.' };

// Ağaçtaki ve aramadaki kısa ad: "Tag 1 · BWA: Anatomie Obere Extremität", "VL 6,7 · Muskeln und Gelenke",
// "Präp. Tag 1 · Abdominalsitus". IPO derslerinde dersin alanı da yazılır ("Atmungsorgane 1-3" zaten alanı içerir).
export function topicLabel(t) {
  if (t.kind === 'abp') return `Tag ${String(t.day).replace('-', '–')} · ${BLOCK_SHORT[t.block] || t.block}: ${t.title}`;
  const typ = t.fach === 'Präparierkurs' ? 'Präp.' : TYP[t.kind] || '';
  const head = t.nr ? `${typ} ${String(t.nr).replace(/(\d)-(\d)/g, '$1–$2')} · ` : '';
  const fach = t.block === 'IPO' && !t.title.includes(t.fach) ? `${t.fach}: ` : '';
  return head + fach + t.title;
}
// Kartta ve ipucunda yer: "ÄBP-Lernplan · Tag 1" ya da "2. Semester · IPO · Bewegungsapparat"
export function topicPlace(t) {
  if (t.kind === 'abp') return `ÄBP-Lernplan · Lerntag ${String(t.day).replace('-', '–')} · ${BLOCK_SHORT[t.block] || t.block}`;
  return [`${t.sem}. Semester`, BLOCKS[t.block] || t.block, t.block === 'IPO' ? t.fach : t.fach === 'Präparierkurs' ? 'Präparierkurs' : 'Anatomie'].join(' · ');
}

// Konular: tembel çözülür (ilk tıklamada); yapı -> konular dizini de ilk gerektiğinde kurulur.
export function createAanki(model, data) {
  const resolve = makeResolver({ items: model.list, groups: model.groups });
  // n: aramadaki sıralama ad olarak başlığı kullanır
  const topics = (data.topics || []).map(t => ({ ...t, n: t.title, label: topicLabel(t), place: topicPlace(t) }));
  const byId = new Map(topics.map(t => [t.id, t]));
  const cache = new Map();
  const recsOf = t => { if (!cache.has(t.id)) cache.set(t.id, resolve(t).items); return cache.get(t.id); };
  let rev = null;
  const topicsOf = id => {
    if (!rev) { rev = new Map(); for (const t of topics) for (const r of recsOf(t)) { if (!rev.has(r.id)) rev.set(r.id, []); rev.get(r.id).push(t); } }
    return rev.get(id) || [];
  };
  return { source: data.source, topics, byId, recsOf, topicsOf };
}
