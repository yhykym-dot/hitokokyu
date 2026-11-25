'use strict';
/* ひと呼吸 — 無駄遣い予防アプリ
   ・データはこの端末のブラウザ内だけに保存（外部送信なし／外部ライブラリなし）
   ・パスコードを設定すると AES-GCM(256bit) で暗号化して保存（鍵は PBKDF2-SHA256 で導出）
   ・このファイル自体には個人のデータを一切含めない（初期データは別ファイルから読み込む） */
const LS='hitokokyu_v1', APP='hitokokyu', ITER=310000, KC_USER='ひと呼吸';
const Q=[
  ['q1','これは半年後の理想の自分（Want-to）につながる？ それとも今の気分の発散？'],
  ['q2','いま持っているもので代わりにならない？ 足りないのは何？'],
  ['q3','これを迎えるなら、代わりに何を手放す？（いくらで）']
];
const WCATS=['服・靴','家電・ガジェット','スマホ小物','車','子ども','その他'];
const TXCATS=['コンビニ','カフェ','外食','食品','日用品','服・靴','サウナ・温浴','ネット通販','メルカリ','子ども','車・ガソリン','投資・貯金','その他'];
const CARDN={rakuten:'楽天カード',amazon:'Amazonカード'};
const PCATS=['日用品','食品','嗜好品・酒類','ペット用品','服・靴','家電・ガジェット','車','子ども','その他'];
const PAYS=['メルペイあと払い','メルペイ残高','カード','その他'];
const SUBST=['継続','検討中','解約済'];
const CYC=[['1回きり',0],['半年ごと',6],['毎年',12],['2年ごと',24],['3年ごと',36]];
const YM=/^\d{4}-(0[1-9]|1[0-2])$/;
/* 月の確認で見てまわる項目 */
const RV=[['book','家計簿の数字を入れた'],['hidden','家計簿に載っていない支出を入れた'],['fund','備えの今月分を積んだ'],['subs','サブスクを見直した'],['cloth','服の枠を確かめた'],['wait','待っているものを確かめた']];
/* よくある備え：名前と周期だけ。金額と期日は自分で入れる */
const PRESETS=[
  {name:'固定資産税',cycle:12,note:'分けて払う場合は年額の合計を入れ、最初の納期を期日に'},
  {name:'車検',cycle:24,amt:160000,note:'目安：大きめのSUVで約10〜16万円。新車は初回のみ3年後。見積もりが出たら直してください'},
  {name:'自動車税',cycle:12,may:1,note:'納期は多くの地域で5月末'},
  {name:'自動車保険',cycle:12,note:''},
  {name:'火災・地震保険',cycle:12,note:''},
  {name:'家の修繕',cycle:0,note:''},
  {name:'家電の買い替え',cycle:0,note:''},
  {name:'入学・進級の準備',cycle:0,note:''},
  {name:'旅行・帰省',cycle:12,note:''},
  {name:'冠婚葬祭・贈り物',cycle:12,note:''}
];
let lifeSel=null,S=null,KEY=null,SALT=null,KITER=ITER,mode='boot',tab='kb',lastMoney='kb',curMonth=null,hiddenAt=0,storageOK=true,dupQ='',simPct=50,undoSnap=null,homeView='month',curYear=null,quickEdit=false;
const openDet=new Set();
const root=document.getElementById('root'),dlg=document.getElementById('dlg');

/* ---------- 小道具 ---------- */
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yen=n=>{n=Math.round(Number(n)||0);return (n<0?'−':'')+'¥'+Math.abs(n).toLocaleString('ja-JP')};
const A=(n,cls)=>`<span class="amt ${cls||''}">${yen(n)}</span>`;
const a2=n=>`<span class="amt n">${yen(n)}</span>`;
const sgn=n=>n<0?'neg':'pos';
const sum=(a,k='amount')=>a.reduce((t,x)=>t+(Number(x[k])||0),0);
const pad=n=>String(n).padStart(2,'0');
const iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today=()=>iso(new Date());
const nowYM=()=>today().slice(0,7);
const ymN=s=>+s.slice(0,4)*12+(+s.slice(5,7)-1);
const ymS=n=>`${Math.floor(n/12)}-${pad(n%12+1)}`;
const fmtYM=s=>`${+s.slice(0,4)}年${+s.slice(5,7)}月`;
const dnum=s=>{const[y,m,d]=s.split('-').map(Number);return Math.round(Date.UTC(y,m-1,d)/864e5)};
const uid=()=>{const u=crypto.getRandomValues(new Uint8Array(12));return Array.from(u,b=>b.toString(16).padStart(2,'0')).join('')};
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
/* 全角数字・カンマ・「円」が混じっていても数字として読む */
const toNum=s=>{s=String(s).normalize('NFKC').replace(/[,\s円¥￥]/g,'');return s===''?NaN:Number(s)};
function toast(m,undo){const t=document.getElementById('toast');t.innerHTML=esc(m)+(undo?'<button data-act="undo">元に戻す</button>':'');t.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('on'),undo?6000:2600)}
function weekStart(d){const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()-((x.getDay()+6)%7));return x}
const band=h=>h>=5&&h<11?'朝':h>=11&&h<16?'昼':'夜';

/* ---------- 月の家計簿（ひと呼吸の中のタブ） ----------
   スプレッドシートと同じ式で「銀行から引き出す額」を出す。データは S.kb に入り、
   保存と暗号化は「ひと呼吸」と共通（パスコード1回で両方使える）。 */
