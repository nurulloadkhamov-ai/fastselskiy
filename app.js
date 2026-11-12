/* Fast Education — adolatli baholash tizimi (Supabase versiyasi) */
(function(){
"use strict";
var CFG = window.FE_CONFIG || {};

/* ============ Yordamchilar ============ */
var ROLES = {reception:"Receptionist", cleaner:"Cleaner", academic:"Academic support"};
var ROLE_COLORS = {reception:"#2450D6", cleaner:"#0F8A7E", academic:"#8A4FD1"};
var ACC_ROLES = {admin:"Admin (menejer)", teacher:"Ustoz", staff:"Xodim"};
var DOWS = ["Ya","Du","Se","Ch","Pa","Ju","Sh"];
var MONTHS = ["Yan","Fev","Mar","Apr","May","Iyn","Iyl","Avg","Sen","Okt","Noy","Dek"];
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function pad(n){return (n<10?"0":"")+n;}
function iso(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());}
function todayISO(){return iso(new Date());}
function parseISO(s){var p=s.split("-");return new Date(+p[0],+p[1]-1,+p[2]);}
function addDays(s,n){var d=parseISO(s);d.setDate(d.getDate()+n);return iso(d);}
function dow(s){return parseISO(s).getDay();}
function monthKey(d){return d.getFullYear()+"-"+pad(d.getMonth()+1);}
function addMonths(mk,n){var p=mk.split("-");return monthKey(new Date(+p[0],+p[1]-1+n,1));}
function monthLabel(mk){var p=mk.split("-");return MONTHS[+p[1]-1]+" "+p[0].slice(2);}
function fmtDate(s){if(!s)return "";var d=parseISO(s);return d.getDate()+" "+MONTHS[d.getMonth()]+" "+d.getFullYear();}
function nowHM(){var d=new Date();return pad(d.getHours())+":"+pad(d.getMinutes());}
function hmToMin(t){var p=String(t||"0:0").split(":");return (+p[0])*60+(+p[1]);}
function uid(p){return (p||"x")+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function avg(a){return a.length?a.reduce(function(x,y){return x+y;},0)/a.length:null;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function r1(v){return v==null?"—":(Math.round(v*10)/10).toString();}
function r0(v){return v==null?"—":Math.round(v).toString();}
function initials(n){return String(n).split(" ").map(function(x){return x[0]||"";}).join("").slice(0,2).toUpperCase();}
function rng(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;var t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function ls(k,v){try{if(v===undefined)return localStorage.getItem(k);if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v);}catch(e){return null;}}
function clone(o){return JSON.parse(JSON.stringify(o));}

/* ============ Server (Supabase RPC) ============ */
var ERRORS={login_failed:"Login yoki parol noto'g'ri",no_session:"Sessiya tugadi, qayta kiring",not_admin:"Bu amal faqat admin uchun",not_allowed:"Bu amalga ruxsatingiz yo'q",only_today:"Faqat bugungi vazifani belgilash mumkin",wrong_password:"Eski parol noto'g'ri",short_password:"Parol kamida 6 belgidan iborat bo'lsin",bad_username:"Login 3–32 belgi: lotin harflari, raqam, . _ -",password_required:"Yangi foydalanuvchi uchun parol kiriting",cannot_delete_self:"O'zingizni o'chira olmaysiz",cannot_demote_self:"O'zingizning admin rolingizni olib tashlay olmaysiz",already_done:"Topshiriq allaqachon bajarilgan",duty_not_found:"Vazifa topilmadi",task_not_found:"Topshiriq topilmadi"};
async function rpc(fn,args){
  var res;
  try{
    res=await fetch(CFG.SUPABASE_URL+"/rest/v1/rpc/"+fn,{method:"POST",headers:{"apikey":CFG.SUPABASE_KEY,"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify(args||{})});
  }catch(e){throw new Error("Server bilan aloqa yo'q. Internetni tekshiring.");}
  var txt=await res.text();var body=null;try{body=txt?JSON.parse(txt):null;}catch(e){body=txt;}
  if(!res.ok){
    var m=(body&&body.message)||("Xato "+res.status);
    if(m==="no_session"){logoutLocal();}
    if(/Could not find the function|schema cache/i.test(m))m="Server sozlanmagan: setup.sql Supabase'da ishga tushirilmagan";
    var err=new Error(ERRORS[m]||m);err.code=m;throw err;
  }
  return body;
}

/* ============ Demo ma'lumotlar ============ */
function defaultDuties(role){
  if(role==="reception")return [["08:30","Ofisni ochish, qabulxonani tayyorlash"],["09:00","Lidlar bazasini yangilash va qo'ng'iroqlar"],["11:00","Kunlik to'lovlarni tekshirish"],["14:00","Yangi o'quvchilarni ro'yxatga olish"],["18:30","Kunlik hisobotni menejerga topshirish"]];
  if(role==="cleaner")return [["07:30","Sinfxonalarni tozalash (dars oldidan)"],["10:00","Hojatxonalarni tozalash va tekshirish"],["13:00","Koridor va zinapoyalarni yuvish"],["16:00","Chiqindilarni olib chiqish"],["20:00","Yakuniy tozalash, derazalarni yopish"]];
  return [["08:45","O'quvchilar davomatini tekshirish"],["10:00","Ustozlar dars rejasini ko'rib chiqish"],["12:00","Qiynalayotgan o'quvchilar bilan qo'shimcha dars"],["15:00","Ota-onalarga qo'ng'iroq (davomat bo'yicha)"],["17:30","Mock test natijalarini kiritish"]];
}
function defaultSettings(){return {lateMin:30,tw:{lesson:40,manager:30,tasks:15,complaints:15},bw:{teachers:40,staff:30,growth:30}};}
function emptyData(){return {v:2,branches:[],teachers:[],evals:[],ratings:[],complaints:[],staff:[],duties:[],tasks:[],settings:defaultSettings()};}
function seed(){
  var R=rng(20261111), T=todayISO(), now=new Date();
  function pick(a){return a[Math.floor(R()*a.length)];}
  function ri(a,b){return a+Math.floor(R()*(b-a+1));}
  var branches=[{id:"b1",name:"Chilonzor",base:420,trend:0.04},{id:"b2",name:"Yunusobod",base:510,trend:0.025},{id:"b3",name:"Sergeli",base:260,trend:-0.02},{id:"b4",name:"Mirzo Ulug'bek",base:340,trend:0.01}].map(function(b){
    var st=[],c=b.base,m0=monthKey(new Date(now.getFullYear(),now.getMonth()-5,1));
    for(var i=0;i<6;i++){st.push({m:addMonths(m0,i),c:Math.round(c)});c=c*(1+b.trend+(R()-0.5)*0.03);}
    return {id:b.id,name:b.name,students:st};});
  var tn=["Aziza Karimova","Jasur Toshmatov","Malika Yusupova","Sardor Rahimov","Dilnoza Ergasheva","Bekzod Aliyev","Nigora Saidova","Otabek Qodirov","Shahnoza Mirzayeva","Ulug'bek Nurmatov","Kamola Xasanova","Javohir Ismoilov","Madina Abdullayeva","Akmal Sobirov","Feruza Olimova","Sherzod Usmonov","Gulnoza Hamidova","Rustam Jo'rayev","Zarina Tursunova","Doniyor Salimov"];
  var subj=["General English","IELTS","Kids English","Matematika","Rus tili","SAT","CEFR"];
  var teachers=[],evals=[],ratings=[],complaints=[],quality={b1:0.8,b2:0.7,b3:0.55,b4:0.65};
  tn.forEach(function(n,i){
    var b=branches[i%4],t={id:"t"+(i+1),name:n,branchId:b.id,subject:pick(subj)};teachers.push(t);
    var q=quality[b.id]+(R()-0.5)*0.35,k;
    for(k=ri(3,6);k>0;k--)evals.push({id:uid("e"),teacherId:t.id,date:addDays(T,-ri(1,80)),c:[0,0,0,0].map(function(){return clamp(Math.round(5+q*5+(R()-0.5)*3),3,10);}),note:pick(["Dars rejasi aniq, o'quvchilar faol.","Vaqt boshqaruvini yaxshilash kerak.","Interaktiv mashg'ulotlar ko'p bo'ldi.","Uy vazifasi tekshirilmagan.","Speaking qismi kuchli.",""]),by:"Menejer"});
    for(k=ri(2,4);k>0;k--)ratings.push({id:uid("r"),teacherId:t.id,date:addDays(T,-ri(1,85)),score:clamp(Math.round(5+q*5+(R()-0.5)*3),2,10),work:pick(["Ochiq dars o'tkazdi","Mock test tashkil qildi","Marketing tadbirida qatnashdi","Yangi guruh ochdi","O'quvchilar natijasi oshdi","Hisobotlarni vaqtida topshirdi"]),comment:""});
    for(k=(R()<q?ri(0,1):ri(1,3));k>0;k--)complaints.push({id:uid("c"),teacherId:t.id,date:addDays(T,-ri(1,70)),source:pick(["Ota-ona","O'quvchi","Xodim"]),text:pick(["Darsga kechikib keldi","Uy vazifalarini tekshirmaydi","O'quvchilarga qo'pol munosabat","Dars tushunarsiz o'tdi","Darsni sababsiz qoldirdi","Telefon bilan band bo'ldi"]),status:pick(["tasdiqlangan","tasdiqlangan","yangi","rad"])});
  });
  var sn=["Sevara Komilova","Nodira Rasulova","Lola Ahmedova","Gulchehra Bozorova","Mohira Yo'ldosheva","Ra'no Qurbonova","Zuhra Tojiyeva","Muhabbat Sharipova","Dilshod Xolmatov","Islom Nazarov","Shoira Ibragimova","Behruz Karimov","Oydin Musayeva","Nilufar G'aniyeva","Sanjar Valiyev","Hulkar Rustamova"];
  var roles=["reception","cleaner","cleaner","academic"],staff=[],duties=[],logs={};
  sn.forEach(function(n,i){
    var b=branches[Math.floor(i/4)],s={id:"s"+(i+1),name:n,branchId:b.id,role:roles[i%4]};staff.push(s);
    defaultDuties(s.role).forEach(function(d){duties.push({id:uid("d"),staffId:s.id,time:d[0],title:d[1],days:[1,2,3,4,5,6]});});
    var rel=clamp(quality[b.id]+0.15+(R()-0.5)*0.3,0.35,0.98),my=duties.filter(function(d){return d.staffId===s.id;});
    for(var k=30;k>=1;k--){var dt=addDays(T,-k);if(dow(dt)===0)continue;my.forEach(function(d){if(R()<rel)logs[dt+"|"+d.id]={s:R()<0.85?"d":"l",at:d.time};});}
  });
  var tasks=[["teacher","t1","Ochiq dars tayyorlash","Yangi metodika bo'yicha ochiq dars",5,"yuqori","jarayonda"],["teacher","t3","Mock test savollarini tuzish","IELTS mock uchun 40 ta savol",-2,"o'rta","bajarildi"],["teacher","t7","Guruh natijalari hisobotini topshirish","Oylik hisobot",-3,"o'rta","yangi"],["teacher","t10","Ota-onalar majlisida chiqish","",7,"past","yangi"],["teacher","t2","Yangi kitob bo'yicha dars rejasi","Kids English 2-bosqich",-6,"o'rta","bajarildi"],["teacher","t12","Darsdan qolgan o'quvchilar bilan ishlash","",-1,"yuqori","yangi"],["staff","s1","Lidlar bazasini CRMga ko'chirish","",3,"yuqori","jarayonda"],["staff","s5","Ota-onalar uchun SMS xabarnoma","",-1,"o'rta","bajarildi"],["staff","s10","Ombordagi tozalash vositalarini sanash","",2,"past","yangi"],["staff","s12","Mock test xonasini tayyorlash","",-4,"o'rta","yangi"]].map(function(a){return {id:uid("k"),type:a[0],assigneeId:a[1],title:a[2],desc:a[3],deadline:addDays(T,a[4]),priority:a[5],status:a[6],created:addDays(T,-8),doneAt:a[6]==="bajarildi"?addDays(T,a[4]-1):null};});
  return {data:{v:2,demo:true,branches:branches,teachers:teachers,evals:evals,ratings:ratings,complaints:complaints,staff:staff,duties:duties,tasks:tasks,settings:defaultSettings()},logs:logs};
}

/* ============ Holat ============ */
var AUTH=null; try{AUTH=JSON.parse(ls("fe_auth")||"null");}catch(e){AUTH=null;}
var S=null, LOGS={}, VERSION=0, loaded=false, loadErr="", busy=0, accounts=null;
var ui={view:"dashboard",tTab:"reyting",tBranch:"all",tSearch:"",sRole:"all",sBranch:"all",sDate:todayISO(),taskFilter:"ochiq",adm:ls("fe_adm_tab")||"baholash",admTeacher:"",admStaff:"",drawer:null,loginErr:"",armed:null,accRole:"teacher"};
function me(){return AUTH||{};}
function isAdmin(){return me().role==="admin";}
function logoutLocal(){AUTH=null;ls("fe_auth",null);S=null;loaded=false;accounts=null;render();}

async function load(silent){
  if(!AUTH)return;
  try{
    var r=await rpc("get_state",{p_token:AUTH.token});
    S=r.data;LOGS=r.logs||{};VERSION=r.version||0;loaded=true;loadErr="";
    if(r.me){AUTH.role=r.me.role;AUTH.person_id=r.me.person_id;ls("fe_auth",JSON.stringify(AUTH));}
    if(S){S.settings=Object.assign(defaultSettings(),S.settings||{});["branches","teachers","evals","ratings","complaints","staff","duties","tasks"].forEach(function(k){if(!Array.isArray(S[k]))S[k]=[];});}
    if(isAdmin()&&accounts===null){try{accounts=await rpc("list_accounts",{p_token:AUTH.token});}catch(e){accounts=[];}}
  }catch(e){if(!silent)loadErr=e.message;}
  render();
}
function setBusy(d){busy+=d;var el=document.getElementById("savestate");if(el)el.innerHTML=saveLabel();}
function saveLabel(){return busy?'<span class="dot" style="background:var(--brand)"></span>Saqlanmoqda…':'<span class="dot" style="background:var(--good)"></span>Saqlangan';}
var toastT;function toast(m,bad){var o=document.querySelector(".toast");if(o)o.remove();var d=document.createElement("div");d.className="toast";if(bad)d.style.background="var(--bad)";d.textContent=m;document.body.appendChild(d);clearTimeout(toastT);toastT=setTimeout(function(){d.remove();},2800);}

/* Admin o'zgarishi: mutatsiya funksiyasi lokal qo'llanadi va serverga yuboriladi.
   Agar boshqa odam ham o'zgartirgan bo'lsa, eng yangi holat olinib, mutatsiya qayta qo'llanadi. */
async function commit(mut,msg){
  var before=clone(S);setBusy(1);
  try{
    mut(S);render();
    for(var attempt=0;attempt<3;attempt++){
      var r=await rpc("admin_save",{p_token:AUTH.token,p_data:S,p_version:VERSION});
      if(!r.conflict){VERSION=r.version;if(msg)toast(msg);return true;}
      var fresh=await rpc("get_state",{p_token:AUTH.token});LOGS=fresh.logs||{};VERSION=fresh.version;S=fresh.data||emptyData();S.settings=Object.assign(defaultSettings(),S.settings||{});mut(S);
    }
    throw new Error("Saqlab bo'lmadi, sahifani yangilang");
  }catch(e){S=before;toast(e.message,true);return false;}
  finally{setBusy(-1);render();}
}

/* ============ Hisob-kitob ============ */
function byId(arr,id){for(var i=0;i<arr.length;i++)if(arr[i].id===id)return arr[i];return null;}
function branchName(id){var b=byId(S.branches,id);return b?b.name:"—";}
function evalScore(e){return avg(e.c);}
function since(days){return addDays(todayISO(),-days);}
function weighted(parts){var sw=0,sv=0;parts.forEach(function(p){if(p.v!=null&&p.w>0){sw+=p.w;sv+=p.v*p.w;}});return sw?sv/sw:null;}
function teacherStats(t){
  var from=since(90);
  var ev=S.evals.filter(function(e){return e.teacherId===t.id&&e.date>=from;});
  var rt=S.ratings.filter(function(e){return e.teacherId===t.id&&e.date>=from;});
  var cp=S.complaints.filter(function(e){return e.teacherId===t.id;});
  var cpConf=cp.filter(function(c){return c.status==="tasdiqlangan"&&c.date>=from;}).length;
  if(t.cpConf90!=null&&!isAdmin()&&me().person_id!==t.id)cpConf=t.cpConf90; // boshqalar uchun faqat son
  var cpNew=cp.filter(function(c){return c.status==="yangi";}).length;
  var tk=S.tasks.filter(function(k){return k.type==="teacher"&&k.assigneeId===t.id;});
  var tkDue=tk.filter(function(k){return k.status==="bajarildi"||k.deadline<todayISO();});
  var tkDone=tkDue.filter(function(k){return k.status==="bajarildi";}).length;
  var lesson=ev.length?avg(ev.map(evalScore)):null, mgr=rt.length?avg(rt.map(function(r){return r.score;})):null;
  var tasksPct=tkDue.length?tkDone/tkDue.length*100:null, compScore=clamp(100-cpConf*20,0,100), w=S.settings.tw;
  var total=weighted([{v:lesson==null?null:lesson*10,w:w.lesson},{v:mgr==null?null:mgr*10,w:w.manager},{v:tasksPct,w:w.tasks},{v:compScore,w:w.complaints}]);
  return {lesson:lesson,mgr:mgr,tasksPct:tasksPct,tkDone:tkDone,tkDue:tkDue.length,cpConf:cpConf,cpNew:cpNew,cpAll:cp.length,compScore:compScore,total:total,nEval:ev.length,nRate:rt.length};
}
/* Shikoyat matnlari faqat adminga ko'rinadi; reyting adolatli chiqishi uchun admin har saqlashda
   har bir ustozning 90 kunlik tasdiqlangan shikoyatlari sonini (cpConf90) yozib qo'yadi. */
function stampComplaintCounts(D){var from=addDays(todayISO(),-90);D.teachers.forEach(function(t){t.cpConf90=D.complaints.filter(function(c){return c.teacherId===t.id&&c.status==="tasdiqlangan"&&c.date>=from;}).length;});}
function dutiesOn(staffId,date){var d=dow(date);return S.duties.filter(function(x){return x.staffId===staffId&&x.days.indexOf(d)>=0;}).sort(function(a,b){return a.time<b.time?-1:1;});}
function logOf(date,dutyId){return LOGS[date+"|"+dutyId]||null;}
function effRange(staffId,from,to){
  var assigned=0,pts=0,d=from,T=todayISO(),hm=hmToMin(nowHM());
  while(d<=to){dutiesOn(staffId,d).forEach(function(x){
      if(d===T&&hmToMin(x.time)+S.settings.lateMin>hm&&!logOf(d,x.id))return;
      assigned++;var l=logOf(d,x.id);if(l)pts+=l.s==="d"?1:0.5;});
    d=addDays(d,1);}
  return assigned?pts/assigned*100:null;
}
function staffStats(s){var T=todayISO();return {day:effRange(s.id,T,T),week:effRange(s.id,addDays(T,-6),T),month:effRange(s.id,addDays(T,-29),T)};}
function branchStats(b){
  var ts=S.teachers.filter(function(t){return t.branchId===b.id;}).map(function(t){return teacherStats(t).total;}).filter(function(v){return v!=null;});
  var sf=S.staff.filter(function(s){return s.branchId===b.id;}).map(function(s){return staffStats(s).month;}).filter(function(v){return v!=null;});
  var st=b.students.slice().sort(function(a,c){return a.m<c.m?-1:1;});
  var last=st.length?st[st.length-1]:null, prev=st.length>1?st[st.length-2]:null, base=st.length>3?st[st.length-4]:(st.length?st[0]:null);
  var growth=(last&&base&&base.c&&base!==last)?(last.c-base.c)/base.c*100:null;
  var mGrowth=(last&&prev&&prev.c)?(last.c-prev.c)/prev.c*100:null;
  var growthScore=growth==null?null:clamp(50+growth*5,0,100), w=S.settings.bw, tAvg=avg(ts), sAvg=avg(sf);
  return {tAvg:tAvg,sAvg:sAvg,growth:growth,mGrowth:mGrowth,growthScore:growthScore,total:weighted([{v:tAvg,w:w.teachers},{v:sAvg,w:w.staff},{v:growthScore,w:w.growth}]),students:last?last.c:0,series:st};
}
function ranked(list,fn){return list.map(function(x){return {x:x,s:fn(x)};}).sort(function(a,b){return (b.s.total==null?-1:b.s.total)-(a.s.total==null?-1:a.s.total);});}
function level(v){if(v==null)return {c:"b-neu",t:"Ma'lumot yo'q"};if(v>=85)return {c:"b-good",t:"Yaxshi"};if(v>=65)return {c:"b-warn",t:"O'rtacha"};return {c:"b-bad",t:"Past"};}
function lvlBadge(v){var l=level(v);return '<span class="badge '+l.c+'">'+(v==null?"—":r0(v)+"%")+' · '+l.t+'</span>';}
function myPerson(){var m=me();if(m.role==="teacher")return byId(S.teachers,m.person_id);if(m.role==="staff")return byId(S.staff,m.person_id);return null;}

/* ============ Ikonkalar va navigatsiya ============ */
var IC={
 dashboard:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/></svg>',
 filiallar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6"/></svg>',
 ustozlar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/></svg>',
 xodimlar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 1 0 0-6M22 21c0-3-2-5-5-5.5"/></svg>',
 topshiriqlar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg>',
 admin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
 profil:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></svg>'
};
function navItems(){
  var n=[["dashboard","Dashboard"],["filiallar","Filiallar reytingi"],["ustozlar","Ustozlar"],["xodimlar","Xodimlar (Staff)"],["topshiriqlar",isAdmin()?"Topshiriqlar":"Mening topshiriqlarim"]];
  if(isAdmin())n.push(["admin","Admin panel"]);
  n.push(["profil","Profil"]);return n;
}
var TITLES={dashboard:["Dashboard","Umumiy ko'rsatkichlar — bugun, "+fmtDate(todayISO())],filiallar:["Filiallar reytingi","Ustozlar ishi, xodimlar samaradorligi va o'quvchilar o'sishi asosida"],ustozlar:["Ustozlar","Dars sifati, shikoyatlar va menejer baholari"],xodimlar:["Xodimlar (Staff)","Kunlik vazifalar va samaradorlik"],topshiriqlar:["Topshiriqlar","Ustoz va xodimlarga berilgan topshiriqlar"],admin:["Admin panel","Menejer uchun boshqaruv"],profil:["Profil","Hisobingiz va parolni o'zgartirish"]};

/* ============ Grafiklar ============ */
function lineChart(series,opts){
  opts=opts||{};var W=opts.w||520,H=opts.h||180,pl=40,pr=14,pt=14,pb=26,col=opts.color||"#2450D6";
  if(!series.length)return '<div class="empty">Ma\'lumot yo\'q</div>';
  var vals=series.map(function(p){return p.c;}),mn=Math.min.apply(null,vals),mx=Math.max.apply(null,vals),padv=Math.max(5,(mx-mn)*0.25);
  mn=Math.max(0,Math.floor((mn-padv)/10)*10);mx=Math.ceil((mx+padv)/10)*10;
  var x=function(i){return pl+(series.length===1?(W-pl-pr)/2:i*(W-pl-pr)/(series.length-1));};
  var y=function(v){return pt+(H-pt-pb)*(1-(v-mn)/(mx-mn||1));};
  var g='';for(var k=0;k<=3;k++){var gv=mn+(mx-mn)*k/3;g+='<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+y(gv)+'" y2="'+y(gv)+'" stroke="#EEF1F6"/><text x="'+(pl-6)+'" y="'+(y(gv)+4)+'" font-size="10.5" fill="#7C859A" text-anchor="end">'+Math.round(gv)+'</text>';}
  var path=series.map(function(p,i){return (i?"L":"M")+x(i).toFixed(1)+" "+y(p.c).toFixed(1);}).join(" ");
  var area=path+" L"+x(series.length-1)+" "+(H-pb)+" L"+x(0)+" "+(H-pb)+" Z";
  var pts=series.map(function(p,i){var prev=i?series[i-1].c:null,ch=prev?((p.c-prev)/prev*100):null;
    return '<circle cx="'+x(i)+'" cy="'+y(p.c)+'" r="4" fill="#fff" stroke="'+col+'" stroke-width="2"/><rect x="'+(x(i)-16)+'" y="'+pt+'" width="32" height="'+(H-pt-pb)+'" fill="transparent" data-tip="'+esc(monthLabel(p.m)+": "+p.c+" o'quvchi"+(ch!=null?"\n"+(ch>=0?"+":"")+r1(ch)+"% oldingi oyga nisbatan":""))+'"/><text x="'+x(i)+'" y="'+(H-8)+'" font-size="10.5" fill="#7C859A" text-anchor="middle">'+monthLabel(p.m)+'</text>';}).join("");
  var last=series[series.length-1];
  return '<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="display:block">'+g+'<path d="'+area+'" fill="'+col+'" opacity=".07"/><path d="'+path+'" fill="none" stroke="'+col+'" stroke-width="2" stroke-linejoin="round"/>'+pts+'<text x="'+(x(series.length-1)-6)+'" y="'+(y(last.c)-10)+'" font-size="12" font-weight="800" fill="#141A2A" text-anchor="end">'+last.c+'</text></svg>';
}
function scoreCell(v){return '<div class="scorecell"><div class="bar" style="flex:1"><i style="width:'+(v==null?0:clamp(v,0,100))+'%"></i></div><b>'+r0(v)+'</b></div>';}
function rankBadge(i){return '<span class="rank '+(i<3?"r"+(i+1):"")+'">'+(i+1)+'</span>';}
function kpi(l,v,n){return '<div class="card kpi"><div class="lbl">'+l+'</div><div class="val">'+v+'</div><div class="note">'+n+'</div></div>';}
function assigneeName(k){var p=k.type==="teacher"?byId(S.teachers,k.assigneeId):byId(S.staff,k.assigneeId);return p?p.name+" · "+(k.type==="teacher"?"Ustoz":ROLES[p.role]):"—";}

/* ============ Ko'rinishlar ============ */
function viewDashboard(){
  var T=todayISO(),tot=0,totPrev=0;
  S.branches.forEach(function(b){var s=b.students.slice().sort(function(a,c){return a.m<c.m?-1:1;});if(s.length){tot+=s[s.length-1].c;totPrev+=(s.length>1?s[s.length-2].c:s[s.length-1].c);}});
  var ch=totPrev?(tot-totPrev)/totPrev*100:0;
  var tAll=S.teachers.map(function(t){return teacherStats(t).total;}).filter(function(v){return v!=null;});
  var sDay=S.staff.map(function(s){return staffStats(s).day;}).filter(function(v){return v!=null;});
  var sMonth=S.staff.map(function(s){return staffStats(s).month;}).filter(function(v){return v!=null;});
  var overdue=S.tasks.filter(function(k){return k.status!=="bajarildi"&&k.deadline<T;});
  var br=ranked(S.branches,branchStats), tr=ranked(S.teachers,teacherStats).slice(0,5);
  var months={};S.branches.forEach(function(b){b.students.forEach(function(p){months[p.m]=(months[p.m]||0)+p.c;});});
  var series=Object.keys(months).sort().slice(-6).map(function(m){return {m:m,c:months[m]};});
  var h='';
  var mp=myPerson();
  if(mp){
    if(me().role==="teacher"){var ts=teacherStats(mp),rk=ranked(S.teachers,teacherStats).map(function(r){return r.x.id;}).indexOf(mp.id)+1;
      h+='<div class="card" style="margin-bottom:16px;border-color:#C9D6FB;background:linear-gradient(0deg,#fff,#F3F6FF)"><div class="flex between"><div><h3>Salom, '+esc(mp.name)+'!</h3><div class="muted small">Sizning umumiy ballingiz va o\'rningiz</div></div><div class="flex"><span class="badge b-pri" style="font-size:14px">'+r0(ts.total)+' ball</span><span class="badge b-neu" style="font-size:14px">'+rk+'-o\'rin / '+S.teachers.length+'</span><button class="btn sm" data-act="openTeacher" data-id="'+mp.id+'">Batafsil</button></div></div></div>';}
    else {var ss=staffStats(mp);h+='<div class="card" style="margin-bottom:16px;border-color:#C9D6FB;background:linear-gradient(0deg,#fff,#F3F6FF)"><div class="flex between"><div><h3>Salom, '+esc(mp.name)+'!</h3><div class="muted small">Bugungi vazifalaringizni «Xodimlar» bo\'limida belgilang</div></div><div class="flex"><span class="badge b-pri" style="font-size:14px">Bugun: '+(ss.day==null?"—":r0(ss.day)+"%")+'</span><span class="badge b-neu" style="font-size:14px">Oylik: '+(ss.month==null?"—":r0(ss.month)+"%")+'</span><a class="btn sm pri" href="#xodimlar">Vazifalarim</a></div></div></div>';}
  }
  h+='<div class="grid g4">'+kpi("Jami o'quvchilar",tot.toLocaleString("ru-RU"),'<span class="'+(ch>=0?"up":"down")+'">'+(ch>=0?"▲ +":"▼ ")+r1(ch)+'%</span> oldingi oyga nisbatan')+
   kpi("Ustozlar o'rtacha balli",r0(avg(tAll)),S.teachers.length+" ta ustoz · 100 ballik tizim")+
   kpi("Xodimlar bugungi samaradorligi",sDay.length?r0(avg(sDay))+"%":"—","Oylik: "+(sMonth.length?r0(avg(sMonth))+"%":"—")+" · "+S.staff.length+" ta xodim")+
   (isAdmin()?kpi("Ko'rib chiqilmagan shikoyatlar",S.complaints.filter(function(c){return c.status==="yangi";}).length,overdue.length+" ta topshiriq muddati o'tgan"):kpi("Filiallar",S.branches.length,overdue.length+" ta topshiriq muddati o'tgan"))+'</div>';
  h+='<div class="grid g21 mt"><div class="card"><div class="card-h"><div><h3>Filiallar reytingi</h3><div class="sub" style="margin:0">Umumiy ball (0–100)</div></div><a class="btn sm" href="#filiallar">Batafsil</a></div>'+
    (br.length?br.map(function(r,i){return '<div class="hbar-row"><div class="name">'+(i+1)+'. '+esc(r.x.name)+'</div><div class="hbar" data-tip="'+esc(r.x.name+"\nUstozlar: "+r0(r.s.tAvg)+"\nXodimlar: "+r0(r.s.sAvg)+"%\nO'sish: "+(r.s.growth==null?"—":r1(r.s.growth)+"%"))+'"><i style="width:'+clamp(r.s.total||0,0,100)+'%"></i></div><div class="v">'+r0(r.s.total)+'</div></div>';}).join(""):'<div class="empty">Filiallar qo\'shilmagan</div>')+
  '</div><div class="card"><h3>O\'quvchilar soni dinamikasi</h3><div class="sub">Barcha filiallar, oxirgi 6 oy</div>'+lineChart(series,{h:200})+'</div></div>';
  h+='<div class="grid g2 mt"><div class="card"><div class="card-h"><h3>Top 5 ustoz</h3><a class="btn sm" href="#ustozlar">Barchasi</a></div>'+(tr.length?'<table><tbody>'+
    tr.map(function(r,i){return '<tr class="click" data-act="openTeacher" data-id="'+r.x.id+'"><td style="width:40px">'+rankBadge(i)+'</td><td><b>'+esc(r.x.name)+'</b><div class="muted small">'+esc(branchName(r.x.branchId))+' · '+esc(r.x.subject)+'</div></td><td style="width:42%">'+scoreCell(r.s.total)+'</td></tr>';}).join("")+'</tbody></table>':'<div class="empty">Ustozlar yo\'q</div>')+
  '</div><div class="card"><div class="card-h"><h3>Muddati o\'tgan topshiriqlar</h3><a class="btn sm" href="#topshiriqlar">Barchasi</a></div>'+
   (overdue.length?'<table><tbody>'+overdue.slice(0,6).map(function(k){return '<tr><td><b>'+esc(k.title)+'</b><div class="muted small">'+esc(assigneeName(k))+'</div></td><td class="num"><span class="badge b-bad">'+fmtDate(k.deadline)+'</span></td></tr>';}).join("")+'</tbody></table>':'<div class="empty">Muddati o\'tgan topshiriq yo\'q 👌</div>')+'</div></div>';
  h+='<div class="card mt"><h3>Bugungi vazifalar bajarilishi — rollar bo\'yicha</h3><div class="sub">Vaqti kelgan vazifalar hisobga olinadi</div><div class="grid g3">'+
   Object.keys(ROLES).map(function(rk){var arr=S.staff.filter(function(s){return s.role===rk;}),d=arr.map(function(s){return staffStats(s).day;}).filter(function(v){return v!=null;}),w=arr.map(function(s){return staffStats(s).week;}).filter(function(v){return v!=null;});
     return '<div class="eff" style="padding:14px"><span>'+ROLES[rk]+' · '+arr.length+' kishi</span><div class="flex between" style="margin-top:6px"><b style="font-size:24px">'+(d.length?r0(avg(d))+"%":"—")+'</b>'+lvlBadge(avg(w))+'</div><div class="muted small">Haftalik: '+(w.length?r0(avg(w))+"%":"—")+'</div></div>';}).join("")+'</div></div>';
  return h;
}
function viewBranches(){
  var br=ranked(S.branches,branchStats),w=S.settings.bw;
  var h='<div class="formula" style="margin-bottom:16px"><b>Filial balli qanday hisoblanadi:</b> ustozlar o\'rtacha balli <code>'+w.teachers+'%</code> + xodimlar oylik samaradorligi <code>'+w.staff+'%</code> + o\'quvchilar o\'sishi <code>'+w.growth+'%</code>. O\'sish balli: oxirgi 3 oydagi o\'zgarish, 0% = 50 ball, har +1% = +5 ball (+10% va undan yuqori = 100).</div>';
  if(!br.length)return h+'<div class="card empty">Filiallar qo\'shilmagan</div>';
  return h+'<div class="grid g2">'+br.map(function(r,i){var s=r.s;
    return '<div class="card branch-card"><div class="card-h"><div class="flex">'+rankBadge(i)+'<div><h3>'+esc(r.x.name)+'</h3><div class="muted small">'+S.teachers.filter(function(t){return t.branchId===r.x.id;}).length+' ustoz · '+S.staff.filter(function(t){return t.branchId===r.x.id;}).length+' xodim · '+s.students+' o\'quvchi</div></div></div><div style="text-align:right"><div class="score">'+r0(s.total)+'</div><div class="muted small">umumiy ball</div></div></div>'+
     comp("Ustozlar ishi",s.tAvg)+comp("Xodimlar samaradorligi",s.sAvg)+comp("O'quvchilar o'sishi",s.growthScore)+
     '<div class="small mt">3 oylik o\'sish: <span class="'+((s.growth||0)>=0?"up":"down")+'">'+(s.growth==null?"—":((s.growth>=0?"+":"")+r1(s.growth)+"%"))+'</span> · oxirgi oy: <span class="'+((s.mGrowth||0)>=0?"up":"down")+'">'+(s.mGrowth==null?"—":((s.mGrowth>=0?"+":"")+r1(s.mGrowth)+"%"))+'</span></div>'+lineChart(s.series.slice(-6),{h:150})+'</div>';}).join("")+'</div>';
}
function comp(l,v){return '<div class="comp"><span class="muted" style="font-weight:600">'+l+'</span><div class="bar"><i style="width:'+(v==null?0:clamp(v,0,100))+'%"></i></div><b class="num">'+r0(v)+'</b></div>';}
function branchSelect(name,val,all){return '<select class="in" data-model="'+name+'">'+(all?'<option value="all">Barcha filiallar</option>':'')+S.branches.map(function(b){return '<option value="'+b.id+'"'+(val===b.id?" selected":"")+'>'+esc(b.name)+'</option>';}).join("")+'</select>';}
function viewTeachers(){
  var tabs=[["reyting","Ustozlar reytingi"],["sifat","Darslar sifati"],["shikoyat",isAdmin()?"Shikoyatlar":"Menga kelgan shikoyatlar"]];
  if(me().role==="staff")tabs=tabs.slice(0,2);
  if(!tabs.some(function(t){return t[0]===ui.tTab;}))ui.tTab="reyting";
  var h='<div class="tabs">'+tabs.map(function(t){return '<button class="tab'+(ui.tTab===t[0]?" on":"")+'" data-act="tTab" data-id="'+t[0]+'">'+t[1]+'</button>';}).join("")+'</div>';
  h+='<div class="filters">'+branchSelect("tBranch",ui.tBranch,true)+'<input class="in" placeholder="Ism bo\'yicha qidirish" data-model="tSearch" value="'+esc(ui.tSearch)+'"></div>';
  var list=S.teachers.filter(function(t){return (ui.tBranch==="all"||t.branchId===ui.tBranch)&&(!ui.tSearch||t.name.toLowerCase().indexOf(ui.tSearch.toLowerCase())>=0);}),w=S.settings.tw;
  if(ui.tTab==="reyting"){
    var rk=ranked(list,teacherStats);
    h+='<div class="formula" style="margin-bottom:16px"><b>Ustoz balli (oxirgi 90 kun):</b> dars sifati <code>'+w.lesson+'%</code> + menejer bahosi <code>'+w.manager+'%</code> + topshiriqlar bajarilishi <code>'+w.tasks+'%</code> + shikoyatlar <code>'+w.complaints+'%</code> (har bir tasdiqlangan shikoyat −20 ball; ko\'rib chiqilmagan yoki rad etilgan shikoyat ballga ta\'sir qilmaydi). Ma\'lumoti yo\'q ko\'rsatkich hisobdan chiqariladi.</div>';
    h+='<div class="card scroll"><table><thead><tr><th>#</th><th>Ustoz</th><th>Filial</th><th class="num">Dars sifati</th><th class="num">Menejer bahosi</th><th class="num">Topshiriqlar</th><th class="num">Shikoyatlar</th><th style="min-width:160px">Umumiy ball</th></tr></thead><tbody>'+
    rk.map(function(r,i){var s=r.s,mine=r.x.id===me().person_id;return '<tr class="click" data-act="openTeacher" data-id="'+r.x.id+'"'+(mine?' style="background:#F3F6FF"':'')+'><td>'+rankBadge(i)+'</td><td><b>'+esc(r.x.name)+'</b>'+(mine?' <span class="badge b-pri">Siz</span>':'')+'<div class="muted small">'+esc(r.x.subject)+'</div></td><td>'+esc(branchName(r.x.branchId))+'</td><td class="num">'+r1(s.lesson)+'<span class="muted">/10</span></td><td class="num">'+r1(s.mgr)+'<span class="muted">/10</span></td><td class="num">'+(s.tasksPct==null?"—":r0(s.tasksPct)+"%")+'<div class="muted small">'+s.tkDone+'/'+s.tkDue+'</div></td><td class="num">'+(s.cpConf?'<span class="badge b-bad">'+s.cpConf+' tasdiq.</span>':'<span class="badge b-good">0</span>')+(s.cpNew?' <span class="badge b-warn">'+s.cpNew+' yangi</span>':'')+'</td><td>'+scoreCell(s.total)+'</td></tr>';}).join("")+
    '</tbody></table>'+(rk.length?'':'<div class="empty">Ustoz topilmadi</div>')+'</div>';
  } else if(ui.tTab==="sifat"){
    var ids=list.map(function(t){return t.id;}),crit=["Tayyorgarlik","Metodika","O'quvchilar faolligi","Vaqt boshqaruvi"];
    var ev=S.evals.filter(function(e){return ids.indexOf(e.teacherId)>=0;}).sort(function(a,b){return a.date<b.date?1:-1;});
    var ca=crit.map(function(_,k){return avg(ev.map(function(e){return e.c[k];}));});
    h+='<div class="grid g4">'+crit.map(function(c,k){return kpi(c,r1(ca[k])+'<span class="muted" style="font-size:16px">/10</span>',"O'rtacha, "+ev.length+" ta kuzatuv");}).join("")+'</div>';
    h+='<div class="card mt scroll"><h3>Dars kuzatuvlari</h3><div class="sub">Menejer tomonidan darsga kirib baholangan natijalar</div><table><thead><tr><th>Sana</th><th>Ustoz</th>'+crit.map(function(c){return '<th class="num">'+c+'</th>';}).join("")+'<th class="num">O\'rtacha</th><th>Izoh</th></tr></thead><tbody>'+
     ev.map(function(e){var t=byId(S.teachers,e.teacherId),sc=evalScore(e);return '<tr class="click" data-act="openTeacher" data-id="'+e.teacherId+'"><td class="muted">'+fmtDate(e.date)+'</td><td><b>'+esc(t?t.name:"—")+'</b></td>'+e.c.map(function(v){return '<td class="num">'+v+'</td>';}).join("")+'<td class="num"><span class="badge '+level(sc*10).c+'">'+r1(sc)+'</span></td><td class="small muted">'+esc(e.note)+'</td></tr>';}).join("")+
    '</tbody></table>'+(ev.length?'':'<div class="empty">Kuzatuvlar yo\'q</div>')+'</div>';
  } else {
    var ids2=list.map(function(t){return t.id;}),cp=S.complaints.filter(function(c){return ids2.indexOf(c.teacherId)>=0;}).sort(function(a,b){return a.date<b.date?1:-1;}),cnt={yangi:0,tasdiqlangan:0,rad:0};
    cp.forEach(function(c){cnt[c.status]++;});
    h+='<div class="grid g3">'+kpi("Ko'rib chiqilmoqda",cnt.yangi,"Admin tasdiqlashi yoki rad etishi kerak")+kpi("Tasdiqlangan",cnt.tasdiqlangan,"Ballga ta'sir qiladi")+kpi("Rad etilgan",cnt.rad,"Asossiz deb topilgan")+'</div>';
    h+='<div class="card mt scroll"><h3>Shikoyatlar</h3><div class="sub">Shikoyat faqat menejer tasdiqlagandan keyin reytingga ta\'sir qiladi. '+(isAdmin()?"":"Siz faqat o'zingizga kelgan shikoyatlarni ko'rasiz.")+'</div><table><thead><tr><th>Sana</th><th>Ustoz</th><th>Manba</th><th>Shikoyat</th><th>Holat</th></tr></thead><tbody>'+
     cp.map(function(c){var t=byId(S.teachers,c.teacherId);return '<tr><td class="muted">'+fmtDate(c.date)+'</td><td><b>'+esc(t?t.name:"—")+'</b><div class="muted small">'+esc(t?branchName(t.branchId):"")+'</div></td><td>'+esc(c.source)+'</td><td>'+esc(c.text)+'</td><td>'+cBadge(c.status)+'</td></tr>';}).join("")+
    '</tbody></table>'+(cp.length?'':'<div class="empty">Shikoyatlar yo\'q</div>')+'</div>';
  }
  return h;
}
function cBadge(s){return s==="tasdiqlangan"?'<span class="badge b-bad">Tasdiqlangan</span>':s==="rad"?'<span class="badge b-neu">Rad etilgan</span>':'<span class="badge b-warn">Ko\'rib chiqilmoqda</span>';}
function teacherDrawer(id){
  var t=byId(S.teachers,id);if(!t)return "";var s=teacherStats(t),showC=isAdmin()||me().person_id===id;
  var ev=S.evals.filter(function(e){return e.teacherId===id;}).sort(function(a,b){return a.date<b.date?1:-1;});
  var rt=S.ratings.filter(function(e){return e.teacherId===id;}).sort(function(a,b){return a.date<b.date?1:-1;});
  var cp=S.complaints.filter(function(e){return e.teacherId===id;}).sort(function(a,b){return a.date<b.date?1:-1;});
  var tk=S.tasks.filter(function(k){return k.type==="teacher"&&k.assigneeId===id;});
  var h='<div class="flex between"><div><h2>'+esc(t.name)+'</h2><div class="muted">'+esc(branchName(t.branchId))+' · '+esc(t.subject)+'</div></div><button class="btn" data-act="closeDrawer">Yopish ✕</button></div>';
  h+='<div class="grid g2 mt">'+kpi("Umumiy ball",r0(s.total),level(s.total).t)+kpi("Dars sifati",r1(s.lesson)+'<span class="muted" style="font-size:16px">/10</span>',s.nEval+" ta kuzatuv (90 kun)")+kpi("Menejer bahosi",r1(s.mgr)+'<span class="muted" style="font-size:16px">/10</span>',s.nRate+" ta baho (90 kun)")+kpi("Tasdiqlangan shikoyatlar",s.cpConf,"oxirgi 90 kun")+'</div>';
  h+='<div class="card mt"><h3>Menejer baholari</h3>'+(rt.length?rt.map(function(r){return '<div class="list-item flex between"><div><b>'+esc(r.work)+'</b><div class="muted small">'+fmtDate(r.date)+(r.comment?" · "+esc(r.comment):"")+'</div></div><span class="badge '+level(r.score*10).c+'">'+r.score+'/10</span></div>';}).join(""):'<div class="empty">Baholar yo\'q</div>')+'</div>';
  h+='<div class="card mt"><h3>Dars kuzatuvlari</h3>'+(ev.length?ev.map(function(e){return '<div class="list-item flex between"><div><b>'+fmtDate(e.date)+'</b><div class="muted small">Tayyorgarlik '+e.c[0]+' · Metodika '+e.c[1]+' · Faollik '+e.c[2]+' · Vaqt '+e.c[3]+(e.note?"<br>"+esc(e.note):"")+'</div></div><span class="badge '+level(evalScore(e)*10).c+'">'+r1(evalScore(e))+'</span></div>';}).join(""):'<div class="empty">Kuzatuvlar yo\'q</div>')+'</div>';
  if(showC)h+='<div class="card mt"><h3>Shikoyatlar</h3>'+(cp.length?cp.map(function(c){return '<div class="list-item flex between"><div><b>'+esc(c.text)+'</b><div class="muted small">'+fmtDate(c.date)+' · '+esc(c.source)+'</div></div>'+cBadge(c.status)+'</div>';}).join(""):'<div class="empty">Shikoyatlar yo\'q</div>')+'</div>';
  h+='<div class="card mt"><h3>Topshiriqlar</h3>'+(tk.length?tk.map(taskLine).join(""):'<div class="empty">Topshiriqlar yo\'q</div>')+'</div>';
  return h;
}
function taskLine(k){return '<div class="list-item flex between"><div><b>'+esc(k.title)+'</b><div class="muted small">Muddat: '+fmtDate(k.deadline)+'</div></div>'+tBadge(k)+'</div>';}
function tBadge(k){if(k.status==="bajarildi")return '<span class="badge b-good">Bajarildi</span>';if(k.deadline<todayISO())return '<span class="badge b-bad">Muddati o\'tgan</span>';if(k.status==="jarayonda")return '<span class="badge b-pri">Jarayonda</span>';return '<span class="badge b-neu">Yangi</span>';}

function viewStaff(){
  var T=todayISO(),tabs=[["all","Barchasi"],["reception","Receptionists"],["cleaner","Cleaners"],["academic","Academic support"]];
  var h='<div class="tabs">'+tabs.map(function(t){return '<button class="tab'+(ui.sRole===t[0]?" on":"")+'" data-act="sRole" data-id="'+t[0]+'">'+t[1]+'</button>';}).join("")+'</div>';
  h+='<div class="filters">'+branchSelect("sBranch",ui.sBranch,true)+'<input type="date" class="in" data-model="sDate" value="'+ui.sDate+'" max="'+T+'">'+(ui.sDate!==T?'<button class="btn sm" data-act="sToday">Bugun</button>':'')+'<span class="muted small">'+(isAdmin()?"Admin: istalgan kunni belgilash mumkin (bosish: bajarildi → kechikdi → bekor)":"Faqat o'zingizning bugungi vazifangizni belgilaysiz. Vaqtidan "+S.settings.lateMin+" daqiqa kech belgilansa — «kechikdi» (0.5 ball). Vaqt server soati bo'yicha olinadi.")+'</span></div>';
  var list=S.staff.filter(function(s){return (ui.sRole==="all"||s.role===ui.sRole)&&(ui.sBranch==="all"||s.branchId===ui.sBranch);});
  var mine=me().role==="staff"?me().person_id:null;
  list.sort(function(a,b){return (a.id===mine?-1:0)-(b.id===mine?-1:0);});
  var stats=list.map(staffStats);
  function av(k){var a=stats.map(function(x){return x[k];}).filter(function(v){return v!=null;});return a.length?r0(avg(a))+"%":"—";}
  h+='<div class="grid g3">'+kpi("Kunlik samaradorlik",av("day"),"Bugun vaqti kelgan vazifalar")+kpi("Haftalik samaradorlik",av("week"),"Oxirgi 7 kun")+kpi("Oylik samaradorlik",av("month"),"Oxirgi 30 kun")+'</div>';
  h+='<div class="grid g3 mt">'+list.map(function(s,i){return staffCard(s,stats[i]);}).join("")+'</div>'+(list.length?'':'<div class="card empty">Xodim topilmadi</div>');
  return h;
}
function staffCard(s,st){
  var date=ui.sDate,T=todayISO(),ds=dutiesOn(s.id,date),hm=hmToMin(nowHM());
  var can=isAdmin()||(me().role==="staff"&&me().person_id===s.id&&date===T);
  var done=ds.filter(function(d){return logOf(date,d.id);}).length;
  var items=ds.map(function(d){var l=logOf(date,d.id),stt;
    if(l)stt=l.s==="d"?'<span class="badge b-good">✓ '+esc(l.at||"")+'</span>':'<span class="badge b-warn">Kechikdi '+esc(l.at||"")+'</span>';
    else if(date<T||hmToMin(d.time)+S.settings.lateMin<hm)stt='<span class="badge b-bad">Bajarilmagan</span>';
    else stt='<span class="badge b-neu">Kutilmoqda</span>';
    return '<div class="todo-item'+(l?" done":"")+'"><span class="t">'+d.time+'</span><button class="chk '+(l?(l.s==="d"?"d":"l"):"")+'" data-act="tick" data-id="'+d.id+'" '+(can?"":"disabled")+' aria-label="Belgilash">'+(l?"✓":"")+'</button><span class="ttl">'+esc(d.title)+'</span>'+stt+'</div>';}).join("");
  var tk=S.tasks.filter(function(k){return k.type==="staff"&&k.assigneeId===s.id&&k.status!=="bajarildi";});
  var isMe=me().role==="staff"&&me().person_id===s.id;
  return '<div class="card staff-card"'+(isMe?' style="border-color:#9DB4F5;box-shadow:0 0 0 3px var(--brand-soft)"':'')+'><div class="staff-head"><div class="ava" style="background:'+ROLE_COLORS[s.role]+'">'+initials(s.name)+'</div><div style="min-width:0"><b>'+esc(s.name)+'</b>'+(isMe?' <span class="badge b-pri">Siz</span>':'')+'<div class="muted small">'+ROLES[s.role]+' · '+esc(branchName(s.branchId))+'</div></div></div>'+
   '<div class="eff3"><div class="eff"><span>Kunlik</span><b>'+(st.day==null?"—":r0(st.day)+"%")+'</b></div><div class="eff"><span>Haftalik</span><b>'+(st.week==null?"—":r0(st.week)+"%")+'</b></div><div class="eff"><span>Oylik</span><b>'+(st.month==null?"—":r0(st.month)+"%")+'</b></div></div>'+
   '<div class="flex between"><b class="small">Kunlik to-do · '+fmtDate(date)+'</b><span class="muted small">'+done+'/'+ds.length+'</span></div><div class="todo">'+(items||'<div class="empty small">Bu kunga vazifa yo\'q</div>')+'</div>'+
   (tk.length?'<div><b class="small">Ochiq topshiriqlar</b>'+tk.map(taskLine).join("")+'</div>':'')+'</div>';
}
function viewTasks(){
  var T=todayISO(),f=[["ochiq","Ochiq"],["muddat","Muddati o'tgan"],["bajarildi","Bajarilgan"],["all","Barchasi"]],m=me();
  var list=S.tasks.filter(function(k){
    if(!isAdmin()&&!(k.type===m.role&&k.assigneeId===m.person_id))return false;
    if(ui.taskFilter==="ochiq")return k.status!=="bajarildi";if(ui.taskFilter==="muddat")return k.status!=="bajarildi"&&k.deadline<T;if(ui.taskFilter==="bajarildi")return k.status==="bajarildi";return true;}).sort(function(a,b){return a.deadline<b.deadline?-1:1;});
  var h='<div class="tabs">'+f.map(function(t){return '<button class="tab'+(ui.taskFilter===t[0]?" on":"")+'" data-act="taskFilter" data-id="'+t[0]+'">'+t[1]+'</button>';}).join("")+'</div>';
  h+='<div class="card scroll"><table><thead><tr><th>Topshiriq</th>'+(isAdmin()?'<th>Kimga</th>':'')+'<th>Muhimlik</th><th>Muddat</th><th>Holat</th><th></th></tr></thead><tbody>'+
   list.map(function(k){return '<tr><td><b>'+esc(k.title)+'</b>'+(k.desc?'<div class="muted small">'+esc(k.desc)+'</div>':'')+'</td>'+(isAdmin()?'<td>'+esc(assigneeName(k))+'</td>':'')+'<td>'+prBadge(k.priority)+'</td><td class="muted">'+fmtDate(k.deadline)+'</td><td>'+tBadge(k)+'</td><td class="num" style="white-space:nowrap">'+
     (k.status==="yangi"?'<button class="btn sm" data-act="taskSt" data-id="'+k.id+'" data-v="jarayonda">Boshlash</button> ':'')+(k.status!=="bajarildi"?'<button class="btn sm pri" data-act="taskSt" data-id="'+k.id+'" data-v="bajarildi">Bajarildi</button>':(isAdmin()?'<button class="btn sm" data-act="taskSt" data-id="'+k.id+'" data-v="jarayonda">Qayta ochish</button>':''))+'</td></tr>';}).join("")+
  '</tbody></table>'+(list.length?'':'<div class="empty">Topshiriqlar yo\'q</div>')+'</div>';
  return h;
}
function prBadge(p){return p==="yuqori"?'<span class="badge b-bad">Yuqori</span>':p==="past"?'<span class="badge b-neu">Past</span>':'<span class="badge b-warn">O\'rta</span>';}
function viewProfile(){
  var m=me(),p=myPerson();
  return '<div class="grid g3"><div class="card"><h3>Hisobingiz</h3><div class="list-item"><span class="muted small">Login</span><div><b>'+esc(m.username)+'</b></div></div><div class="list-item"><span class="muted small">Rol</span><div><b>'+ACC_ROLES[m.role]+'</b></div></div>'+(p?'<div class="list-item"><span class="muted small">Bog\'langan shaxs</span><div><b>'+esc(p.name)+'</b> · '+esc(branchName(p.branchId))+'</div></div>':'')+'<button class="btn mt" data-act="logout">Tizimdan chiqish</button></div>'+
   '<div class="card"><h3>📲 Telegram bot</h3><p class="sub">Ulansangiz: '+(m.role==="staff"?"har kuni vazifalaringiz ro\'yxati va har bir vazifa vaqtida eslatma keladi, vazifani botning o\'zida belgilaysiz.":m.role==="teacher"?"yangi topshiriqlar, darsingizga qo\'yilgan baholar va har dushanba reytingingiz keladi.":"har kuni kechqurun umumiy hisobot, yangi shikoyatlar va haftalik reyting keladi.")+'</p>'+
    (ui.tgLink?'<a class="btn pri" href="'+esc(ui.tgLink)+'" target="_blank" rel="noopener" style="display:inline-block;text-decoration:none">Telegramda ochish va «Start» bosish →</a><p class="muted small">Havola 15 daqiqa amal qiladi. Botda <b>Start</b> tugmasini bosing.</p>':(ui.tgErr?'<div class="badge b-warn" style="white-space:normal">'+esc(ui.tgErr)+'</div><br><br>':'')+'<div class="flex"><button class="btn pri" data-act="tgLink">Telegramni ulash</button><button class="btn sm" data-act="tgUnlink">Uzish</button></div>')+'</div>'+
   '<div class="card"><h3>Parolni o\'zgartirish</h3><form class="form" data-form="mypass"><label>Hozirgi parol<input class="in" type="password" name="old" required autocomplete="current-password"></label><label>Yangi parol (kamida 6 belgi)<input class="in" type="password" name="p" minlength="6" required autocomplete="new-password"></label><label>Yangi parolni takrorlang<input class="in" type="password" name="p2" minlength="6" required autocomplete="new-password"></label><button class="btn pri" type="submit" style="justify-self:start">O\'zgartirish</button></form></div></div>';
}

/* ============ Admin panel ============ */
function viewAdmin(){
  if(!isAdmin())return '<div class="card empty">Bu bo\'lim faqat admin uchun</div>';
  var tabs=[["baholash","Baholash va shikoyatlar"],["topshiriq","Topshiriq berish"],["vazifalar","Xodimlar vazifalari"],["ustozlar","Ustozlar"],["xodimlar","Xodimlar"],["loginlar","Login-parollar"],["filiallar","Filiallar va o'quvchilar"],["sozlamalar","Sozlamalar"]];
  var h='<div class="tabs">'+tabs.map(function(t){return '<button class="tab'+(ui.adm===t[0]?" on":"")+'" data-act="adm" data-id="'+t[0]+'">'+t[1]+'</button>';}).join("")+'</div>';
  if(me().username==="admin"&&ls("fe_pw_changed")!=="1")h+='<div class="banner">⚠️ Boshlang\'ich parol (fast2026) ishlatilayotgan bo\'lishi mumkin. <a href="#profil">Profil</a> bo\'limida o\'zgartiring.</div>';
  if(S.demo)h+='<div class="banner">Hozir <b>namunaviy (demo) ma\'lumotlar</b>. Haqiqiy ishni boshlashdan oldin <a href="#admin" data-act="adm" data-id="sozlamalar">Sozlamalar</a>dan tozalang.</div>';
  var fn={baholash:admEval,topshiriq:admTasks,vazifalar:admDuties,ustozlar:admTeachers,xodimlar:admStaff,loginlar:admAccounts,filiallar:admBranches,sozlamalar:admSettings}[ui.adm]||admEval;
  return h+fn();
}
function teacherOptions(sel){return S.teachers.map(function(t){return '<option value="'+t.id+'"'+(sel===t.id?" selected":"")+'>'+esc(t.name)+' — '+esc(branchName(t.branchId))+'</option>';}).join("");}
function staffOptions(sel){return S.staff.map(function(t){return '<option value="'+t.id+'"'+(sel===t.id?" selected":"")+'>'+esc(t.name)+' — '+ROLES[t.role]+', '+esc(branchName(t.branchId))+'</option>';}).join("");}
function num(name,label,v,min,max){return '<label>'+label+'<input class="in" type="number" name="'+name+'" min="'+min+'" max="'+max+'" value="'+v+'" required></label>';}
function delBtn(coll,id){var key=coll+":"+id;return '<button class="btn sm danger'+(ui.armed===key?" armed":"")+'" data-act="del" data-coll="'+coll+'" data-id="'+esc(id)+'">'+(ui.armed===key?"Tasdiqlang":"O'chirish")+'</button>';}
function loginFields(){return '<div class="row"><label>Login (ixtiyoriy)<input class="in" name="lu" placeholder="masalan: aziza" autocomplete="off"></label><label>Parol<input class="in" name="lp" type="text" placeholder="kamida 6 belgi" autocomplete="off"></label></div>';}
function admEval(){
  if(!S.teachers.length)return '<div class="card empty">Avval «Ustozlar» bo\'limida ustoz qo\'shing</div>';
  if(!byId(S.teachers,ui.admTeacher))ui.admTeacher=S.teachers[0].id;
  var T=todayISO();
  var h='<div class="card"><div class="flex"><b>Ustoz:</b><select class="in" data-model="admTeacher" style="min-width:280px">'+teacherOptions(ui.admTeacher)+'</select><button class="btn sm" data-act="openTeacher" data-id="'+ui.admTeacher+'">Profilini ko\'rish</button></div></div><div class="grid g3 mt">';
  h+='<div class="card"><h3>Dars kuzatuvi (dars sifati)</h3><p class="sub">Har bir mezon 1–10 ball</p><form class="form" data-form="eval"><label>Sana<input class="in" type="date" name="date" value="'+T+'" max="'+T+'" required></label><div class="row">'+num("c0","Tayyorgarlik",8,1,10)+num("c1","Metodika",8,1,10)+num("c2","O'quvchilar faolligi",8,1,10)+num("c3","Vaqt boshqaruvi",8,1,10)+'</div><label>Izoh<textarea class="in" name="note"></textarea></label><button class="btn pri" type="submit">Saqlash</button></form></div>';
  h+='<div class="card"><h3>Qilgan ishi uchun reyting</h3><p class="sub">Menejer bahosi, 1–10 ball</p><form class="form" data-form="rating"><label>Sana<input class="in" type="date" name="date" value="'+T+'" max="'+T+'" required></label><label>Qilgan ishi<input class="in" name="work" placeholder="Masalan: ochiq dars o\'tkazdi" required></label>'+num("score","Ball (1–10)",8,1,10)+'<label>Izoh<textarea class="in" name="comment"></textarea></label><button class="btn pri" type="submit">Reyting berish</button></form></div>';
  h+='<div class="card"><h3>Shikoyat qo\'shish</h3><p class="sub">Tasdiqlanmaguncha ballga ta\'sir qilmaydi</p><form class="form" data-form="complaint"><label>Sana<input class="in" type="date" name="date" value="'+T+'" max="'+T+'" required></label><label>Manba<select class="in" name="source"><option>Ota-ona</option><option>O\'quvchi</option><option>Xodim</option><option>Menejer</option></select></label><label>Shikoyat matni<textarea class="in" name="text" required></textarea></label><button class="btn pri" type="submit">Qo\'shish</button></form></div></div>';
  var cp=S.complaints.slice().sort(function(a,b){return (a.status==="yangi"?0:1)-(b.status==="yangi"?0:1)||(a.date<b.date?1:-1);});
  h+='<div class="card mt scroll"><h3>Barcha shikoyatlar — ko\'rib chiqish</h3><p class="sub">Shikoyatni tekshirib, tasdiqlang yoki rad eting</p><table><thead><tr><th>Sana</th><th>Ustoz</th><th>Shikoyat</th><th>Holat</th><th></th></tr></thead><tbody>'+
   cp.map(function(c){var t=byId(S.teachers,c.teacherId);return '<tr><td class="muted">'+fmtDate(c.date)+'</td><td><b>'+esc(t?t.name:"—")+'</b></td><td>'+esc(c.text)+'<div class="muted small">'+esc(c.source)+'</div></td><td>'+cBadge(c.status)+'</td><td class="num" style="white-space:nowrap">'+(c.status!=="tasdiqlangan"?'<button class="btn sm" data-act="cSt" data-id="'+c.id+'" data-v="tasdiqlangan">Tasdiqlash</button> ':'')+(c.status!=="rad"?'<button class="btn sm" data-act="cSt" data-id="'+c.id+'" data-v="rad">Rad etish</button> ':'')+delBtn("complaints",c.id)+'</td></tr>';}).join("")+'</tbody></table>'+(cp.length?'':'<div class="empty">Shikoyatlar yo\'q</div>')+'</div>';
  var ev=S.evals.filter(function(e){return e.teacherId===ui.admTeacher;}).sort(function(a,b){return a.date<b.date?1:-1;}),rt=S.ratings.filter(function(e){return e.teacherId===ui.admTeacher;}).sort(function(a,b){return a.date<b.date?1:-1;});
  h+='<div class="grid g2 mt"><div class="card"><h3>Tanlangan ustoz kuzatuvlari</h3>'+(ev.length?ev.map(function(e){return '<div class="list-item flex between"><span>'+fmtDate(e.date)+' — <b>'+r1(evalScore(e))+'</b> <span class="muted small">('+e.c.join(", ")+')</span></span>'+delBtn("evals",e.id)+'</div>';}).join(""):'<div class="empty">Yo\'q</div>')+'</div><div class="card"><h3>Tanlangan ustoz baholari</h3>'+(rt.length?rt.map(function(e){return '<div class="list-item flex between"><span>'+fmtDate(e.date)+' — '+esc(e.work)+' <b>'+e.score+'/10</b></span>'+delBtn("ratings",e.id)+'</div>';}).join(""):'<div class="empty">Yo\'q</div>')+'</div></div>';
  return h;
}
function admTasks(){
  var T=todayISO();
  if(!S.teachers.length&&!S.staff.length)return '<div class="card empty">Avval ustoz yoki xodim qo\'shing</div>';
  var h='<div class="card"><h3>Yangi topshiriq</h3><p class="sub">Ustoz yoki xodimga topshiriq bering — bajarilishi ustoz reytingiga ta\'sir qiladi</p><form class="form" data-form="task"><div class="row"><label>Kimga<select class="in" name="who" required><optgroup label="Ustozlar">'+S.teachers.map(function(t){return '<option value="teacher:'+t.id+'">'+esc(t.name)+' — '+esc(branchName(t.branchId))+'</option>';}).join("")+'</optgroup><optgroup label="Xodimlar">'+S.staff.map(function(t){return '<option value="staff:'+t.id+'">'+esc(t.name)+' — '+ROLES[t.role]+'</option>';}).join("")+'</optgroup></select></label><label>Muddat<input class="in" type="date" name="deadline" value="'+addDays(T,3)+'" required></label><label>Muhimlik<select class="in" name="priority"><option value="yuqori">Yuqori</option><option value="o\'rta" selected>O\'rta</option><option value="past">Past</option></select></label></div><label>Topshiriq<input class="in" name="title" required></label><label>Tavsif<textarea class="in" name="desc"></textarea></label><button class="btn pri" type="submit" style="justify-self:start">Topshiriq berish</button></form></div>';
  var list=S.tasks.slice().sort(function(a,b){return a.deadline<b.deadline?1:-1;});
  h+='<div class="card mt scroll"><h3>Barcha topshiriqlar</h3><table><thead><tr><th>Topshiriq</th><th>Kimga</th><th>Muddat</th><th>Holat</th><th></th></tr></thead><tbody>'+list.map(function(k){return '<tr><td><b>'+esc(k.title)+'</b></td><td>'+esc(assigneeName(k))+'</td><td class="muted">'+fmtDate(k.deadline)+'</td><td><select class="in" data-act-change="taskSel" data-id="'+k.id+'">'+["yangi","jarayonda","bajarildi"].map(function(v){return '<option value="'+v+'"'+(k.status===v?" selected":"")+'>'+{yangi:"Yangi",jarayonda:"Jarayonda",bajarildi:"Bajarildi"}[v]+'</option>';}).join("")+'</select></td><td class="num">'+delBtn("tasks",k.id)+'</td></tr>';}).join("")+'</tbody></table></div>';
  return h;
}
function admDuties(){
  if(!S.staff.length)return '<div class="card empty">Avval «Xodimlar» bo\'limida xodim qo\'shing</div>';
  if(!byId(S.staff,ui.admStaff))ui.admStaff=S.staff[0].id;
  var s=byId(S.staff,ui.admStaff),ds=S.duties.filter(function(d){return d.staffId===ui.admStaff;}).sort(function(a,b){return a.time<b.time?-1:1;});
  var h='<div class="card"><div class="flex"><b>Xodim:</b><select class="in" data-model="admStaff" style="min-width:300px">'+staffOptions(ui.admStaff)+'</select></div></div>';
  h+='<div class="grid g2 mt"><div class="card"><h3>Yangi vazifa (duty)</h3><p class="sub">Kunlik to-do ro\'yxatiga aniq bajarish vaqti bilan qo\'shiladi</p><form class="form" data-form="duty"><div class="row"><label>Vaqt<input class="in" type="time" name="time" value="09:00" required></label><label>Vazifa<input class="in" name="title" required></label></div><div><b class="small">Kunlar</b><div class="days" style="margin-top:6px">'+[1,2,3,4,5,6,0].map(function(d){return '<label><input type="checkbox" name="d'+d+'"'+(d?" checked":"")+'> '+DOWS[d]+'</label>';}).join("")+'</div></div><button class="btn pri" type="submit" style="justify-self:start">Qo\'shish</button></form><div class="mt"><button class="btn sm" data-act="stdDuties">'+ROLES[s.role]+' uchun standart vazifalarni qo\'shish</button></div></div>';
  h+='<div class="card"><h3>'+esc(s.name)+' — vazifalar</h3><p class="sub">'+ROLES[s.role]+' · '+esc(branchName(s.branchId))+'</p>'+(ds.length?ds.map(function(d){return '<div class="list-item flex between"><div><b>'+d.time+'</b> — '+esc(d.title)+'<div class="muted small">'+d.days.slice().sort(function(a,b){return ((a+6)%7)-((b+6)%7);}).map(function(x){return DOWS[x];}).join(", ")+'</div></div>'+delBtn("duties",d.id)+'</div>';}).join(""):'<div class="empty">Vazifalar yo\'q</div>')+'</div></div>';
  return h;
}
function accOf(pid){return (accounts||[]).filter(function(a){return a.person_id===pid;}).map(function(a){return a.username;}).join(", ");}
function admTeachers(){
  if(!S.branches.length)return '<div class="card empty">Avval «Filiallar» bo\'limida filial qo\'shing</div>';
  var h='<div class="card"><h3>Ustoz qo\'shish</h3><form class="form" data-form="teacher"><div class="row"><label>F.I.Sh.<input class="in" name="name" required></label><label>Filial<select class="in" name="branchId">'+S.branches.map(function(b){return '<option value="'+b.id+'">'+esc(b.name)+'</option>';}).join("")+'</select></label><label>Fan / yo\'nalish<input class="in" name="subject" required></label></div>'+loginFields()+'<button class="btn pri" type="submit" style="justify-self:start">Qo\'shish</button></form></div>';
  h+='<div class="card mt scroll"><h3>Ustozlar ro\'yxati ('+S.teachers.length+')</h3><table><thead><tr><th>F.I.Sh.</th><th>Filial</th><th>Fan</th><th>Login</th><th></th></tr></thead><tbody>'+S.teachers.map(function(t){return '<tr><td><b>'+esc(t.name)+'</b></td><td><select class="in" data-act-change="tBranch" data-id="'+t.id+'">'+S.branches.map(function(b){return '<option value="'+b.id+'"'+(b.id===t.branchId?" selected":"")+'>'+esc(b.name)+'</option>';}).join("")+'</select></td><td>'+esc(t.subject)+'</td><td>'+(accOf(t.id)?'<span class="badge b-good">'+esc(accOf(t.id))+'</span>':'<span class="badge b-neu">yo\'q</span>')+'</td><td class="num">'+delBtn("teachers",t.id)+'</td></tr>';}).join("")+'</tbody></table></div>';
  return h;
}
function admStaff(){
  if(!S.branches.length)return '<div class="card empty">Avval «Filiallar» bo\'limida filial qo\'shing</div>';
  var h='<div class="card"><h3>Xodim qo\'shish</h3><form class="form" data-form="staff"><div class="row"><label>F.I.Sh.<input class="in" name="name" required></label><label>Lavozim<select class="in" name="role">'+Object.keys(ROLES).map(function(r){return '<option value="'+r+'">'+ROLES[r]+'</option>';}).join("")+'</select></label><label>Filial<select class="in" name="branchId">'+S.branches.map(function(b){return '<option value="'+b.id+'">'+esc(b.name)+'</option>';}).join("")+'</select></label></div>'+loginFields()+'<label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="std" checked> Lavozimga mos standart kunlik vazifalarni qo\'shish</label><button class="btn pri" type="submit" style="justify-self:start">Qo\'shish</button></form></div>';
  h+='<div class="card mt scroll"><h3>Xodimlar ro\'yxati ('+S.staff.length+')</h3><table><thead><tr><th>F.I.Sh.</th><th>Lavozim</th><th>Filial</th><th class="num">Vazifalar</th><th>Login</th><th></th></tr></thead><tbody>'+S.staff.map(function(s){return '<tr><td><b>'+esc(s.name)+'</b></td><td>'+ROLES[s.role]+'</td><td>'+esc(branchName(s.branchId))+'</td><td class="num">'+S.duties.filter(function(d){return d.staffId===s.id;}).length+'</td><td>'+(accOf(s.id)?'<span class="badge b-good">'+esc(accOf(s.id))+'</span>':'<span class="badge b-neu">yo\'q</span>')+'</td><td class="num">'+delBtn("staff",s.id)+'</td></tr>';}).join("")+'</tbody></table></div>';
  return h;
}
function personName(a){if(a.role==="teacher"){var t=byId(S.teachers,a.person_id);return t?t.name:"—";}if(a.role==="staff"){var s=byId(S.staff,a.person_id);return s?s.name+" ("+ROLES[s.role]+")":"—";}return "—";}
function admAccounts(){
  var r=ui.accRole;
  var opts=r==="teacher"?S.teachers.map(function(t){return '<option value="'+t.id+'">'+esc(t.name)+'</option>';}).join(""):r==="staff"?S.staff.map(function(t){return '<option value="'+t.id+'">'+esc(t.name)+' — '+ROLES[t.role]+'</option>';}).join(""):"";
  var h='<div class="card"><h3>Login-parol berish yoki parolni tiklash</h3><p class="sub">Har bir ustoz va xodimga alohida login beriladi. Ustoz faqat o\'z shikoyatlarini va topshiriqlarini ko\'radi; xodim faqat o\'z vazifalarini belgilaydi. Mavjud loginni kiritsangiz — paroli yangilanadi.</p><form class="form" data-form="account"><div class="row"><label>Rol<select class="in" name="role" data-model="accRole">'+Object.keys(ACC_ROLES).map(function(k){return '<option value="'+k+'"'+(k===r?" selected":"")+'>'+ACC_ROLES[k]+'</option>';}).join("")+'</select></label>'+(r==="admin"?'':'<label>Kimga<select class="in" name="person" required>'+opts+'</select></label>')+'<label>Login<input class="in" name="u" required autocomplete="off" placeholder="lotin harflari, raqam"></label><label>Parol<input class="in" name="p" type="text" autocomplete="off" placeholder="kamida 6 belgi"></label></div><button class="btn pri" type="submit" style="justify-self:start">Saqlash</button></form></div>';
  h+='<div class="card mt scroll"><h3>Foydalanuvchilar ('+(accounts||[]).length+')</h3><table><thead><tr><th>Login</th><th>Rol</th><th>Shaxs</th><th>Telegram</th><th></th></tr></thead><tbody>'+(accounts||[]).map(function(a){return '<tr><td><b>'+esc(a.username)+'</b>'+(a.username===me().username?' <span class="badge b-pri">Siz</span>':'')+'</td><td>'+ACC_ROLES[a.role]+'</td><td>'+esc(personName(a))+'</td><td>'+(a.tg?'<span class="badge b-good">ulangan</span>':'<span class="badge b-neu">yo\'q</span>')+'</td><td class="num">'+(a.username===me().username?'':delBtn("account",a.username))+'</td></tr>';}).join("")+'</tbody></table></div>';
  return h;
}
function admBranches(){
  var mk=monthKey(new Date());
  var h='<div class="grid g2"><div class="card"><h3>O\'quvchilar sonini kiritish</h3><p class="sub">Har oy oxirida har bir filial uchun faol o\'quvchilar sonini kiriting — filial o\'sishi shundan hisoblanadi</p>'+(S.branches.length?'<form class="form" data-form="students"><div class="row"><label>Filial<select class="in" name="branchId">'+S.branches.map(function(b){return '<option value="'+b.id+'">'+esc(b.name)+'</option>';}).join("")+'</select></label><label>Oy<input class="in" type="month" name="m" value="'+mk+'" required></label><label>O\'quvchilar soni<input class="in" type="number" name="c" min="0" required></label></div><button class="btn pri" type="submit" style="justify-self:start">Saqlash</button></form>':'<div class="empty">Avval filial qo\'shing</div>')+'</div>'+
   '<div class="card"><h3>Filial qo\'shish</h3><form class="form" data-form="branch"><label>Filial nomi<input class="in" name="name" required></label><label>Joriy o\'quvchilar soni<input class="in" type="number" name="c" min="0" value="0"></label><button class="btn pri" type="submit" style="justify-self:start">Qo\'shish</button></form></div></div>';
  var months={};S.branches.forEach(function(b){b.students.forEach(function(p){months[p.m]=1;});});var ms=Object.keys(months).sort().slice(-6);
  h+='<div class="card mt scroll"><h3>Oylik o\'quvchilar soni</h3><table><thead><tr><th>Filial</th>'+ms.map(function(m){return '<th class="num">'+monthLabel(m)+'</th>';}).join("")+'<th></th></tr></thead><tbody>'+S.branches.map(function(b){return '<tr><td><b>'+esc(b.name)+'</b></td>'+ms.map(function(m){var p=b.students.filter(function(x){return x.m===m;})[0];return '<td class="num">'+(p?p.c:'<span class="muted">—</span>')+'</td>';}).join("")+'<td class="num">'+delBtn("branches",b.id)+'</td></tr>';}).join("")+'</tbody></table></div>';
  return h;
}
function admSettings(){
  var s=S.settings;
  return '<div class="grid g2"><div class="card"><h3>Ustoz balli og\'irliklari (%)</h3><p class="sub">Yig\'indisi 100 bo\'lishi tavsiya etiladi</p><form class="form" data-form="tw"><div class="row">'+num("lesson","Dars sifati",s.tw.lesson,0,100)+num("manager","Menejer bahosi",s.tw.manager,0,100)+num("tasks","Topshiriqlar",s.tw.tasks,0,100)+num("complaints","Shikoyatlar",s.tw.complaints,0,100)+'</div><button class="btn pri" type="submit" style="justify-self:start">Saqlash</button></form></div>'+
   '<div class="card"><h3>Filial balli og\'irliklari (%)</h3><p class="sub">Yig\'indisi 100 bo\'lishi tavsiya etiladi</p><form class="form" data-form="bw"><div class="row">'+num("teachers","Ustozlar ishi",s.bw.teachers,0,100)+num("staff","Xodimlar samaradorligi",s.bw.staff,0,100)+num("growth","O\'quvchilar o\'sishi",s.bw.growth,0,100)+'</div>'+num("lateMin","Kechikish chegarasi (daqiqa)",s.lateMin,0,240)+'<button class="btn pri" type="submit" style="justify-self:start">Saqlash</button></form></div></div>'+
   '<div class="card mt"><h3>Ma\'lumotlar</h3><p class="sub">Tozalashda filiallar nomi saqlanadi; ustozlar, xodimlar, baholar, vazifalar va belgilashlar o\'chadi. Login-parollar alohida, ularni «Login-parollar» bo\'limida o\'chirasiz.</p><div class="flex"><button class="btn danger'+(ui.armed==="wipe"?" armed":"")+'" data-act="wipe">'+(ui.armed==="wipe"?"Ishonchingiz komilmi? Yana bosing":"Hamma ma'lumotlarni tozalash")+'</button><button class="btn'+(ui.armed==="reseed"?" danger armed":"")+'" data-act="reseed">'+(ui.armed==="reseed"?"Yana bosing":"Demo ma'lumotlarni yuklash")+'</button></div></div>';
}

/* ============ Render ============ */
function viewLogin(){
  return '<div class="gate"><div class="card"><div class="flex" style="margin-bottom:16px"><div class="logo-mark">F</div><div><b style="font-size:16px">Fast Education</b><div class="muted small">Adolatli baholash tizimi</div></div></div><h3 style="font-size:19px">Tizimga kirish</h3><p class="sub">Login va parolni menejeringizdan oling.</p><form class="form" data-form="login"><label>Login<input class="in" name="u" autocomplete="username" autocapitalize="none" required></label><label>Parol<input class="in" name="p" type="password" autocomplete="current-password" required></label>'+(ui.loginErr?'<div class="badge b-bad" style="justify-self:start;white-space:normal">'+esc(ui.loginErr)+'</div>':'')+'<button class="btn pri" type="submit">Kirish</button></form></div></div>';
}
function viewFirstRun(){
  if(!isAdmin())return '<div class="gate"><div class="card"><h3>Tizim hali sozlanmagan</h3><p class="sub">Admin birinchi marta kirib, ma\'lumotlarni kiritishi kerak.</p><button class="btn" data-act="logout">Chiqish</button></div></div>';
  return '<div class="gate"><div class="card" style="width:min(520px,100%)"><h3 style="font-size:19px">Xush kelibsiz! Qanday boshlaymiz?</h3><p class="sub">Tizim bo\'sh. Tanlang:</p><div class="grid" style="gap:10px"><button class="btn pri" data-act="startDemo">Demo ma\'lumotlar bilan ko\'rib chiqish</button><button class="btn" data-act="startEmpty">Bo\'sh boshlash (o\'z filiallarimni kiritaman)</button></div><p class="muted small" style="margin-top:14px">Demo ma\'lumotlarni keyin Admin panel → Sozlamalar orqali bitta tugma bilan tozalash mumkin.</p></div></div>';
}
function navHtml(){return navItems().map(function(n){return '<a class="nav'+(ui.view===n[0]?" on":"")+'" href="#'+n[0]+'">'+IC[n[0]]+'<span>'+n[1]+'</span></a>';}).join("");}
function render(){
  var root=document.getElementById("root");
  if(!CFG.SUPABASE_URL){root.innerHTML='<div class="gate"><div class="card">config.js topilmadi</div></div>';return;}
  if(!AUTH){root.innerHTML=viewLogin();return;}
  if(!loaded){root.innerHTML='<div class="gate"><div class="card" style="text-align:center">'+(loadErr?'<h3>Xatolik</h3><p class="sub">'+esc(loadErr)+'</p><div class="flex" style="justify-content:center"><button class="btn pri" data-act="reload">Qayta urinish</button><button class="btn" data-act="logout">Chiqish</button></div>':'<div class="spinner"></div><p class="muted small">Yuklanmoqda…</p>')+'</div></div>';return;}
  if(!S){root.innerHTML=viewFirstRun();return;}
  var allowed=navItems().map(function(n){return n[0];});if(allowed.indexOf(ui.view)<0)ui.view="dashboard";
  var t=TITLES[ui.view],body={dashboard:viewDashboard,filiallar:viewBranches,ustozlar:viewTeachers,xodimlar:viewStaff,topshiriqlar:viewTasks,admin:viewAdmin,profil:viewProfile}[ui.view];
  var scrollY=window.scrollY,active=document.activeElement,activeModel=active&&active.getAttribute&&active.getAttribute("data-model"),selStart=active&&active.selectionStart;
  var p=myPerson();
  root.innerHTML='<div class="mobile-nav">'+navHtml()+'</div><div class="app"><aside class="side"><div class="logo"><div class="logo-mark">F</div><div><b>Fast Education</b><span>Adolatli baholash tizimi</span></div></div>'+navHtml()+'<div class="userbox"><b>'+esc(p?p.name:me().username)+'</b>'+ACC_ROLES[me().role]+'<br><button class="btn sm" data-act="logout">Chiqish</button></div></aside><main class="main"><div class="top"><div><h1>'+t[0]+'</h1><p>'+t[1]+'</p></div><span class="pill" id="savestate">'+saveLabel()+'</span></div>'+body()+'</main></div>'+(ui.drawer?'<div class="drawer-bg" data-act="closeDrawerBg"><div class="drawer">'+teacherDrawer(ui.drawer)+'</div></div>':'');
  window.scrollTo(0,scrollY);
  if(activeModel){var el=document.querySelector('[data-model="'+activeModel+'"]');if(el&&el.tagName==="INPUT"&&el.type==="text"){el.focus();try{el.setSelectionRange(selStart,selStart);}catch(e){}}}
}
function route(){var h=(location.hash||"").replace("#","");ui.view=TITLES[h]?h:"dashboard";ui.drawer=null;render();window.scrollTo(0,0);}
window.addEventListener("hashchange",route);

/* ============ Hodisalar ============ */
async function deleteAccountsOf(pid){if(!accounts)return;for(var i=0;i<accounts.length;i++){if(accounts[i].person_id===pid){try{await rpc("delete_account",{p_token:AUTH.token,p_username:accounts[i].username});}catch(e){}}}await refreshAccounts();}
async function refreshAccounts(){try{accounts=await rpc("list_accounts",{p_token:AUTH.token});}catch(e){}render();}
async function createLogin(u,p,role,pid){if(!u)return;try{await rpc("upsert_account",{p_token:AUTH.token,p_username:u,p_password:p,p_role:role,p_person_id:pid});toast("Login yaratildi: "+u.toLowerCase());}catch(e){toast("Login yaratilmadi: "+e.message,true);}await refreshAccounts();}
async function seedServer(pack){
  setBusy(1);
  try{
    var r=await rpc("admin_save",{p_token:AUTH.token,p_data:pack.data,p_version:VERSION});
    if(r.conflict){var f=await rpc("get_state",{p_token:AUTH.token});VERSION=f.version;r=await rpc("admin_save",{p_token:AUTH.token,p_data:pack.data,p_version:VERSION});}
    VERSION=r.version;await rpc("admin_replace_logs",{p_token:AUTH.token,p_logs:pack.logs});
    S=pack.data;LOGS=pack.logs;toast("Tayyor");
  }catch(e){toast(e.message,true);}
  finally{setBusy(-1);render();}
}
document.addEventListener("click",function(e){
  var el=e.target.closest("[data-act]");if(!el)return;
  var a=el.getAttribute("data-act"),id=el.getAttribute("data-id");
  if(a!=="del"&&a!=="wipe"&&a!=="reseed")ui.armed=null;
  if(a==="closeDrawerBg"){if(e.target===el){ui.drawer=null;render();}return;}
  if(a==="closeDrawer"){ui.drawer=null;render();return;}
  if(a==="openTeacher"){ui.drawer=id;render();return;}
  if(a==="tTab"){ui.tTab=id;render();return;}
  if(a==="sRole"){ui.sRole=id;render();return;}
  if(a==="sToday"){ui.sDate=todayISO();render();return;}
  if(a==="taskFilter"){ui.taskFilter=id;render();return;}
  if(a==="reload"){loadErr="";render();load();return;}
  if(a==="adm"){e.preventDefault();ui.adm=id;ls("fe_adm_tab",id);if(ui.view!=="admin")location.hash="#admin";else render();return;}
  if(a==="logout"){var tk=AUTH&&AUTH.token;if(tk)rpc("logout",{p_token:tk}).catch(function(){});logoutLocal();return;}
  if(a==="tick"){
    if(el.disabled)return;var date=ui.sDate,key=date+"|"+id;el.disabled=true;setBusy(1);
    rpc("tick",{p_token:AUTH.token,p_day:date,p_duty_id:id}).then(function(r){if(r.log)LOGS[key]=r.log;else delete LOGS[key];if(r.log&&r.log.s==="l"&&!isAdmin())toast("Belgilandi — kechikish bilan ("+r.log.at+")");}).catch(function(err){toast(err.message,true);}).finally(function(){setBusy(-1);render();});
    return;
  }
  if(a==="tgLink"){ui.tgErr="";rpc("tg_link_code",{p_token:AUTH.token}).then(function(r){if(!r.bot){ui.tgErr="Bot hali sozlanmagan — menejerga ayting";}else{ui.tgLink="https://t.me/"+r.bot+"?start="+r.code;}render();}).catch(function(err){ui.tgErr=/tg_link_code|schema cache|sozlanmagan/i.test(err.message)?"Bot hali sozlanmagan — menejerga ayting":err.message;render();});return;}
  if(a==="tgUnlink"){rpc("tg_unlink",{p_token:AUTH.token}).then(function(){ui.tgLink="";toast("Telegram uzildi");render();}).catch(function(err){toast(err.message,true);});return;}
  if(a==="taskSt"){var st=el.getAttribute("data-v");setBusy(1);
    rpc("set_task_status",{p_token:AUTH.token,p_task_id:id,p_status:st}).then(function(r){VERSION=r.version;var k=byId(S.tasks,id);if(k){k.status=r.task.status;k.doneAt=r.task.doneAt;}toast("Topshiriq holati yangilandi");}).catch(function(err){toast(err.message,true);}).finally(function(){setBusy(-1);render();});
    return;}
  if(!isAdmin())return;
  if(a==="startDemo"){seedServer(seed());return;}
  if(a==="startEmpty"){var d=emptyData();seedServer({data:d,logs:{}});location.hash="#admin";ui.adm="filiallar";ls("fe_adm_tab","filiallar");return;}
  if(a==="cSt"){var v=el.getAttribute("data-v");commit(function(D){var c=byId(D.complaints,id);if(c)c.status=v;stampComplaintCounts(D);},v==="tasdiqlangan"?"Shikoyat tasdiqlandi":"Shikoyat rad etildi");return;}
  if(a==="del"){var coll=el.getAttribute("data-coll"),key2=coll+":"+id;
    if(ui.armed!==key2){ui.armed=key2;render();return;}
    ui.armed=null;
    if(coll==="account"){rpc("delete_account",{p_token:AUTH.token,p_username:id}).then(function(){toast("Login o'chirildi");}).catch(function(err){toast(err.message,true);}).finally(refreshAccounts);return;}
    commit(function(D){
      D[coll]=D[coll].filter(function(x){return x.id!==id;});
      if(coll==="teachers"){["evals","ratings","complaints"].forEach(function(c){D[c]=D[c].filter(function(x){return x.teacherId!==id;});});D.tasks=D.tasks.filter(function(k){return !(k.type==="teacher"&&k.assigneeId===id);});}
      if(coll==="staff"){D.duties=D.duties.filter(function(d){return d.staffId!==id;});D.tasks=D.tasks.filter(function(k){return !(k.type==="staff"&&k.assigneeId===id);});}
      if(coll==="branches"){var tids=D.teachers.filter(function(t){return t.branchId===id;}).length+D.staff.filter(function(t){return t.branchId===id;}).length;if(tids)throw new Error("Filialda ustoz yoki xodim bor — avval ularni o'chiring yoki boshqa filialga o'tkazing");}
      stampComplaintCounts(D);
    },"O'chirildi").then(function(ok){if(ok&&(coll==="teachers"||coll==="staff"))deleteAccountsOf(id);});
    return;}
  if(a==="stdDuties"){var s=byId(S.staff,ui.admStaff);if(!s)return;var nd=defaultDuties(s.role).map(function(d){return {id:uid("d"),staffId:s.id,time:d[0],title:d[1],days:[1,2,3,4,5,6]};});commit(function(D){nd.forEach(function(x){D.duties.push(x);});},"Standart vazifalar qo'shildi");return;}
  if(a==="wipe"){if(ui.armed!=="wipe"){ui.armed="wipe";render();return;}ui.armed=null;var w=emptyData();w.settings=S.settings;w.branches=S.branches.map(function(b){return {id:b.id,name:b.name,students:[]};});seedServer({data:w,logs:{}});return;}
  if(a==="reseed"){if(ui.armed!=="reseed"){ui.armed="reseed";render();return;}ui.armed=null;var pk=seed();pk.data.settings=S.settings;seedServer(pk);return;}
});
document.addEventListener("input",function(e){if(e.target.getAttribute("data-model")==="tSearch"){ui.tSearch=e.target.value;render();}});
document.addEventListener("change",function(e){
  var m=e.target.getAttribute("data-model");
  if(m&&m!=="tSearch"){ui[m]=e.target.value;if(m==="sDate"&&(!ui.sDate||ui.sDate>todayISO()))ui.sDate=todayISO();render();return;}
  var ac=e.target.getAttribute("data-act-change");if(!ac||!isAdmin())return;var id=e.target.getAttribute("data-id"),v=e.target.value;
  if(ac==="taskSel"){commit(function(D){var k=byId(D.tasks,id);if(k){k.status=v;k.doneAt=v==="bajarildi"?todayISO():null;}},"Holat yangilandi");}
  if(ac==="tBranch"){commit(function(D){var t=byId(D.teachers,id);if(t)t.branchId=v;},"Filial o'zgartirildi");}
});
document.addEventListener("submit",async function(e){
  var f=e.target.closest("form[data-form]");if(!f)return;e.preventDefault();
  var kind=f.getAttribute("data-form"),fd=new FormData(f),g=function(k){return (fd.get(k)||"").toString().trim();};
  var n=function(k,a,b){return clamp(parseInt(g(k),10)||0,a,b);};
  var btn=f.querySelector("button[type=submit]");
  if(kind==="login"){
    if(btn)btn.disabled=true;
    try{var r=await rpc("login",{p_username:g("u"),p_password:fd.get("p")});AUTH={token:r.token,username:r.username,role:r.role,person_id:r.person_id};ls("fe_auth",JSON.stringify(AUTH));ui.loginErr="";accounts=null;render();await load();}
    catch(err){ui.loginErr=err.message;render();}
    return;
  }
  if(kind==="mypass"){
    if(fd.get("p")!==fd.get("p2")){toast("Yangi parollar mos emas",true);return;}
    try{await rpc("change_password",{p_token:AUTH.token,p_old:fd.get("old"),p_new:fd.get("p")});ls("fe_pw_changed","1");toast("Parol o'zgartirildi");f.reset();render();}catch(err){toast(err.message,true);}
    return;
  }
  if(!isAdmin())return;
  var ok;
  if(kind==="eval"){var ev={id:uid("e"),teacherId:ui.admTeacher,date:g("date"),c:[n("c0",1,10),n("c1",1,10),n("c2",1,10),n("c3",1,10)],note:g("note"),by:me().username};ok=await commit(function(D){D.evals.push(ev);},"Dars kuzatuvi saqlandi");}
  else if(kind==="rating"){var rt={id:uid("r"),teacherId:ui.admTeacher,date:g("date"),score:n("score",1,10),work:g("work"),comment:g("comment")};ok=await commit(function(D){D.ratings.push(rt);},"Reyting berildi");}
  else if(kind==="complaint"){var cp={id:uid("c"),teacherId:ui.admTeacher,date:g("date"),source:g("source"),text:g("text"),status:"yangi"};ok=await commit(function(D){D.complaints.push(cp);},"Shikoyat qo'shildi");}
  else if(kind==="task"){var w=g("who").split(":");if(!w[1])return;var tk={id:uid("k"),type:w[0],assigneeId:w[1],title:g("title"),desc:g("desc"),deadline:g("deadline"),priority:g("priority"),status:"yangi",created:todayISO(),doneAt:null};ok=await commit(function(D){D.tasks.push(tk);},"Topshiriq berildi");}
  else if(kind==="duty"){var days=[0,1,2,3,4,5,6].filter(function(d){return fd.get("d"+d);});if(!days.length){toast("Kamida bitta kunni tanlang",true);return;}var du={id:uid("d"),staffId:ui.admStaff,time:g("time"),title:g("title"),days:days};ok=await commit(function(D){D.duties.push(du);},"Vazifa qo'shildi");}
  else if(kind==="teacher"){var t={id:uid("t"),name:g("name"),branchId:g("branchId"),subject:g("subject"),cpConf90:0};ok=await commit(function(D){D.teachers.push(t);},"Ustoz qo'shildi");if(ok&&g("lu"))await createLogin(g("lu"),g("lp"),"teacher",t.id);}
  else if(kind==="staff"){var s={id:uid("s"),name:g("name"),role:g("role"),branchId:g("branchId")};var sd=fd.get("std")?defaultDuties(s.role).map(function(d){return {id:uid("d"),staffId:s.id,time:d[0],title:d[1],days:[1,2,3,4,5,6]};}):[];ok=await commit(function(D){D.staff.push(s);sd.forEach(function(x){D.duties.push(x);});},"Xodim qo'shildi");if(ok&&g("lu"))await createLogin(g("lu"),g("lp"),"staff",s.id);}
  else if(kind==="account"){var role=g("role");try{await rpc("upsert_account",{p_token:AUTH.token,p_username:g("u"),p_password:g("p"),p_role:role,p_person_id:role==="admin"?"":g("person")});toast("Saqlandi: "+g("u").toLowerCase());f.reset();}catch(err){toast(err.message,true);}await refreshAccounts();return;}
  else if(kind==="students"){var bid=g("branchId"),m=g("m"),c=n("c",0,1000000);ok=await commit(function(D){var b=byId(D.branches,bid);if(!b)return;var ex=b.students.filter(function(x){return x.m===m;})[0];if(ex)ex.c=c;else b.students.push({m:m,c:c});b.students.sort(function(x,y){return x.m<y.m?-1:1;});},"O'quvchilar soni saqlandi");}
  else if(kind==="branch"){var nb={id:uid("b"),name:g("name"),students:[{m:monthKey(new Date()),c:n("c",0,1000000)}]};ok=await commit(function(D){D.branches.push(nb);},"Filial qo'shildi");}
  else if(kind==="tw"){var tw={lesson:n("lesson",0,100),manager:n("manager",0,100),tasks:n("tasks",0,100),complaints:n("complaints",0,100)};ok=await commit(function(D){D.settings.tw=tw;},"Og'irliklar saqlandi");}
  else if(kind==="bw"){var bw={teachers:n("teachers",0,100),staff:n("staff",0,100),growth:n("growth",0,100)},lm=n("lateMin",0,240);ok=await commit(function(D){D.settings.bw=bw;D.settings.lateMin=lm;},"Sozlamalar saqlandi");}
});
// Demo ma'lumotlardagi admin har bir saqlashda shikoyat sonlarini yangilaydi
var _commit=commit;commit=function(mut,msg){return _commit(function(D){mut(D);stampComplaintCounts(D);},msg);};

var tip=document.getElementById("tip");
document.addEventListener("mousemove",function(e){var el=e.target.closest&&e.target.closest("[data-tip]");if(!el){tip.style.display="none";return;}tip.textContent=el.getAttribute("data-tip");tip.style.display="block";var x=e.clientX+14,y=e.clientY+14;if(x+tip.offsetWidth>innerWidth-8)x=e.clientX-tip.offsetWidth-14;if(y+tip.offsetHeight>innerHeight-8)y=e.clientY-tip.offsetHeight-14;tip.style.left=x+"px";tip.style.top=y+"px";});
// Har daqiqada yangilab turish (boshqalar kiritgan o'zgarishlar ko'rinishi uchun)
setInterval(function(){if(AUTH&&loaded&&!busy&&!document.querySelector("input:focus,textarea:focus,select:focus"))load(true);},60000);
var h0=(location.hash||"").replace("#","");ui.view=TITLES[h0]?h0:"dashboard";
render();load();
})();
