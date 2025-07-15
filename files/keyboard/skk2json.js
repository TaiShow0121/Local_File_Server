// skk2json.js
// usage: node skk2json.js SKK-JISYO.L kanaDict.json
const fs = require('fs');

const [,, inputPath = 'SKK-JISYO.L', outputPath = 'kanaDict.json'] = process.argv;
if (!fs.existsSync(inputPath)) {
  console.error('Not found:', inputPath); process.exit(1);
}
let raw = fs.readFileSync(inputPath);
// 文字コード自動判別（EUC-JP/UTF-8）
let text;
try {
  text = raw.toString('utf8');
  if (text.includes('�')) throw 'decode error';
} catch {
  text = require('iconv-lite').decode(raw, 'euc-jp');
}
const map = {};
for (const line of text.split(/\r?\n/)) {
  if (!line || line[0] === ';' || !line.includes('/')) continue;
  // SKKの多くは タブ区切り or 空白区切り
  const m = line.match(/^(.+?)[ \t]+(\/.+\/)/);
  if (!m) continue;
  const kana = m[1];
  const cands = m[2].slice(1, -1).split('/');
  if (cands.length && kana) map[kana] = cands.slice(0, 8);
}
fs.writeFileSync(outputPath, JSON.stringify(map, null, 2), 'utf8');
console.log(`✅ kanaDict.json: ${Object.keys(map).length} 読み`);
