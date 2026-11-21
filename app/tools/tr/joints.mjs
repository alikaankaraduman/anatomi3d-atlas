// Eklemler: düzenli kalıba sahip adlar programla üretilir; geri kalanı tools/tr/gen/ içindedir.
const d = {};
const LEVELS = ['C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12', 'L1', 'L2', 'L3', 'L4', 'L5', 'S1'];
for (let i = 0; i + 1 < LEVELS.length; i++) {
  const lv = LEVELS[i] + '-' + LEVELS[i + 1];
  d['Intervertebral disc ' + lv] = lv + ' omurlar arası diski';
  d['Nucleus pulposus ' + lv] = lv + ' diskinin nükleus pulpozusu (disk çekirdeği)';
}
export default d;
