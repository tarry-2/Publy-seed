/* 🌱 Flow 이미지를 주제별로 분류해 봇 접근 위치로 복사 (프로필 사진 풀)
   바탕화면 Publy_Flow이미지_* → ~/.publy/gs-profile-images/{topic}/
   파일명 키워드로 주제 판정. 실행: node classify-profile-images.cjs */
const fs = require("fs"), path = require("path"), os = require("os");
const SRC = path.join(os.homedir(), "Desktop", "Publy_Flow이미지_2026-09-12");
const OUT = path.join(os.homedir(), ".publy", "gs-profile-images");

// 주제 판정(첫 매칭). 매칭 없으면 daily.
const TOPICS = [
  ["cooking", /레시피|닭가슴살|장어|참돔|굴비|해물|한정식|식단|밥|계란|요리|조리|프라이팬|반건조|물회|샐러드|민물|박대|김치|현미/],
  ["travel", /여행|펜션|오션뷰|제주|속초|여행코스|1박|숙소|떠난|코스/],
  ["money", /투자|보조금|지원금|보험|파이프라인|재테크|정부지원|스터디|전기차|파이낸스|절세|연말정산/],
  ["health", /운동|근육|동작|단백질|코어|헬스|다이어트|숙면|건강|스트레칭/],
  ["cafe", /맛집|커피숍|카페|후기|본점|시장|디저트|브런치/],
  ["it", /클라우드|스마트폰|카메라|서버|컴퓨팅|콘텐츠|디지털|아이폰|갤럭시|앱/],
];
const pickTopic = (name) => { for (const [t, re] of TOPICS) if (re.test(name)) return t; return "daily"; };

function walk(dir) { let out = []; for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); const st = fs.statSync(p); if (st.isDirectory()) out = out.concat(walk(p)); else if (/\.(png|jpe?g|webp)$/i.test(f)) out.push(p); } return out; }

if (!fs.existsSync(SRC)) { console.log("❌ 소스 폴더 없음: " + SRC); process.exit(1); }
const files = walk(SRC);
console.log(`총 ${files.length}개 이미지 발견`);
const counts = {};
for (const f of files) {
  const name = path.basename(f);
  const topic = pickTopic(name);
  const dir = path.join(OUT, topic);
  fs.mkdirSync(dir, { recursive: true });
  // 파일명 충돌 방지: 해시 대신 순번
  counts[topic] = (counts[topic] || 0) + 1;
  const ext = path.extname(f);
  const dest = path.join(dir, `${topic}_${counts[topic]}${ext}`);
  try { fs.copyFileSync(f, dest); } catch (e) { console.log("복사 실패 " + name + ": " + e.message); }
}
console.log("\n주제별 분류 결과:");
Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => console.log(`  ${t}: ${c}개`));
console.log(`\n✅ 저장 위치: ${OUT}`);