const KB=(()=>{
/* グループ：income=収入 / keep=口座に残す / rent=家賃支払額 / other=支出合計に足すもの / memo=計算に入れない */
const GROUPS=['income','keep','rent','other','memo'];
const CARDS=[{k:'amazon',n:'Amazonカード',co:'三井住友カード',url:'https://www.smbc-card.com/mem/index.jsp',where:'Vpass',re:/amazon|アマゾン/i,hint:'Vpass のメール設定で、お支払い合計額を「表示する」にしてください'},{k:'rakuten',n:'楽天カード',co:'楽天カード',url:'https://www.rakuten-card.co.jp/e-navi/',where:'楽天e-NAVI（または楽天銀行アプリ）',re:/楽天/,fb:/^カード支払い$/,hint:'楽天e-NAVI のメール設定で、請求金額をメールに載せる設定にしてください'},{k:'nicos',n:'JAカード（ニコス）',co:'ニコス',util:1,g:'rent',url:'https://branch.nicos.co.jp/',where:'Net Branch',re:/電気/,hint:'Net Branch のメール設定で、請求額確定のお知らせに金額が載る設定にしてください'}];
const GNAME={income:'収入',keep:'口座に残す',rent:'JA口座',other:'そのほか',memo:'メモ'};
/* 最初から入っている項目 [id, グループ, 名前, 次の月に引き継ぐか] */
const DEF=[['income','income','収入',1],['card','keep','カード支払い',0],['amazon','keep','Amazon',0],['mercari','keep','メルカリ',0],['kinder','keep','幼稚園',1],['other','keep','その他（口座に残す分）',1],['loan','rent','住宅ローン',1],['elec','rent','電気代',0],['water','rent','水道代',0],['remit','other','仕送り',1],['car','memo','車ローン',1],['tatekae','memo','立替',0]];
/* 式で出る行。数字を打つと手入力が優先され、「式に戻す」で自動計算に戻る */
const OV=['keep','draw','rent','short','jaIn','total','left'];
const YM=/^\d{4}-(0[1-9]|1[0-2])$/,DT=/^\d{4}-\d{2}-\d{2}$/;
const defItems=()=>DEF.map(([id,group,label,carry])=>({id,group,label,carry:!!carry,day:0}));
const blank=()=>({months:{},labels:{},items:defItems(),settings:{bonusAmt:0,bonusMonths:[],autoLockMin:3,payDay:25,cushion:0}});
let D=null,cur=null,edit=false,focusId=null,app=null;const fold={keep:1};let sim={id:'',v:0},bills={},billAt=0;
const dlg=document.createElement('dialog');dlg.id='kbdlg';document.body.appendChild(dlg);
/* ---------- 小道具 ---------- */
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yen=n=>{n=Math.round(Number(n)||0);return(n<0?'−':'')+'¥'+Math.abs(n).toLocaleString('ja-JP')};
const A=(n,cls)=>`<span class="amt ${cls||''}">${yen(n)}</span>`;
const sgn=n=>n<0?'neg':n>0?'pos':'';
const fmt=n=>n==null?'':Math.round(n).toLocaleString('ja-JP');
const pad=n=>String(n).padStart(2,'0');
const today=()=>{const d=new Date();return`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
const nowYM=()=>today().slice(0,7);
const ymN=s=>+s.slice(0,4)*12+(+s.slice(5,7)-1);
const ymS=n=>`${Math.floor(n/12)}-${pad(n%12+1)}`;
const mo=ym=>+ym.slice(5);
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const uid=()=>'i'+Array.from(crypto.getRandomValues(new Uint8Array(6)),b=>b.toString(16).padStart(2,'0')).join('');
/* 数字の読み取り：全角・カンマ・「円」OK。「172205+3190」のような足し算・引き算もできる */
function toNum(s){s=String(s==null?'':s).normalize('NFKC').replace(/[−ー‐–—]/g,'-').replace(/[,\s円¥￥]/g,'').replace(/[+\-]+$/,'');
  if(s==='')return null;if(!/^-?\d+(\.\d+)?([+\-]\d+(\.\d+)?)*$/.test(s))return null;
  let t=0;(s.match(/^-?[\d.]+|[+\-][\d.]+/g)||[]).forEach(x=>t+=Number(x));return Number.isFinite(t)?Math.max(-1e9,Math.min(1e9,t)):null}
const G=g=>D.items.filter(x=>x.group===g);
const names=g=>G(g).map(x=>x.label);

/* ---------- 画面の文字（計算の行の名前・見出し・式の説明）。直した分だけ D.labels に入る ---------- */
const DL={c_income:'収入の合計',c_keep:'口座に残す',c_draw:'引出し額',c_rent:'家賃支払額',c_short:'不足額',c_jaIn:'JA入金',c_total:'支出合計',c_left:'残り',jaBal:'JA残高',h_1:'収入',h_2:'口座に残すもの（引き落とされる分）',h_3:'JA口座（家の支払い）',h_4:'そのほか',h_5:'メモ（計算には入れません）',hero:'銀行から引き出す額'};
const incName=()=>G('income').length===1?G('income')[0].label:L('c_income');
const FD={f_keep:()=>names('keep').join(' ＋ ')||'（項目なし）',f_draw:()=>`${incName()} − ${L('c_keep')}`,f_rent:()=>names('rent').join(' ＋ ')||'（項目なし）',f_short:()=>`${L('jaBal')} − ${L('c_rent')}`,f_jaIn:()=>`${L('c_short')}を千円単位で切り上げ`,f_total:()=>[L('c_keep'),L('c_jaIn'),...names('other')].join(' ＋ '),f_left:()=>`${incName()} − ${L('c_total')}`};
const dflt=k=>FD[k]?FD[k]():DL[k]||'';
const L=k=>D.labels[k]||dflt(k);
const T=(k,f)=>edit?`<input class="lab${f?' f':''}" data-lab="${k}" type="text" maxlength="${f?80:40}" value="${esc(L(k))}" placeholder="${esc(dflt(k))}" aria-label="文字を直す">`:esc(L(k));

/* ---------- 読み込み時の検査（古い形式のデータもここで新しい形に直す） ---------- */
function sanitize(o,base){
  if(!o||typeof o!=='object'||!o.months||typeof o.months!=='object')throw new Error('データの形式が違います');
  const out=blank(),nn=x=>{const n=x==null?null:Number(x);return n==null||!Number.isFinite(n)?null:Math.max(-1e9,Math.min(1e9,n))},oldL=o.labels&&typeof o.labels==='object'?o.labels:{};
  if(Array.isArray(o.items)&&o.items.length){const seen=new Set();out.items=[];o.items.slice(0,80).forEach(x=>{if(!x||typeof x!=='object')return;const id=typeof x.id==='string'&&/^[A-Za-z0-9_]{1,40}$/.test(x.id)&&!seen.has(x.id)&&x.id!=='jaBal'?x.id:uid();seen.add(id);out.items.push({id,group:GROUPS.includes(x.group)?x.group:'memo',label:(typeof x.label==='string'&&x.label.trim()?x.label.trim():'項目').slice(0,40),carry:!!x.carry,day:clamp(Math.round(Number(x.day))||0,0,31),...(x.plan&&typeof x.plan==='object'&&Number(x.plan.amt)>0?{plan:{amt:clamp(Math.round(Number(x.plan.amt)),1,1e8),m:[...new Set((Array.isArray(x.plan.m)?x.plan.m:[]).map(Number).filter(n=>n>=1&&n<=12))].sort((a,b)=>a-b)}}:{})})})}
  else if(base&&base.items.length)out.items=base.items.map(x=>({...x}));
  else out.items=defItems().map(x=>({...x,label:(typeof oldL[x.id]==='string'&&oldL[x.id].trim()?oldL[x.id].trim():x.label).slice(0,40)}));
  const src=Object.keys(oldL).length||!base?oldL:base.labels;
  Object.keys(src).forEach(k=>{if((DL[k]||FD[k])&&typeof src[k]==='string'&&src[k].trim())out.labels[k]=src[k].trim().slice(0,FD[k]?80:40)});
  const s=o.settings&&typeof o.settings==='object'?o.settings:base?base.settings:{};
  out.settings={bonusAmt:clamp(Number(s.bonusAmt)||0,0,1e9),bonusMonths:[...new Set((Array.isArray(s.bonusMonths)?s.bonusMonths:[]).map(x=>Math.round(Number(x))).filter(x=>x>=1&&x<=12))].sort((a,b)=>a-b),autoLockMin:clamp(s.autoLockMin==null?3:Math.round(Number(s.autoLockMin))||0,0,120),payDay:clamp(Math.round(Number(s.payDay))||25,1,31),cushion:clamp(Number(s.cushion)||0,0,1e8),planSeeded:!!s.planSeeded,amzAuto:s.amzAuto!==false,amzItem:typeof s.amzItem==='string'&&/^[A-Za-z0-9_]{1,40}$/.test(s.amzItem)?s.amzItem:'',cardAuto:{},cardItem:{},cardSeen:{}};
  CARDS.forEach(c=>{const ca=s.cardAuto||{},ci=s.cardItem||{};out.settings.cardAuto[c.k]=c.k==='amazon'&&ca.amazon==null?s.amzAuto!==false:ca[c.k]!==false;const id=c.k==='amazon'&&!ci.amazon?s.amzItem:ci[c.k];out.settings.cardItem[c.k]=typeof id==='string'&&/^[A-Za-z0-9_]{1,40}$/.test(id)?id:'';const sn=(s.cardSeen||{})[c.k];out.settings.cardSeen[c.k]=typeof sn==='string'&&DT.test(sn)?sn:''});
  Object.keys(o.months).filter(k=>YM.test(k)).slice(0,240).forEach(k=>{const m=o.months[k]||{},r={memo:typeof m.memo==='string'?m.memo.slice(0,200):'',v:{},ov:{},done:{}};
    out.items.forEach(it=>r.v[it.id]=nn(m.v&&m.v[it.id]!=null?m.v[it.id]:m[it.id]));
    r.jaBal=nn(m.jaBal);OV.forEach(f=>r.ov[f]=nn(m.ov&&m.ov[f]));if(r.ov.jaIn==null)r.ov.jaIn=nn(m.jaIn);
    r.src={};if(m.src&&typeof m.src==='object')out.items.forEach(it=>{if(['mail','est','plan'].includes(m.src[it.id]))r.src[it.id]=m.src[it.id]});
    if(m.done&&typeof m.done==='object')Object.keys(m.done).slice(0,100).forEach(q=>{if(/^[A-Za-z0-9_:]{1,50}$/.test(q)&&DT.test(m.done[q]))r.done[q]=m.done[q]});
    out.months[k]=r});
  return out}

/* ---------- 家計簿用の小さな入力ダイアログ（ひと呼吸のダイアログとは別） ---------- */
function openForm(title,fields,cb,o={}){
  dlg.innerHTML=`<form method="dialog" novalidate><h2>${esc(title)}</h2>${o.desc?`<p class="hint">${esc(o.desc)}</p>`:''}${fields.map((f,i)=>`<label class="f" for="kf${i}">${esc(f.label)}</label><input id="kf${i}" type="${f.type==='password'?'password':'text'}" ${f.type==='number'?'inputmode="numeric"':''} ${f.type==='password'?'name="password"':''} value="${esc(f.value==null?'':f.value)}" placeholder="${esc(f.ph||'')}" autocomplete="${f.type==='password'?'current-password':'off'}" maxlength="60">`).join('')}${fields.some(f=>f.type==='password')?kcUser(o.user):''}
    <div class="btns" style="margin-top:14px"><button class="btn pri" value="ok">${esc(o.ok||'保存')}</button><button class="btn" value="cancel" formnovalidate>やめる</button></div></form>`;
  dlg.querySelector('form').onsubmit=e=>{if(e.submitter&&e.submitter.value!=='ok')return;const out={};
    for(let i=0;i<fields.length;i++){const f=fields[i],el=document.getElementById('kf'+i);let v=f.type==='number'?toNum(el.value):f.type==='password'?el.value:el.value.trim();
      if(f.type==='number'&&(v==null||v<0)){e.preventDefault();toast(`「${f.label}」は0以上の数字で入れてください`);el.focus();return}
      if(f.req&&!v){e.preventDefault();toast(`「${f.label}」を入れてください`);el.focus();return}out[f.k]=v}
    if(cb(out)===false)e.preventDefault()};
  dlg.showModal()}

/* ---------- 計算：シートと同じ式。グループごとに足し算する ---------- */
function calc(m){const sg=g=>G(g).reduce((t,x)=>t+(m.v[x.id]||0),0),o=(k,f)=>m.ov[k]==null?f:m.ov[k];   /* 手入力があればそれを使い、下の式にも流す */
  const income=sg('income'),other=sg('other');
  const keep=o('keep',sg('keep'));                                   /* 口座に残す ＝ そのグループの合計 */
  const rent=o('rent',sg('rent'));                                   /* 家賃支払額 ＝ そのグループの合計 */
  const short=o('short',(m.jaBal||0)-rent);                          /* 不足額 ＝ JA残高 − 家賃支払額 */
  const jaIn=o('jaIn',short<0?Math.ceil(-short/1000)*1000:0);        /* JA入金 ＝ 不足額を千円単位で切り上げ */
  const draw=o('draw',income-keep);                                  /* 引出し額 ＝ 収入 − 口座に残す */
  const total=o('total',keep+jaIn+other);                            /* 支出合計 ＝ 口座に残す ＋ JA入金 ＋ そのほか */
  const left=o('left',income-total);                                 /* 残り ＝ 収入 − 支出合計 */
  return{income,other,keep,rent,short,jaIn,draw,total,left}}
const months=()=>Object.keys(D.months).sort();
/* 月をつなぐ：最初の月から順に「残り」を積み上げ、ボーナスの月にはボーナスを足す（記録のない月は0） */
function cumTable(){const ms=months();if(!ms.length)return[];const st=D.settings,out=[];let cum=0;
  for(let n=ymN(ms[0]);n<=ymN(ms[ms.length-1]);n++){const ym=ymS(n),m=D.months[ym],left=m?calc(m).left:0,bonus=st.bonusAmt&&st.bonusMonths.includes(mo(ym))?st.bonusAmt:0;cum+=left+bonus;out.push({ym,rec:!!m,left,bonus,cum})}return out}
function nextBonus(ym){const st=D.settings;if(!st.bonusAmt||!st.bonusMonths.length)return null;for(let k=1;k<=12;k++){const y=ymS(ymN(ym)+k);if(st.bonusMonths.includes(mo(y)))return y}return null}
/* やること：計算から出た「動かすお金」を順に並べる */
function tasks(m,c){const cu=D.settings.cushion,t=[{k:'draw',label:cu?`給料日に引き出した（クッション ${yen(cu)} は残す）`:'給料日に引き出した',amt:Math.max(0,c.draw-cu),s:'引き出す'}];if(c.jaIn>0)t.push({k:'jaIn',label:`${L('c_jaIn')}をした`,amt:c.jaIn,s:L('c_jaIn')});G('other').forEach(it=>{if(m.v[it.id])t.push({k:'i:'+it.id,label:`${it.label}を済ませた`,amt:m.v[it.id],s:it.label})});return t}
/* 支払いの1週間前：今月の「口座に残す」「JA口座」の項目の引き落とし日（なければ設定の目安日）のうち、いちばん近いもの */
function payAlert(){const t=new Date(),ym=nowYM(),m=D.months[ym];if(!m)return null;const dd=t.getDate(),days=[...new Set(D.items.filter(x=>x.day&&(x.group==='keep'||x.group==='rent')).map(x=>x.day))];
  const list=(days.length?days:[D.settings.payDay]).filter(d=>d>=dd).sort((a,b)=>a-b);if(!list.length||list[0]-dd>7)return null;const d=list[0],c=calc(m),due=D.items.filter(x=>x.day===d&&(x.group==='keep'||x.group==='rent'));
  const gs=due.length?[...new Set(due.map(x=>x.group))]:['keep'];return{ym,d,inDays:d-dd,names:due.map(x=>x.label),gs,c}}
/* 足りないときの手：計算結果と項目から、使える手を順に並べる */
function adviceHtml(m,c){const short=Math.max(-c.left,-c.draw,0);if(!short)return'';
  const tat=D.items.filter(x=>x.group==='memo'&&/立替|精算/.test(x.label)&&m.v[x.id]),tatAmt=tat.reduce((a,x)=>a+(m.v[x.id]||0),0),nb=nextBonus(cur),fl=G('keep').filter(x=>/amazon|定期|メルカリ/i.test(x.label)&&m.v[x.id]);
  const step=(n,t,b)=>`<div class="adv"><b>${n}　${t}</b><div>${b}</div></div>`;
  return`<h2>足りないときの手 <span class="sub">${A(short,'neg')} 足りません</span></h2>
  ${step('①','まず引き落としに間に合わせる',`カード・ローンの引き落としが最優先です。引き落とし日の<b>前の営業日まで</b>に、口座へ ${A(c.keep)} を入れておきます。足りない分は、ふだん使わない貯金から一時的に移すのがいちばん安全です。${nb?`次のボーナス（${mo(nb)}月）で貯金に戻す、と決めておきます。`:''}`)}
  ${step('②','入ってくるお金を早める',`${tatAmt?`${tat.map(x=>esc(x.label)).join('・')} ${A(tatAmt,'pos')} の精算を、今すぐ申請します。`:'仕事の立替があれば、精算を早めに申請します。'}メルカリで売れたお金も、引き出して口座へ回せます。`)}
  ${step('③','出ていくお金を後ろにずらす',`待っている買い物は、今月は見送ります。${fl.length?`${fl.map(x=>esc(x.label)).join('・')}の定期便は、次回分をスキップできるものがあります。`:'ネットの定期便は、次回分をスキップできるものがあります。'}`)}
  ${step('④','来月から固定費を下げる',`カード払いの積立投資は、一時的に減らしたり止めたりできます（売るわけではないので、それまでの分は残ります）。サブスクと酒類の定期便も見直し候補です。`)}
  <div class="adv warn"><b>避けたいこと</b><div>リボ払い・キャッシング・カードローンで埋めること（金利が高く、翌月以降がもっと苦しくなります）。引き落としの残高不足をそのままにすること（遅延損害金がつき、信用情報に記録されることがあります）。</div></div>
  <p class="hint">一般的な考え方です。お金の専門家としての助言ではありません。</p>`}
const prevM=()=>cur&&D.months[ymS(ymN(cur)-1)];
function diffHtml(it){const p=prevM(),m=D.months[cur];if(!p||it.group==='memo')return'';const a=m.v[it.id],b=p.v[it.id];if(a==null&&b==null)return'';const d=(a||0)-(b||0);if(!d)return'';const cls=it.group==='income'?(d>0?'pos':'neg'):(d>0?'neg':'pos');return`<span class="amt dif ${cls}">${d>0?'▲':'▼'} ${fmt(Math.abs(d))}</span>`}
/* グループ合計の先月との差 */
function gDiff(k,cur_,prev_,good){if(prev_==null)return'';const d=cur_-prev_;if(!d)return'<small class="gd">先月と同じ</small>';const bad=good==='up'?d<0:d>0;return`<small class="gd ${bad?'neg':'pos'}">${d>0?'▲':'▼'} ${fmt(Math.abs(d))}</small>`}
/* 引き落としの流れ：日付つきの項目を日にち順に、残りを足し引きしていく */
function flowLine(m,c){const ev=[];const add=(day,label,amt,kind)=>{if(amt)ev.push({day,label,amt,kind})};
  G('income').forEach(it=>add(it.day||0,it.label,m.v[it.id]||0,'in'));
  G('keep').forEach(it=>add(it.day||0,it.label,-(m.v[it.id]||0),'out'));
  const rd=G('rent').map(x=>x.day).filter(Boolean).sort((a,b)=>a-b)[0]||0;add(rd,L('c_jaIn'),-c.jaIn,'ja');
  G('other').forEach(it=>add(it.day||0,it.label,-(m.v[it.id]||0),'out'));
  const dated=ev.filter(e=>e.day).length;if(!dated)return'';
  ev.sort((a,b)=>(a.day||99)-(b.day||99)||(a.kind==='in'?-1:1));
  const kOff=c.keep-G('keep').reduce((t,x)=>t+(m.v[x.id]||0),0),iOff=c.income-G('income').reduce((t,x)=>t+(m.v[x.id]||0),0);
  let run=0,firstNeg=null;const rows=ev.map(e=>{run+=e.amt;if(run<0&&firstNeg==null)firstNeg=e;return{...e,run}});
  const days=[...new Set(rows.map(r=>r.day))];
  return`<div class="fl">${days.map(d=>{const rs=rows.filter(r=>r.day===d),end=rs[rs.length-1].run,inc=rs.some(r=>r.kind==='in');return`<div class="fd ${end<0?'neg':''} ${inc?'in':''}"><b>${d?d+'日':'日付なし'}</b>${rs.map(r=>`<span class="fi"><span>${esc(r.label)}</span><span class="amt">${r.amt>0?'+':'−'}${fmt(Math.abs(r.amt))}</span></span>`).join('')}<span class="fe amt">${yen(end)}</span></div>`}).join('')}</div>
  ${firstNeg?`<p class="hint flw">⚠️ ${firstNeg.day?firstNeg.day+'日の':''}「${esc(firstNeg.label)}」のところで足りなくなります。その前の日までにお金を用意します。</p>`:'<p class="hint">最後まで足りています。</p>'}
  ${kOff||iOff?'<p class="hint">手で直した行があるので、最後の数字は「残り」と少しずれることがあります。</p>':''}`}

/* ---------- 画面 ---------- */
/* ---------- カードの請求額をメールから（カード会社の正しいメールだけ。サーバー側で確かめる） ---------- */
const cardIt=k=>{const c=CARDS.find(x=>x.k===k),id=c.util?'':D.settings.cardItem&&D.settings.cardItem[k];return D.items.find(x=>x.id===id&&x.group!=='memo')||D.items.find(x=>x.group===(c.g||'keep')&&c.re.test(x.label))||(c.fb?D.items.find(x=>x.group===(c.g||'keep')&&c.fb.test(x.label)):null)||null};
const cardOn=k=>CLOUD&&D&&!(D.settings.cardAuto&&D.settings.cardAuto[k]===false);
function billApply(k){const b=bills[k];if(!b||!b.amount||!D||!cardOn(k))return;const c=CARDS.find(x=>x.k===k),it=cardIt(k),m=D.months[b.ym];if(!it||!m)return;m.src=m.src||{};
  const v=m.v[it.id];if(v===b.amount)return;
  if(v==null||m.src[it.id]==='mail'){m.v[it.id]=b.amount;m.src[it.id]='mail';if(b.payDay&&!it.day)it.day=b.payDay;save();if(cur===b.ym)render();toast(`${c.n}の${mo(b.ym)}月の請求 ${yen(b.amount)} をメールから入れました`)}}
const billMismatch=k=>{const b=bills[k];if(!b||!b.amount)return false;const it=cardIt(k),m=D.months[b.ym];return!!(it&&m&&m.v[it.id]!=null&&m.v[it.id]!==b.amount&&!(m.src&&m.src[it.id]==='mail'))};
function billSync(force){if(!CLOUD||!D||!CARDS.some(c=>cardOn(c.k)))return;if(!force&&Date.now()-billAt<36e5){CARDS.forEach(c=>billApply(c.k));return}billAt=Date.now();
  gsr('cardBills').then(r=>{bills=r&&typeof r==='object'?r:{};let rr=false;CARDS.forEach(c=>{billApply(c.k);if(bills[c.k]&&bills[c.k].ym===cur&&billMismatch(c.k))rr=true});if(rr&&!edit)render();renderBillSt()})
    .catch(e=>{const er=String(e&&e.message||e);CARDS.forEach(c=>bills[c.k]={err:er});renderBillSt()})}
function billStText(k){const c=CARDS.find(x=>x.k===k),it=cardIt(k),b=bills[k];if(!CLOUD)return'Google の Apps Script で開いたときだけ動きます';if(!cardOn(k))return'オフ';if(!it)return`入れる項目がありません。下で選んでください`;if(!b)return`オン：「${esc(it.label)}」に入れます`;
  if(b.err)return`<span class="neg">読めませんでした：${esc(b.err.slice(0,90))}</span>`;
  if(b.noAmount)return isConfirm(b)?(c.url&&c.k!=='amazon'?`オン：このカードは金額がメールに載りません。請求額が決まったら（最新 ${b.mailAt}）、家計簿のいちばん上で「金額を入れてください」とお知らせします`:`<span class="neg">請求額確定のメール（${b.mailAt}）に金額が書かれていません。${esc(c.hint)}</span>`):`オン：請求額確定のメールを待っています（${esc(c.co)}の最新のメールは ${b.mailAt}「${esc((b.subject||'').slice(0,40))}」）。届いたら自動で入ります`;
  if(b.none)return`オン：この2か月に、${esc(c.co)}の請求額のメールが見つかりません`;return`オン：最新は ${b.mailAt} のメール（${mo(b.ym)}月 ${yen(b.amount)}）→「${esc(it.label)}」`}
/* 金額がメールに載らないカード：確定のメールが来たら「金額を入れてください」と知らせる */
const isConfirm=b=>b&&b.noAmount&&/確定|請求/.test(b.subject||'')&&!/変更|手続/.test(b.subject||'');
function billWait(){if(!D)return[];const seen=D.settings.cardSeen||{};return CARDS.filter(c=>cardOn(c.k)&&isConfirm(bills[c.k])&&bills[c.k].mailAt>(seen[c.k]||'')&&Date.now()-new Date(bills[c.k].mailAt).getTime()<40*864e5).map(c=>({c,b:bills[c.k],it:cardIt(c.k),ym:bills[c.k].mailAt.slice(0,7)}))}
function billWaitHtml(){const w=billWait();if(!w.length)return'';return`<div class="card billwait"><b>📬 請求額が決まりました</b>${w.map(x=>`<div class="bw"><div class="n">${esc(x.c.n)}（${+x.b.mailAt.slice(5,7)}/${+x.b.mailAt.slice(8)}のメール）<small>${x.c.util?`電気代・水道代には多めの見込みが入っています。${esc(x.c.where)}の明細で、実際の額に直すとより正確になります（直さなくても足りる側です）`:`金額はメールに載らないので、${esc(x.c.where)}で見て入れてください${x.it?`。入れる先：${mo(x.ym)}月「${esc(x.it.label)}」`:''}`}</small></div><div class="bwb"><a class="btn s" href="${x.c.url}" target="_blank" rel="noopener noreferrer">${esc(x.c.where.replace(/（.*）/,''))}を開く</a>${x.it&&D.months[x.ym]?`<button class="btn s pri" data-billgo="${x.c.k}">金額を入れる</button>`:''}<button class="btn s plain" data-billok="${x.c.k}">入れた</button></div></div>`).join('')}</div>`}
const seeBill=k=>{const b=bills[k];if(!b||!b.mailAt)return;D.settings.cardSeen=D.settings.cardSeen||{};if(b.mailAt>(D.settings.cardSeen[k]||'')){D.settings.cardSeen[k]=b.mailAt;save()}};
function renderBillSt(){const bw=app&&app.querySelector('#dyn-billwait');if(bw)bw.innerHTML=billWaitHtml();CARDS.forEach(c=>{const e=app&&app.querySelector('#bst_'+c.k);if(e)e.innerHTML=billStText(c.k)})}
function vSetup(){return`<div class="kbhead"><h2>📒 月の家計簿</h2></div>
  <div class="card kbmove"><h2>家計簿のデータを移す</h2><p>いままで別のアプリで使っていた「月の家計簿」のデータを、ここに移します。移したあとは「ひと呼吸」のパスコードだけで開けます。</p>
  ${CLOUD?'<button class="btn pri" data-act="fromDrive">Google ドライブの家計簿から移す</button>':''}<button class="btn" data-act="fromFile">書き出したファイルから移す</button><button class="btn" data-act="startBlank">空で始める</button>
  <p class="hint" style="margin-top:10px">移すときに、月の家計簿で使っていたパスコードを1回だけ聞きます。</p></div>`}
/* 楽天カード：利用のお知らせの合計を、翌月の引き落とし額の見込みとして入れる（月末締め・翌月27日払い）。手で入れた額は上書きしない */
function txEst(){const it=cardIt('rakuten'),from=S.settings.txFrom;if(!it||!from||!(S.cardTx||[]).length)return false;let ch=false;
  months().forEach(ym=>{const prev=ymS(ymN(ym)-1),m=D.months[ym];if(prev+'-01'<from)return;const sum=S.cardTx.filter(t=>t.card==='rakuten'&&!t.voided&&t.date.slice(0,7)===prev).reduce((a,t)=>a+t.amount,0);if(sum<=0)return;
    m.src=m.src||{};if((m.v[it.id]==null||m.src[it.id]==='est')&&m.v[it.id]!==sum){m.v[it.id]=sum;m.src[it.id]='est';ch=true}});
  return ch}
/* 電気代・水道代（JAカードで払う分）：明細を見に行かなくても足りるよう、多めの見込みを自動で入れる。
   電気代＝直近1年で手で入れた額のいちばん高い額（なければ28,000円）、水道代＝2か月に1回、前回の額（なければ28,000円）。手で入れた額は上書きしない */
const UTIL_DEF=28000,utilIt=re=>D.items.find(x=>x.group==='rent'&&re.test(x.label));
function utilEst(){const el=utilIt(/電気/),wa=utilIt(/水道/),now=nowYM();let ch=false;
  const real=(ym,it)=>{const m=D.months[ym];return m&&m.v[it.id]!=null&&!(m.src&&m.src[it.id]==='est')?m.v[it.id]:null};
  const put=(m,it,v)=>{m.src=m.src||{};if((m.v[it.id]==null||m.src[it.id]==='est')&&m.v[it.id]!==v){m.v[it.id]=v;m.src[it.id]='est';ch=true}};
  months().filter(ym=>ym>=now).forEach(ym=>{const m=D.months[ym],n=ymN(ym);
    if(el){const r=[...Array(12)].map((_,i)=>real(ymS(n-i-1),el)).filter(v=>v>0);put(m,el,r.length?Math.max(...r):UTIL_DEF)}
    if(wa){const pm=D.months[ymS(n-1)],prev=pm?pm.v[wa.id]:null;let last=null;for(let i=1;i<=6&&last==null;i++){const v=real(ymS(n-i),wa);if(v>0)last=v}
      put(m,wa,prev>0?0:(last||UTIL_DEF))}});
  return ch}
/* 決まった月に払うもの（固定資産税など）：その月に予定の額を自動で入れる。手で入れた額は上書きしない */
function planSeed(){if(D.settings.planSeeded)return false;D.settings.planSeeded=true;if(!D.items.some(x=>/固定資産税/.test(x.label))){const it={id:uid(),group:'rent',label:'固定資産税',carry:false,day:0,plan:{amt:42000,m:[4,7,12,2]}};D.items.push(it);months().forEach(k=>D.months[k].v[it.id]=null)}return true}
function planFill(){const now=nowYM();let ch=false;D.items.filter(x=>x.plan).forEach(it=>{months().filter(ym=>ym>=now).forEach(ym=>{const m=D.months[ym];m.src=m.src||{};const want=it.plan.m.includes(+ym.slice(5))?it.plan.amt:null;
  if((m.v[it.id]==null||m.src[it.id]==='plan')&&m.v[it.id]!==want){m.v[it.id]=want;if(want==null)delete m.src[it.id];else m.src[it.id]='plan';ch=true}})});return ch}
function render(){if(!app)return;D=S&&S.kb;if(!D){app.innerHTML=vSetup();return}
  if(planSeed()|txEst()|utilEst()|planFill())save();
  const ms=months();if(!cur||!D.months[cur])cur=ms.includes(nowYM())?nowYM():ms[ms.length-1]||null;
  const head=`<div class="kbhead"><h2>📒 月の家計簿</h2><button class="btn" data-act="edit">${edit?'完了':'✎ 項目を編集'}</button></div>`;
  const chips=`<div class="chips">${ms.map(k=>`<button class="chip ${k===cur?'on':''}" data-m="${k}">${+k.slice(0,4)!==new Date().getFullYear()?k.slice(2,4)+'年':''}${mo(k)}月</button>`).join('')}<button class="chip" data-act="addMonth">＋ ${ms.length?'次の月':'月を作る'}</button>${ms.length>1?'<button class="chip cmpb" data-act="cmp">📋 月を並べて比べる</button>':''}</div>`;
  if(!cur){app.innerHTML=`${head}${chips}<div class="card"><p>まだ月がありません。「＋ 月を作る」から始めてください。</p></div><div class="card"><h2>家計簿の設定</h2>${vData()}</div>`;return}
  const m=D.months[cur];
  const gopt=it=>GROUPS.map(g=>`<option value="${g}" ${g===it.group?'selected':''}>${GNAME[g]}</option>`).join('');
  const item=it=>edit?`<div class="r ed"><div class="n"><input class="lab" data-item="${it.id}" type="text" maxlength="40" value="${esc(it.label)}" aria-label="項目の名前">
      <div class="ctl"><button class="mini" data-mv="${it.id}" data-d="-1" aria-label="上へ">↑</button><button class="mini" data-mv="${it.id}" data-d="1" aria-label="下へ">↓</button><select data-grp="${it.id}" aria-label="グループ">${gopt(it)}</select><label class="cy">毎月<input class="day" data-day="${it.id}" type="text" inputmode="numeric" maxlength="2" value="${it.day||''}" placeholder="-">日</label><label class="cy"><input type="checkbox" data-carry="${it.id}" ${it.carry?'checked':''}>次の月へ</label></div></div>
      <input id="i_${it.id}" data-k="${it.id}" type="text" inputmode="numeric" autocomplete="off" value="${fmt(m.v[it.id])}" placeholder="0" aria-label="${esc(it.label)}"><button class="x" data-del="${it.id}" aria-label="${esc(it.label)}を消す">✕</button></div>`
    :`<div class="r"><label for="i_${it.id}">${esc(it.label)}${it.day?`<small>毎月 ${it.day}日</small>`:''}${m.src&&m.src[it.id]==='mail'?'<small class="mailtag">📧 メールから</small>':m.src&&m.src[it.id]==='plan'?`<small class="mailtag plan">📅 予定（${it.plan?it.plan.m.join('・')+'月':''}）</small>`:m.src&&m.src[it.id]==='est'?`<small class="mailtag est">${cardIt('rakuten')===it?'≈ 利用の合計（見込み）':'≈ 見込み（多めに入れています）'}</small>`:''}${CARDS.filter(c=>cardIt(c.k)===it&&bills[c.k]&&bills[c.k].ym===cur&&billMismatch(c.k)).map(c=>`<button class="prevb noprint" data-mailfix="${c.k}">メールでは ${fmt(bills[c.k].amount)}。こちらにする</button>`).join('')}<small data-diff="${it.id}">${diffHtml(it)}</small>${(()=>{const p=prevM();return m.v[it.id]==null&&p&&p.v[it.id]?`<button class="prevb noprint" data-prev="${it.id}">先月の ${fmt(p.v[it.id])} を入れる</button>`:''})()}</label><input id="i_${it.id}" data-k="${it.id}" type="text" inputmode="numeric" autocomplete="off" value="${fmt(m.v[it.id])}" placeholder="0"></div>`;
  const list=g=>G(g).map(item).join('')+`<div><button class="add noprint" data-add="${g}">＋ 項目を足す</button></div>`;
  const out=k=>`<div class="r c${edit?' ed':''}" data-row="${k}">${edit?`<div class="n">${T('c_'+k)}${T('f_'+k,1)}</div>`:`<label for="o_${k}"><b>${T('c_'+k)}</b><span class="tagm">手入力</span><small>＝ ${T('f_'+k)}</small></label>`}<button class="rst noprint" data-rst="${k}" hidden>式に戻す</button><input id="o_${k}" data-ov="${k}" type="text" inputmode="numeric" autocomplete="off"></div>`;
  const F=(k,sum,title,body,cls='')=>`<details class="card kbg ${cls}" data-fold="${k}" ${edit||fold[k]?'open':''}><summary><span class="gt">${title}</span><span class="gs">${sum}</span></summary><div class="gb">${body}</div></details>`;
  const cnt=g=>`<small class="gc">${G(g).length}件</small>`;
  const pm=prevM(),pc=pm?calc(pm):null,mS=mm=>G('memo').reduce((t,x)=>t+(mm.v[x.id]||0),0);
  app.innerHTML=`${head}${chips}
  <div class="kbcols"><div class="kbl">
  <div class="card hero"><h2>${mo(cur)}月　${T('hero')}</h2><div class="big amt" data-o="draw"></div><div class="pills" id="dyn-pills"></div></div>
  <div id="dyn-billwait">${billWaitHtml()}</div>
  <details class="card kbadv" data-fold="adv" id="dyn-advwrap" ${fold.adv?'open':''} hidden><summary id="dyn-advsum"></summary><div id="dyn-alert"></div><div id="dyn-advice"></div></details>
  <div class="card" id="dyn-flow"></div>
  <div class="card" id="dyn-line"></div>
  <div class="card" id="dyn-sim"></div>
  <div class="card" id="dyn-tasks"></div>
  </div><div class="kbr">
  <p class="hint noprint kbhint">${edit?'点線の枠の文字を直せます。↑↓で並べ替え、グループを変えると入る式が変わります。「毎月◯日」は引き落とし日です。✕で消しても、すぐ出る「元に戻す」で取り消せます。終わったら右上の「完了」を押してください。':'押すと開いて直せます。▲▼は先月との差です。灰色の行は式で自動計算されます（数字を押すと手で直すこともできます）。「172205+3190」のような足し算もできます。'}</p>
  ${F('income',`<span data-o="dincome"></span><b class="amt" data-o="income"></b>`,`${T('h_1')}${cnt('income')}`,`${list('income')}${G('income').length>1?`<div class="r c sumrow"><div class="n"><b>${T('c_income')}</b></div><b class="amt" data-o="income"></b></div>`:''}`)}
  ${F('keep',`<span data-o="dkeep"></span><b class="amt" data-o="keepS"></b>`,`${T('h_2')}${cnt('keep')}`,`${list('keep')}${out('keep')}${out('draw')}`)}
  ${F('rent',`<span data-o="djaIn"></span><small>${esc(L('c_jaIn'))}</small> <b class="amt" data-o="jaInS"></b>`,`${T('h_3')}${cnt('rent')}`,`${list('rent')}${out('rent')}
    <div class="r${edit?' ed':''}">${edit?`<div class="n">${T('jaBal')}</div>`:`<label for="i_jaBal">${T('jaBal')}<small>いま口座にある額</small></label>`}<input id="i_jaBal" data-k="jaBal" type="text" inputmode="numeric" autocomplete="off" value="${fmt(m.jaBal)}" placeholder="0"></div>
    ${out('short')}${out('jaIn')}`)}
  ${F('other',`<span data-o="dother"></span><b class="amt" data-o="otherS"></b>`,`${T('h_4')}${cnt('other')}`,`${list('other')}${out('total')}${out('left')}`)}
  ${F('memo',`<b class="amt" data-o="memoS"></b>`,`${T('h_5')}${cnt('memo')}`,`${list('memo')}<div class="r"><input class="memo" id="memo" type="text" maxlength="200" placeholder="ひとことメモ" value="${esc(m.memo)}" aria-label="メモ"></div>`,'memo')}
  <div class="kbmore">
  <details class="card kbf" data-fold="cmp" id="kbcmp" ${fold.cmp?'open':''}><summary>📋 月を並べて比べる</summary><div id="dyn-cmp"></div></details>
  <details class="card kbf" data-fold="outlook" ${fold.outlook?'open':''}><summary>📊 月ごとの残りと累計</summary><div id="dyn-outlook"></div></details>
  <details class="card kbf" data-fold="set" ${fold.set?'open':''}><summary>⚙️ 家計簿の設定</summary>${vData()}</details>
  </div></div></div>`;
  update();billSync();
  if(focusId){const el=app.querySelector(`[data-item="${focusId}"]`);focusId=null;if(el){el.focus();el.select()}}}

function vPlans(){const ps=D.items.filter(x=>x.plan);return`<div class="r plans"><div class="n"><b>決まった月に払うもの</b><small>固定資産税・自動車税・保険など。その月に予定の額が自動で入ります</small>${ps.map(it=>`<div class="pl"><span>${esc(it.label)}<small>${GNAME[it.group]}・${it.plan.m.join('・')}月・${yen(it.plan.amt)}</small></span><button class="btn s" data-act="planEdit" data-id="${it.id}">変更</button></div>`).join('')}<button class="add noprint" data-act="planAdd">＋ 追加</button></div></div>`}
function vData(){const st=D.settings;return`<div class="kbset">${vPlans()}
  <div class="r"><div class="n"><b>ボーナス</b><small>${st.bonusAmt&&st.bonusMonths.length?`${st.bonusMonths.join('月・')}月に ${yen(st.bonusAmt)} ずつ`:'未設定'}</small></div><button class="btn" data-act="bonus">変更</button></div>
  <div class="r"><div class="n"><b>クッション</b><small>${st.cushion?`引き落とし口座に いつも ${yen(st.cushion)} を残す`:'未設定。少し足りない月でも引き落としが止まらないよう、口座に残しておく額'}</small></div><button class="btn" data-act="cushion">変更</button></div>
  ${CARDS.map(c=>{const it=cardIt(c.k),on=!(st.cardAuto&&st.cardAuto[c.k]===false);return`<div class="r cardrow"><div class="n"><b>${c.n}をメールから入れる</b><small id="bst_${c.k}">${billStText(c.k)}</small>${on&&c.util?`<small>入れる先：電気代・水道代（見込みを多めに自動で入れています。確定したら明細の金額に直せます）</small>`:on?`<label class="cy cardsel">入れる項目 <select data-carditem="${c.k}" aria-label="${c.n}の金額を入れる項目">${D.items.filter(x=>x.group!=='memo'&&x.group!=='income').map(x=>`<option value="${x.id}" ${it===x?'selected':''}>${esc(x.label)}</option>`).join('')}${it?'':'<option selected value="">（選ぶ）</option>'}</select></label>`:''}</div><button class="btn" data-act="cardToggle" data-k="${c.k}">${on?'オフにする':'オンにする'}</button></div>`}).join('')}
  ${CLOUD&&CARDS.some(c=>!(st.cardAuto&&st.cardAuto[c.k]===false))?'<div class="btns" style="margin:-2px 0 6px"><button class="btn s" data-act="billNow">いま確かめる</button></div>':''}
  <div class="r"><div class="n"><b>支払い日の目安</b><small>毎月 ${st.payDay}日。項目に引き落とし日を入れていないとき、この日の1週間前からお知らせします</small></div><button class="btn" data-act="payDay">変更</button></div>
  ${cur?'<div class="btns" style="margin-top:12px"><button class="btn w" data-act="delMonth">この月を消す</button></div>':''}
  <p class="hint" style="margin-top:8px">保存・パスコード・バックアップは「ひと呼吸」と共通です（⚙️ から）。</p></div>`}

function update(){const m=D.months[cur];if(!m)return;const c=calc(m),set=(k,t)=>app.querySelectorAll(`[data-o="${k}"]`).forEach(e=>{e.textContent=t});
  OV.forEach(k=>{const el=app.querySelector('#o_'+k),ov=m.ov[k]!=null;if(!el)return;el.closest('.r').classList.toggle('ovr',ov);app.querySelector(`[data-rst="${k}"]`).hidden=!ov;if(document.activeElement!==el)el.value=fmt(c[k]);el.classList.toggle('neg',c[k]<0);el.classList.toggle('pos',c[k]>0&&(k==='left'||k==='short'))});
  set('draw',yen(c.draw));set('income',yen(c.income));set('keepS',yen(c.keep));set('jaInS',yen(c.jaIn));set('otherS',yen(c.other));set('memoS',yen(G('memo').reduce((t,x)=>t+(m.v[x.id]||0),0)));
  const pm=prevM(),pc=pm?calc(pm):null,dset=(k,h)=>app.querySelectorAll(`[data-o="${k}"]`).forEach(e=>{e.innerHTML=h});
  dset('dincome',gDiff('income',c.income,pc&&pc.income,'up'));dset('dkeep',gDiff('keep',c.keep,pc&&pc.keep));dset('djaIn',gDiff('jaIn',c.jaIn,pc&&pc.jaIn));dset('dother',gDiff('other',c.other,pc&&pc.other));
  const pa=payAlert(),pl=app.querySelector('#dyn-pills');
  if(pl)pl.innerHTML=`<span class="pill ${c.left<0?'r':'g'}">${c.left<0?yen(-c.left)+' 足りない':yen(c.left)+' 残る'}</span>${pc&&pc.left!==c.left?`<span class="pill ${c.left<pc.left?'y':'g'}">先月より ${yen(Math.abs(c.left-pc.left))} ${c.left<pc.left?'悪化':'改善'}</span>`:''}${pa?`<span class="pill y">${pa.d}日の引き落とし${pa.inDays?'まであと'+pa.inDays+'日':'は今日'}</span>`:''}${D.settings.cushion?`<span class="pill w">クッション ${yen(D.settings.cushion)} を残すなら ${yen(Math.max(0,c.draw-D.settings.cushion))}</span>`:''}`;
  const aw=app.querySelector('#dyn-advwrap');if(aw){const sh=c.left<0||c.draw<0;aw.hidden=!(sh||pa);aw.classList.toggle('ok',!sh);app.querySelector('#dyn-advsum').textContent=sh?'足りないときの手を見る':'引き落とし前の確認を見る'}
  const fw=app.querySelector('#dyn-flow');if(fw){const on2=names('other'),segs=[[L('c_keep'),c.keep,'s1'],[L('c_jaIn'),c.jaIn,'s2'],[on2.length?on2.join('・'):L('h_4'),c.other,'s3']],base=Math.max(c.income,c.total,1),pc=v=>(Math.max(0,v)/base*100).toFixed(1);
    fw.innerHTML=`<h2>お金の流れ</h2><div class="fr"><span>${esc(G('income').length>1?L('c_income'):L('h_1'))}</span><b class="amt">${yen(c.income)}</b></div><div class="fbar"><span class="inc" style="width:${pc(c.income)}%"></span></div><div class="fbar">${segs.map(x=>`<i class="${x[2]}" style="width:${pc(x[1])}%"></i>`).join('')}</div>${segs.map(x=>`<div class="fr s"><span><i class="dot ${x[2]}"></i>${esc(x[0])}</span><span class="amt">${yen(x[1])}</span></div>`).join('')}<div class="fr tot"><b>${esc(L('c_left'))}</b><b class="amt ${c.left<0?'neg':''}">${c.left<0?'−':''}${yen(Math.abs(c.left))}</b></div>`}
  const on=names('other');
  const cu=D.settings.cushion;
  if(0)set('heroNote',`${cu?`クッション ${yen(cu)} を口座に残すなら、引き出すのは ${yen(Math.max(0,c.draw-cu))}。`:''}ここから ${L('c_jaIn')} ${yen(c.jaIn)}${on.length?` と${on.join('・')} ${yen(c.other)}（合わせて ${yen(c.jaIn+c.other)}）`:''} を出すと、${c.left<0?yen(-c.left)+' 足りません':yen(c.left)+' 残ります'}。`);
  D.items.forEach(it=>{const e=app.querySelector(`[data-diff="${it.id}"]`);if(e)e.innerHTML=diffHtml(it)});
  /* 支払いの1週間前のお知らせ */
  const al=app.querySelector('#dyn-alert');if(al){const a=payAlert();al.innerHTML=a?`<div class="card alert"><b>${a.inDays?`あと ${a.inDays}日`:'今日'}（${a.d}日）は${a.names.length?esc(a.names.join('・'))+'の':''}引き落とし日です</b><p>${a.gs.map(g=>g==='keep'?`引き落とし口座に ${A(a.c.keep+D.settings.cushion)}（${esc(L('c_keep'))}${D.settings.cushion?` ＋ クッション ${yen(D.settings.cushion)}`:''}）`:`JA口座に ${A(a.c.rent)}（${esc(L('c_rent'))}。${esc(L('c_jaIn'))} ${A(a.c.jaIn)} が必要）`).join('、')}が入っているか確かめてください。${a.c.left<0?`今月は ${A(-a.c.left,'neg')} 足りない見込みです。`:''}</p>${a.ym!==cur?`<button class="linkb" data-m="${a.ym}">${mo(a.ym)}月を開く</button>`:''}</div>`:''}
  const ln=app.querySelector('#dyn-line');if(ln){const h=flowLine(m,c);ln.innerHTML=`<h2>引き落としの流れ</h2>${h||`<p class="hint">項目に「毎月◯日」を入れると、給料日から引き落としまでの口座の動きがここに並びます。</p><button class="btn s" data-act="edit">✎ 日にちを入れる</button>`}`}
  const sm=app.querySelector('#dyn-sim');if(sm){const cand=D.items.filter(x=>['keep','rent','other'].includes(x.group)&&(m.v[x.id]||0)>0);if(!cand.find(x=>x.id===sim.id)){const pr={keep:0,other:1,rent:2};sim.id=(cand.slice().sort((a,b)=>pr[a.group]-pr[b.group]||(m.v[b.id]||0)-(m.v[a.id]||0))[0]||{}).id||'';sim.v=0}
    if(!cand.length)sm.hidden=true;else{sm.hidden=false;const it=D.items.find(x=>x.id===sim.id),mx=m.v[it.id]||0,v=Math.min(sim.v,mx),res=calc({...m,v:{...m.v,[it.id]:mx-v}}).left;
      if(!sm.querySelector('#simr'))sm.innerHTML=`<h2>ここを減らすと <span class="sub">試すだけ・保存しません</span></h2><div class="simrow"><select id="sims" data-sim="id" aria-label="減らす項目">${cand.map(x=>`<option value="${x.id}" ${x.id===sim.id?'selected':''}>${esc(x.label)}</option>`).join('')}</select><span class="amt" id="simv"></span></div><input type="range" id="simr" data-sim="v" min="0" step="1000" aria-label="減らす額"><p id="simo"></p>`;
      const r=sm.querySelector('#simr');r.max=mx;if(document.activeElement!==r)r.value=v;sm.querySelector('#simv').textContent='−'+yen(v).replace('−','');
      sm.querySelector('#simo').innerHTML=v?`${esc(it.label)}を ${yen(v)} 減らすと、残りは ${A(res,res<0?'neg':'pos')}${res<0?`（まだ ${yen(-res)} 足りない）`:'。足ります'}`:`バーを右に動かすと、${esc(it.label)}（${yen(mx)}）を減らしたときの残りがわかります。`}}
  const cp=app.querySelector('#dyn-cmp');if(cp){const ks=months().slice(-6),rowsC=[['income',L('h_1')],['keep',L('c_keep')],['draw',L('c_draw')],['rent',L('c_rent')],['jaIn',L('c_jaIn')],['other',L('h_4')],['total',L('c_total')],['left',L('c_left')]],cs=ks.map(k=>calc(D.months[k]));
    cp.innerHTML=ks.length<2?'<p class="hint">2か月以上あると、並べて比べられます。</p>':`<div class="cmpw"><table class="cmp"><thead><tr><th></th>${ks.map(k=>`<th class="${k===cur?'cur':''}"><button class="linkb" data-m="${k}">${mo(k)}月</button></th>`).join('')}</tr></thead><tbody>${rowsC.map(([k,l])=>`<tr class="${k==='left'||k==='draw'?'em':''}"><th>${esc(l)}</th>${cs.map((x,i)=>`<td class="${ks[i]===cur?'cur':''} ${x[k]<0?'neg':''}">${fmt(x[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="hint">いちばん右の月までの最大6か月です。月の名前を押すとその月を開きます。</p>`}
  /* 足りないときの手 */
  const ad=app.querySelector('#dyn-advice');if(ad){const h=adviceHtml(m,c);ad.hidden=!h;ad.innerHTML=h}
  /* やること */
  const ts=tasks(m,c),nd=ts.filter(t=>m.done[t.k]).length,tk=app.querySelector('#dyn-tasks');
  if(tk)tk.innerHTML=`<h2>${mo(cur)}月のやること <span class="sub">${nd} / ${ts.length}</span></h2><div class="steps">${ts.map(t=>`<button class="step ${m.done[t.k]?'on':''}" data-done="${t.k}" aria-pressed="${!!m.done[t.k]}" aria-label="${esc(t.label)}"><span class="chk ${m.done[t.k]?'on':''}">✓</span><b>${esc(t.s)}</b><span class="amt">${yen(t.amt)}</span><small>${m.done[t.k]?`${+m.done[t.k].slice(5,7)}/${+m.done[t.k].slice(8)} 済み`:'まだ'}</small></button>`).join('')}</div>`;
  /* 見通し：12か月の帯と、ボーナスまでの累計 */
  const ol=app.querySelector('#dyn-outlook');if(ol){const rows=cumTable(),R=rows.slice(-12),mx=Math.max(1,...R.map(r=>Math.abs(r.left))),st=D.settings,me=rows.find(r=>r.ym===cur);
    let line=`${mo(cur)}月までの残りの累計は ${A(me.cum,sgn(me.cum))}${st.bonusAmt?'（ボーナス込み）':''}。`;
    const nb=nextBonus(cur);if(nb){let before=me.cum,miss=0;for(let n=ymN(cur)+1;n<ymN(nb);n++){const x=D.months[ymS(n)];if(x)before+=calc(x).left;else miss++}const after=before+st.bonusAmt;
      line+=`<br>次のボーナス（${mo(nb)}月）の前までで ${A(before,sgn(before))}${miss?`<span class="hint">（記録のない${miss}か月は0として）</span>`:''}。ボーナス ${A(st.bonusAmt)} が入ると ${A(after,sgn(after))}${after<0?' <span class="tag r">ボーナスでも埋まりません</span>':' <span class="tag g">ボーナスで埋まります</span>'}`}
    else if(!st.bonusAmt)line+=` <button class="linkb" data-act="bonus">ボーナスを設定すると、ボーナスまでの見通しが出ます</button>`;
    if(st.bonusAmt&&st.bonusMonths.length){const per=Math.round(st.bonusAmt*st.bonusMonths.length/12),cl=calc(m).left,with_=cl+per;line+=`<div class="bm"><b>ボーナスを月割りにすると</b>年 ${yen(st.bonusAmt*st.bonusMonths.length)} ÷ 12 ＝ 毎月 ${A(per,'pos')}。${mo(cur)}月の残り ${A(cl,sgn(cl))} に足すと ${A(with_,sgn(with_))}${with_>=0?' <span class="tag g">ボーナスの範囲で暮らせています</span>':` <span class="tag r">毎月 ${yen(-with_)} 減らすと、ボーナスで穴埋めしなくて済みます</span>`}</div>`}
    ol.innerHTML=`<div class="ych">${R.map(r=>{const h=r.rec?Math.max(r.left?3:0,Math.round(Math.abs(r.left)/mx*54)):0;return`<button class="col ${r.ym===cur?'cur':''}" ${r.rec?`data-m="${r.ym}"`:'disabled'} aria-label="${mo(r.ym)}月 残り ${yen(r.left)}"><span class="up">${r.left>0?`<i style="height:${h}px;background:var(--accent)"></i>`:''}</span><span class="dn">${r.left<0?`<i style="height:${h}px;background:var(--red)"></i>`:''}</span><span class="lb">${r.bonus?'<b>○</b>':''}${mo(r.ym)}</span></button>`}).join('')}</div>
      <p style="margin-top:10px;font-size:14px">${line}</p>
      <details class="tbl"><summary>月ごとの表を見る</summary>${rows.map(r=>`<div class="r"><div class="n"><b>${mo(r.ym)}月</b><small>${r.rec?'残り '+yen(r.left):'記録なし'}${r.bonus?' ・ ボーナス '+yen(r.bonus):''}</small></div><span class="amt ${sgn(r.cum)}">累計 ${yen(r.cum)}</span></div>`).join('')}</details>`}
  /* 引き落とし日の順 */
  const od=app.querySelector('#dyn-order');if(od){const its=D.items.filter(x=>x.day).sort((a,b)=>a.day-b.day||D.items.indexOf(a)-D.items.indexOf(b));
    od.innerHTML=`${its.length?its.map(it=>{const v=m.v[it.id]||0;return`<div class="r"><div class="n"><b>${it.day}日　${esc(it.label)}</b><small>${GNAME[it.group]}</small></div>${A(it.group==='income'?v:-v,it.group==='income'?'pos':'')}</div>`}).join(''):'<p class="hint">「✎ 項目を編集」で各項目に「毎月◯日」を入れると、お金が動く順にここへ並びます。</p>'}`}}

/* ---------- 操作 ---------- */
function newMonth(k){const ms=months(),last=ms.filter(x=>x<k).pop(),r={memo:'',v:{},ov:{},done:{},jaBal:null};OV.forEach(f=>r.ov[f]=null);D.items.forEach(it=>r.v[it.id]=last&&it.carry&&!(it.group==='rent'&&/電気|水道/.test(it.label))?D.months[last].v[it.id]:null);D.months[k]=r;return!!last}
function migrate(o){if(!o||typeof o!=='object')return toast('データの形式が違います');if(o.app==='hitokokyu')return toast('これは「ひと呼吸」のバックアップです');
  const apply=raw=>{let d;try{d=sanitize(raw)}catch(e){return toast('月の家計簿のデータではありません')}withUndo('家計簿を移しました',()=>{S.kb=d;cur=null})};
  if(o.enc){if(!hasCrypto)return toast('この開き方では暗号化されたデータを開けません');openForm('月の家計簿のパスコード',[{k:'p',label:'月の家計簿で使っていたパスコード',type:'password',req:1}],v=>{decRaw(o,v.p).then(apply).catch(()=>toast('パスコードが違うか、データが壊れています'))},{ok:'開く',user:'月の家計簿'})}
  else apply(o)}
const PG={'口座に残すもの（引き落とし口座）':'keep','JA口座（家の支払い）':'rent','そのほか':'other'};
function planForm(it){const gname=g=>Object.keys(PG).find(k=>PG[k]===g)||Object.keys(PG)[1];
  window.openForm(it?`${it.label}（決まった月に払うもの）`:'決まった月に払うものを足す',[{k:'n',label:'名前',value:it?it.label:'',ph:'自動車税'},{k:'a',label:'1回の金額（円）',type:'number',value:it?it.plan.amt:''},{k:'m',label:'払う月（「,」で区切る）',value:it?it.plan.m.join(','):'',ph:'4,7,12,2'},{k:'g',label:'どの口座から',type:'select',options:Object.keys(PG),value:gname(it?it.group:'rent')},...(it?[{k:'x',label:'決まった月に払うものから外す（項目は残す）',type:'check',value:false}]:[])],v=>{
    const amt=clamp(Math.round(Number(v.a)||0),0,1e8),ms=[...new Set(String(v.m||'').normalize('NFKC').split(/[^0-9]+/).filter(Boolean).map(Number).filter(n=>n>=1&&n<=12))].sort((a,b)=>a-b);
    if(v.x&&it){delete it.plan;months().forEach(k=>{const m=D.months[k];if(m.src&&m.src[it.id]==='plan'){m.v[it.id]=null;delete m.src[it.id]}});save();render();return}
    if(!amt||!ms.length){toast('金額と月を入れてください');return false}
    const label=String(v.n||'').trim().slice(0,40)||'決まった支払い';
    if(!it){it={id:uid(),group:PG[v.g]||'rent',label,carry:false,day:0};D.items.push(it);months().forEach(k=>D.months[k].v[it.id]=null)}
    it.label=label;it.group=PG[v.g]||it.group;it.plan={amt,m:ms};save();render();toast(`${label}：${ms.join('・')}月に ${yen(amt)} を入れます`)},{desc:'この月の家計簿に、自動で金額が入ります。払う月の前の週に、引き落としのお知らせにも出ます。'})}
const acts={
  edit:()=>{edit=!edit;render()},
  planAdd:()=>planForm(null),
  planEdit:d=>planForm(D.items.find(x=>x.id===d.id)),
  cardToggle:d=>{const ca=D.settings.cardAuto=D.settings.cardAuto||{};ca[d.k]=ca[d.k]===false;save();render();if(ca[d.k])billSync(true)},
  billNow:()=>{CARDS.forEach(c=>{const e=app.querySelector('#bst_'+c.k);if(e)e.textContent='確かめています…'});billSync(true)},
  cmp:()=>{fold.cmp=1;const d=app.querySelector('#kbcmp');if(d){d.open=true;d.scrollIntoView({behavior:'smooth',block:'start'})}},
  addMonth:()=>{const ms=months(),k=ms.length?ymS(ymN(ms[ms.length-1])+1):nowYM(),c=newMonth(k);cur=k;save();render();toast(c?'毎月同じ項目を引き継ぎました':'月を作りました')},
  delMonth:(d,t)=>{if(!t.dataset.sure){t.dataset.sure='1';t.textContent='もう一度押すと消えます';setTimeout(()=>{if(t.isConnected){delete t.dataset.sure;t.textContent='この月を消す'}},4000);return}const k=cur;withUndo(`${mo(k)}月を消しました`,()=>{delete D.months[k];cur=null})},
  bonus:()=>openForm('ボーナス',[{k:'a',label:'1回あたりの金額（円）',type:'number',value:D.settings.bonusAmt||''},{k:'m',label:'入る月（「,」で区切る）',value:D.settings.bonusMonths.join(','),ph:'1,7'}],v=>{D.settings.bonusAmt=clamp(v.a,0,1e9);D.settings.bonusMonths=[...new Set(String(v.m).normalize('NFKC').split(/[^0-9]+/).filter(Boolean).map(Number).filter(x=>x>=1&&x<=12))].sort((a,b)=>a-b);save();render()},{desc:'ボーナスの月に、この額を累計へ足します。0にすると見通しから外れます。'}),
  cushion:()=>openForm('クッション',[{k:'v',label:'引き落とし口座にいつも残しておく額（円）',type:'number',value:D.settings.cushion||''}],v=>{D.settings.cushion=clamp(v.v,0,1e8);save();render()},{desc:'5万円など、決めた額を口座から引き出さずに残しておきます。0にすると表示を消します。'}),
  payDay:()=>openForm('支払い日の目安',[{k:'v',label:'毎月何日か（1〜31）',type:'number',value:D.settings.payDay}],v=>{D.settings.payDay=clamp(Math.round(v.v)||25,1,31);save();render()},{desc:'カードやローンの引き落とし日のうち、いちばん早い日がおすすめです。'}),
  fromDrive:()=>{gsr('loadBlob','k').then(r=>{let o=null;try{o=r&&r.text?JSON.parse(r.text):null}catch(e){}if(o)migrate(o);else toast('ドライブに月の家計簿のデータが見つかりませんでした。ファイルから移してください')}).catch(()=>toast('ドライブから読み込めませんでした'))},
  fromFile:()=>{const i=document.createElement('input');i.type='file';i.accept='.json,application/json';i.onchange=()=>{const f=i.files[0];if(!f||f.size>2e6)return toast('読み込めませんでした');const r=new FileReader();r.onload=()=>{let o;try{o=JSON.parse(String(r.result))}catch(e){return toast('データの形式が違います')}migrate(o)};r.readAsText(f)};i.click()},
  startBlank:()=>withUndo('家計簿を始めました',()=>{S.kb=blank();cur=null})
};
/* 家計簿タブの中の操作だけを受け持ち、ひと呼吸の操作とは混ぜない */
const inKB=e=>e.target&&e.target.closest&&e.target.closest('#kb');
document.addEventListener('click',e=>{if(!inKB(e))return;e.stopImmediatePropagation();const t=e.target.closest('button');if(!t||t.disabled)return;const d=t.dataset;
  if(d.act&&acts[d.act]){acts[d.act](d,t);return}
  if(!D)return;
  if(d.m){cur=d.m;render();window.scrollTo(0,0);return}
  if(d.billok){seeBill(d.billok);renderBillSt();toast('お知らせを閉じました');return}
  if(d.billgo){const x=billWait().find(y=>y.c.k===d.billgo);if(!x)return;cur=x.ym;fold[x.it.group]=1;render();const el=app.querySelector('#i_'+x.it.id);if(el){el.scrollIntoView({block:'center'});el.focus();el.select()}return}
  if(d.mailfix){const it=cardIt(d.mailfix),m=D.months[cur],b=bills[d.mailfix];if(it&&b&&b.amount){m.v[it.id]=b.amount;m.src=m.src||{};m.src[it.id]='mail';save();render();toast('メールの金額にしました')}return}
  if(d.prev){const p=prevM(),m=D.months[cur];if(p&&p.v[d.prev]!=null){m.v[d.prev]=p.v[d.prev];save();render();toast('先月と同じ額を入れました')}return}
  if(d.rst){D.months[cur].ov[d.rst]=null;save();update();toast('式の計算に戻しました');return}
  if(d.done){const m=D.months[cur];if(m.done[d.done])delete m.done[d.done];else m.done[d.done]=today();save();update();return}
  if(d.add){if(D.items.length>=80)return toast('項目は80個までです');const it={id:uid(),group:d.add,label:'新しい項目',carry:false,day:0};D.items.push(it);months().forEach(k=>D.months[k].v[it.id]=null);edit=true;focusId=it.id;save();render();return}
  if(d.del){const it=D.items.find(x=>x.id===d.del);withUndo(`「${it?it.label:''}」を消しました`,()=>{D.items=D.items.filter(x=>x.id!==d.del);months().forEach(k=>{delete D.months[k].v[d.del];delete D.months[k].done['i:'+d.del]})});return}
  if(d.mv){const a=D.items,i=a.findIndex(x=>x.id===d.mv);if(i<0)return;let j=i+Number(d.d);while(j>=0&&j<a.length&&a[j].group!==a[i].group)j+=Number(d.d);if(j<0||j>=a.length)return;[a[i],a[j]]=[a[j],a[i]];save();render();const b=app.querySelector(`[data-mv="${d.mv}"][data-d="${d.d}"]`);if(b)b.focus();return}});
document.addEventListener('input',e=>{if(!inKB(e))return;e.stopImmediatePropagation();if(!D)return;const t=e.target,m=D.months[cur],d=t.dataset;if(!m)return;
  if(d.sim){if(d.sim==='id'){sim.id=t.value;sim.v=0}else sim.v=Number(t.value)||0;update();return}
  if(d.lab){const v=t.value.trim();if(v&&v!==dflt(d.lab))D.labels[d.lab]=v.slice(0,80);else delete D.labels[d.lab];save();return}
  if(d.item){const it=D.items.find(x=>x.id===d.item);if(it){it.label=t.value.trim().slice(0,40)||'項目';save()}return}
  if(d.carry){const it=D.items.find(x=>x.id===d.carry);if(it){it.carry=t.checked;save()}return}
  if(d.day){const it=D.items.find(x=>x.id===d.day);if(it){it.day=clamp(parseInt(t.value.normalize('NFKC'),10)||0,0,31);save();update()}return}
  if(t.id==='memo')m.memo=t.value.slice(0,200);else if(d.k==='jaBal')m.jaBal=toNum(t.value);else if(d.k){m.v[d.k]=toNum(t.value);CARDS.forEach(c=>{const it=cardIt(c.k),b=bills[c.k];if(it&&it.id===d.k&&b&&isConfirm(b)&&b.mailAt.slice(0,7)===cur&&t.value.trim()){seeBill(c.k);const bw=app.querySelector('#dyn-billwait');if(bw)bw.innerHTML=billWaitHtml()}});if(m.src&&m.src[d.k]){delete m.src[d.k];const tg=t.closest('.r')&&t.closest('.r').querySelector('.mailtag');if(tg)tg.remove()}}else if(d.ov)m.ov[d.ov]=toNum(t.value);else return;
  save();update()});
document.addEventListener('change',e=>{if(!inKB(e))return;e.stopImmediatePropagation();const t=e.target;if(D&&t.dataset&&t.dataset.carditem){D.settings.cardItem=D.settings.cardItem||{};D.settings.cardItem[t.dataset.carditem]=t.value;save();render();CARDS.forEach(c=>billApply(c.k));return}if(D&&t.dataset&&t.dataset.grp){const it=D.items.find(x=>x.id===t.dataset.grp);if(it&&GROUPS.includes(t.value)){it.group=t.value;save();render();toast(`「${it.label}」を${GNAME[it.group]}に移しました`)}}});
document.addEventListener('focusout',e=>{if(!inKB(e)||!D)return;const t=e.target,d=t.dataset||{};if(d.k)t.value=fmt(toNum(t.value));else if(d.ov)setTimeout(update,0);else if(d.day)t.value=(D.items.find(x=>x.id===d.day)||{}).day||''});
document.addEventListener('focusin',e=>{if(!inKB(e))return;const t=e.target;if(t.dataset&&t.dataset.ov)t.select()});
/* 外から使うもの：画面に出す、読み込み時の検査、支払い前のお知らせ */
document.addEventListener('toggle',e=>{const t=e.target;if(!t.dataset||!t.dataset.fold||!t.closest('#kb')||edit)return;if(t.open)fold[t.dataset.fold]=1;else delete fold[t.dataset.fold]},true);
function mount(el){app=el;render()}
function alertInfo(){D=S&&S.kb;if(!D)return null;try{return payAlert()}catch(e){return null}}
return{mount,sanitize,alertInfo,yen};
})();

/* ---------- データの形と検査（読み込み時は必ず通す） ---------- */
function blank(){return{v:2,
  settings:{threshold:3000,lockHours:48,mercariStart:today(),mercariFee:10,mercariLock:50,familyUnit:5000,familyLabel:'家族のお出かけ',autoLockMin:3,bonusYear:0,bonusMonths:[],reviewDay:25,budget:0,balance:null,balanceAt:'',merpayDay:31,goalName:'',goalAmount:0,saveMonthly:0,life:null},
  months:[],wishes:[],mercari:{purchases:[],sales:[]},purchases:[],subs:[],funds:[],reviews:[],flows:[],letgo:[],
  quick:[{key:'coffee',icon:'☕',label:'コンビニコーヒー',amount:180,pace:4},{key:'conv',icon:'🏪',label:'コンビニ',amount:500,pace:0},{key:'cafe',icon:'🥤',label:'カフェ',amount:600,pace:0},{key:'sauna',icon:'♨️',label:'サウナ',amount:1000,pace:3},{key:'home',icon:'🏠',label:'家サウナ',amount:0,pace:0},{key:'meal',icon:'🍚',label:'外食',amount:1000,pace:0}],
  logs:[],kb:null,daily:{},weeks:[],cardTx:[],merchantMap:{}}}
const str=(v,max=200)=>typeof v==='string'?v.slice(0,max):'';
const num=(v,d=0)=>{const n=Number(v);return Number.isFinite(n)?n:d};
const arr=v=>Array.isArray(v)?v.slice(0,5000):[];
const dstr=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)?v:today();
const rows=v=>arr(v).map(x=>({id:str(x&&x.id,40)||uid(),label:str(x&&x.label),amount:num(x&&x.amount),auto:['bill','bal'].includes(x&&x.auto)?x.auto:''}));
function sanitize(d){
  if(!d||typeof d!=='object'||Array.isArray(d))throw new Error('データの形式が違います');
  const b=blank(),s=d.settings||{};
  b.settings={threshold:clamp(num(s.threshold,3000),0,1e7),lockHours:clamp(num(s.lockHours,48),0,720),mercariStart:dstr(s.mercariStart),mercariFee:clamp(num(s.mercariFee,10),0,100),mercariLock:clamp(num(s.mercariLock,50),0,100),familyUnit:clamp(num(s.familyUnit,5000),1,1e7),familyLabel:str(s.familyLabel,30)||'家族のお出かけ',autoLockMin:clamp(num(s.autoLockMin,3),0,120),bonusYear:clamp(num(s.bonusYear,0),0,1e9),bonusMonths:[...new Set(arr(s.bonusMonths).map(x=>Math.round(num(x))).filter(x=>x>=1&&x<=12))].sort((a,b)=>a-b),reviewDay:clamp(Math.round(num(s.reviewDay,25)),1,28),budget:clamp(num(s.budget),0,1e8),balance:s.balance==null||!Number.isFinite(Number(s.balance))?null:clamp(Number(s.balance),-1e9,1e9),balanceAt:s.balanceAt?dstr(s.balanceAt):'',merpayDay:clamp(Math.round(num(s.merpayDay,31)),1,31),goalName:str(s.goalName,30),goalAmount:clamp(num(s.goalAmount),0,1e9),saveMonthly:clamp(num(s.saveMonthly),0,1e8),life:lifeClean(s.life),txAuto:s.txAuto!==false,txSince:/^\d{4}-\d{2}-\d{2}$/.test(s.txSince)?s.txSince:'',txFrom:/^\d{4}-\d{2}-\d{2}$/.test(s.txFrom)?s.txFrom:''};
  b.months=arr(d.months).filter(m=>m&&YM.test(m.month)).map(m=>({month:m.month,note:str(m.note,100),income:num(m.income),sheetExpense:num(m.sheetExpense),items:rows(m.items),hidden:rows(m.hidden),excluded:rows(m.excluded)}));
  b.wishes=arr(d.wishes).map(w=>({id:str(w.id,40)||uid(),item:str(w.item),price:num(w.price),category:WCATS.includes(w.category)?w.category:'その他',registeredAt:num(typeof w.registeredAt==='number'?w.registeredAt:Date.parse(w.registeredAt),Date.now()),lockHours:clamp(num(w.lockHours,48),0,720),note:str(w.note,300),answers:{q1:str(w.answers&&w.answers.q1,500),q2:str(w.answers&&w.answers.q2,500),q3:str(w.answers&&w.answers.q3,500)},status:['waiting','bought','passed'].includes(w.status)?w.status:'waiting',decidedAt:w.decidedAt?dstr(w.decidedAt):''}));
  const me=d.mercari||{};
  b.mercari.purchases=arr(me.purchases).map(x=>({id:str(x.id,40)||uid(),date:dstr(x.date),item:str(x.item),amount:num(x.amount),payment:str(x.payment,40)}));
  b.mercari.sales=arr(me.sales).map(x=>({id:str(x.id,40)||uid(),date:dstr(x.date),item:str(x.item),price:num(x.price)}));
  b.purchases=arr(d.purchases).map(x=>({id:str(x.id,40)||uid(),date:dstr(x.date),item:str(x.item),amount:num(x.amount),category:PCATS.includes(x.category)?x.category:'その他',sub:!!x.sub,cycle:clamp(num(x.cycle,1),1,12)}));
  b.subs=arr(d.subs).map(x=>({id:str(x.id,40)||uid(),name:str(x.name,80),amount:num(x.amount),status:SUBST.includes(x.status)?x.status:'継続',note:str(x.note,100),day:clamp(Math.round(num(x.day)),0,31)}));
  b.flows=arr(d.flows).map(x=>({id:str(x.id,40)||uid(),label:str(x.label,40),amount:clamp(num(x.amount),0,1e9),dir:x.dir==='in'?'in':'out',day:clamp(Math.round(num(x.day)),0,31)}));
  b.letgo=arr(d.letgo).map(x=>({id:str(x.id,40)||uid(),item:str(x.item,80),forItem:str(x.forItem,200),date:dstr(x.date),done:!!x.done}));
  b.funds=arr(d.funds).map(x=>({id:str(x.id,40)||uid(),name:str(x.name,40),target:clamp(num(x.target),0,1e9),saved:clamp(num(x.saved),0,1e9),due:YM.test(x.due)?x.due:nowYM(),cycle:CYC.some(c=>c[1]===x.cycle)?x.cycle:0,last:YM.test(x.last)?x.last:'',note:str(x.note,100)}));
  b.reviews=arr(d.reviews).filter(x=>x&&YM.test(x.month)).map(x=>{const k={},sn=x.snap&&typeof x.snap==='object'?x.snap:null,nn=v=>v==null?null:num(v);RV.forEach(([q])=>k[q]=!!(x.checks&&x.checks[q]));return{month:x.month,doneAt:x.doneAt?dstr(x.doneAt):'',note:str(x.note,300),checks:k,snap:sn?{real:nn(sn.real),life:nn(sn.life),micro:num(sn.micro),passed:num(sn.passed),fundSaved:num(sn.fundSaved)}:null}});
  if(Array.isArray(d.quick)&&d.quick.length)b.quick=d.quick.slice(0,12).map(x=>({key:str(x.key,20)||uid(),icon:str(x.icon,8)||'•',label:str(x.label,20)||'記録',amount:clamp(num(x.amount),0,1e7),pace:clamp(num(x.pace),0,50)}));
  b.cardTx=arr(d.cardTx).slice(-3000).map(x=>({id:str(x.id,40)||uid(),mk:str(x.mk,40),mk2:str(x.mk2,40),qmk:str(x.qmk,40),card:['rakuten','amazon'].includes(x.card)?x.card:'rakuten',kind:x.kind==='quick'?'quick':'final',date:dstr(x.date),time:/^\d{2}:\d{2}$/.test(x.time)?x.time:'',amount:num(x.amount),raw:str(x.raw,60),name:str(x.name,40),cat:TXCATS.includes(x.cat)?x.cat:'その他',payer:str(x.payer,8),ignore:!!x.ignore,voided:!!x.voided,link:str(x.link,50),ok:!!x.ok,edited:!!x.edited,at:x.at?dstr(x.at):''}));
  b.merchantMap={};if(d.merchantMap&&typeof d.merchantMap==='object')Object.keys(d.merchantMap).slice(0,500).forEach(k=>{const m=d.merchantMap[k]||{};if(k.length<=60)b.merchantMap[k]={name:str(m.name,40),cat:TXCATS.includes(m.cat)?m.cat:'その他',ignore:!!m.ignore}});
  b.logs=arr(d.logs).map(x=>({id:str(x.id,40)||uid(),ts:num(x.ts,Date.now()),key:str(x.key,20),label:str(x.label,20),amount:num(x.amount)}));
  /* 家計簿タブのデータ。形が違っても、ほかのデータは読めるようにする */
  /* 1日1問の答え（使った／使っていない）と、週の振り返り */
  b.daily={};if(d.daily&&typeof d.daily==='object')Object.keys(d.daily).filter(k=>/^\d{4}-\d{2}-\d{2}$/.test(k)&&(d.daily[k]==='yes'||d.daily[k]==='no')).sort().slice(-400).forEach(k=>b.daily[k]=d.daily[k]);
  b.weeks=arr(d.weeks).filter(w=>w&&/^\d{4}-\d{2}-\d{2}$/.test(w.wk)).slice(-200).map(w=>({wk:w.wk,doneAt:w.doneAt?dstr(w.doneAt):'',note:str(w.note,300),snap:w.snap&&typeof w.snap==='object'?{spent:num(w.snap.spent),wb:num(w.snap.wb),ns:num(w.snap.ns),saved:num(w.snap.saved)}:null}));
  b.kb=null;if(d.kb){try{b.kb=KB.sanitize(d.kb)}catch(e){}}
  return b}

/* ---------- 暗号化（WebCrypto） ---------- */
const hasCrypto=!!(window.crypto&&crypto.subtle);
function b64(buf){const u=new Uint8Array(buf);let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s)}
function unb64(s){const b=atob(s),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u}
/* ---------- この端末ではパスコードなしで開く ----------
   暗号の鍵を「取り出せない形」のまま、この端末のブラウザの中（IndexedDB）にだけ置く。
   パスコードそのものは保存しない。鍵は外へ送られず、ドライブには今まで通り暗号化した文字だけが残る。
   鍵が見つからない・合わないときは、いつものパスコード画面になる。 */
let devOn=false;
const Dev={
  db(){return new Promise((res,rej)=>{try{const r=indexedDB.open('hitokokyu-device',1);r.onupgradeneeded=()=>r.result.createObjectStore('keys');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}catch(e){rej(e)}})},
  async get(k){try{const db=await this.db();return await new Promise(res=>{const q=db.transaction('keys').objectStore('keys').get(k);q.onsuccess=()=>res(q.result||null);q.onerror=()=>res(null)})}catch(e){return null}},
  async set(k,v){const db=await this.db();await new Promise((res,rej)=>{const t=db.transaction('keys','readwrite');v==null?t.objectStore('keys').delete(k):t.objectStore('keys').put(v,k);t.oncomplete=res;t.onerror=()=>rej(t.error)})},
  /* 鍵を覚える（この端末で「やめる」を選んでいたら覚えない。force は設定画面から） */
  async remember(force){if(!hasCrypto||!KEY||!SALT||KEY.extractable)return false;try{if(!force&&await this.get(APP+':off'))return false;await this.set(APP,{key:KEY,salt:b64(SALT),iter:KITER});await this.set(APP+':off',null);devOn=true;return true}catch(e){devOn=false;return false}},
  async forget(stop){devOn=false;try{await this.set(APP,null);if(stop)await this.set(APP+':off',1)}catch(e){}}
};
/* 覚えた鍵で、保存されている暗号化データを開く。開けたら true */
async function devOpen(o){if(!hasCrypto||!o||!o.enc)return false;const r=await Dev.get(APP);if(!r||!r.key||String(o.salt)!==r.salt)return false;
  try{const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(String(o.iv))},r.key,unb64(String(o.ct)));S=sanitize(JSON.parse(new TextDecoder().decode(pt)));KEY=r.key;SALT=unb64(r.salt);KITER=r.iter||ITER;devOn=true;return true}catch(e){return false}}
async function deriveKey(pass,salt,iter){const km=await crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:iter,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
async function encState(){const iv=crypto.getRandomValues(new Uint8Array(12));const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},KEY,new TextEncoder().encode(JSON.stringify(S)));return{app:APP,enc:1,iter:KITER,salt:b64(SALT),iv:b64(iv),ct:b64(ct)}}
async function decBlob(o,pass){const iter=clamp(num(o.iter,ITER),10000,2000000),salt=unb64(str(o.salt,100));const key=await deriveKey(pass,salt,iter);const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(str(o.iv,100))},key,unb64(String(o.ct)));return{state:sanitize(JSON.parse(new TextDecoder().decode(pt))),key,salt,iter}}

/* ---------- 保存 ---------- */
let chain=Promise.resolve(),soonT=0;
/* ---------- クラウド保存 ----------
   マイアプリ（Google Apps Script のウェブアプリ）で開いたときだけ動く。
   パスコードで暗号化した文字だけを、自分の Google ドライブに保存する。暗号を解く鍵は端末の外に出ない。
   ファイルとして開いたときは今まで通り、この端末の中だけに保存する。
   各アプリ側で CAPP（'h' か 'k'）と cloudHas / cloudApply / cloudRelock を用意する。 */
/* GAS：Apps Script のページとして開いたとき。PWA：ホーム画面のアプリ（画面は端末に保存し、データだけ署名つきで頼む） */
const GAS=!!(window.google&&google.script&&google.script.run);
const PWA=!GAS&&document.documentElement.dataset.pwa==='1'&&hasCrypto;
const CLOUD=GAS||PWA;
const Cloud={rev:null,last:null,busy:false,again:false,pending:false,t:0,st:''};
function gsr(fn,...a){if(PWA)return apiCall(fn,a);return new Promise((res,rej)=>{try{google.script.run.withSuccessHandler(res).withFailureHandler(rej)[fn](...a)}catch(e){rej(e)}})}
/* ---------- iPhoneアプリ用：署名つきでサーバーに頼む ----------
   つなぐコード（合言葉）から作った「取り出せない鍵」で、頼みごとに署名する。合言葉そのものは送らない。 */
let apiCred=null;
async function apiCreds(){if(!apiCred)apiCred=await Dev.get('api');return apiCred}
function rid(){return b64(crypto.getRandomValues(new Uint8Array(18))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
async function apiCall(fn,a){const c=await apiCreds();if(!c||!c.url||!c.key){const e=new Error('notpaired');e.api='notpaired';throw e}
  const p=JSON.stringify({fn,a,ts:Date.now(),n:rid()});const sg=b64(await crypto.subtle.sign('HMAC',c.key,new TextEncoder().encode(p)));
  const res=await fetch(c.url,{method:'POST',body:JSON.stringify({p,s:sg}),headers:{'Content-Type':'text/plain;charset=utf-8'},credentials:'omit',cache:'no-store',redirect:'follow'});
  let j=null;try{j=await res.json()}catch(e){}
  if(!j||!j.ok){const e=new Error((j&&(j.m||j.e))||'api');e.api=j&&j.e||'net';throw e}return j.r}
const API_URL_RE=/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/;
async function apiPair(url,code){url=String(url||'').trim();code=String(code||'').trim().replace(/^HK1-/,'');
  if(!API_URL_RE.test(url))throw new Error('URL が正しくありません（https://script.google.com/macros/s/…/exec の形）');
  if(!/^[A-Za-z0-9_-]{30,80}$/.test(code))throw new Error('つなぐコードが正しくありません');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(code),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  apiCred={url,key};try{await apiCall('getRev',[CAPP])}catch(e){apiCred=null;throw new Error(e.api==='auth'?'つなぐコードが違います（もう一度 makePairCode を実行して、新しいコードを貼ってください）':e.api==='time'?'iPhone の時刻がずれています。設定で「自動設定」をオンにしてください':'つながりませんでした。URL と、公開の設定（アクセスできるユーザー：全員）を確かめてください')}
  await Dev.set('api',{url,key})}
async function apiUnpair(){apiCred=null;try{await Dev.set('api',null);await Dev.set('cache:'+APP,null)}catch(e){}await Dev.forget()}
/* 前回のデータ（暗号化したまま）をこの端末に置いておき、開いた瞬間に表示する */
function cacheSave(text,rev,pending){if(!PWA||!text)return;Dev.set('cache:'+APP,{text,rev:rev||null,pending:!!pending}).catch(()=>{})}
function cloudStatus(s){Cloud.st=s;document.querySelectorAll('[data-cloudst]').forEach(e=>e.textContent=s)}
const cloudNoKeyMsg='🔒 まだ保存されていません（パスコードを設定してください）';
/* 変更があったら少し待ってからまとめて送る */
function cloudMark(){if(!CLOUD)return;Cloud.pending=true;clearTimeout(Cloud.t);if(!KEY){cloudStatus(cloudNoKeyMsg);return}
  if(PWA){clearTimeout(Cloud.ct);Cloud.ct=setTimeout(async()=>{try{if(!S||!Cloud.pending)return;const t=JSON.stringify(await encState());if(Cloud.pending)cacheSave(t,Cloud.rev,true)}catch(e){}},300)}cloudStatus('☁️ 保存待ち…');Cloud.t=setTimeout(cloudPush,1200)}
async function cloudPush(){if(!CLOUD||!cloudHas())return;clearTimeout(Cloud.t);if(!KEY){cloudStatus(cloudNoKeyMsg);return}
  if(Cloud.busy){Cloud.again=true;return}Cloud.busy=true;Cloud.again=false;cloudStatus('☁️ 保存中…');
  try{const text=JSON.stringify(await encState());const r=await gsr('saveBlob',CAPP,text,Cloud.rev);
    if(r&&r.conflict){cloudStatus('⚠️ 別の端末で新しい内容が保存されています');cloudConflict()}
    else{Cloud.rev=r.rev;Cloud.last=JSON.parse(text);if(!Cloud.again)Cloud.pending=false;cacheSave(text,r.rev,Cloud.pending);cloudStatus('☁️ 保存済み')}}
  catch(e){cloudStatus('⚠️ 保存できませんでした。通信を確かめてください（自動でやり直します）');Cloud.t=setTimeout(cloudPush,15000)}
  finally{Cloud.busy=false;if(Cloud.again)cloudPush()}}
function cloudTake(r){Cloud.rev=r&&r.rev||null;let o=null;try{o=r&&r.text?JSON.parse(r.text):null}catch(e){}Cloud.last=o;if(o&&o.enc)cacheSave(r.text,Cloud.rev,false);return o}
async function cloudFetch(){return cloudTake(await gsr('loadBlob',CAPP))}
/* ページと一緒に届いたデータがあれば、それを使う（サーバーへの往復を1回減らす）。1回だけ使う */
async function cloudFirst(){const r=window.__BOOT;window.__BOOT=null;if(r&&typeof r==='object'&&('text' in r))return cloudTake(r);return cloudFetch()}
/* 同じパスコードのまま別の端末で保存された内容なら、パスコードを聞き直さずに読み込む */
async function cloudDecWithKey(o){if(!KEY||!SALT||!o||!o.enc||String(o.salt)!==b64(SALT))return null;const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(String(o.iv))},KEY,unb64(String(o.ct)));return JSON.parse(new TextDecoder().decode(pt))}
async function cloudPull(msg){try{const o=await cloudFetch();if(!o||!o.enc)return;const raw=await cloudDecWithKey(o).catch(()=>null);
  if(raw){cloudApply(raw);Cloud.pending=false;cloudStatus('☁️ 保存済み');if(msg)toast(msg)}else cloudRelock()}catch(e){cloudStatus('⚠️ 読み込めませんでした')}}
function cloudConflict(){if(dlg.open)return;openForm('別の端末で新しい内容が保存されています',[],()=>{cloudPull('最新の内容を読み込みました')},{ok:'最新を読み込む',desc:'Mac など別の端末で、この画面より新しい内容が保存されました。読み込むと、この端末でまだ保存されていない変更は消えます。'})}
/* ほかの端末で使ったあとに戻ってきたら、新しい内容がないか確かめる */
document.addEventListener('visibilitychange',()=>{if(!CLOUD)return;if(document.hidden){if(Cloud.pending&&KEY)cloudPush();return}
  if(mode==='app'&&!Cloud.pending&&!Cloud.busy)gsr('getRev',CAPP).then(r=>{if(r&&r!==Cloud.rev)cloudPull('別の端末の変更を読み込みました')}).catch(()=>{})});
const cloudBar=()=>CLOUD?`<p class="cloudst" data-cloudst>${esc(Cloud.st||(KEY?'☁️ 保存済み':cloudNoKeyMsg))}</p>`:'';
const cloudNeedKey=()=>CLOUD&&!KEY?`<div class="card" style="border-color:#E3C58A;background:#FDF6E7"><b>まだ Google ドライブに保存されていません</b><p class="hint">データは、パスコードで暗号化してから保存します。パスコードを設定するまで、入力した内容は残りません。</p><div class="btns"><button class="btn" data-act="setPass">パスコードを設定する</button></div></div>`:'';
const CAPP='h';
const cloudHas=()=>!!S;
function cloudApply(raw){S=sanitize(raw);enter();render()}
function cloudRelock(){Dev.forget();S=null;KEY=null;SALT=null;undoSnap=null;mode='lock';if(dlg.open)dlg.close();render();toast('パスコードが変わったため、もう一度入れてください')}
function save(){if(CLOUD){cloudMark();return Promise.resolve()}chain=chain.then(async()=>{if(!S)return;const out=KEY?await encState():{app:APP,enc:0,state:S};try{localStorage.setItem(LS,JSON.stringify(out))}catch(e){storageOK=false;toast('この環境では保存できません。バックアップを書き出してください')}}).catch(()=>{});return chain}
function saveSoon(){if(CLOUD){cloudMark();return}clearTimeout(soonT);soonT=setTimeout(save,500)}
function commit(){save();render()}
/* 取り消せる操作：直前の状態を覚えてから実行する */
function withUndo(msg,fn){undoSnap=JSON.stringify(S);fn();commit();toast(msg,true)}
function readLS(){try{const t=localStorage.getItem(LS);return t?JSON.parse(t):null}catch(e){storageOK=false;return null}}

/* ---------- 起動 ---------- */
async function bootPWA(){
  if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
  if(!(await apiCreds())){mode='pair';render();return}
  const c=await Dev.get('cache:'+APP);let o=null;try{o=c&&c.text?JSON.parse(c.text):null}catch(e){}
  if(o&&o.enc){Cloud.rev=c.rev||null;Cloud.last=o;
    if(await devOpen(o)){enter();render();route();if(c.pending){Cloud.pending=true;cloudStatus('☁️ 保存待ち…');cloudPush()}else cloudCheck();return}
    mode='lock';render();cloudFetch().catch(()=>{});return}
  root.innerHTML='<div class="center"><h1>ひと呼吸</h1><p>Google ドライブから読み込んでいます…</p></div>';
  try{o=await cloudFetch()}catch(e){root.innerHTML=`<div class="center"><h1>ひと呼吸</h1><p>${e.api==='auth'?'つながりが切れています。もう一度つないでください。':'読み込めませんでした。通信を確かめて、開き直してください。'}</p>${e.api==='auth'?'<div class="btns"><button class="btn" data-act="repair">つなぎ直す</button></div>':''}</div>`;return}
  if(o&&o.enc&&await devOpen(o)){Cloud.pending=false;cloudStatus('☁️ 保存済み');enter();render();route();return}
  mode=o&&o.enc?'lock':'first';render()}
/* 開いたあと、裏でサーバーの最新を確かめる */
function cloudCheck(){cloudStatus('☁️ 確かめています…');gsr('getRev',CAPP).then(r=>{if(r&&r!==Cloud.rev){if(!Cloud.pending)cloudPull('最新の内容を読み込みました')}else cloudStatus('☁️ 保存済み')}).catch(e=>cloudStatus(e&&e.api==='auth'?'⚠️ つながりが切れています（設定からつなぎ直してください）':'⚠️ 通信できません（この端末の内容を表示しています）'))}
async function boot(){if(PWA)return bootPWA();if(CLOUD){root.innerHTML='<div class="center"><h1>ひと呼吸</h1><p>Google ドライブから読み込んでいます…</p></div>';let o;
    try{o=await cloudFirst()}catch(e){root.innerHTML='<div class="center"><h1>ひと呼吸</h1><p>Google ドライブから読み込めませんでした。通信を確かめて、開き直してください。</p></div>';return}
    if(o&&o.enc&&await devOpen(o)){Cloud.pending=false;cloudStatus('☁️ 保存済み');enter();render();route();return}
    mode=o&&o.enc?'lock':'first';render();return}
  const o=readLS();
  if(!o){mode='first'}
  else if(o.enc){if(await devOpen(o))enter();else mode='lock'}
  else{try{S=sanitize(o.state);enter()}catch(e){mode='first'}}
  render();route()}
/* 直接開くリンク：#buy（買う前に預ける）、#log（記録）、#wait、#fund、#flow */
function route(){if(mode!=='app')return;const h=window.__OPEN||(location.hash||'').slice(1);window.__OPEN='';if(dlg.open&&h!=='buy')dlg.close();const map={wait:'kb',fund:'fund',clothes:'mercari',shop:'shop',home:'home',week:'kb',today:'kb',kb:'kb',log:'kb',record:'kb',buy:'kb'};
  if( h==='flow'){tab='home';homeView='flow';render()}else if(map[h]){tab=map[h];render()}}
window.addEventListener('hashchange',route);
function enter(){mode='app';if(!S.months.find(m=>m.month===curMonth)){const t=nowYM();curMonth=(S.months.find(m=>m.month===t)||S.months[S.months.length-1]||{}).month||null}}
async function lock(){clearTimeout(soonT);if(CLOUD){if(Cloud.pending&&KEY)await cloudPush()}else await save();S=null;KEY=null;SALT=null;undoSnap=null;mode='lock';if(dlg.open)dlg.close();render()}
document.addEventListener('visibilitychange',()=>{if(document.hidden){hiddenAt=Date.now();if(S){clearTimeout(soonT);if(!CLOUD)save()}}else if(KEY&&mode==='app'&&!devOn){if(Date.now()-hiddenAt>=S.settings.autoLockMin*60000)lock()}});

/* ---------- フォーム・確認ダイアログ ---------- */
/* iPhone のパスワード保存（Face ID で自動入力）に、どのアプリのパスコードかを伝えるための見えない欄 */
const kcUser=u=>`<input class="ukc" type="text" name="username" autocomplete="username" value="${esc(u||KC_USER)}" readonly tabindex="-1" aria-hidden="true">`;
function openForm(title,fields,cb,o={}){
  dlg.innerHTML=`<form method="dialog" novalidate><h2>${esc(title)}</h2>${o.desc?`<p class="hint">${esc(o.desc)}</p>`:''}${fields.map((f,i)=>{const id='f'+i,v=f.value==null?'':f.value,ph=f.ph?`placeholder="${esc(f.ph)}"`:'';
    if(f.type==='check')return`<label class="c"><input type="checkbox" id="${id}" ${v?'checked':''}>${esc(f.label)}</label>`;
    if(f.type==='select')return`<label class="f" for="${id}">${esc(f.label)}</label><select id="${id}">${f.options.map(x=>`<option ${x===v?'selected':''}>${esc(x)}</option>`).join('')}</select>`;
    if(f.type==='area')return`<label class="f" for="${id}">${esc(f.label)}</label><textarea id="${id}" rows="${f.rows||6}" ${f.readonly?'readonly':''} spellcheck="false">${esc(v)}</textarea>`;
    if(f.type==='number')return`<label class="f" for="${id}">${esc(f.label)}</label><input id="${id}" type="text" inputmode="numeric" value="${esc(v)}" ${ph} maxlength="14" autocomplete="off">`;
    if(f.type==='password')return`<label class="f" for="${id}">${esc(f.label)}</label><input id="${id}" type="password" name="${f.ac==='new-password'?'new-password':'password'}" value="${esc(v)}" autocomplete="${f.ac||'current-password'}" maxlength="200">`;
    return`<label class="f" for="${id}">${esc(f.label)}</label><input id="${id}" type="${f.type||'text'}" value="${esc(v)}" ${ph} autocomplete="off" maxlength="${f.max||200}">`}).join('')}${fields.some(f=>f.type==='password')?kcUser(o.user):''}
    <div class="btns"><button class="btn" value="ok">${esc(o.ok||'保存')}</button><button class="btn plain" value="cancel" formnovalidate>${esc(o.cancel||'やめる')}</button></div></form>`;
  dlg.querySelector('form').onsubmit=e=>{if(e.submitter&&e.submitter.value!=='ok')return;
    const out={};for(let i=0;i<fields.length;i++){const f=fields[i],el=document.getElementById('f'+i);
      let v=f.type==='check'?el.checked:f.type==='number'?toNum(el.value):(f.type==='password'||f.type==='area')?el.value:el.value.trim();
      if(f.type==='number'&&f.opt&&el.value.trim()===''){out[f.k]=null;continue}
      if(f.type==='number'&&(!Number.isFinite(v)||v<0)){e.preventDefault();toast(`「${f.label}」は0以上の数字で入れてください`);el.focus();return}
      if(f.req&&!v){e.preventDefault();toast(`「${f.label}」を入れてください`);el.focus();return}
      out[f.k]=v}
    if(cb(out)===false)e.preventDefault()};
  dlg.showModal();const first=dlg.querySelector('input:not([type=checkbox]),textarea,select');if(first&&!first.value)first.focus()}
function ask(msg,cb,ok='はい'){openForm(msg,[],()=>{cb()},{ok,cancel:'いいえ'})}

/* ---------- 計算 ---------- */
function monthCalc(m){const hid=sum(m.hidden),exc=sum(m.excluded),sheet=m.income-m.sheetExpense,real=sheet-hid,life=real+exc;return{hid,exc,sheet,real,life}}
function mercariCalc(){const st=S.settings,sl=S.mercari.sales.filter(x=>x.date>=st.mercariStart),gross=sum(sl,'price'),net=Math.round(gross*(1-st.mercariFee/100)),keep=Math.round(net*st.mercariLock/100),cap=net-keep,used=sum(S.mercari.purchases.filter(x=>x.date>=st.mercariStart)),remain=cap-used;return{gross,net,keep,cap,used,remain}}
function afterSale(p){return S.mercari.sales.some(s=>{const d=dnum(p.date)-dnum(s.date);return d>=0&&d<=3})}
const norm=s=>String(s).normalize('NFKC').toLowerCase().replace(/[\s\-_.,、。・×x()（）\[\]【】\/]/g,'');
function grams(s){const g=new Set();for(let i=0;i<s.length-1;i++)g.add(s.slice(i,i+2));return g}
function similar(a,b){a=norm(a);b=norm(b);if(a.length<2||b.length<2)return 0;if(a.includes(b)||b.includes(a))return 1;const x=grams(a),y=grams(b);let n=0;x.forEach(g=>{if(y.has(g))n++});return 2*n/(x.size+y.size)}
function findDup(q,days=90){const t=dnum(today());return[...S.purchases.map(p=>({...p,src:'購入履歴'})),...S.mercari.purchases.map(p=>({...p,src:'メルカリ'}))].map(p=>({...p,score:similar(q,p.item),ago:t-dnum(p.date)})).filter(p=>p.score>=.4).sort((a,b)=>a.ago-b.ago).map(p=>({...p,recent:p.ago<=days}))}
const monthly=p=>p.amount/(p.cycle||1);
function leftMs(w){return w.registeredAt+w.lockHours*36e5-Date.now()}
function leftText(ms){if(ms<=0)return'待ち時間クリア';const m=Math.ceil(ms/6e4),d=Math.floor(m/1440),h=Math.floor(m%1440/60);return'あと '+(d?d+'日 ':'')+(h?h+'時間 ':'')+(m%60)+'分'}
const answered=w=>Q.every(([k])=>w.answers[k].trim().length>=5);
const canBuy=w=>w.lockHours===0||(leftMs(w)<=0&&answered(w));
/* 備え：期日までの残り月数で割って、毎月いくら積めば間に合うかを出す（100円単位で切り上げ） */
function fundCalc(f){const diff=ymN(f.due)-ymN(nowYM()),done=f.last===nowYM(),n=Math.max(1,diff+(done?0:1)),need=Math.max(0,f.target-f.saved),per=need?Math.min(need,Math.ceil(need/n/100)*100):0;return{diff,done,n,need,per,over:diff<0,pend:!done&&per>0}}
const fundsMonthly=()=>S.funds.reduce((t,f)=>t+fundCalc(f).per,0);
const fundsPending=()=>S.funds.reduce((t,f)=>{const c=fundCalc(f);return t+(c.pend?c.per:0)},0);
function contrib(f){const c=fundCalc(f);if(!c.pend)return;f.saved+=c.per;f.last=nowYM()}
function upcoming(){const n0=ymN(nowYM()),out=[];S.funds.forEach(f=>{let d=ymN(f.due);for(let i=0;i<30&&d<=n0+12;i++){if(d>=n0)out.push({ym:ymS(d),f});if(!f.cycle)break;d+=f.cycle}});return out.sort((a,b)=>a.ym.localeCompare(b.ym))}

/* 今日使える額：自分で決めた月の枠から、今月記録した支出を引き、残り日数で割る */
const dim=(y,m)=>new Date(y,m,0).getDate();
const dayIn=(ym,day)=>`${ym}-${pad(Math.min(day,dim(+ym.slice(0,4),+ym.slice(5))))}`;
const fmtD=s=>{const d=new Date(+s.slice(0,4),+s.slice(5,7)-1,+s.slice(8));return`${d.getMonth()+1}/${d.getDate()}（${'日月火水木金土'[d.getDay()]}）`};
function budgetCalc(){const b=S.settings.budget,ym=nowYM(),spent=sum(S.logs.filter(l=>inYM(l.ts,ym)))+sum(S.purchases.filter(p=>!p.sub&&p.date.slice(0,7)===ym))+sum(S.mercari.purchases.filter(p=>p.date.slice(0,7)===ym))+sum((S.cardTx||[]).filter(t=>txCounts(t)&&t.date.slice(0,7)===ym)),d=new Date(),left=dim(d.getFullYear(),d.getMonth()+1)-d.getDate()+1,rem=b-spent;return{b,spent,rem,left,per:Math.floor(Math.max(0,rem)/left)}}
/* 毎日の支出：日々・購入履歴（定期便以外）・メルカリで買ったもの。0円の記録（家サウナなど）は数えない */
function spendByDay(){const m={},add=(d,a)=>{if(a>0)m[d]=(m[d]||0)+a};S.logs.forEach(l=>add(iso(new Date(l.ts)),l.amount));S.purchases.filter(p=>!p.sub).forEach(p=>add(p.date,p.amount));S.mercari.purchases.forEach(p=>add(p.date,p.amount));(S.cardTx||[]).filter(txCounts).forEach(t=>add(t.date,t.amount));return m}
/* 数えはじめ：「日々」で最初に記録した日。記録していない時期を「使わなかった日」に数えないため */
function firstDay(){const ds=S.logs.map(l=>iso(new Date(l.ts))).concat(Object.keys(S.daily||{})).sort();return ds[0]||null}
/* 今週あといくら：月の枠を1日あたりにして7日分。月曜はじまり */
function weekCalc(){const b=S.settings.budget;if(!b)return null;const d=new Date(),wb=Math.round(b/dim(d.getFullYear(),d.getMonth()+1)*7/100)*100,ws=iso(weekStart(d)),t=today(),sp=spendByDay();let s=0;Object.keys(sp).forEach(k=>{if(k>=ws&&k<=t)s+=sp[k]});return{wb,spent:s,left:wb-s}}
/* 使わなかった日が何日続いているか（今日を含む。記録を始めた日より前は数えない） */
function noSpendStreak(){const sp=spendByDay(),f=firstDay();if(!f)return 0;let n=0,d=new Date();for(let i=0;i<400;i++){const k=iso(d);if(k<f||sp[k]||S.daily[k]==='yes')break;n++;d.setDate(d.getDate()-1)}return n}
/* 次に出ていくお金：「流れ」の毎月の動きから、いちばん近い引き落とし */
function nextPay(){const t=today(),c=[];S.flows.filter(f=>f.dir==='out'&&f.day&&f.amount).forEach(f=>{let d=dayIn(nowYM(),f.day);if(d<t)d=dayIn(ymS(ymN(nowYM())+1),f.day);c.push({d,label:f.label})});if(!c.length)return null;c.sort((a,b)=>a.d.localeCompare(b.d));const d=c[0].d;return{date:d,in:dnum(d)-dnum(t),label:c.filter(x=>x.d===d).map(x=>x.label).join('・')}}
const flowNet=()=>S.flows.reduce((t,f)=>t+(f.dir==='in'?f.amount:-f.amount),0);
/* メルカリの記録から：あと払いは翌月に請求、残高払いはその月の支出 */
const billFor=ym=>{const pv=ymS(ymN(ym)-1);return sum(S.mercari.purchases.filter(p=>p.date.slice(0,7)===pv&&p.payment.includes('あと払い')))};
const balFor=ym=>sum(S.mercari.purchases.filter(p=>p.date.slice(0,7)===ym&&p.payment.includes('残高')));
function autoMiss(m){const out=[],has=(k,v)=>m.hidden.some(r=>r.auto===k||r.amount===v),b=billFor(m.month),c=balFor(m.month),mo=+m.month.slice(5);if(b&&!has('bill',b))out.push({auto:'bill',label:`メルペイあと払い（${mo}月請求）`,amount:b});if(c&&!has('bal',c))out.push({auto:'bal',label:'メルペイ残高での購入',amount:c});return out}
/* 流れ：これから60日のお金の出入りを日付順に並べ、口座残高の動きを出す */
function timeline(days=60){const t0=today(),n0=dnum(t0),ev=[];
  for(let k=0;k<=3;k++){const ym=ymS(ymN(nowYM())+k),n=ymN(ym);
    S.flows.filter(f=>f.day>0&&f.amount).forEach(f=>ev.push({date:dayIn(ym,f.day),label:f.label,amt:f.dir==='in'?f.amount:-f.amount}));
    const b=billFor(ym);if(b)ev.push({date:dayIn(ym,S.settings.merpayDay),label:`メルペイあと払い（${+ym.slice(5)}月請求）`,amt:-b});
    S.subs.filter(x=>x.day>0&&x.status!=='解約済').forEach(x=>ev.push({date:dayIn(ym,x.day),label:x.name+' の更新',amt:0,mark:x.amount,src:'サブスク'}));
    S.funds.filter(f=>f.target&&occ(f,n,n).length).forEach(f=>ev.push({date:k?ym+'-01':t0,label:f.name,amt:0,mark:f.target,src:'備えから払う',mo:+ym.slice(5)}))}
  const out=ev.filter(e=>{const d=dnum(e.date)-n0;return(d>0||(e.mo&&d===0))&&d<=days}).sort((a,b)=>a.date.localeCompare(b.date)||b.amt-a.amt);
  let bal=S.settings.balance,min=null;out.forEach(e=>{if(bal!=null){bal+=e.amt;e.bal=bal;if(e.amt&&(!min||bal<min.bal))min={bal,date:e.date}}});return{ev:out,min}}
function nextRenew(x){const t=today(),a=dayIn(nowYM(),x.day),d=a>=t?a:dayIn(ymS(ymN(nowYM())+1),x.day);return{date:d,in:dnum(d)-dnum(t)}}
/* 明細の貼り付け：1行ずつ 日付・品名・金額 を読み取る（端末の中だけで処理） */
function splitCSV(l){const out=[];let c='',q=false;for(const ch of l){if(ch==='"')q=!q;else if(ch===','&&!q){out.push(c);c=''}else c+=ch}out.push(c);return out}
function pDate(s){let m=s.match(/(\d{4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})\s*日?/);if(m)return[`${m[1]}-${pad(+m[2])}-${pad(+m[3])}`,m[0]];
  m=s.match(/(^|[^\d])(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*日?(?!\d)/);if(m&&+m[2]>=1&&+m[2]<=12&&+m[3]>=1&&+m[3]<=31){const y=+today().slice(0,4);let d=`${y}-${pad(+m[2])}-${pad(+m[3])}`;if(d>today())d=`${y-1}${d.slice(4)}`;return[d,m[0].slice(m[1].length)]}return null}
const cellAmt=c=>{const t=c.replace(/[¥￥円\s,"]/g,'');return/^-?\d+$/.test(t)?Math.abs(+t):null};
function parseLines(txt){const out=[];txt.normalize('NFKC').split(/\r?\n/).forEach(raw=>{let l=raw.trim();if(!l)return;let date=null,amt=null,item='';
  const tab=l.includes('\t'),cells=tab?l.split('\t'):splitCSV(l);
  /* カンマ区切りの表として読むのは、3列以上あって「1,234」の途中で割れていないときだけ */
  if(tab?cells.length>=2:cells.length>=3&&!cells.some((c,i)=>i>0&&/^\d{3}\s*円?$/.test(c.trim())&&/\d$/.test(cells[i-1].trim()))){const rest=[];cells.forEach(c=>{c=c.trim();if(!c)return;const d=!date&&pDate(c);if(d&&/^[\s\d:()月火水木金土日曜]*$/.test(c.replace(d[1],''))){date=d[0];return}const a=cellAmt(c);if(a!=null){amt=a;return}rest.push(c)});item=rest.sort((a,b)=>b.length-a.length)[0]||''}
  else{const d=pDate(l);if(d){date=d[0];l=l.replace(d[1],' ')}const ms=[...l.matchAll(/[¥￥]?\s*(\d{1,3}(?:,\d{3})+|\d+)\s*円?/g)];if(ms.length){const pick=ms.filter(m=>/[¥￥円]/.test(m[0])).pop()||ms[ms.length-1];amt=+pick[1].replace(/,/g,'');l=l.replace(pick[0],' ')}item=l.replace(/[|｜]/g,' ').replace(/\s+/g,' ').trim()}
  if(!amt)return;out.push({date:/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date||'')?date:today(),item:(item||'（品名なし）').slice(0,200),amount:amt})});return out.slice(0,500)}

/* 年間：ある年の12か月ぶんを1行ずつにまとめる */
/* 子どもの節目：いまの学年から入学の年を出す。金額は調査の平均（目安）。あとで自分の額に直す */
const GRADES=['年少','年中','年長','小1','小2','小3','小4','小5','小6','中1','中2','中3','高1','高2','高3'];
const EDU={sho:{k:1,label:'小学校入学',amt:0,note:'ランドセル・学用品など。金額を入れてください'},
  chu:{k:7,label:'中学入学',amt:230000,note:'目安：公立中の入学準備 約23万円（制服・自転車など）'},
  chuP:{k:7,label:'中学入学（私立）',amt:1030000,note:'目安：私立中の初年度納付金 約103万円（東京都の平均。地域で差があります）'},
  ko:{k:10,label:'高校入学',amt:350000,note:'目安：高校の入学費用 約35万円（日本政策金融公庫の調査）'},
  dai:{k:13,label:'大学入学',amt:811000,note:'目安：大学の入学費用 約81万円（日本政策金融公庫の調査）'}};
const schoolYear=()=>{const d=new Date();return d.getMonth()>=3?d.getFullYear():d.getFullYear()-1};
/* 学年の番号：年少=-2 … 年長=0、小1=1 … 高3=12。入学の前の3月を期日にする */
function eduGoals(name,grade,priv,uni){const g=GRADES.indexOf(grade)-2,fy=schoolYear(),out=[];
  [EDU.sho,priv?EDU.chuP:EDU.chu,EDU.ko].concat(uni?[EDU.dai]:[]).forEach(e=>{if(e.k>g)out.push({name:`${name}・${e.label}`.slice(0,40),target:e.amt,saved:0,due:`${fy+e.k-g}-03`,cycle:0,last:'',note:e.note})});return out}
/* 長い目で見た計画：これから必要になる額を時間の順に積み上げ、貯まり方と比べる */
function longPlan(){const n0=ymN(nowYM()),one=S.funds.filter(f=>f.target&&!f.cycle).map(f=>ymN(f.due)),end=Math.min(n0+180,Math.max(n0+24,...one));const ev=[];
  S.funds.filter(f=>f.target).forEach(f=>{const os=occ(f,n0,end);if(!os.length&&!f.cycle&&ymN(f.due)<n0)os.push(n0);os.forEach(n=>ev.push({n,f}))});
  ev.sort((a,b)=>a.n-b.n);const saved=sum(S.funds,'saved');let cum=0,mstar=0;ev.forEach(e=>{cum+=e.f.target;e.cum=cum;mstar=Math.max(mstar,(cum-saved)/(e.n-n0+1))});
  mstar=Math.max(0,Math.ceil(mstar/1000)*1000);const own=S.settings.saveMonthly>0,pace=own?S.settings.saveMonthly:mstar;
  const at=n=>saved+pace*(n-n0+1),miss=ev.find(e=>at(e.n)<e.cum);return{n0,end,ev,saved,cum,mstar,pace,own,at,miss}}
function planSvg(P){const W=320,H=150,L=4,R=4,T=10,B=22,span=Math.max(1,P.end-P.n0),X=n=>(L+(n-P.n0)/span*(W-L-R)).toFixed(1),top=Math.max(P.cum,P.at(P.end),1)*1.05,Y=v=>(T+(1-v/top)*(H-T-B)).toFixed(1);
  let st=`M${X(P.n0)},${Y(0)}`,c=0;P.ev.forEach(e=>{st+=` H${X(e.n)}`;c=e.cum;st+=` V${Y(c)}`});st+=` H${X(P.end)}`;
  const y0=Math.floor(P.n0/12),y1=Math.floor(P.end/12),step=y1-y0>8?3:y1-y0>4?2:1;let ticks='';for(let y=y0+1;y<=y1;y+=step){const x=X(y*12);ticks+=`<line x1="${x}" x2="${x}" y1="${T}" y2="${H-B}" stroke="#EDE7DE"/><text x="${x}" y="${H-6}" font-size="9" text-anchor="middle" fill="#78736D">${y}</text>`}
  const dots=P.ev.filter((e,i,a)=>!e.f.cycle).map(e=>`<circle cx="${X(e.n)}" cy="${Y(e.cum)}" r="3" fill="#92400E"/>`).join('');
  return`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="必要な額と貯まり方のグラフ">${ticks}<line x1="${L}" x2="${W-R}" y1="${Y(0)}" y2="${Y(0)}" stroke="#D9D2C7"/><path d="${st}" fill="none" stroke="#C2410C" stroke-width="2" stroke-linejoin="round"/>${dots}<line x1="${X(P.n0)}" y1="${Y(P.at(P.n0))}" x2="${X(P.end)}" y2="${Y(P.at(P.end))}" stroke="#1C5B3D" stroke-width="2.5"/><circle cx="${X(P.n0)}" cy="${Y(P.saved)}" r="3.5" fill="#1C5B3D"/></svg>`}
/* ---------- 人生グラフ ----------
   年ごとの教育費を、子どもの学年と進路から出す。金額は公的な調査の平均（目安）。
   ・小中高の1年あたり：文部科学省「子供の学習費調査」令和5年度の学習費総額
   ・大学：日本政策金融公庫「教育費負担の実態調査」令和3年度の入学費用・在学費用
   ・一人暮らし：同調査（令和2年度）の仕送り 年約90万円、始めるための費用 約36万円 */
const LIFE_UNI=['国公立','私立（文系）','私立（理系）','進学しない'];
const LCOST={kinder:347338,sho:336265,chu:542475,koPub:597752,koPri:1030283,
  uni:{'国公立':{enter:672000,year:1035000},'私立（文系）':{enter:818000,year:1520000},'私立（理系）':{enter:888000,year:1832000}},awayYear:900000,awayStart:360000,allowance:120000};
function lifeClean(l){if(!l||typeof l!=='object')return null;const age=Math.round(num(l.age));if(!(age>=18&&age<=80))return null;
  const kids=arr(l.kids).slice(0,4).filter(k=>k&&GRADES.includes(k.grade)).map(k=>({name:str(k.name,12)||'子ども',grade:k.grade,hs:k.hs==='私立'?'私立':'公立',uni:LIFE_UNI.includes(k.uni)?k.uni:'国公立',away:!!k.away,base:Math.round(num(k.base))||Math.round(num(l.base))||schoolYear()}));
  return{age,base:Math.round(num(l.base))||schoolYear(),kids}}
/* 学年の番号（年少=-2 … 小1=1 … 高3=12、大1=13 … 大4=16）を、その年度の段階と費用に変える */
function kidYear(k,fy){const g=GRADES.indexOf(k.grade)-2+(fy-k.base),c=LCOST;let stage='',cost=0,note=[];
  if(g<-2)return{g,stage:'',cost:0};
  if(g<=0){stage='幼';cost=c.kinder}else if(g<=6){stage='小';cost=c.sho}else if(g<=9){stage='中';cost=c.chu}
  else if(g<=12){stage='高';cost=k.hs==='私立'?c.koPri:c.koPub}
  else if(g<=16&&k.uni!=='進学しない'){stage='大';const u=c.uni[k.uni];cost=u.year;if(g===13){cost+=u.enter;note.push('大学入学')}if(k.away){cost+=c.awayYear;if(g===13){cost+=c.awayStart;note.push('一人暮らし開始')}}}
  if(g===1)note.push('小学校入学');if(g===7)note.push('中学入学');if(g===10)note.push(`${k.hs}高校入学`);
  return{g,stage,cost,note,allow:g<=12?c.allowance:0}}
function lifeData(){const L=S.settings.life;if(!L)return null;const fy0=schoolYear(),ageAt=fy=>L.age+(fy-L.base),endFy=L.base+(65-L.age),rows=[];
  const other=S.funds.filter(f=>f.target&&!/入学/.test(f.name));
  for(let fy=fy0;fy<=endFy;fy++){const ks=L.kids.map(k=>kidYear(k,fy)),edu=ks.reduce((t,x)=>t+x.cost,0),allow=ks.reduce((t,x)=>t+(x.allow||0),0),
    oth=other.reduce((t,f)=>t+f.target*occ(f,fy*12+3,fy*12+14).length,0);rows.push({fy,age:ageAt(fy),ks,edu,allow,oth,total:edu+oth})}
  return{L,rows}}
const STAGEC={幼:'#E9D8B4',小:'#B9D7C4',中:'#7FB59A',高:'#3E8A66',大:'#1C5B3D'};
function lifeSvg(D){const R=D.rows,W=320,H=170,T=14,B=26,n=R.length,bw=(W-8)/n,mx=Math.max(1,...R.map(r=>r.total)),Y=v=>(H-B)-(v/mx)*(H-B-T),kc=['#2B546A','#C2410C','#6D28D9','#B45309'];let s='';
  R.forEach((r,i)=>{const x=4+i*bw;let y=H-B;r.ks.forEach((k,j)=>{if(!k.cost)return;const h=(H-B)-Y(k.cost);y-=h;s+=`<rect x="${(x+1).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1,bw-2).toFixed(1)}" height="${h.toFixed(1)}" fill="${kc[j%4]}"/>`});
    if(r.oth){const h=(H-B)-Y(r.oth);y-=h;s+=`<rect x="${(x+1).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1,bw-2).toFixed(1)}" height="${h.toFixed(1)}" fill="#C8C1B7"/>`}
    if(r.age%5===0)s+=`<text x="${(x+bw/2).toFixed(1)}" y="${H-12}" font-size="9" text-anchor="middle" fill="#78736D">${r.age}歳</text><text x="${(x+bw/2).toFixed(1)}" y="${H-2}" font-size="8" text-anchor="middle" fill="#A8A29A">${r.fy}</text>`;
    if(lifeSel===r.fy)s=`<rect x="${x.toFixed(1)}" y="${T-6}" width="${bw.toFixed(1)}" height="${H-B-T+6}" fill="#EFF6F1"/>`+s;
    s+=`<rect class="hit" data-ly="${r.fy}" x="${x.toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H}" fill="transparent" style="cursor:pointer"/>`});
  const top=R.reduce((a,b)=>b.total>a.total?b:a,R[0]);
  return`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;touch-action:manipulation" role="img" aria-label="年ごとの教育費のグラフ"><line x1="4" x2="${W-4}" y1="${H-B}" y2="${H-B}" stroke="#D9D2C7"/>${s}<text x="${W-4}" y="10" font-size="9" text-anchor="end" fill="#78736D">いちばん高い年 ${top.fy}年度 ${yen(top.total)}</text></svg>`}
function lifeStrips(D){const R=D.rows,n=R.length;return D.L.kids.map(k=>{let segs='',prev=null,start=0;const flush=(i)=>{if(prev){const w=(i-start)/n*100;segs+=`<span style="left:${(start/n*100).toFixed(2)}%;width:${w.toFixed(2)}%;background:${STAGEC[prev]}">${w>4?prev:''}</span>`}};
  R.forEach((r,i)=>{const st=kidYear(k,r.fy).stage;if(st!==prev){flush(i);prev=st;start=i}});flush(n);return`<div class="lstrip"><b>${esc(k.name)}</b><div>${segs}</div></div>`}).join('')}
function lifeAdvice(D){const R=D.rows,L=D.L,band=(a,b)=>R.filter(r=>r.age>=a&&r.age<=b),out=[],man=v=>Math.round(v/10000)+'万円';
  const both=R.filter(r=>r.ks.filter(k=>k.stage==='高'||k.stage==='大').length>=2),uni2=R.filter(r=>r.ks.filter(k=>k.stage==='大').length>=2);
  const stages=rs=>L.kids.map(k=>{const a=rs.map(r=>kidYear(k,r.fy).stage).filter(Boolean),u=[...new Set(a)];return u.length?`${esc(k.name)}：${u.join('→')}`:''}).filter(Boolean).join('、');
  const seg=[[L.age,39,'貯めどき','子どもが小さいうちは、教育費は比較的軽い時期です。ここで教育資金の土台を作れるかどうかが、あとの山を越えられるかを決めます。'],
    [40,44,'中学の時期','中学に入ると、塾など学校の外の費用が増えます（公立中3年の補助学習費は年 約39万円が平均）。車の買い替えも重なりやすい時期です。'],
    [45,49,'山の入り口','高校と大学が重なり始めます。私立高校は2026年度から授業料に年45.7万円までの国の支援（所得制限なし）があり、グラフの平均額より軽くなる見込みです。入学金・制服・通学費は自己負担です。'],
    [50,54,'いちばんの山','大学の学費と一人暮らしの仕送りが重なると、1年で数百万円になります。奨学金や教育ローンを使うかを、前もって家族で決めておくと慌てません。'],
    [55,59,'切り替え','教育費が終わったら、浮いた分をそのまま老後資金へ回すのがコツです。親の介護が始まりやすい時期でもあります。'],
    [60,65,'退職の前後','収入の形が変わる時期です。私立学校の場合、定年・再雇用・退職金は勤め先の規程で確かめておきましょう。']];
  seg.forEach(([a,b,t,tip])=>{if(b<L.age)return;const rs=band(Math.max(a,L.age),b);if(!rs.length)return;const tot=rs.reduce((x,r)=>x+r.edu,0),pk=rs.reduce((x,r)=>r.total>x.total?r:x,rs[0]);
    out.push(`<div class="lseg"><b>${Math.max(a,L.age)}〜${b}歳 <span class="tag">${t}</span></b><small>${rs[0].fy}〜${rs[rs.length-1].fy}年度${stages(rs)?' ・ '+stages(rs):''}</small><p>教育費の合計 <b>${man(tot)}</b>${pk.total?`（いちばん高い ${pk.fy}年度 ${man(pk.total)}）`:''}</p><p class="hint">${tip}</p></div>`)});
  const head=[];if(uni2.length)head.push(`<b>${uni2[0].fy}〜${uni2[uni2.length-1].fy}年度（${uni2[0].age}〜${uni2[uni2.length-1].age}歳）は大学生が2人</b>。いちばん重い時期です。`);
  else if(both.length)head.push(`<b>${both[0].fy}〜${both[both.length-1].fy}年度（${both[0].age}〜${both[both.length-1].age}歳）は高校・大学が重なります</b>。`);
  const allow=R.reduce((t,r)=>t+r.allow,0),edu=R.reduce((t,r)=>t+r.edu,0);
  return`${head.length?`<p class="lhead">${head.join('')}</p>`:''}<div class="grid2" style="margin:8px 0"><div class="stat"><small>これからの教育費（目安）</small><span class="amt">${man(edu)}</span></div><div class="stat"><small>児童手当（高校生まで・月1万円）</small><span class="amt pos">${man(allow)}</span></div></div>${out.join('')}`}
function lifeDetail(D){const r=D.rows.find(x=>x.fy===lifeSel);if(!r)return'<p class="hint">グラフの棒を押すと、その年の中身が出ます。</p>';
  return`<div class="lsel"><b>${r.fy}年度（${r.age}歳）</b>${r.ks.map((k,i)=>k.stage?`<div class="row"><div class="l"><b>${esc(D.L.kids[i].name)}：${k.g<=0?GRADES[k.g+2]||'未就学':k.g<=6?'小'+k.g:k.g<=9?'中'+(k.g-6):k.g<=12?'高'+(k.g-9):'大'+(k.g-12)}</b><small>${k.note.join('・')}</small></div>${A(k.cost)}</div>`:'').join('')}${r.oth?`<div class="row"><div class="l"><b>そのほかの備え</b><small>車検など</small></div>${A(r.oth)}</div>`:''}<div class="row"><div class="l"><b>合計</b></div>${A(r.total)}</div></div>`}
function vLife(){const D=lifeData();
  const body=D&&!D.L.kids.length?`<p class="hint">子どもが入っていません。「年齢・進路を直す」で、子どもの呼び名・学年・進路を入れてください。</p><div class="btns"><button class="btn" data-act="lifeSet">年齢・進路を直す</button></div>`:!D?`<p class="hint">自分の年齢と、子どもの学年・進路を入れると、何歳のときにどのくらいお金がかかるかをグラフにします。</p><div class="btns"><button class="btn" data-act="lifeSet">入れる</button></div>`
   :`${lifeSvg(D)}<div class="legend">${D.L.kids.map((k,j)=>`<span><i style="background:${['#2B546A','#C2410C','#6D28D9','#B45309'][j%4]}"></i>${esc(k.name)}</span>`).join('')}<span><i style="background:#C8C1B7"></i>車検など</span></div>
     <div class="lstrips">${lifeStrips(D)}</div>${lifeDetail(D)}${lifeAdvice(D)}
     <p class="hint">金額は全国平均の目安です（小中高：文部科学省 令和5年度、大学：日本政策金融公庫）。物価や学校で変わります。</p><div class="btns"><button class="btn plain s" data-act="lifeSet">年齢・進路を直す</button></div>`;
  return`<details class="card life" data-det="life" ${openDet.has('life')?'open':''}><summary>📈 人生グラフ <span class="sub">タップで開く</span></summary>${body}</details>`}
function vPlan(){const P=longPlan();if(!P.ev.length)return`<div class="card"><h2>これからの大きなお金</h2><p class="hint">下の「備えを足す」から、子どもの入学や車検を入れると、いつまでにいくら必要かがグラフで見えます。</p><div class="btns"><button class="btn" data-act="addKid">＋ 子どもの節目を足す</button></div></div>`;
  const years={};P.ev.forEach(e=>{const y=Math.floor(e.n/12);(years[y]=years[y]||[]).push(e)});const ym=n=>`${Math.floor(n/12)}年${n%12+1}月`;
  const msg=P.miss?`<p class="pmsg neg">このままだと <b>${ym(P.miss.n)}の「${esc(P.miss.f.name)}」</b>で ${A(P.miss.cum-P.at(P.miss.n),'neg')} 足りなくなります。毎月 <b>${yen(P.mstar)}</b> 積めば、すべて間に合います。</p>`:`<p class="pmsg pos">${P.own?`毎月 ${yen(P.pace)} の積立で、すべて間に合います 🎉`:`毎月 <b>${yen(P.mstar)}</b> 積めば、すべて間に合います。`}</p>`;
  const next=P.ev.find(e=>!e.f.cycle);
  return`<div class="card"><h2>これからの大きなお金 <span class="sub">${ym(P.n0)}〜${Math.floor(P.end/12)}年</span></h2>
    ${msg}${planSvg(P)}
    <div class="legend"><span><i style="background:#C2410C"></i>必要になる額の合計</span><span><i style="background:#1C5B3D"></i>${P.own?`毎月 ${yen(P.pace)} 積んだとき`:`毎月 ${yen(P.mstar)} 積んだとき`}</span></div>
    <p class="hint">緑の線が赤い階段より上にあれば、間に合っています。${next?`次の大きな節目は ${ym(next.n)} の「${esc(next.f.name)}」です。`:''}</p>
    <div class="btns"><button class="btn plain s" data-act="setSaveMonthly">${P.own?`実際の積立 ${yen(P.pace)}／月 を直す`:'実際に毎月いくら積むかを入れる'}</button><button class="btn ghost s" data-act="addKid">＋ 子どもの節目</button></div>
    <details class="more"><summary>年ごとに見る</summary>${Object.keys(years).map(y=>`<div class="yr"><b>${y}年</b>${years[y].map(e=>`<div class="row"><div class="l"><b>${e.n%12+1}月　${esc(e.f.name)}</b><small>ここまでの合計 ${yen(e.cum)}</small></div>${A(e.f.target)}</div>`).join('')}</div>`).join('')}</details></div>`}
function occ(f,a,b){const out=[];let d=ymN(f.due);for(let i=0;i<200&&d<=b;i++){if(d>=a)out.push(d);if(!f.cycle)break;d+=f.cycle}return out}
const inYM=(ts,ym)=>iso(new Date(ts)).slice(0,7)===ym;
function yearData(Y){const st=S.settings,bm=st.bonusMonths,R=[];for(let mo=1;mo<=12;mo++){const ym=`${Y}-${pad(mo)}`,n=ymN(ym),m=S.months.find(x=>x.month===ym);
  R.push({ym,mo,m,c:m?monthCalc(m):null,pays:S.funds.filter(f=>f.target&&occ(f,n,n).length),bonus:bm.includes(mo)?st.bonusYear/bm.length:0,micro:sum(S.logs.filter(l=>inYM(l.ts,ym))),clothes:sum(S.mercari.purchases.filter(p=>p.date.slice(0,7)===ym)),rv:S.reviews.some(r=>r.month===ym&&r.doneAt)})}return R}
function getRv(ym,make){let r=S.reviews.find(x=>x.month===ym);if(!r&&make){r={month:ym,doneAt:'',note:'',checks:{},snap:null};S.reviews.push(r)}return r}
const rvDone=ym=>!!(getRv(ym)||{}).doneAt;
function streak(){let n=ymN(nowYM()),k=0;if(!rvDone(ymS(n)))n--;while(rvDone(ymS(n))){k++;n--}return k}

/* ---------- 画面 ---------- */
function render(){
  document.body.classList.toggle('hide',!!render.hide);
  if(mode==='pair')return root.innerHTML=vPair();
  if(mode==='first')return root.innerHTML=vFirst();
  if(mode==='lock'){root.innerHTML=vLock();const p=document.getElementById('pass');if(p)p.focus();return}
  if(mode==='app'&&CLOUD)setTimeout(txSync,300);
  if(mode!=='app')return;
  if(['today','wait','week'].includes(tab))tab='kb';const GRP={home:'money',kb:'money',mercari:'money',shop:'money',fund:'future',set:'set'},g=GRP[tab]||'money';if(g==='money')lastMoney=tab;
  const tabs=[['money','📒','家計簿',lastMoney],['future','🐖','将来','fund'],['set','⚙️','設定','set']];
  const msub=g==='money'?`<div class="seg msub">${[['kb','家計簿'],['home','収支'],['mercari','服の枠'],['shop','定期']].map(([k,l])=>`<button class="${tab===k?'on':''}" data-act="tab" data-t="${k}">${l}</button>`).join('')}</div>`:'';
  root.innerHTML=`<header class="top"><h1>ひと呼吸<small>無駄遣い予防</small></h1>
    <button class="ib" data-act="hide" aria-label="金額を隠す">${render.hide?'🙈':'👁'}</button>
    ${KEY?'<button class="ib" data-act="lock" aria-label="ロックする">🔒</button>':''}
</header>
    ${cloudBar()}<main class="${tab==='kb'?'wide':''}">${cloudNeedKey()}${CLOUD||storageOK?'':'<div class="card" style="border-color:#E7B8B2"><b>この環境では保存ができません。</b><p class="hint">設定からバックアップを書き出してください。</p></div>'}${msub}${({home:vHome,fund:vFund,mercari:vMercari,shop:vShop,set:vSet,kb:()=>'<div id="kb"></div>'+vTx()}[tab]||(()=>'<div id="kb"></div>'+vTx()))()}</main>
    <nav class="tabs">${tabs.map(([k,i,l,t])=>`<button class="${g===k?'on':''}" data-act="tab" data-t="${t}"><span>${i}</span>${l}</button>`).join('')}</nav>`;
  if(tab==='kb')KB.mount(document.getElementById('kb'));
  tick()}
/* 行：名前を押すと直せる。✕で消す（取り消し可） */
const row=(l,id,title,sub,right)=>`<div class="row"><div class="l tap" role="button" tabindex="0" data-act="edit" data-l="${l}" data-id="${id}"><b>${title}</b>${sub?`<small>${sub}</small>`:''}</div>${right}<button class="x" data-act="del" data-l="${l}" data-id="${id}" aria-label="削除">✕</button></div>`;
const det=(key,summary,body)=>`<details class="card" data-det="${key}" ${openDet.has(key)?'open':''}><summary>${summary}</summary>${body}</details>`;

function vPair(){return`<div class="center"><h1>🌱 ひと呼吸</h1><p>はじめに、あなたの Google ドライブとつなぎます（この端末で1回だけ）。</p>
  <form id="pair" class="pairf"><label>ウェブアプリのURL<input id="purl" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec"></label>
  <label>つなぐコード<input id="pcode" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="HK1-…"></label>
  <div class="btns"><button class="btn">つなぐ</button></div></form>
  <p class="hint" style="margin-top:18px">URL と つなぐコードは、手順書のとおり Apps Script から取り出します。つなぐコードは、ほかの人に見せないでください。</p></div>`}
function vFirst(){return`<div class="center"><h1>ひと呼吸</h1><p>買う前にひと呼吸おいて、お金の流れを自分の目で確かめるためのアプリです。</p>
  <div class="card" style="margin-top:16px"><h2>安全のしくみ</h2><ul class="plain">
  ${CLOUD?'<li>データは<b>この端末でパスコードで暗号化してから</b>、あなたの Google ドライブに保存します。Google 側には暗号化された文字しか残りません。</li><li>Mac と iPhone で同じデータを使えます。</li>':'<li>データは<b>この端末のブラウザの中だけ</b>に保存します。どこにも送信しません。</li>'}
  <li>外部のサービスやライブラリを読み込みません（通信そのものを禁止しています）。</li>
  ${CLOUD?'<li>はじめにパスコードを決めます。忘れると中身を取り出せません。</li>':'<li>パスコードを設定すると、データを暗号化して保存します。</li>'}
  <li>銀行・カード・メールとは連携しません。口座番号やカード番号は入力不要です。</li></ul></div>
  <div class="card"><h2>はじめかた</h2>
  <div class="btns"><button class="btn" data-act="pickFile">初期データを読み込む（JSON）</button><button class="btn ghost" data-act="startEmpty">空で始める</button></div>
  <p class="hint">初期データやバックアップのファイルをお持ちの場合は、それを選ぶと続きから使えます。</p><div class="btns"><button class="btn plain s" data-act="pasteImport">貼り付けて読み込む</button></div></div>
  ${hasCrypto?'':'<p class="hint">この開き方ではパスコード暗号化が使えません（https で開くと使えます）。</p>'}</div>`}
function vLock(){return`<div class="center"><h1>🔒 ひと呼吸</h1><p>パスコードを入れてください。</p>
  <form id="unlock" style="margin-top:14px">${kcUser()}<input id="pass" type="password" name="password" autocomplete="current-password" aria-label="パスコード"><div class="btns"><button class="btn">開く</button></div></form>
  <p class="hint" style="margin-top:24px">パスコードを忘れた場合、中身を取り出す方法はありません。</p>
  <div class="btns"><button class="btn warn s" data-act="wipe">データを消去してやり直す</button></div></div>`}

/* いまやること：気づいてほしいことだけを上に出す */
function todo(){const out=[];
  if(!rvDone(nowYM())&&new Date().getDate()>=S.settings.reviewDay)out.push([`${+nowYM().slice(5)}月の確認をしましょう（3分ほど）。`,'hv','review','始める']);
  S.wishes.filter(w=>w.status==='waiting'&&w.lockHours>0&&leftMs(w)<=0).forEach(w=>out.push([`「${esc(w.item)}」の待ち時間が終わりました。`,'tab','wait','決める']));
  const pend=fundsPending();if(pend>0)out.push([`今月の備え ${A(pend)} をまだ積んでいません。`,'contribAll','','積む']);
  S.funds.forEach(f=>{if(!f.target)out.push([`「${esc(f.name)}」の金額がまだ入っていません。`,'tab','fund','入れる']);else if(fundCalc(f).over)out.push([`「${esc(f.name)}」の期日（${fmtYM(f.due)}）を過ぎています。`,'tab','fund','確認']) });
  const mc=mercariCalc();if(mc.remain<0)out.push([`服の枠を ${A(-mc.remain)} 超えています。次に売れるまで服はお休み。`,'tab','mercari','見る']);
  const ws=weekStart(new Date()).getTime();S.quick.filter(q=>q.pace>0).forEach(q=>{const n=S.logs.filter(l=>l.key===q.key&&l.ts>=ws).length;if(n>q.pace)out.push([`今週の${esc(q.label)}が ${n} 回（目安は週${q.pace}回）。`,'tab','micro','見る'])});
  const bc=budgetCalc();if(bc.b&&bc.rem<0)out.push([`今月の枠を ${A(-bc.rem)} 超えています。`,'tab','micro','見る']);
  S.subs.filter(x=>x.day>0&&x.status!=='解約済').forEach(x=>{const r=nextRenew(x);if(r.in<=3)out.push([`${esc(x.name)} の更新が ${fmtD(r.date)}${r.in?`（あと${r.in}日）`:'（今日）'}です。続けますか？`,'tab','shop','見る'])});
  {const w=weekTarget(),dw=new Date().getDay();if((dw===0||dw===1)&&!weekDone(w.wk))out.push([`${dw===0?'今週':'先週'}の振り返りをしましょう（3分）。`,'tab','week','始める'])}
  const lg=S.letgo.filter(x=>!x.done).length;if(lg)out.push([`手放す予定の服が ${lg} 着あります。`,'tab','mercari','見る']);
  const ka=KB.alertInfo();if(ka)out.push([`${ka.inDays?`あと${ka.inDays}日`:'今日'}（${ka.d}日）は${ka.names.length?esc(ka.names.join('・'))+'の':''}引き落とし日です。口座のお金を確かめましょう。`,'tab','kb','見る']);
  if(!KEY&&hasCrypto)out.push(['パスコードを設定すると、データが暗号化されます。','setPass','','設定']);
  return out}
function vHome(){
  const seg=`<div class="seg">${[['month','月ごと'],['flow','流れ'],['year','年間'],['review','月の確認'+(rvDone(nowYM())?' ✓':'')]].map(([k,l])=>`<button class="${homeView===k?'on':''}" data-act="hv" data-t="${k}">${l}</button>`).join('')}</div>`;
  return seg+(homeView==='year'?vYear():homeView==='flow'?vFlow():homeView==='review'?vReview():vMonth())}
function vFlow(){
  const st=S.settings,has=st.balance!=null,tl=timeline(60),ev=tl.ev,unset=S.flows.filter(f=>!f.day),set=S.flows.filter(f=>f.day).sort((a,b)=>a.day-b.day);let chart='';
  if(has&&ev.some(e=>e.amt)){const n0=dnum(today()),pts=[[0,st.balance]];ev.forEach(e=>{if(e.amt){const x=dnum(e.date)-n0;pts.push([x,pts[pts.length-1][1]]);pts.push([x,e.bal])}});pts.push([60,pts[pts.length-1][1]]);
    const vs=pts.map(q=>q[1]).concat(0),lo=Math.min(...vs),hi=Math.max(...vs),X=x=>(x/60*300).toFixed(1),Y=v=>(96-(v-lo)/(hi-lo||1)*92).toFixed(1);
    chart=`<svg viewBox="0 0 300 100" preserveAspectRatio="none" style="width:100%;height:120px;display:block;margin-top:12px" role="img" aria-label="口座残高の見通し"><line x1="0" x2="300" y1="${Y(0)}" y2="${Y(0)}" stroke="#B42318" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/><polyline fill="none" stroke="#1C5B3D" stroke-width="2" vector-effect="non-scaling-stroke" points="${pts.map(q=>X(q[0])+','+Y(q[1])).join(' ')}"/></svg><div class="legend"><span>今日</span><span style="color:var(--red)">- - 残高ゼロの線</span><span style="margin-left:auto">60日後</span></div>`}
  return`<div class="card"><h2>口座残高の見通し <button class="btn ghost s" data-act="setBal">${has?'残高を直す':'残高を入れる'}</button></h2>
    ${has?`<span class="amt big ${sgn(st.balance)}">${yen(st.balance)}</span><p class="hint">${esc(st.balanceAt)} に入れた残高です。</p>${tl.min?`<p style="margin-top:8px">いちばん少なくなるのは <b>${fmtD(tl.min.date)}</b> の ${A(tl.min.bal,sgn(tl.min.bal))} です。${tl.min.bal<0?'<span class="tag r">このままだと足りません</span>':''}</p>`:''}${chart}`:'<p class="hint">いまの口座残高を入れると、この先60日でいつ・いくらまで減るかが線で見えます。</p>'}</div>
  <div class="card"><h2>これから60日</h2>${ev.length?ev.map(e=>`<div class="row"><div class="l"><b>${e.mo&&!e.amt?e.mo+'月中':fmtD(e.date)}　${esc(e.label)}</b><small>${e.src?esc(e.src):''}${e.bal!=null&&e.amt?`残高 ${a2(e.bal)}`:''}</small></div>${e.amt?A(e.amt,sgn(e.amt)):`<span class="amt n" style="color:var(--muted)">${yen(e.mark)}</span>`}</div>`).join(''):'<p class="hint">下の「毎月の動き」に、給料日や引き落とし日を入れると、ここに日付順で並びます。</p>'}
    <p class="hint">灰色の金額（備え・サブスク）は目印です。口座残高の計算には入れていません。</p></div>
  <div class="card"><h2>毎月の動き <button class="btn ghost s" data-act="add" data-l="flow">＋ 追加</button></h2>
    ${set.map(f=>row('flow',f.id,esc(f.label),`毎月 ${f.day}日`,A(f.dir==='in'?f.amount:-f.amount,f.dir==='in'?'pos':'neg'))).join('')}
    ${unset.length?`<p class="hint" style="margin-top:10px"><span class="tag a">日にちが未設定</span> 名前を押して、何日かを入れてください。</p>${unset.map(f=>row('flow',f.id,esc(f.label),'日にち未設定',A(f.dir==='in'?f.amount:-f.amount,f.dir==='in'?'pos':'neg'))).join('')}`:''}
    ${S.flows.length?`<div class="row"><div class="l"><b>毎月の差し引き</b></div>${A(flowNet(),sgn(flowNet()))}</div>`:`<p class="hint">給料、家賃、カードの引き落としなど、毎月決まった日に動くお金を入れます。</p>${S.months.length?'<div class="btns"><button class="btn ghost s" data-act="flowsFromItems">いちばん新しい月の内訳から作る</button></div>':''}`}
    <p class="hint">メルペイあと払いは、メルカリの記録から翌月 ${st.merpayDay>=28?'末':st.merpayDay+'日'}に自動で入ります（日にちは設定で変えられます）。</p></div>`}
function vYear(){
  const y0=+nowYM().slice(0,4),ys=[...new Set([...S.months.map(m=>+m.month.slice(0,4)),y0,y0+1])].sort();if(!ys.includes(curYear))curYear=y0;
  const R=yearData(curYear),rec=R.filter(r=>r.c),n=rec.length,T=k=>rec.reduce((t,r)=>t+r.c[k],0),life=T('life'),st=S.settings;
  const payT=R.reduce((t,r)=>t+sum(r.pays,'target'),0),est=n?life+(12-n)*(life/n)+st.bonusYear:null,mx=Math.max(1,...rec.map(r=>Math.abs(r.c.life)));
  const passed=sum(S.wishes.filter(w=>w.status==='passed'&&w.decidedAt.slice(0,4)===String(curYear)),'price');
  const bar=r=>{const v=r.c?r.c.life:0,h=Math.max(v?3:0,Math.round(Math.abs(v)/mx*62));return`<div class="col"><div class="up">${v>0?`<i style="height:${h}px;background:var(--accent)"></i>`:''}</div><div class="dn">${v<0?`<i style="height:${h}px;background:var(--red)"></i>`:''}</div></div>`};
  return`<div class="chips">${ys.map(y=>`<button class="chip ${y===curYear?'on':''}" data-act="year" data-y="${y}">${y}年</button>`).join('')}</div>
  <div class="card"><h2>${curYear}年の着地の目安 <span class="sub">記録 ${n} / 12か月</span></h2>${est==null?'<p class="hint">この年の記録はまだありません。下の月を押して入れてください。</p>':`<span class="amt big ${sgn(est)}">${yen(est)}</span><p class="hint">記録した${n}か月の「暮らしの収支」の平均で残りの月を埋め、ボーナス ${a2(st.bonusYear)} を足した額です。</p>`}
    <div class="ych" style="margin-top:14px">${R.map(bar).join('')}</div><div class="ylab">${R.map(r=>`<span>${r.pays.length?'<b style="color:var(--amber)">●</b>':r.bonus?'<b style="color:var(--accent)">○</b>':'&nbsp;'}<br>${r.mo}</span>`).join('')}</div>
    <div class="legend"><span><i style="background:var(--accent)"></i>黒字の月</span><span><i style="background:var(--red)"></i>赤字の月</span><span><b style="color:var(--amber)">●</b> 備えの支払い</span><span><b style="color:var(--accent)">○</b> ボーナス</span></div>
    ${st.bonusYear&&!st.bonusMonths.length?'<div class="btns"><button class="btn ghost s" data-act="setBonusMonths">ボーナスの月を設定する</button></div>':''}</div>
  <div class="card"><h2>${curYear}年の合計</h2><div class="grid2">
    <div class="stat"><small>収入</small>${A(rec.reduce((t,r)=>t+r.m.income,0))}</div><div class="stat"><small>暮らしの収支</small>${A(life,sgn(life))}</div>
    <div class="stat"><small>家計簿にない支出</small>${A(T('hid'),'neg')}</div><div class="stat"><small>服の購入（メルカリ）</small>${A(R.reduce((t,r)=>t+r.clothes,0))}</div>
    <div class="stat"><small>日々の少額</small>${A(R.reduce((t,r)=>t+r.micro,0))}</div><div class="stat"><small>見送って守ったお金</small>${A(passed,'pos')}</div>
    <div class="stat"><small>備えの支払い予定</small>${A(payT)}</div><div class="stat"><small>備えで貯まっている額</small>${A(sum(S.funds,'saved'),'pos')}</div></div></div>
  <div class="card"><h2>月ごとの一覧</h2>${R.map(r=>{const sub=[r.bonus?`<span class="tag g">ボーナス ${a2(r.bonus)}</span>`:'',...r.pays.map(f=>`<span class="tag a">${esc(f.name)} ${a2(f.target)}</span>`),r.clothes?`服 ${a2(r.clothes)}`:'',r.micro?`日々 ${a2(r.micro)}`:''].filter(Boolean).join(' ');
    return`<div class="row"><div class="l tap" role="button" tabindex="0" data-act="ymGo" data-m="${r.ym}"><b>${r.mo}月${r.ym===nowYM()?' <span class="tag g">今月</span>':''}${r.rv?' <span class="tag">確認済み</span>':''}</b><small>${sub||(r.c?'':'まだ記録がありません')}</small></div>${r.c?A(r.c.life,sgn(r.c.life)):'<button class="btn ghost s" data-act="ymGo" data-m="'+r.ym+'">入れる</button>'}</div>`}).join('')}
    <p class="hint">右の金額は「暮らしの収支」です。月を押すと、その月の内訳を開きます。</p></div>`}
function vReview(){
  const ym=nowYM(),mo=+ym.slice(5),r=getRv(ym)||{checks:{},note:'',doneAt:''},m=S.months.find(x=>x.month===ym),c=m?monthCalc(m):null,mc=mercariCalc(),pend=fundsPending();
  const prev=S.months.find(x=>x.month===ymS(ymN(ym)-1)),pc=prev?monthCalc(prev):null;
  const micro=sum(S.logs.filter(l=>inYM(l.ts,ym))),passed=sum(S.wishes.filter(w=>w.status==='passed'&&w.decidedAt.slice(0,7)===ym),'price');
  const fix=S.subs.filter(x=>x.status==='継続'),con=S.subs.filter(x=>x.status==='検討中'),wt=S.wishes.filter(w=>w.status==='waiting');
  const info={book:[m?`収入 ${a2(m.income)} ／ 支出 ${a2(m.sheetExpense)}`:'この月はまだ入っていません','rvMonth',m?'直す':'入れる',''],
    hidden:[m?`いま ${a2(c.hid)}（${m.hidden.length}件）`:'先に家計簿の数字を入れてください','rvHidden','足す',''],
    fund:[S.funds.length?(pend?`まだ ${a2(pend)} 積んでいません`:'積立済みです'):'備えはまだ登録されていません',pend?'contribAll':'tab',pend?'積む':'見る','fund'],
    subs:[`継続 ${fix.length}件 ${a2(sum(fix))} ／ 検討中 ${con.length}件`,'tab','見る','shop'],
    cloth:[`残り ${a2(mc.remain)}`,'tab','見る','mercari'],
    wait:[`${wt.length}件 預かり中`,'tab','見る','wait']};
  const on=k=>!!r.checks[k]||(k==='fund'&&S.funds.length>0&&!pend),nOn=RV.filter(([k])=>on(k)).length,past=S.reviews.filter(x=>x.doneAt&&x.month!==ym).sort((a,b)=>b.month.localeCompare(a.month)),sk=streak();
  return`<div class="card"><h2>${mo}月の確認 <span class="sub">${nOn} / ${RV.length}</span></h2>${r.doneAt?`<p><span class="tag g">完了 ${esc(r.doneAt)}</span>${sk>1?` <span class="tag">${sk}か月連続</span>`:''}</p>`:'<p class="hint">月に一度、上から順に見てまわります。3分ほどで終わります。</p>'}
    ${RV.map(([k,l])=>{const[d,a,b,t]=info[k];return`<div class="row"><button class="chk ${on(k)?'on':''}" data-act="chk" data-k="${k}" aria-label="${l}" aria-pressed="${on(k)}">✓</button><div class="l"><b>${l}</b><small>${d}</small></div><button class="btn plain s" data-act="${a}" data-t="${t}">${b}</button></div>`}).join('')}</div>
  <div class="card"><h2>${mo}月の結果</h2><div class="grid2">
    <div class="stat"><small>本当の収支</small>${c?A(c.real,sgn(c.real)):'<span class="hint">未入力</span>'}</div><div class="stat"><small>暮らしの収支</small>${c?A(c.life,sgn(c.life)):'<span class="hint">未入力</span>'}</div>
    <div class="stat"><small>日々の少額</small>${A(micro)}</div><div class="stat"><small>見送って守ったお金</small>${A(passed,'pos')}</div></div>
    ${c&&pc?`<p class="hint">先月とくらべて、暮らしの収支は ${A(c.life-pc.life,sgn(c.life-pc.life))} です。</p>`:''}
    <label class="f" for="rvnote">来月ひとつだけ変えること</label><textarea id="rvnote" data-rvnote="1" maxlength="300" placeholder="例：服は売れた分の範囲だけにする">${esc(r.note)}</textarea>
    <div class="btns"><button class="btn" data-act="rvDone">${r.doneAt?'もう一度保存する':'確認を完了する'}</button></div></div>
  ${past.length?`<div class="card"><h2>これまでの確認</h2>${past.map(x=>`<div class="row"><div class="l"><b>${fmtYM(x.month)}</b><small>${esc(x.note)}</small></div>${x.snap&&x.snap.life!=null?A(x.snap.life,sgn(x.snap.life)):''}</div>`).join('')}</div>`:''}`}
/* ---------- 今日：毎日見るものを1枚に ---------- */
function todayTop(){const td=todo();
  const bc=budgetCalc(),wk=weekCalc(),np=nextPay(),sk=noSpendStreak(),bits=[wk?`今週あと ${A(wk.left,wk.left<0?'neg':'')}`:'',np?`${esc(np.label)}まで${np.in?'あと'+np.in+'日':'今日'}`:'',sk>1?`使わない日 ${sk}日目`:''].filter(Boolean);
  const n0=new Date(),dayBase=bc.b?bc.b/dim(n0.getFullYear(),n0.getMonth()+1):0,sig=!bc.b?'':bc.rem<0?'r':bc.per<dayBase*0.5?'y':'g',SIGL={g:'余裕あり',y:'残りわずか',r:'使いすぎ'};
  const head1=`<div class="card today ${sig?'sig-'+sig:''}">${sig?`<span class="sigl">${SIGL[sig]}</span>`:''}<div class="tl">${bc.b?`<small>今日使える</small><span class="amt big ${bc.rem<0?'neg':''}">${yen(bc.per)}</span>`:'<button class="linkb" data-act="setBudget">月の枠を決めると、今日使える額が出ます</button>'}</div>${bits.length?`<p class="tline">${bits.join('<span class="dot">・</span>')}</p>`:''}<div class="big3"><button data-act="goRec"><span>☕</span>記録</button><button data-act="add" data-l="wish"><span>⏳</span>買う前に</button><button data-act="hv" data-t="flow"><span>📅</span>流れ</button></div>${bc.b?`<details class="more"><summary>くわしく</summary>`:''}`;
  const bud=bc.b?`${head1}<p class="hint">今月あと ${A(bc.rem,bc.rem<0?'neg':'')}（残り${bc.left}日）／ 枠 ${a2(bc.b)}</p><div class="bar"><i style="width:${clamp(bc.spent/bc.b*100,0,100).toFixed(1)}%;background:${bc.rem<0?'var(--red)':'var(--ink)'}"></i></div><p class="hint">使った額 ${a2(bc.spent)}。「日々」「購入履歴」「メルカリで買ったもの」に今月記録した分を数えています。${wk?`今週の枠は ${a2(wk.wb)}（月の枠を1日あたりにした7日分）。`:''}</p><div class="btns"><button class="btn plain s" data-act="setBudget">枠を直す</button></div></details></div>`:`${head1}</div>`;
  return bud+`<div class="card"><h2>いまやること</h2>${td.length?td.map(([t,a,x,l])=>`<div class="row"><div class="l">${t}</div><button class="btn ghost s" data-act="${a}" data-t="${x}">${l}</button></div>`).join(''):'<p class="hint">いまやることはありません。いい状態です。</p>'}
</div>`}
function vMonth(){const fm=fundsMonthly();
  const chips=`<div class="chips">${S.months.map(m=>`<button class="chip ${m.month===curMonth?'on':''}" data-act="month" data-m="${m.month}">${+m.month.slice(5)}月</button>`).join('')}<button class="chip" data-act="addMonth">＋ 月を追加</button></div>`;
  const m=S.months.find(x=>x.month===curMonth);
  if(!m)return chips+`<div class="card"><h2>まだ月のデータがありません</h2><p class="hint">「＋ 月を追加」から、収入と家計簿の支出合計を入れてください。</p></div>`+vSaved();
  const c=monthCalc(m),tot=m.sheetExpense+c.hid,mx=Math.max(m.income,tot,1),w=n=>(Math.max(0,n)/mx*100).toFixed(1);
  const list=(k,title,hint)=>det(k,`${title}<span class="sub">${m[k].length}件 ${k==='items'?'':A(sum(m[k]))}</span>`,`${m[k].map(r=>row(k,r.id,esc(r.label),'',A(r.amount))).join('')}<div class="btns"><button class="btn ghost s" data-act="add" data-l="${k}">＋ 追加</button></div><p class="hint">${hint}</p>`);
  const ms=S.months.map(monthCalc),avg=ms.reduce((t,x)=>t+x.life,0)/ms.length,by=S.settings.bonusYear,yr=avg*12+by,miss=autoMiss(m);
  return chips+`<div class="card"><h2>${+m.month.slice(5)}月の収支 <span class="sub">${esc(m.note)}</span></h2>
    <div class="steps">
      <div class="st"><small>① 家計簿の上では</small>${A(c.sheet,sgn(c.sheet))}<small>収入 ${A(m.income)} − 支出 ${A(m.sheetExpense)}</small></div>
      <div class="st"><small>② 家計簿に載っていない支出 ${A(c.hid)} を足すと</small><span class="amt big ${sgn(c.real)}">${yen(c.real)}</span><small>これが口座から実際に出ていくお金の収支です。</small></div>
      <div class="st"><small>③ そのうち貯蓄・立替 ${A(c.exc)} を除くと</small>${A(c.life,sgn(c.life))}<small>暮らしで使った分だけの収支です。</small></div>
    </div>
    <div style="margin-top:14px"><small class="hint">収入</small><div class="bar"><i style="width:${w(m.income)}%;background:var(--accent)"></i></div>
    <small class="hint">支出</small><div class="bar"><i style="width:${w(m.sheetExpense-c.exc)}%;background:var(--ink)"></i><i style="width:${w(c.exc)}%;background:#9DB8A8"></i><i style="width:${w(c.hid)}%;background:var(--red)"></i></div>
    <div class="legend"><span><i style="background:var(--ink)"></i>暮らしの支出</span><span><i style="background:#9DB8A8"></i>貯蓄・立替</span><span><i style="background:var(--red)"></i>家計簿にない支出</span></div></div>
    ${miss.length?`<p class="hint" style="margin-top:12px"><span class="tag a">メルカリの記録から</span> ${miss.map(x=>esc(x.label)+' '+a2(x.amount)).join('、')} が、まだ②に入っていません。</p><div class="btns" style="margin-top:6px"><button class="btn ghost s" data-act="autoHidden">②に入れる</button></div>`:''}
    <div class="btns"><button class="btn plain s" data-act="editMonth">収入・支出合計を直す</button><button class="btn plain s" data-act="importKb">家計簿から取り込む</button><button class="btn warn s" data-act="delMonth">この月を消す</button></div></div>`
  +list('hidden','家計簿に載っていない支出','メルペイあと払い・残高払いなど、家計簿の合計に入っていないものを入れます。')
  +list('excluded','貯蓄・立替','積立投資や、あとで戻ってくる仕事の立替など、使ったお金ではないもの。')
  +list('items','支出の内訳メモ','合計には影響しません。固定費の確認用です。')
  +`<div class="card"><h2>このペースで1年続くと</h2><div class="row"><div class="l"><b>暮らしの収支（月平均）×12</b><small>記録のある${ms.length}か月の平均から</small></div>${A(avg*12,sgn(avg))}</div>
    <div class="row"><div class="l"><b>ボーナス（年間）</b></div>${A(by,'pos')}</div>
    <div class="row"><div class="l"><b>1年後の差し引き</b></div><span class="amt big ${sgn(yr)}">${yen(yr)}</span></div>
    ${fm?`<div class="row"><div class="l"><b>このほかに備えの積立</b><small>毎月 ${yen(fm)} × 12</small></div>${A(-fm*12,'neg')}</div>`:''}
    <p class="hint">記録した月だけから出した目安です。月が増えるほど正確になります。</p></div>`+vSaved()}
function vSaved(){const p=S.wishes.filter(w=>w.status==='passed'),t=sum(p,'price'),st=S.settings,g=st.goalAmount;return`<div class="card"><h2>見送って守ったお金 <button class="btn plain s" data-act="setGoal">${g?'行き先を直す':'行き先を決める'}</button></h2><span class="amt big pos">${yen(t)}</span>${g?`<div class="bar" style="margin-top:8px"><i style="width:${clamp(t/g*100,0,100).toFixed(1)}%;background:var(--accent)"></i></div><p class="hint">「${esc(st.goalName||'目標')}」${a2(g)} まで ${t>=g?'届きました 🎉':'あと '+a2(g-t)}</p>`:''}<p class="hint">「待つ」で見送りを決めた ${p.length} 件の合計です。${g?'':'家族旅行など、このお金の行き先を決めると進み具合が見えます。'}</p></div>`}

function vFund(){
  const fs=[...S.funds].sort((a,b)=>a.due.localeCompare(b.due)),fm=fundsMonthly(),pend=fundsPending(),up=upcoming();
  const rest=PRESETS.map((p,i)=>[p,i]).filter(([p])=>!S.funds.some(f=>f.name===p.name));
  return vPlan()+vLife()+`<div class="card"><h2>毎月の積立</h2><span class="amt big">${yen(fm)}</span><p class="hint">この額を毎月よけておけば、下の支払いすべてに間に合います。いま貯まっている合計は ${A(sum(S.funds,'saved'),'pos')} です。</p>
    ${pend>0?`<div class="btns"><button class="btn" data-act="contribAll">今月分 ${yen(pend)} をまとめて積む</button></div>`:S.funds.length?'<p class="hint"><span class="tag g">今月分は積立済み</span></p>':''}</div>
  ${fs.map(f=>{const c=fundCalc(f),pct=f.target?clamp(f.saved/f.target*100,0,100):0;
    return`<div class="card"><h2><span class="tap" role="button" tabindex="0" data-act="edit" data-l="fund" data-id="${f.id}">${esc(f.name)}</span>${A(f.target)}</h2>
    <p><span class="tag ${c.over?'r':c.diff<=2?'a':''}">${fmtYM(f.due)}${c.over?' ・ 期日を過ぎています':c.diff===0?' ・ 今月':` ・ あと${c.diff}か月`}</span><span class="tag">${CYC.find(x=>x[1]===f.cycle)[0]}</span></p>
    ${f.target?`<div class="bar" style="margin-top:10px"><i style="width:${pct.toFixed(1)}%;background:var(--accent)"></i></div><p class="hint">貯まった ${A(f.saved,'pos')} ／ あと ${A(c.need)}${c.need?` ・ 毎月 <b class="amt">${yen(c.per)}</b>`:' ・ 準備できました'}</p>`:'<p class="hint">名前を押して、金額を入れてください。</p>'}
    ${f.note?`<p class="hint">${esc(f.note)}</p>`:''}
    <div class="btns">${c.pend?`<button class="btn s" data-act="contrib" data-id="${f.id}">今月分 ${yen(c.per)} を積む</button>`:c.need&&f.target?'<span class="tag g">今月分 ✓</span>':''}<button class="btn plain s" data-act="edit" data-l="fund" data-id="${f.id}">直す</button><button class="btn plain s" data-act="paid" data-id="${f.id}">支払った</button><button class="x" data-act="del" data-l="fund" data-id="${f.id}" aria-label="削除">✕</button></div></div>`}).join('')}
  <div class="card"><h2>備えを足す</h2><div class="btns" style="margin:0 0 10px"><button class="btn" data-act="addKid">＋ 子どもの節目（入学）</button></div>${rest.length?`<div class="chips">${rest.map(([p,i])=>`<button class="chip" data-act="add" data-l="fund" data-p="${i}">＋ ${esc(p.name)}</button>`).join('')}</div>`:''}<div class="btns" style="margin-top:0"><button class="btn ghost" data-act="add" data-l="fund">＋ 自分で入れる</button></div>
    <p class="hint">金額は、去年の納税通知書や前回の請求書を見て入れるのが確実です。</p></div>
  ${up.length?`<div class="card"><h2>これから1年の支払い</h2>${up.map(u=>`<div class="row"><div class="l"><b>${fmtYM(u.ym)}</b><small>${esc(u.f.name)}</small></div>${A(u.f.target)}</div>`).join('')}<div class="row"><div class="l"><b>合計</b></div>${A(up.reduce((t,u)=>t+u.f.target,0))}</div></div>`:''}
  <div class="card"><p class="hint">積んだお金は、ふだん使う口座と分けて置いておくと、うっかり使わずに済みます。このアプリは金額を記録するだけで、実際の移動は行いません。</p></div>`}

function vWait(){
  const st=S.settings,act=S.wishes.filter(w=>w.status==='waiting'),done=S.wishes.filter(w=>w.status!=='waiting').sort((a,b)=>b.decidedAt.localeCompare(a.decidedAt));
  const mc=mercariCalc();
  return`<div class="card"><h2>欲しいものを預ける</h2><p>${A(st.threshold)} 以上の「なくても困らないもの」は、買う前にここへ。${st.lockHours}時間たって3つの問いに答えたら、買うか見送るかを決められます。</p><div class="btns"><button class="btn" data-act="add" data-l="wish">＋ 欲しいものを預ける</button></div></div>
  ${act.length?act.map(w=>{const gate=w.lockHours>0,dup=findDup(w.item).filter(d=>d.recent);return`<div class="card wish"><h2><span>${esc(w.item)}</span>${A(w.price)}</h2>
    <p><span class="tag">${esc(w.category)}</span>${gate?` <span class="count" data-cd="${w.id}"></span>`:' <span class="tag g">金額が小さいので待ち時間なし</span>'}</p>
    ${w.note?`<p class="hint">${esc(w.note)}</p>`:''}
    ${w.category==='服・靴'?`<p class="hint">服の枠の残り：${A(mc.remain,sgn(mc.remain))}</p>`:''}
    ${dup.length?`<p class="hint"><span class="tag a">似たものを最近買っています</span> ${esc(dup[0].item)}（${dup[0].ago}日前）</p>`:''}
    ${gate?Q.map(([k,q])=>`<label class="f" for="${k}-${w.id}">${esc(q)}</label><textarea id="${k}-${w.id}" data-ans="${k}" data-id="${w.id}" maxlength="500">${esc(w.answers[k])}</textarea>`).join(''):''}
    <div class="btns"><button class="btn" data-act="pass" data-id="${w.id}">見送る</button><button class="btn ghost" data-act="buy" data-id="${w.id}" data-buy="${w.id}" ${canBuy(w)?'':'disabled'}>買うと決める</button><button class="btn plain s" data-act="edit" data-l="wish" data-id="${w.id}">直す</button><button class="x" data-act="del" data-l="wish" data-id="${w.id}" aria-label="削除">✕</button></div>
    ${gate?'<p class="hint">「買うと決める」は、待ち時間が終わり、3つすべてに答えると押せます。</p>':''}</div>`}).join(''):'<div class="card"><p class="hint">いま預かっているものはありません。</p></div>'}
  ${done.length?`<div class="card"><h2>決めたもの</h2>${done.map(w=>row('wish',w.id,esc(w.item),esc(w.decidedAt),`${A(w.price)}<span class="tag ${w.status==='passed'?'g':''}">${w.status==='passed'?'見送り':'購入'}</span>`)).join('')}</div>`:''}`}

function vMercari(){
  const st=S.settings,c=mercariCalc(),P=[...S.mercari.purchases].sort((a,b)=>b.date.localeCompare(a.date)),L=[...S.mercari.sales].sort((a,b)=>b.date.localeCompare(a.date));
  const by={};S.mercari.purchases.forEach(p=>{const k=p.date.slice(0,7);by[k]=(by[k]||0)+p.amount});const ks=Object.keys(by).sort().slice(-6),mx=Math.max(1,...ks.map(k=>by[k]));
  return`<div class="card"><h2>服に使える枠 <span class="sub">${esc(st.mercariStart)} から</span></h2>
    <span class="amt big ${sgn(c.remain)}">${yen(c.remain)}</span><p class="hint">${c.remain<0?'枠を超えています。次に売れるまで服は買わない、が約束です。':'売って得たお金の範囲でだけ、次の服を買えます。'}</p>
    <div class="grid2" style="margin-top:12px"><div class="stat"><small>売上（手数料${st.mercariFee}%を引いた額）</small>${A(c.net)}</div><div class="stat"><small>家計に戻す分（${st.mercariLock}%）</small>${A(c.keep,'pos')}</div><div class="stat"><small>服に使える分</small>${A(c.cap)}</div><div class="stat"><small>もう使った分</small>${A(c.used)}</div></div>
    <div class="btns"><button class="btn" data-act="add" data-l="ms">＋ 売れた</button><button class="btn ghost" data-act="add" data-l="mp">＋ 買った</button></div>
    <p class="hint">送料は含めていません。割合と開始日は設定で変えられます。</p></div>
  ${ks.length?`<div class="card"><h2>月ごとの購入額</h2>${ks.map(k=>`<div class="row" style="display:block"><div style="display:flex;justify-content:space-between"><span>${+k.slice(5)}月</span>${A(by[k])}</div><div class="bar"><i style="width:${(by[k]/mx*100).toFixed(1)}%;background:var(--ink)"></i></div></div>`).join('')}<p class="hint">買った日の月で集計しています（あと払いの請求は翌月）。</p></div>`:''}
  ${S.letgo.length?`<div class="card"><h2>手放す予定 <span class="sub">1着入れたら1着出す</span></h2>${[...S.letgo].sort((a,b)=>a.done-b.done||b.date.localeCompare(a.date)).map(x=>`<div class="row" style="${x.done?'opacity:.55':''}"><button class="chk ${x.done?'on':''}" data-act="lgDone" data-id="${x.id}" aria-label="出品した" aria-pressed="${x.done}">✓</button><div class="l"><b>${esc(x.item)}</b><small>「${esc(x.forItem)}」の代わり ・ ${esc(x.date)}</small></div><button class="x" data-act="del" data-l="letgo" data-id="${x.id}" aria-label="削除">✕</button></div>`).join('')}<p class="hint">出品したら ✓ を付けます。売れたら「＋ 売れた」で記録すると、服の枠が増えます。</p></div>`:''}
  ${det('mp',`買ったもの<span class="sub">${P.length}件 ${A(sum(P))}</span>`,P.map(p=>row('mp',p.id,esc(p.item),`${esc(p.date)}${p.payment?' ・ '+esc(p.payment):''}${afterSale(p)?' <span class="tag a">売れた直後</span>':''}`,A(p.amount))).join('')||'<p class="hint">まだありません。</p>')}
  ${det('ms',`売ったもの<span class="sub">${L.length}件 ${A(sum(L,'price'))}</span>`,L.map(p=>row('ms',p.id,esc(p.item),esc(p.date),A(p.price,'pos'))).join('')||'<p class="hint">まだありません。</p>')}`}

function vShop(){
  const subs=S.purchases.filter(p=>p.sub),tot=subs.reduce((t,p)=>t+monthly(p),0),lux=subs.filter(p=>p.category==='嗜好品・酒類').reduce((t,p)=>t+monthly(p),0);
  const H=[...S.purchases].sort((a,b)=>b.date.localeCompare(a.date)),fix=S.subs.filter(s=>s.status!=='解約済');
  return`<div class="card"><h2>買う前の重複チェック</h2><input type="text" id="dupq" placeholder="例：酸素系漂白剤" value="${esc(dupQ)}" maxlength="80" aria-label="商品名"><div id="dupres">${dupHtml()}</div></div>
  <div class="card"><h2>明細をまとめて取り込む</h2><p class="hint">カードやメルカリの明細をコピーして貼ると、日付・品名・金額を読み取って一度に記録します。読み取りはこの端末の中だけで行います。</p><div class="btns"><button class="btn ghost" data-act="paste">貼り付けて取り込む</button></div></div>
  <div class="card"><h2>定期便 <span class="sub">月あたり</span></h2><span class="amt big">${yen(tot)}</span>
    ${tot?`<div class="bar"><i style="width:${(lux/tot*100).toFixed(1)}%;background:var(--amber)"></i><i style="width:${(100-lux/tot*100).toFixed(1)}%;background:var(--accent)"></i></div><div class="legend"><span><i style="background:var(--amber)"></i>嗜好品・酒類 ${yen(lux)}</span><span><i style="background:var(--accent)"></i>必需品 ${yen(tot-lux)}</span></div>`:''}
    ${lux?`<label class="f" for="sim">嗜好品の定期便を <span id="simp">${simPct}</span>% 減らすと</label><input type="range" id="sim" min="0" max="100" step="25" value="${simPct}"><p id="simout">${simHtml(lux)}</p>`:''}
    ${subs.map(p=>row('p',p.id,esc(p.item),`${esc(p.category)}${p.cycle>1?' ・ '+p.cycle+'か月ごと':''}`,A(p.amount))).join('')}</div>
  <div class="card"><h2>毎月のサブスク <button class="btn ghost s" data-act="add" data-l="sub">＋ 追加</button></h2><p>続けているものの合計 ${A(sum(fix))}<span class="hint"> ／月</span> ・ 年にすると <b>${A(sum(fix)*12)}</b></p>
    ${S.subs.map(s=>row('sub',s.id,esc(s.name),[s.amount&&s.status!=='解約済'?`年 ${yen(s.amount*12)}`:'',s.day?`毎月 ${s.day}日に更新`:'',esc(s.note)].filter(Boolean).join(' ・ '),`${A(s.amount)}<button class="btn plain s" data-act="cycSub" data-id="${s.id}">${esc(s.status)}</button>`)).join('')}
    <p class="hint">状態のボタンを押すと「継続 → 検討中 → 解約済」と切り替わります。名前を押して更新日を入れると、3日前から「いまやること」に出ます。</p></div>
  ${det('p',`購入履歴<span class="sub">${H.length}件</span>`,`${H.map(p=>row('p',p.id,esc(p.item),`${esc(p.date)} ・ ${esc(p.category)}${p.sub?' ・ 定期便':''}`,A(p.amount))).join('')}<div class="btns"><button class="btn ghost s" data-act="add" data-l="p">＋ 追加</button></div><p class="hint">ここに入れたものが重複チェックの対象になります。</p>`)}`}
function simHtml(lux){const s=lux*simPct/100;return`月 ${A(s,'pos')} ・ 年 ${A(s*12,'pos')} 浮きます。`}
function dupHtml(){if(norm(dupQ).length<2)return'<p class="hint">商品名を入れると、過去の購入と照らし合わせます。</p>';const r=findDup(dupQ);if(!r.length)return'<p class="hint"><span class="tag g">重複なし</span> 似た購入は見つかりませんでした。</p>';return r.slice(0,6).map(p=>`<div class="row"><div class="l"><b>${esc(p.item)}</b><small>${esc(p.date)}（${p.ago}日前）・ ${esc(p.src)}</small></div>${A(p.amount)}<span class="tag ${p.recent?'r':''}">${p.recent?'90日以内':'90日より前'}</span></div>`).join('')}

function calHtml(){const d=new Date(),y=d.getFullYear(),m=d.getMonth()+1,n=dim(y,m),t=today(),f=firstDay(),sp=spendByDay(),b=S.settings.budget,per=b?b/n:0,lead=(new Date(y,m-1,1).getDay()+6)%7;let cells='',ns=0;
  for(let i=0;i<lead;i++)cells+='<span></span>';
  for(let i=1;i<=n;i++){const k=`${y}-${pad(m)}-${pad(i)}`,v=sp[k]||0;let c='fu';if(k<=t)c=!f||k<f?'na':!v?(S.daily[k]==='yes'?'sp':'ns'):per&&v>per?'ov':'sp';if(c==='ns')ns++;cells+=`<span class="${c}${k===t?' td':''}" title="${v?yen(v):'使っていない'}">${i}</span>`}
  const sk=noSpendStreak();
  return`<div class="card"><h2>使わなかった日 <span class="sub">${m}月</span></h2><div class="cal"><b>月</b><b>火</b><b>水</b><b>木</b><b>金</b><b>土</b><b>日</b>${cells}</div>
  <p style="margin-top:10px">今月は <b>${ns}日</b>${sk>1?`、いま <b>${sk}日</b> 続いています 🌱`:''}</p><div class="legend"><span><i style="background:#CFE6D8"></i>使わなかった</span><span><i style="background:#EDE7DE"></i>使った</span>${per?'<span><i style="background:#F6D3CE"></i>1日分を超えた</span>':''}</div><p class="hint">${f?`${+f.slice(5,7)}/${+f.slice(8)} に「日々」で記録を始めた日から数えています。`:'「日々」で記録を始めた日から数えます。'}0円の記録（家サウナなど）は「使わなかった」に数えます。</p></div>`}
/* 1日1問：「今日お金を使った？」に答えるだけで、使わなかった日が記録される */
function dailyQ(){const t=today(),a=S.daily[t],n=S.logs.filter(l=>iso(new Date(l.ts))===t&&l.amount>0).length;
  if(!a)return`<div class="card dq"><h2>今日の1問</h2><p class="dqq">今日はここまでで、お金を使った？</p><div class="dqb"><button class="btn ghost" data-act="dq" data-v="yes">使った</button><button class="btn" data-act="dq" data-v="no">使っていない 🌱</button></div></div>`;
  return`<div class="card dq done"><p>今日の1問：<b>${a==='no'?'使っていない 🌱':'使った'}</b>${a==='yes'?`<span class="hint">（記録 ${n}件）</span>`:''}<button class="linkb" data-act="dqReset">変える</button></p></div>`}
/* 週の振り返り：日曜はその週、それ以外は先週を見る */
function weekTarget(){const d=new Date(),ws=weekStart(d);if(d.getDay()!==0)ws.setDate(ws.getDate()-7);const we=new Date(ws);we.setDate(we.getDate()+6);return{wk:iso(ws),end:iso(we)}}
function weekStats(wk,end){const sp=spendByDay(),b=S.settings.budget,d0=new Date(+wk.slice(0,4),+wk.slice(5,7)-1,+wk.slice(8)),wb=b?Math.round(b/dim(d0.getFullYear(),d0.getMonth()+1)*7/100)*100:0;let spent=0,ns=0,f=firstDay();
  for(let i=0;i<7;i++){const x=new Date(d0);x.setDate(x.getDate()+i);const k=iso(x);if(k>today())break;spent+=sp[k]||0;if(f&&k>=f&&!sp[k]&&S.daily[k]!=='yes')ns++}
  const saved=sum(S.wishes.filter(w=>w.status==='passed'&&w.decidedAt>=wk&&w.decidedAt<=end),'price'),by={};S.logs.filter(l=>{const k=iso(new Date(l.ts));return k>=wk&&k<=end&&l.amount>0}).forEach(l=>by[l.label]=(by[l.label]||0)+l.amount);
  const top=Object.entries(by).sort((a,b)=>b[1]-a[1]).slice(0,3),over=S.quick.filter(q=>q.pace>0).map(q=>({q,n:S.logs.filter(l=>{const k=iso(new Date(l.ts));return l.key===q.key&&k>=wk&&k<=end}).length})).filter(x=>x.n>x.q.pace);return{spent,wb,ns,saved,top,over}}
const weekDone=wk=>!!(S.weeks.find(w=>w.wk===wk)||{}).doneAt;
function vWeek(){const {wk,end}=weekTarget(),st=weekStats(wk,end),pw=new Date(+wk.slice(0,4),+wk.slice(5,7)-1,+wk.slice(8)-7),pst=weekStats(iso(pw),iso(new Date(pw.getFullYear(),pw.getMonth(),pw.getDate()+6))),r=S.weeks.find(w=>w.wk===wk)||{note:'',doneAt:''},md=s=>`${+s.slice(5,7)}/${+s.slice(8)}`;
  const past=S.weeks.filter(w=>w.doneAt&&w.wk!==wk).sort((a,b)=>b.wk.localeCompare(a.wk)).slice(0,8);
  return`<button class="linkb" data-act="tab" data-t="today">← 今日に戻る</button>
  <div class="card"><h2>週の振り返り <span class="sub">${md(wk)}〜${md(end)}</span></h2>${r.doneAt?`<p><span class="tag g">完了 ${esc(r.doneAt)}</span></p>`:'<p class="hint">3分で終わります。上から見て、最後に来週のことを1つだけ決めます。</p>'}
    <div class="grid2" style="margin-top:10px"><div class="stat"><small>使った額</small>${A(st.spent)}${st.wb?`<small>週の枠 ${yen(st.wb)}</small>`:''}</div><div class="stat"><small>先週とくらべて</small>${A(st.spent-pst.spent,st.spent>pst.spent?'neg':'pos')}</div>
    <div class="stat"><small>使わなかった日</small><span class="amt">${st.ns}日</span></div><div class="stat"><small>見送って守ったお金</small>${A(st.saved,'pos')}</div></div>
    ${st.wb?`<p style="margin-top:10px">${st.spent<=st.wb?`<span class="tag g">枠の中で暮らせました</span> ${A(st.wb-st.spent,'pos')} 残っています。`:`<span class="tag r">枠を ${yen(st.spent-st.wb)} 超えました</span>`}</p>`:''}
    ${st.top.length?`<p class="hint" style="margin-top:8px">多かったもの：${st.top.map(([l,a])=>`${esc(l)} ${yen(a)}`).join('、')}</p>`:''}
    ${st.over.length?`<p class="hint">ペースを超えたもの：${st.over.map(x=>`${esc(x.q.label)}（${x.n}回／目安${x.q.pace}回）`).join('、')}</p>`:''}
    <label class="f" for="wknote">来週ひとつだけ変えること</label><textarea id="wknote" data-wknote="${wk}" maxlength="300" placeholder="例：コンビニは朝だけにする">${esc(r.note)}</textarea>
    <div class="btns"><button class="btn" data-act="wkDone" data-wk="${wk}">${r.doneAt?'もう一度保存する':'振り返りを終える'}</button></div></div>
  ${past.length?`<div class="card"><h2>これまでの振り返り</h2>${past.map(w=>`<div class="row"><div class="l"><b>${md(w.wk)}の週</b><small>${esc(w.note)}</small></div>${w.snap?A(w.snap.spent):''}</div>`).join('')}</div>`:''}`}
function waitSummary(){const w=S.wishes.filter(x=>x.status==='waiting');if(!w.length)return'';return`<div class="card"><h2>待っているもの <span class="sub">${w.length}件</span></h2>${w.slice(0,3).map(x=>`<div class="row"><div class="l"><b>${esc(x.item)}</b><small>${x.lockHours?esc(leftText(leftMs(x))):'待ち時間なし'}</small></div>${A(x.price)}</div>`).join('')}<div class="btns"><button class="btn plain s" data-act="tab" data-t="wait">開いて決める</button></div></div>`}
/* ---------- カードの利用（利用のお知らせメールから自動で入る） ---------- */
const TXRULES=[[/コスモス|ドラッグ|マツモトキヨシ|ツルハ|ウエルシア|レデイ|ダイソー|DAISO|セリア|ニトリ|NITORI/,'日用品'],[/セブン|SEVEN|7-?ELEVEN|ファミリーマート|ファミマ|FAMILYMART|ローソン|LAWSON|ミニストツプ|デイリーヤマザキ|ポプラ/,'コンビニ'],[/STARBUCKS|スターバツクス|スタバ|ドトール|DOUTOR|タリーズ|TULLY|コメダ|KOMEDA|CAFE|カフエ/,'カフェ'],[/サウナ|SAUNA|温泉|スパ|SPA|銭湯|湯$/,'サウナ・温浴'],[/AMAZON|アマゾン/,'ネット通販'],[/メルカリ|MERCARI|メルペイ/,'メルカリ'],[/UNIQLO|ユニクロ|ZARA|しまむら|SHIMAMURA|ZOZO|ゾゾ|H&M|GAP|BEAMS|ビームス|ユナイテツドアローズ|ABC-?MART|ジーユー/,'服・靴'],[/楽天証券|ラクテンシヨウケン|証券/,'投資・貯金'],[/ENEOS|エネオス|出光|IDEMITSU|コスモ石油|SHELL|オートバツクス|イエローハツト/,'車・ガソリン'],[/マクドナルド|MCDONALD|すき家|吉野家|松屋|ガスト|サイゼリヤ|スシロー|くら寿司|丸亀|はま寿司|ケンタツキー|モスバーガー/,'外食'],[/フジ|FUJI|イオン|AEON|マルナカ|ハローズ|コープ|COOP|業務スーパー|スーパー/,'食品'],[/西松屋|トイザらス|TOYSRUS|アカチヤンホンポ/,'子ども']];
const txKey=r=>String(r||'').normalize('NFKC').toUpperCase().replace(/株式会社|有限会社|\(株\)|\(有\)|カ\)|\(カ|ユ\)/g,'').replace(/[ァィゥェォッャュョヮ]/g,c=>'アイウエオツヤユヨワ'['ァィゥェォッャュョヮ'.indexOf(c)]).replace(/[\s・.,\-_/'"()（）]/g,'').slice(0,40);
const txCounts=t=>!t.ignore&&!t.voided&&!t.link&&t.amount>0;
const dayDiff=(a,b)=>Math.abs((new Date(a)-new Date(b))/864e5);
function txName(t){if(t.edited)return;if(!t.raw){t.name='（お店の名前はあとで届きます）';t.cat=t.cat||'その他';return}const k=txKey(t.raw),m=S.merchantMap[k];
  if(m){t.name=m.name||t.raw;t.cat=m.cat;t.ignore=m.ignore;return}const hit=TXRULES.find(([re])=>re.test(k));t.name=t.raw;t.cat=hit?hit[1]:'その他';t.ignore=t.cat==='投資・貯金'}
/* 手で入れた記録（ワンタップ・購入履歴・メルカリ）と同じ日・同じ金額なら、つなげて二重に数えない */
function txLink(t){if(t.ignore||t.voided||t.link||t.amount<=0)return;const used=new Set(S.cardTx.map(x=>x.link).filter(Boolean)),ok=k=>!used.has(k);
  const l=S.logs.find(x=>x.amount===t.amount&&dayDiff(iso(new Date(x.ts)),t.date)<=1&&ok('log:'+x.id));if(l){t.link='log:'+l.id;return}
  const p=S.purchases.find(x=>x.amount===t.amount&&dayDiff(x.date,t.date)<=1&&ok('p:'+x.id));if(p){t.link='p:'+p.id;return}
  const q=S.mercari.purchases.find(x=>x.amount===t.amount&&dayDiff(x.date,t.date)<=1&&ok('m:'+x.id));if(q)t.link='m:'+q.id}
function txMerge(rows){let add=0,up=0;const have=new Set();S.cardTx.forEach(t=>[t.mk,t.mk2,t.qmk].forEach(k=>k&&have.add(k)));
  rows.slice().sort((a,b)=>(a.kind==='quick'?0:1)-(b.kind==='quick'?0:1)||String(a.date).localeCompare(b.date)).forEach(r=>{
    if(!r||!r.mk||have.has(r.mk)||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Number.isFinite(r.amount)||!CARDN[r.card])return;have.add(r.mk);
    if(r.cancel){const t=S.cardTx.find(x=>x.card===r.card&&!x.voided&&Math.abs(x.amount)===Math.abs(r.amount)&&dayDiff(x.date,r.date)<=40);if(t){t.voided=true;t.mk2=t.mk2||r.mk;up++;return}}
    if(r.kind==='final'){const q=S.cardTx.find(x=>x.card===r.card&&x.kind==='quick'&&x.amount===r.amount&&dayDiff(x.date,r.date)<=3);if(q){q.kind='final';q.raw=str(r.merchant,60);q.mk2=r.mk;if(!q.payer)q.payer=str(r.payer,8);txName(q);if(q.ignore)q.link='';else txLink(q);up++;return}}
    if(r.kind==='quick'){const f=S.cardTx.find(x=>x.card===r.card&&x.kind==='final'&&!x.qmk&&x.amount===r.amount&&dayDiff(x.date,r.date)<=3);if(f){f.qmk=r.mk;return}}
    const t={id:uid(),mk:r.mk,mk2:'',qmk:'',card:r.card,kind:r.kind==='quick'?'quick':'final',date:r.date,time:/^\d{2}:\d{2}$/.test(r.time)?r.time:'',amount:Math.round(r.amount),raw:str(r.merchant,60),name:'',cat:'その他',payer:str(r.payer,8),ignore:false,voided:!!r.cancel,link:'',ok:false,edited:false,at:today()};
    txName(t);txLink(t);S.cardTx.push(t);add++});
  return{add,up}}
let txAt=0,txBusy=false,txErr='';
function txSync(force){if(!CLOUD||!S||mode!=='app'||S.settings.txAuto===false||txBusy)return;if(!force&&Date.now()-txAt<36e5)return;txAt=Date.now();txBusy=true;
  const st=S.settings,since=st.txSince?iso(new Date(new Date(st.txSince).getTime()-5*864e5)):iso(new Date(Date.now()-35*864e5));
  gsr('cardTx',since).then(r=>{txBusy=false;if(!r||!Array.isArray(r.tx))return;const e=Object.values(r.errs||{});txErr=e.length?e[0]:'';const res=txMerge(r.tx);st.txSince=today();if(!st.txFrom||since<st.txFrom)st.txFrom=since;
    if(res.add||res.up){commit();if(res.add)toast(`カードの利用を ${res.add}件 取り込みました`)}else{save();if(tab==='set')render()}})
    .catch(e=>{txBusy=false;txErr=String(e&&e.message||e).slice(0,120);if(tab==='set')render()})}
let txAll=false;
function vTx(){const list=(S.cardTx||[]).filter(t=>!t.voided).sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));if(!list.length)return'';const nw=list.filter(t=>!t.ok),show=(txAll?list:nw.length?nw:list).slice(0,txAll?80:6);
  const row=t=>`<button class="txr ${txCounts(t)?'':'off'}" data-act="txEdit" data-id="${t.id}"><span class="d">${+t.date.slice(5,7)}/${+t.date.slice(8)}</span><span class="n">${esc(t.name)}<small>${CARDN[t.card]}・${esc(t.cat)}${t.kind==='quick'?'・速報':''}${t.link?'・手で記録済みとまとめた':''}${t.ignore?'・数えない':''}${t.payer&&t.payer!=='本人'?'・'+esc(t.payer):''}</small></span><span class="amt">${yen(t.amount)}</span></button>`;
  return`<div class="card txc"><h2>💳 カードの利用 <span class="sub">${nw.length?`確認待ち ${nw.length}件`:'メールから自動で入ります'}</span></h2>${show.map(row).join('')}<div class="btns">${nw.length?'<button class="btn s" data-act="txOkAll">全部確かめた</button>':''}<button class="btn s plain" data-act="txAll">${txAll?'たたむ':'すべて見る'}</button></div><p class="hint">押すと名前・分け方・数えるかを直せます。お店ごとに覚えます。</p></div>`}
function vToday(){return todayTop()+dailyQ()+waitSummary()+vTx()+`<div id="rec"></div>`+vMicro()+`<div class="btns" style="margin:4px 0 16px"><button class="btn plain s" data-act="tab" data-t="week">📝 週の振り返り</button></div>`}
function vMicro(){
  const now=new Date(),ws=weekStart(now).getTime(),ym=nowYM(),td=today();
  const wk=S.logs.filter(l=>l.ts>=ws),mo=S.logs.filter(l=>iso(new Date(l.ts)).slice(0,7)===ym),tdl=S.logs.filter(l=>dnum(td)-dnum(iso(new Date(l.ts)))<=6&&l.ts<=Date.now()+864e5).sort((a,b)=>b.ts-a.ts);
  const mt=sum(mo),st=S.settings,bands={朝:0,昼:0,夜:0};mo.forEach(l=>bands[band(new Date(l.ts).getHours())]+=l.amount);
  const paced=S.quick.filter(q=>q.pace>0);
  return`<div class="card"><h2>${quickEdit?'ボタンを編集':'ワンタップで記録'}<button class="btn ${quickEdit?'':'ghost'} s" data-act="qEdit">${quickEdit?'完了':'✏️ 金額を変える'}</button></h2><div class="quick">${S.quick.map(q=>`<button class="${quickEdit?'ed':''}" data-act="${quickEdit?'editQuick':'log'}" data-k="${esc(q.key)}"><span class="ic">${esc(q.icon)}</span>${esc(q.label)}<small class="amt">${yen(q.amount)}${quickEdit?' ✏️':''}</small></button>`).join('')}${quickEdit&&S.quick.length<12?'<button class="ed" data-act="addQuick"><span class="ic">＋</span>ボタンを足す</button>':''}</div><p class="hint">${quickEdit?'直したいボタンを押してください。名前・金額・週のペースを変えられます。終わったら「完了」を押します。':'押すと今の時刻で記録します。押しまちがいは、出てくる「元に戻す」で取り消せます。'}</p></div>
  ${calHtml()}
  ${paced.length?`<div class="card"><h2>今週のペース <span class="sub">月曜はじまり</span></h2>${paced.map(q=>{const n=wk.filter(l=>l.key===q.key).length;let d='';for(let i=0;i<Math.max(q.pace,n);i++)d+=`<i class="${i<n?(i<q.pace?'f':'o'):''}"></i>`;return`<div class="row"><div class="l"><b>${esc(q.icon)} ${esc(q.label)}</b><small>${n} / 週${q.pace}回${n>q.pace?' ・ ペースを超えました':''}</small></div><span class="dots">${d}</span></div>`}).join('')}<p class="hint">好きなことは、決めたペースの中で気持ちよく。</p></div>`:''}
  <div class="card"><h2>今月の合計</h2><span class="amt big">${yen(mt)}</span><p class="hint">${mo.length} 回 ・ ${esc(st.familyLabel)} <b>${(mt/st.familyUnit).toFixed(1)}</b> 回分（1回 ${yen(st.familyUnit)}）</p>
    <div class="grid2" style="grid-template-columns:repeat(3,1fr);margin-top:10px">${Object.keys(bands).map(b=>`<div class="stat"><small>${b}</small>${A(bands[b])}</div>`).join('')}</div></div>
  <div class="card"><h2>この7日の記録 <button class="btn ghost s" data-act="logPast">＋ あとから記録</button></h2>${tdl.length?tdl.map(l=>{const d=new Date(l.ts);return`<div class="row"><div class="l"><b>${esc(l.label)}</b><small>${iso(d)===td?'今日':fmtD(iso(d))} ${pad(d.getHours())}:${pad(d.getMinutes())}</small></div><button class="btn plain s amt" data-act="editLog" data-id="${l.id}">${yen(l.amount)}</button><button class="x" data-act="del" data-l="log" data-id="${l.id}" aria-label="削除">✕</button></div>`}).join(''):'<p class="hint">この7日は記録がありません。押し忘れた分は「＋ あとから記録」で入れられます。</p>'}</div>`}

function vTxSet(){const st=S.settings,n=(S.cardTx||[]).length;return`<div class="card"><h2>💳 カードの利用を自動で入れる</h2>
  <div class="row"><div class="l"><b>${st.txAuto===false?'オフ':'オン'}</b><small>${!CLOUD?'Google の Apps Script で開いたときだけ動きます':st.txAuto===false?'楽天カード・Amazonカードの「利用のお知らせ」メールを読みません':`楽天カード・Amazonカードの「利用のお知らせ」メールから、日付・お店・金額を入れます。カード会社の正しいメールだけを読みます。${st.txSince?`最後に読んだ日 ${fmtD(st.txSince)}・`:''}これまで ${n}件`}${txErr?`<br><span class="neg">読めませんでした：${esc(txErr)}</span>`:''}</small></div><button class="btn plain s" data-act="txToggle">${st.txAuto===false?'オンにする':'オフにする'}</button></div>
  ${CLOUD&&st.txAuto!==false?'<div class="btns"><button class="btn s" data-act="txNow">いま読む</button></div>':''}
  <p class="hint">楽天e-NAVIの「カード利用お知らせメール」、Vpassの「ご利用通知サービス（メール・すべて通知）」を登録すると届きます。お店の名前と分け方は、直すと覚えます（${Object.keys(S.merchantMap||{}).length}店）。</p></div>`}
function vSet(){const st=S.settings;const r=(l,v,act)=>`<div class="row"><div class="l"><b>${l}</b></div><span>${v}</span><button class="btn plain s" data-act="${act}">変更</button></div>`;
  return`${vTxSet()}${PWA?`<div class="card"><h2>この端末のつながり</h2><div class="row"><div class="l"><b>Google ドライブとつないでいます</b><small>データは暗号化したまま、署名つきでやり取りしています</small></div><button class="btn plain s" data-act="unpair">切る</button></div></div>`:''}<div class="card"><h2>安全</h2>
    <div class="row"><div class="l"><b>パスコードで暗号化</b><small>${CLOUD?(KEY?'オン：暗号化してから Google ドライブに保存しています。パスコードがないと中身は読めません':'オフ：設定するまで保存されません'):KEY?'オン：保存データは暗号化されています':hasCrypto?'オフ：端末を開ける人なら見られる状態です':'この開き方では使えません'}</small></div>${hasCrypto?`<button class="btn ${KEY?'plain':''} s" data-act="setPass">${KEY?'変更':'設定する'}</button>${KEY&&!CLOUD?'<button class="btn warn s" data-act="rmPass">解除</button>':''}`:''}</div>
    ${KEY&&hasCrypto?`<div class="row"><div class="l"><b>この端末ではパスコードなしで開く</b><small>${devOn?'オン：この端末では入力なしで開きます。ドライブには暗号化したまま保存しています':'オフ：開くたびにパスコードを入れます'}</small></div><button class="btn ${devOn?'plain':''} s" data-act="devToggle">${devOn?'やめる':'オンにする'}</button></div>`:''}
    ${KEY&&!devOn?r('自動ロック',st.autoLockMin+'分 画面を離れたら','setAuto'):''}
    <ul class="plain"><li><b>Face ID で入れるには：</b>パスコードを入れたときに iPhone が「パスワードを保存」と聞いてきたら「保存」を押します。次からは入力欄を押すと、キーボードの上に出る候補から Face ID で入れられます。出てこないときは、iPhone の「設定 → パスワード」から自分で追加できます。</li>${CLOUD?'<li>データは、この端末でパスコードで暗号化してから、あなたの Google ドライブ（「ひと呼吸のデータ（暗号化）」フォルダ）に保存します。Mac と iPhone で同じデータを使えます。</li><li>パスコードはどこにも保存されず、送られません。</li>':'<li>データはこの端末のブラウザ内だけにあり、外部へ送信しません。</li>'}<li>パスコードを忘れると復元できません。下のバックアップを取っておいてください。</li></ul></div>
  <div class="card"><h2>家計簿と収支</h2><p class="hint">「家計簿」タブの各月の収入・支出合計・内訳を、「収支」の月ごとに入れます。</p><div class="btns"><button class="btn ghost" data-act="importKb">家計簿から取り込む</button></div></div>
  <div class="card"><h2>iPhone など別の端末で使う</h2><ul class="plain"><li>ホーム画面に置くと、アプリのように1タップで開けます（共有ボタン →「ホーム画面に追加」）。</li><li>アドレスの最後に <b>#buy</b> を付けると「買う前に預ける」、<b>#log</b> で「記録」が直接開きます。ショートカットやブックマークに使えます。</li><li>データは端末ごとに別々です。自動では同期しません。</li><li>移すときは、こちらで「書き出す」→ 向こうで「ファイルから読み込む」または「貼り付けて読み込む」。</li><li>パスコードを設定しておくと、書き出したファイルは暗号化されます。移す前に設定してください。</li><li>両方の端末で入力すると食い違います。入力する端末をひとつに決めるのがおすすめです。</li></ul></div>
  <div class="card"><h2>バックアップ</h2><p class="hint">${KEY?'パスコードで暗号化したまま書き出します。':'パスコード未設定のため、暗号化されていないファイルになります。'}</p>
    <div class="btns"><button class="btn ghost" data-act="export">書き出す</button><button class="btn plain" data-act="pickFile">ファイルから読み込む</button><button class="btn plain" data-act="pasteImport">貼り付けて読み込む</button></div></div>
  <div class="card"><h2>ルール</h2>${r('待つ対象の金額',yen(st.threshold)+' 以上','setThreshold')}${r('待ち時間',st.lockHours+' 時間','setLock')}${r('服の枠：集計の開始日',esc(st.mercariStart),'setMStart')}${r('服の枠：販売手数料',st.mercariFee+'%','setMFee')}${r('服の枠：家計に戻す割合',st.mercariLock+'%','setMLock')}${r('ボーナス（年間の合計）',yen(st.bonusYear),'setBonus')}${r('ボーナスの月',st.bonusMonths.length?st.bonusMonths.join('月・')+'月':'未設定','setBonusMonths')}${r('月の確認をうながす日','毎月 '+st.reviewDay+'日から','setReviewDay')}${r('換算の単位',esc(st.familyLabel)+' '+yen(st.familyUnit),'setFamily')}${r('今月使ってよい額（枠）',st.budget?yen(st.budget):'未設定','setBudget')}${r('メルペイあと払いの支払日',st.merpayDay>=28?'月末':'毎月 '+st.merpayDay+'日','setMerpayDay')}</div>
  <div class="card"><h2>ワンタップのボタン</h2>${S.quick.map(q=>`<div class="row"><div class="l"><b>${esc(q.icon)} ${esc(q.label)}</b><small>${q.pace?'週'+q.pace+'回まで':'ペースなし'}</small></div>${A(q.amount)}<button class="btn plain s" data-act="editQuick" data-k="${esc(q.key)}">変更</button></div>`).join('')}</div>
  <div class="card"><h2>データの消去</h2><div class="btns"><button class="btn warn" data-act="wipe">すべて消去する</button></div></div>`}

/* ---------- カウントダウン ---------- */
function tick(){if(mode!=='app'||tab!=='wait')return;S.wishes.forEach(w=>{const el=root.querySelector(`[data-cd="${w.id}"]`);if(el){const ms=leftMs(w);el.textContent=leftText(ms);el.classList.toggle('ok',ms<=0)}const b=root.querySelector(`[data-buy="${w.id}"]`);if(b)b.disabled=!canBuy(w)})}
setInterval(tick,15000);

/* ---------- 月の家計簿からの取り込み ----------
   家計簿の書き出しファイル（暗号化されたものも可）を読み、家計簿と同じ式で各月の収入と支出合計を出す */
const KDEF=[['income','income','収入'],['card','keep','カード支払い'],['amazon','keep','Amazon'],['mercari','keep','メルカリ'],['kinder','keep','幼稚園'],['other','keep','その他（口座に残す分）'],['loan','rent','住宅ローン'],['elec','rent','電気代'],['water','rent','水道代'],['remit','other','仕送り'],['car','memo','車ローン'],['tatekae','memo','立替']];
async function decRaw(o,pass){const iter=clamp(num(o.iter,ITER),10000,2000000),key=await deriveKey(pass,unb64(str(o.salt,100)),iter);const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(str(o.iv,100))},key,unb64(String(o.ct)));return JSON.parse(new TextDecoder().decode(pt))}
function kbRows(kd){if(!kd||typeof kd!=='object'||!kd.months||typeof kd.months!=='object')return[];
  const items=(Array.isArray(kd.items)&&kd.items.length?kd.items:KDEF.map(([id,group,label])=>({id,group,label}))).filter(x=>x&&typeof x==='object').slice(0,80).map(x=>({id:str(x.id,40),group:str(x.group,10),label:str(x.label,60)||'項目'}));
  return Object.keys(kd.months).filter(k=>YM.test(k)).sort().slice(-240).map(ym=>{const m=kd.months[ym]||{},n=x=>{const v=Number(x);return x==null||!Number.isFinite(v)?null:clamp(v,-1e9,1e9)},val=id=>n(m.v&&m.v[id]!=null?m.v[id]:m[id])||0,ovr=k=>{const x=n(m.ov&&m.ov[k]);return x==null&&k==='jaIn'?n(m.jaIn):x},o=(k,f)=>{const x=ovr(k);return x==null?f:x},sg=g=>items.filter(x=>x.group===g).reduce((t,x)=>t+val(x.id),0);
    const income=sg('income'),keep=o('keep',sg('keep')),rent=o('rent',sg('rent')),short=o('short',(n(m.jaBal)||0)-rent),jaIn=o('jaIn',short<0?Math.ceil(-short/1000)*1000:0),total=o('total',keep+jaIn+sg('other'));
    const det=items.filter(x=>x.group==='keep'&&val(x.id)).map(x=>({label:x.label,amount:val(x.id)}));if(jaIn)det.push({label:'JA入金',amount:jaIn});items.filter(x=>x.group==='other'&&val(x.id)).forEach(x=>det.push({label:x.label,amount:val(x.id)}));
    return{ym,income,total,det}})}
function applyKb(kd){const rs=kbRows(kd);if(!rs.length)return toast('月の家計簿のデータが見つかりませんでした');
  openForm(`家計簿から ${rs.length}か月分`,[{k:'p',label:'この内容で「月ごと」の収入・支出合計・内訳を置き換えます',type:'area',rows:Math.min(10,rs.length+1),readonly:1,value:rs.map(r=>`${fmtYM(r.ym)}　収入 ${yen(r.income)} ／ 支出合計 ${yen(r.total)}`).join('\n')}],()=>withUndo(`${rs.length}か月分を取り込みました`,()=>{
    rs.forEach(r=>{const items=r.det.map(d=>({id:uid(),label:d.label,amount:d.amount,auto:''}));let m=S.months.find(x=>x.month===r.ym);if(m){m.income=r.income;m.sheetExpense=r.total;m.items=items}else S.months.push({month:r.ym,note:'家計簿から',income:r.income,sheetExpense:r.total,items,hidden:[],excluded:[]})});
    S.months.sort((a,b)=>a.month.localeCompare(b.month));curMonth=rs[rs.length-1].ym;tab='home';homeView='month'}),{ok:'取り込む',desc:'「家計簿に載っていない支出」と「貯蓄・立替」はそのまま残ります。'})}
function kbHandle(o){if(o&&o.app===APP)return toast('これは「ひと呼吸」のバックアップです。設定の「ファイルから読み込む」を使ってください');
  if(o&&o.enc){if(!hasCrypto)return toast('この開き方では暗号化ファイルを開けません');openForm('家計簿のパスコード',[{k:'p',label:'月の家計簿で設定したパスコード',type:'password',req:1}],v=>{decRaw(o,v.p).then(applyKb).catch(()=>toast('パスコードが違うか、データが壊れています'))},{ok:'開く',user:'月の家計簿'})}else applyKb(o)}
function importKb(){if(S.kb)return applyKb(S.kb);if(CLOUD){gsr('loadBlob','k').then(r=>{let o=null;try{o=r&&r.text?JSON.parse(r.text):null}catch(e){}if(o)kbHandle(o);else{toast('ドライブに家計簿が見つからないので、ファイルから選んでください');importKbFile()}}).catch(()=>importKbFile());return}importKbFile()}
function importKbFile(){const i=document.createElement('input');i.type='file';i.accept='.json,application/json';i.onchange=()=>{const f=i.files[0];if(!f)return;if(f.size>5e6)return toast('ファイルが大きすぎます');const r=new FileReader();r.onload=()=>{let o;try{o=JSON.parse(String(r.result))}catch(e){return toast('JSONとして読めませんでした')}
  kbHandle(o)};r.readAsText(f)};i.click()}

/* ---------- 読み込み・書き出し ---------- */
function done(msg){undoSnap=null;enter();tab='kb';commit();toast(msg);if(CLOUD&&!KEY)setTimeout(()=>acts.setPass(),400)}
function importText(txt){
  if(txt.length>5e6)return toast('ファイルが大きすぎます');
  let o;try{o=JSON.parse(txt)}catch(e){return toast('JSONとして読めませんでした')}
  if(o&&o.enc){if(!hasCrypto)return toast('この開き方では暗号化ファイルを開けません');
    openForm('バックアップのパスコード',[{k:'p',label:'パスコード',type:'password',req:1}],v=>{decBlob(o,v.p).then(r=>{S=r.state;if(!KEY){KEY=r.key;SALT=r.salt;KITER=r.iter}done('読み込みました')}).catch(()=>toast('パスコードが違うか、ファイルが壊れています'))},{ok:'開く'})}
  else{try{S=sanitize(o&&o.state?o.state:o)}catch(e){return toast(e.message)}done('読み込みました')}}
function pickFile(){const i=document.createElement('input');i.type='file';i.accept='.json,application/json';i.onchange=()=>{const f=i.files[0];if(!f)return;if(f.size>5e6)return toast('ファイルが大きすぎます');const r=new FileReader();r.onload=()=>importText(String(r.result));r.readAsText(f)};i.click()}
async function exportData(){const out=KEY?await encState():{app:APP,enc:0,state:S},txt=JSON.stringify(out);
  openForm('バックアップ',[{k:'t',label:'うまく保存できないときは、下の文字をすべてコピーして保管してください',type:'area',value:txt,readonly:1}],()=>{try{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([txt],{type:'application/json'}));a.download=`hitokokyu-backup-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),4000)}catch(e){toast('保存できませんでした。文字をコピーしてください');return false}},{ok:'ファイルに保存',cancel:'閉じる'})}

/* ---------- 追加・編集の共通のしくみ ----------
   L: どのリストか / K: フォームの種類 / F: 入力欄 / MK: 入力からデータを作る */
const M=()=>S.months.find(x=>x.month===curMonth);
const L={flow:()=>S.flows,letgo:()=>S.letgo,hidden:()=>M().hidden,excluded:()=>M().excluded,items:()=>M().items,mp:()=>S.mercari.purchases,ms:()=>S.mercari.sales,p:()=>S.purchases,sub:()=>S.subs,wish:()=>S.wishes,fund:()=>S.funds,log:()=>S.logs};
const K=l=>['hidden','excluded','items'].includes(l)?'row':l;
const T={row:'項目',mp:'買ったもの',ms:'売ったもの',p:'購入の記録',sub:'サブスク',wish:'欲しいもの',fund:'備え',flow:'毎月の動き'};
const yen0=v=>v==null?'':v;
const F={
  row:o=>[{k:'label',label:'名前',req:1,value:o.label},{k:'amount',label:'金額（円）',type:'number',value:yen0(o.amount)}],
  mp:o=>[{k:'item',label:'品名',req:1,value:o.item},{k:'amount',label:'金額（円）',type:'number',value:yen0(o.amount)},{k:'date',label:'日付',type:'date',value:o.date||today(),req:1},{k:'payment',label:'支払い方法',type:'select',options:PAYS,value:o.payment||PAYS[0]}],
  ms:o=>[{k:'item',label:'品名',req:1,value:o.item},{k:'price',label:'売れた値段（円）',type:'number',value:yen0(o.price)},{k:'date',label:'日付',type:'date',value:o.date||today(),req:1}],
  p:o=>[{k:'item',label:'品名',req:1,value:o.item},{k:'amount',label:'金額（円）',type:'number',value:yen0(o.amount)},{k:'date',label:'日付',type:'date',value:o.date||today(),req:1},{k:'category',label:'種類',type:'select',options:PCATS,value:o.category||'日用品'},{k:'sub',label:'定期便',type:'check',value:!!o.sub},{k:'cycle',label:'定期便の間隔（か月）',type:'number',value:o.cycle||1}],
  sub:o=>[{k:'name',label:'名前',req:1,max:80,value:o.name},{k:'amount',label:'月額（円）',type:'number',value:yen0(o.amount)},{k:'day',label:'更新日（毎月何日か。0でなし）',type:'number',value:o.day||0},{k:'note',label:'メモ',max:100,value:o.note}],
  flow:o=>[{k:'label',label:'名前',req:1,max:40,value:o.label,ph:'例：給料、家賃、カード引き落とし'},{k:'amount',label:'金額（円）',type:'number',value:yen0(o.amount)},{k:'dir',label:'向き',type:'select',options:['出ていく','入ってくる'],value:o.dir==='in'?'入ってくる':'出ていく'},{k:'day',label:'毎月何日か（月末は31。まだ分からなければ0）',type:'number',value:o.day||0}],
  wish:o=>[{k:'item',label:'欲しいもの',req:1,value:o.item},{k:'price',label:'だいたいの値段（円）',type:'number',value:yen0(o.price)},{k:'category',label:'種類',type:'select',options:WCATS,value:o.category||'服・靴'},{k:'note',label:'ひとことメモ（なぜ欲しい？）',max:300,value:o.note}],
  fund:o=>[{k:'name',label:'名前',req:1,max:40,value:o.name},{k:'target',label:'必要な金額（円）',type:'number',value:yen0(o.target)},{k:'due',label:'支払う年月',type:'month',ph:'2027-05',max:7,req:1,value:o.due},{k:'saved',label:'いま貯まっている額（円）',type:'number',value:o.saved||0},{k:'cycle',label:'くり返し',type:'select',options:CYC.map(c=>c[0]),value:(CYC.find(c=>c[1]===(o.cycle||0))||CYC[0])[0]},{k:'note',label:'メモ',max:100,value:o.note}]
};
const MK={
  row:v=>({label:v.label,amount:v.amount}),
  mp:v=>({date:dstr(v.date),item:v.item,amount:v.amount,payment:v.payment}),
  ms:v=>({date:dstr(v.date),item:v.item,price:v.price}),
  p:v=>({date:dstr(v.date),item:v.item,amount:v.amount,category:v.category,sub:v.sub,cycle:clamp(Math.round(v.cycle)||1,1,12)}),
  sub:(v,o)=>({name:v.name,amount:v.amount,note:v.note,day:clamp(Math.round(v.day)||0,0,31),status:o?o.status:'継続'}),
  flow:v=>({label:v.label,amount:v.amount,dir:v.dir==='入ってくる'?'in':'out',day:clamp(Math.round(v.day)||0,0,31)}),
  wish:(v,o)=>o?{item:v.item,price:v.price,category:v.category,note:v.note}:{item:v.item,price:v.price,category:v.category,note:v.note,registeredAt:Date.now(),lockHours:v.price>=S.settings.threshold?S.settings.lockHours:0,answers:{q1:'',q2:'',q3:''},status:'waiting',decidedAt:''},
  fund:(v,o)=>{if(!YM.test(v.due)){toast('支払う年月は 2027-05 の形で入れてください');return false}return{name:v.name,target:v.target,saved:v.saved,due:v.due,cycle:CYC.find(c=>c[0]===v.cycle)[1],note:v.note,last:o?o.last:''}}
};
const setNum=(title,k,max,label)=>openForm(title,[{k:'v',label:label||title,type:'number',value:S.settings[k]}],v=>{S.settings[k]=clamp(v.v,0,max);commit()});

/* ---------- 操作 ---------- */
const acts={
  txEdit:d=>{const t=S.cardTx.find(x=>x.id===d.id);if(!t)return;const f=[{k:'n',label:'名前',value:t.name.startsWith('（')?'':t.name,max:40},{k:'c',label:'分け方',type:'select',options:TXCATS,value:t.cat},{k:'g',label:'今日使える額に',type:'select',options:['数える','数えない（投資・立替など）'],value:t.ignore?'数えない（投資・立替など）':'数える'}];
    if(t.link)f.push({k:'l',label:'手で入れた記録と',type:'select',options:['まとめる（二重に数えない）','別に数える'],value:'まとめる（二重に数えない）'});if(t.raw)f.push({k:'r',label:`このお店（${t.raw}）はいつもこうする`,type:'check',value:true});
    openForm(`${fmtD(t.date)}　${yen(t.amount)}`,f,v=>{t.name=String(v.n||'').trim().slice(0,40)||t.raw||t.name;t.cat=TXCATS.includes(v.c)?v.c:'その他';t.ignore=String(v.g).startsWith('数えない');if(t.link&&String(v.l).startsWith('別'))t.link='';t.edited=true;t.ok=true;
      if(v.r&&t.raw){const k=txKey(t.raw);S.merchantMap[k]={name:t.name,cat:t.cat,ignore:t.ignore};S.cardTx.forEach(x=>{if(x!==t&&!x.edited&&x.raw&&txKey(x.raw)===k){x.name=t.name;x.cat=t.cat;x.ignore=t.ignore}})}commit()},{desc:`${CARDN[t.card]}${t.raw?'・メールのお店の名前：'+t.raw:''}`})},
  txOkAll:()=>withUndo('カードの利用を確かめました',()=>S.cardTx.forEach(t=>t.ok=true)),
  txAll:()=>{txAll=!txAll;render()},
  txToggle:()=>{S.settings.txAuto=S.settings.txAuto===false;commit();if(S.settings.txAuto)txSync(true)},
  txNow:()=>{toast('カードの利用のメールを読んでいます…');txSync(true)},
  tab:d=>{tab=['micro','today','wait','week'].includes(d.t)?'kb':d.t;quickEdit=false;render();window.scrollTo(0,0)},
  goRec:()=>{tab='kb';render()},
  dq:d=>{S.daily[today()]=d.v==='no'?'no':'yes';commit();if(d.v==='no')toast('🌱 使わなかった日にしました');else{toast('下のボタンで記録しましょう');acts.goRec()}},
  dqReset:()=>{delete S.daily[today()];commit()},
  wkDone:d=>{const wk=d.wk;let r=S.weeks.find(w=>w.wk===wk);if(!r){r={wk,doneAt:'',note:'',snap:null};S.weeks.push(r)}const ta=document.getElementById('wknote');if(ta)r.note=ta.value.slice(0,300);const w=weekTarget(),stt=weekStats(wk,w.wk===wk?w.end:wk);r.snap={spent:stt.spent,wb:stt.wb,ns:stt.ns,saved:stt.saved};r.doneAt=today();commit();toast('振り返り、おつかれさまでした')},
  hide:()=>{render.hide=!render.hide;render()},
  lock:()=>lock(),
  undo:()=>{if(!undoSnap)return;try{S=sanitize(JSON.parse(undoSnap))}catch(e){return}undoSnap=null;enter();commit();toast('元に戻しました')},
  startEmpty:()=>{S=blank();done('はじめました')},
  pickFile,
  importKb:()=>importKb(),
  pasteImport:()=>openForm('貼り付けて読み込む',[{k:'t',label:'バックアップの文字を貼り付け',type:'area',req:1}],v=>{setTimeout(()=>importText(v.t),0)},{ok:'読み込む',desc:'いまのデータは置き換わります。'}),
  export:()=>exportData(),
  wipe:()=>PWA?toast('安全のため、iPhoneアプリからは消去できません（パソコンの Apps Script の画面から消去できます）'):ask(CLOUD?'Google ドライブに保存したデータを消去します。Mac と iPhone の両方から消えます（ドライブのゴミ箱に30日残ります）。':'この端末のデータをすべて消去します。元に戻せません。',()=>{clearTimeout(soonT);Dev.forget();S=null;KEY=null;SALT=null;undoSnap=null;try{localStorage.removeItem(LS)}catch(e){}if(CLOUD){gsr('deleteBlob',CAPP).catch(()=>{});Cloud.rev=null;Cloud.last=null;Cloud.pending=false}mode='first';render()},'消去する'),
  setPass:()=>openForm(KEY?'パスコードを変更':'パスコードを設定',[{k:'a',label:'新しいパスコード（6文字以上）',type:'password',ac:'new-password',req:1},{k:'b',label:'もう一度',type:'password',ac:'new-password',req:1}],v=>{if(v.a.length<6){toast('6文字以上にしてください');return false}if(v.a!==v.b){toast('2つが一致していません');return false}const salt=crypto.getRandomValues(new Uint8Array(16));deriveKey(v.a,salt,ITER).then(k=>{KEY=k;SALT=salt;KITER=ITER;commit();Dev.remember().then(()=>render());toast('暗号化しました。iPhone が「パスワードを保存」と聞いたら保存すると、次から Face ID で入れられます')}).catch(()=>toast('設定できませんでした'))},{desc:'忘れると復元できません。数字4桁より、覚えやすい長めの言葉がおすすめです。'}),
  repair:()=>{apiUnpair().then(()=>{S=null;KEY=null;SALT=null;mode='pair';render()})},
  unpair:()=>ask('この端末と Google ドライブのつながりを切りますか？ ドライブのデータは消えません。もう一度使うときは、つなぎ直します。',()=>{apiUnpair().then(()=>{S=null;KEY=null;SALT=null;mode='pair';render()})},'切る'),
  devToggle:()=>{if(devOn)ask('この端末でも、開くたびにパスコードを入れるようにしますか？',()=>{Dev.forget(true).then(()=>{render();toast('次から、パスコードを聞きます')})},'そうする');else Dev.remember(true).then(ok=>{render();toast(ok?'次からこの端末では、パスコードなしで開きます':'この開き方では使えませんでした')})},
  rmPass:()=>ask('暗号化を解除しますか？ データは暗号化されない状態で保存されます。',()=>{Dev.forget();KEY=null;SALT=null;commit()},'解除する'),
  setAuto:()=>setNum('自動ロックまでの分数（0ですぐ）','autoLockMin',120),
  setThreshold:()=>setNum('待つ対象の金額（円）','threshold',1e7),
  setLock:()=>setNum('待ち時間（時間）','lockHours',720),
  setMFee:()=>setNum('販売手数料（%）','mercariFee',100),
  setMLock:()=>setNum('家計に戻す割合（%）','mercariLock',100),
  setBonus:()=>setNum('ボーナス（年間の合計・円）','bonusYear',1e9),
  setMStart:()=>openForm('服の枠：集計の開始日',[{k:'v',label:'この日以降の売り買いで計算',type:'date',value:S.settings.mercariStart,req:1}],v=>{S.settings.mercariStart=dstr(v.v);commit()}),
  setFamily:()=>openForm('換算の単位',[{k:'l',label:'名前',value:S.settings.familyLabel,req:1,max:30},{k:'u',label:'1回あたりの金額（円）',type:'number',value:S.settings.familyUnit}],v=>{S.settings.familyLabel=v.l;S.settings.familyUnit=clamp(v.u,1,1e7);commit()}),
  qEdit:()=>{quickEdit=!quickEdit;render()},
  editQuick:d=>{const q=S.quick.find(x=>x.key===d.k);if(!q)return;openForm(q.label+' を直す',[{k:'a',label:'1回の金額（円）',type:'number',value:q.amount},{k:'l',label:'名前',value:q.label,req:1,max:20},{k:'i',label:'絵文字',value:q.icon,max:8},{k:'p',label:'週のペース（回。0でなし）',type:'number',value:q.pace}].concat(S.quick.length>1?[{k:'d',label:'このボタンを消す（これまでの記録は残ります）',type:'check',value:false}]:[]),v=>{if(v.d)return withUndo('ボタンを消しました',()=>{S.quick=S.quick.filter(x=>x!==q)});q.label=v.l;q.icon=v.i||'•';q.amount=clamp(v.a,0,1e7);q.pace=clamp(Math.round(v.p),0,50);commit();toast(`${q.label} を ${yen(q.amount)} にしました`)},{desc:'これから記録する分に使われます。すでに記録した分は変わりません。'})},
  addQuick:()=>openForm('ボタンを足す',[{k:'l',label:'名前',req:1,max:20,ph:'例：自販機'},{k:'a',label:'1回の金額（円）',type:'number',value:''},{k:'i',label:'絵文字',value:'',max:8,ph:'例：🥤'},{k:'p',label:'週のペース（回。0でなし）',type:'number',value:0}],v=>{if(S.quick.length>=12){toast('ボタンは12個までです');return false}S.quick.push({key:uid(),icon:v.i||'•',label:v.l,amount:clamp(v.a,0,1e7),pace:clamp(Math.round(v.p),0,50)});commit()},{ok:'追加'}),
  month:d=>{curMonth=d.m;render()},
  hv:d=>{tab='home';homeView=d.t;render();window.scrollTo(0,0)},
  year:d=>{curYear=+d.y;render()},
  ymGo:d=>{if(S.months.some(x=>x.month===d.m)){curMonth=d.m;homeView='month';render();window.scrollTo(0,0)}else acts.addMonth({m:d.m})},
  chk:d=>{const r=getRv(nowYM(),true);r.checks[d.k]=!r.checks[d.k];commit()},
  rvMonth:()=>{if(S.months.some(x=>x.month===nowYM())){curMonth=nowYM();acts.editMonth()}else acts.addMonth({m:nowYM()})},
  rvHidden:()=>{if(!S.months.some(x=>x.month===nowYM()))return acts.rvMonth();curMonth=nowYM();acts.add({l:'hidden'})},
  rvDone:()=>{const ym=nowYM(),r=getRv(ym,true),m=S.months.find(x=>x.month===ym),c=m?monthCalc(m):null;r.doneAt=today();r.snap={real:c?c.real:null,life:c?c.life:null,micro:sum(S.logs.filter(l=>inYM(l.ts,ym))),passed:sum(S.wishes.filter(w=>w.status==='passed'&&w.decidedAt.slice(0,7)===ym),'price'),fundSaved:sum(S.funds,'saved')};commit();toast(`${+ym.slice(5)}月の確認、おつかれさまでした`)},
  setReviewDay:()=>openForm('月の確認をうながす日',[{k:'v',label:'毎月何日から知らせるか（1〜28）',type:'number',value:S.settings.reviewDay}],v=>{S.settings.reviewDay=clamp(Math.round(v.v)||25,1,28);commit()},{desc:'給料日のあとなど、家計簿をつける日に合わせると続けやすくなります。'}),
  setBonusMonths:()=>openForm('ボーナスの月',[{k:'v',label:'月を「,」で区切って入れる',value:S.settings.bonusMonths.join(','),ph:'1,7',max:40}],v=>{const a=[...new Set(v.v.normalize('NFKC').split(/[^0-9]+/).filter(Boolean).map(Number).filter(x=>x>=1&&x<=12))].sort((x,y)=>x-y);S.settings.bonusMonths=a;commit()},{desc:'年間の合計を、ここで入れた月に等分して表示します。'}),
  addMonth:d=>{const last=S.months[S.months.length-1],next=(d&&d.m)||(last?ymS(ymN(last.month)+1):nowYM());
    openForm('月を追加',[{k:'m',label:'年月',type:'month',ph:'2027-01',value:next,req:1,max:7},{k:'i',label:'収入（円）',type:'number',value:last?last.income:''},{k:'e',label:'家計簿の支出合計（円）',type:'number',value:''},{k:'n',label:'メモ',value:'',max:100}].concat(last?[{k:'c',label:'前の月の内訳と貯蓄・立替を引き継ぐ',type:'check',value:true}]:[]),v=>{if(!YM.test(v.m)){toast('年月は 2027-01 の形で入れてください');return false}if(S.months.some(x=>x.month===v.m)){toast('その月はもうあります');return false}const cp=k=>v.c?last[k].map(r=>({id:uid(),label:r.label,amount:r.amount})):[];S.months.push({month:v.m,note:v.n,income:v.i,sheetExpense:v.e,items:cp('items'),hidden:[],excluded:cp('excluded')});S.months.sort((a,b)=>a.month.localeCompare(b.month));curMonth=v.m;if(homeView==='year'){homeView='month';tab='home'}commit()})},
  editMonth:()=>{const m=M();openForm(`${+m.month.slice(5)}月を直す`,[{k:'i',label:'収入（円）',type:'number',value:m.income},{k:'e',label:'家計簿の支出合計（円）',type:'number',value:m.sheetExpense},{k:'n',label:'メモ',value:m.note,max:100}],v=>{m.income=v.i;m.sheetExpense=v.e;m.note=v.n;commit()})},
  delMonth:()=>ask('この月のデータを消しますか？',()=>withUndo('月を消しました',()=>{S.months=S.months.filter(x=>x.month!==curMonth);curMonth=null;enter()}),'消す'),
  add:d=>{const k=K(d.l);let init={};
    if(k==='fund'&&d.p!=null){const p=PRESETS[+d.p];if(p){const y=+nowYM().slice(0,4),may=`${y}-05`;init={name:p.name,cycle:p.cycle,note:p.note,target:p.amt||'',due:p.may?(ymN(may)>=ymN(nowYM())?may:`${y+1}-05`):''}}}
    openForm(T[k]+'を追加',F[k](init),v=>{const o=MK[k](v,null);if(!o)return false;o.id=uid();if(k==='wish'){S.wishes.unshift(o);tab='wait'}else L[d.l]().push(o);openDet.add(d.l);commit();
      if(k==='wish')toast(o.lockHours?`預かりました。${o.lockHours}時間おきましょう`:'預かりました')},{ok:k==='wish'?'預ける':'追加',desc:k==='fund'?'金額がまだ分からなければ 0 のままで、あとから入れられます。':''})},
  edit:d=>{const k=K(d.l),o=L[d.l]().find(x=>x.id===d.id);if(!o)return;openForm(T[k]+'を直す',F[k](o),v=>{const n=MK[k](v,o);if(!n)return false;Object.assign(o,n);commit()})},
  del:d=>{const list=L[d.l](),i=list.findIndex(x=>x.id===d.id);if(i<0)return;withUndo('消しました',()=>list.splice(i,1))},
  pass:d=>{const w=S.wishes.find(x=>x.id===d.id);withUndo(`${yen(w.price)} を守りました`,()=>{w.status='passed';w.decidedAt=today()})},
  buy:d=>{const w=S.wishes.find(x=>x.id===d.id);if(!canBuy(w))return;const go=out=>withUndo('納得して決めた買い物です',()=>{w.status='bought';w.decidedAt=today();S.purchases.push({id:uid(),date:today(),item:w.item,amount:w.price,category:PCATS.includes(w.category)?w.category:'その他',sub:false,cycle:1});if(out)S.letgo.push({id:uid(),item:out,forItem:w.item,date:today(),done:false})});
    if(w.category==='服・靴')return openForm(`「${w.item}」を買うと決める`,[{k:'o',label:'代わりに手放す服・靴',req:1,max:80,ph:'例：黒のパーカー'}],v=>go(v.o),{ok:'決める',desc:'1着入れたら1着出す、が約束です。「服の枠」の手放す予定に入ります。'});
    ask(`「${w.item}」を買うと決めますか？`,()=>withUndo('納得して決めた買い物です',()=>{w.status='bought';w.decidedAt=today();S.purchases.push({id:uid(),date:today(),item:w.item,amount:w.price,category:PCATS.includes(w.category)?w.category:'その他',sub:false,cycle:1})}),'決める')},
  contrib:d=>{const f=S.funds.find(x=>x.id===d.id),c=fundCalc(f);withUndo(`${f.name} に ${yen(c.per)} 積みました`,()=>contrib(f))},
  contribAll:()=>{const p=fundsPending();if(!p)return;withUndo(`今月分 ${yen(p)} を積みました`,()=>S.funds.forEach(contrib))},
  paid:d=>{const f=S.funds.find(x=>x.id===d.id);ask(`「${f.name}」を支払い済みにしますか？`,()=>withUndo(f.cycle?`次回は ${fmtYM(ymS(ymN(f.due)+f.cycle))} です`:'おつかれさまでした',()=>{if(f.cycle){f.due=ymS(ymN(f.due)+f.cycle);f.saved=Math.max(0,f.saved-f.target);f.last=''}else S.funds=S.funds.filter(x=>x!==f)}),'支払った')},
  lgDone:d=>{const x=S.letgo.find(q=>q.id===d.id);if(x){x.done=!x.done;commit()}},
  setBudget:()=>{const n=flowNet()-fundsMonthly();openForm('今月使ってよい額',[{k:'v',label:'自由に使ってよい額（円・月）',type:'number',value:S.settings.budget||''}],v=>{S.settings.budget=clamp(v.v,0,1e8);commit()},{desc:(S.flows.length?`「毎月の動き」の差し引きから備えの積立を引くと ${yen(n)} です。`:'')+'服・コーヒー・サウナ・ネットの買い物など、固定費以外に使う分の上限です。0にすると表示を消します。'})},
  setBal:()=>openForm('いまの口座残高',[{k:'v',label:'引き落としに使う口座の残高（円）',type:'number',value:S.settings.balance==null?'':Math.max(0,S.settings.balance)}],v=>{S.settings.balance=v.v;S.settings.balanceAt=today();commit()},{desc:'口座番号などは不要です。金額だけ入れてください。'}),
  setMerpayDay:()=>openForm('メルペイあと払いの支払日',[{k:'v',label:'毎月何日か（月末は31）',type:'number',value:S.settings.merpayDay}],v=>{S.settings.merpayDay=clamp(Math.round(v.v)||31,1,31);commit()}),
  lifeSet:()=>{const L=S.settings.life,k=i=>(L&&L.kids[i])||{},f=[{k:'age',label:'自分の年齢',type:'number',value:L?L.age+(schoolYear()-L.base):''}];
    [0,1].forEach(i=>{const x=k(i);f.push({k:'n'+i,label:`${i+1}人目の呼び名（${i?'2人目がいなければ消して空に':'必ず入れてください'}）`,max:12,value:x.name||(L&&L.kids.length?'':(i?'下の子':'上の子'))},{k:'g'+i,label:`${i+1}人目のいまの学年`,type:'select',options:GRADES,value:x.grade?GRADES[clamp(GRADES.indexOf(x.grade)+(schoolYear()-(x.base||schoolYear())),0,GRADES.length-1)]:'小1'},{k:'h'+i,label:'高校',type:'select',options:['公立','私立'],value:x.hs||'公立'},{k:'u'+i,label:'大学',type:'select',options:LIFE_UNI,value:x.uni||'国公立'},{k:'a'+i,label:'大学は一人暮らし',type:'check',value:!!x.away})});
    openForm('人生グラフの前提',f,v=>{if(!(v.age>=18&&v.age<=80)){toast('年齢は18〜80で入れてください');return false}if(!v.n0&&!v.n1){toast('子どもの呼び名を入れてください');return false}const fy=schoolYear(),kids=[0,1].filter(i=>v['n'+i]).map(i=>({name:v['n'+i],grade:v['g'+i],hs:v['h'+i],uni:v['u'+i],away:v['a'+i],base:fy}));
      S.settings.life=lifeClean({age:Math.round(v.age),base:fy,kids});openDet.add('life');lifeSel=null;commit()},{desc:'いまの年度を基準に、毎年1学年ずつ進めて計算します。'})},
  addKid:()=>openForm('子どもの節目を足す',[{k:'n',label:'呼び名',req:1,max:12,ph:'例：上の子'},{k:'g',label:'いまの学年',type:'select',options:GRADES,value:'小1'},{k:'c',label:'中学',type:'select',options:['公立','私立'],value:'公立'},{k:'u',label:'大学入学まで入れる',type:'check',value:true}],v=>{const gs=eduGoals(v.n,v.g,v.c==='私立',v.u);if(!gs.length){toast('これから先の入学はありません');return false}
    withUndo(`${gs.length}つの節目を足しました`,()=>{gs.forEach(g=>S.funds.push({id:uid(),...g}))})},{ok:'足す',desc:'入学の前の3月を期日にして、小学校・中学・高校（・大学）の入学にかかるお金を入れます。金額は調査の平均なので、あとで名前を押して直せます。'}),
  setSaveMonthly:()=>openForm('実際に毎月いくら積む？',[{k:'v',label:'備えのために毎月よけている額（円。0で「必要な額」で表示）',type:'number',value:S.settings.saveMonthly||''}],v=>{S.settings.saveMonthly=clamp(v.v,0,1e8);commit()},{desc:'グラフの緑の線が、この額で貯めたときの貯まり方になります。'}),
  setGoal:()=>openForm('守ったお金の行き先',[{k:'n',label:'名前',value:S.settings.goalName,max:30,ph:'例：家族旅行'},{k:'a',label:'目標の金額（円。0でなし）',type:'number',value:S.settings.goalAmount||''}],v=>{S.settings.goalName=v.n;S.settings.goalAmount=clamp(v.a,0,1e9);commit()}),
  autoHidden:()=>{const m=M(),ms=autoMiss(m);if(!ms.length)return;withUndo('②に入れました',()=>{ms.forEach(x=>m.hidden.push({id:uid(),...x}));openDet.add('hidden')})},
  flowsFromItems:()=>{const m=S.months[S.months.length-1];if(!m)return;withUndo('内訳から作りました。日にちを入れてください',()=>{if(m.income)S.flows.push({id:uid(),label:'給料',amount:m.income,dir:'in',day:0});m.items.filter(r=>r.amount&&!r.label.includes('立替')).forEach(r=>S.flows.push({id:uid(),label:r.label,amount:r.amount,dir:'out',day:0}))})},
  logPast:()=>{const y=new Date();y.setDate(y.getDate()-1);openForm('あとから記録',[{k:'q',label:'どれ',type:'select',options:S.quick.map(q=>q.label),value:S.quick[0].label},{k:'d',label:'日付',type:'date',value:iso(y),req:1},{k:'a',label:'金額（円。空ならボタンの金額）',type:'number',opt:1,value:''}],v=>{const q=S.quick.find(x=>x.label===v.q)||S.quick[0],dt=dstr(v.d);if(dt>today()){toast('先の日付は入れられません');return false}const ts=new Date(+dt.slice(0,4),+dt.slice(5,7)-1,+dt.slice(8),12).getTime();S.logs.push({id:uid(),ts,key:q.key,label:q.label,amount:v.a==null?q.amount:v.a});commit();toast(`${fmtD(dt)} に ${q.label} を記録しました`)},{ok:'記録'})},
  paste:()=>openForm('明細を貼り付け',[{k:'t',label:'1行に1件。日付・品名・金額が入っていれば順番は自由です',type:'area',rows:8,req:1},{k:'to',label:'入れる先',type:'select',options:['購入履歴','メルカリで買ったもの'],value:'購入履歴'}],v=>{if(v.t.length>2e5){toast('長すぎます。分けて貼ってください');return false}const rs=parseLines(v.t);if(!rs.length){toast('金額のある行が見つかりませんでした');return false}
    setTimeout(()=>openForm(`${rs.length}件 読み取りました`,[{k:'p',label:'内容を確かめてください（合計 '+yen(sum(rs))+'）',type:'area',rows:9,readonly:1,value:rs.map(r=>`${r.date}　${yen(r.amount)}　${r.item}`).join('\n')}],()=>withUndo(`${rs.length}件を取り込みました`,()=>{rs.forEach(r=>v.to==='購入履歴'?S.purchases.push({id:uid(),date:r.date,item:r.item,amount:r.amount,category:'その他',sub:false,cycle:1}):S.mercari.purchases.push({id:uid(),date:r.date,item:r.item,amount:r.amount,payment:PAYS[0]}));openDet.add(v.to==='購入履歴'?'p':'mp')}),{ok:`${rs.length}件を取り込む`,desc:'読み違いがあれば、取り込んだあと名前を押して直せます。'}),0)},{ok:'読み取る'}),
  cycSub:d=>{const s=S.subs.find(x=>x.id===d.id);s.status=SUBST[(SUBST.indexOf(s.status)+1)%3];commit()},
  log:d=>{const q=S.quick.find(x=>x.key===d.k);withUndo(`${q.label} を記録しました`,()=>S.logs.push({id:uid(),ts:Date.now(),key:q.key,label:q.label,amount:q.amount}))},
  editLog:d=>{const l=S.logs.find(x=>x.id===d.id);openForm(l.label,[{k:'a',label:'金額（円）',type:'number',value:l.amount}],v=>{l.amount=v.a;commit()})}
};
document.addEventListener('click',e=>{const ly=e.target.closest&&e.target.closest('[data-ly]');if(ly){lifeSel=+ly.dataset.ly;openDet.add('life');render();return}const el=e.target.closest('[data-act]');if(!el||el.disabled)return;const f=acts[el.dataset.act];if(f)f(el.dataset)});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('[role=button]')){e.preventDefault();e.target.click()}});
document.addEventListener('toggle',e=>{const k=e.target.dataset&&e.target.dataset.det;if(k){if(e.target.open)openDet.add(k);else openDet.delete(k)}},true);
document.addEventListener('submit',e=>{if(e.target.id!=='pair')return;e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;b.textContent='つないでいます…';
  apiPair(document.getElementById('purl').value,document.getElementById('pcode').value).then(()=>{toast('つながりました');boot()}).catch(err=>{toast(err.message||'つながりませんでした');b.disabled=false;b.textContent='つなぐ'})});
document.addEventListener('submit',e=>{if(e.target.id!=='unlock')return;e.preventDefault();const p=document.getElementById('pass').value;if(!p)return;(CLOUD?cloudFetch().catch(()=>Cloud.last):Promise.resolve(readLS())).then(o=>{if(!o)throw new Error('none');return decBlob(o,p)}).then(r=>{S=r.state;KEY=r.key;SALT=r.salt;KITER=r.iter;Cloud.pending=false;cloudStatus('☁️ 保存済み');enter();render();route();Dev.remember().then(ok=>{if(ok)toast('次からこの端末では、パスコードなしで開きます')})}).catch(()=>{toast('パスコードが違います');document.getElementById('pass').select()})});
document.addEventListener('input',e=>{const t=e.target;
  if(t.dataset.ans){const w=S.wishes.find(x=>x.id===t.dataset.id);if(w){w.answers[t.dataset.ans]=t.value.slice(0,500);saveSoon();tick()}}
  else if(t.dataset.wknote){let r=S.weeks.find(w=>w.wk===t.dataset.wknote);if(!r){r={wk:t.dataset.wknote,doneAt:'',note:'',snap:null};S.weeks.push(r)}r.note=t.value.slice(0,300);saveSoon()}
  else if(t.dataset.rvnote){getRv(nowYM(),true).note=t.value.slice(0,300);saveSoon()}
  else if(t.id==='dupq'){dupQ=t.value;document.getElementById('dupres').innerHTML=dupHtml()}
  else if(t.id==='sim'){simPct=Number(t.value);document.getElementById('simp').textContent=simPct;const lux=S.purchases.filter(p=>p.sub&&p.category==='嗜好品・酒類').reduce((a,p)=>a+monthly(p),0);document.getElementById('simout').innerHTML=simHtml(lux)}});
boot();
