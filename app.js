// app.js with endpoint fallback (CORS-friendly first), same UI/logic
const state={reviews:[],current:null,busy:false};
const el={
  token:document.getElementById("token"),
  btnRand:document.getElementById("btn-rand"),
  btnSent:document.getElementById("btn-sent"),
  btnNouns:document.getElementById("btn-nouns"),
  btnRe:document.getElementById("btn-recheck"),
  spinner:document.getElementById("spinner"),
  review:document.getElementById("review"),
  sentEmoji:document.getElementById("sent-emoji"),
  sentText:document.getElementById("sent-text"),
  nounEmoji:document.getElementById("noun-emoji"),
  nounText:document.getElementById("noun-text"),
  mismatch:document.getElementById("mismatch"),
  err:document.getElementById("err")
};

// Prefer text2text-generation models that commonly allow CORS
const ENDPOINTS=[
  {url:"https://api-inference.huggingface.co/models/google/flan-t5-base", kind:"text2text-generation"},
  {url:"https://api-inference.huggingface.co/models/google/flan-t5-large", kind:"text2text-generation"},
  {url:"https://api-inference.huggingface.co/models/tiiuae/falcon-7b-instruct", kind:"text-generation"},
  {url:"https://api-inference.huggingface.co/models/Qwen/Qwen2.5-3B-Instruct", kind:"text-generation"}
];

const DEMO={text:"I love this product. The build quality is great, shipping was fast, and customer service solved my issue quickly. However, the battery life could be better."};

function uiBusy(b){state.busy=b;[el.btnRand,el.btnSent,el.btnNouns,el.btnRe].forEach(x=>x.disabled=b);el.spinner.style.display=b?"flex":"none"}
function setErr(t){el.err.textContent=t||""}

function pick(){
  if(state.reviews.length===0 && !state.current){ state.current=DEMO; }
  else if(state.reviews.length>0){ state.current=state.reviews[Math.floor(Math.random()*state.reviews.length)]; }
  const t=(state.current?.text||state.current?.summary||"").trim();
  el.review.textContent=t||"(no review loaded)";
  el.sentEmoji.textContent="—";el.sentText.textContent="n/a";
  el.nounEmoji.textContent="—";el.nounText.textContent="n/a";
  el.mismatch.classList.add("hidden");setErr("");
}

async function loadTSV(){
  try{
    const r=await fetch("reviews_test.tsv",{cache:"no-store"});
    if(!r.ok) throw new Error("HTTP "+r.status+" while fetching reviews_test.tsv");
    const s=await r.text();
    const p=Papa.parse(s,{header:true,delimiter:"\t"});
    const arr=(p.data||[]).filter(x=>(x.text&&x.text.trim())||(x.summary&&x.summary.trim()));
    state.reviews=arr;
    if(arr.length===0){ setErr("reviews_test.tsv найден, но пустой — показан демо-отзыв."); state.current=DEMO; }
  }catch(e){ setErr("Не удалось загрузить reviews_test.tsv ("+(e.message||e)+"). Показан демо-отзыв."); state.current=DEMO; }
  finally{ pick(); }
}

function mapSent(s){if(s==="positive")return["👍","positive"];if(s==="negative")return["👎","negative"];if(s==="neutral")return["❓","neutral"];return["—","n/a"]}
function mapNoun(s){if(s==="high")return["🟢","high"];if(s==="medium")return["🟡","medium"];if(s==="low")return["🔴","low"];return["—","n/a"]}

async function tryEndpoint(ep, prompt, text){
  const headers={"Content-Type":"application/json"};
  const tok=el.token.value.trim();
  if(tok) headers.Authorization="Bearer "+tok;
  const res=await fetch(ep.url,{method:"POST",headers,body:JSON.stringify({inputs:prompt+"\n\n"+text})});
  if(res.status===402||res.status===429) throw new Error("Rate limit or payment required ("+res.status+")");
  if(!res.ok) throw new Error("HTTP "+res.status+" @ "+ep.url);
  const data=await res.json();
  // Common shapes: [{generated_text: "..."}] or [{summary_text:"..."}] or string
  let out="";
  if(Array.isArray(data) && data.length){
    if(typeof data[0]==="object"){
      out = (data[0].generated_text ?? data[0].summary_text ?? "");
    } else {
      out = String(data[0]||"");
    }
  }else if(typeof data==="string"){ out=data; }
  else { out=JSON.stringify(data); }
  const first=(out||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean)[0]||"";
  return first.toLowerCase();
}

async function callApi(prompt,text){
  let lastErr=null;
  for(const ep of ENDPOINTS){
    try{
      const result=await tryEndpoint(ep,prompt,text);
      return result;
    }catch(e){
      lastErr=e;
      // continue to next endpoint (handle CORS/network silently)
    }
  }
  throw lastErr || new Error("All endpoints failed");
}

function parseSent(s){const v=s.trim().toLowerCase();return (v==="positive"||v==="negative"||v==="neutral")?v:"invalid"}
function parseNoun(s){const v=s.trim().toLowerCase();return (v==="high"||v==="medium"||v==="low")?v:"invalid"}

function tokenize(t){return t.split(/[^A-Za-z]+/).filter(x=>x)}
function heuristicLevel(original){
  const stop=new Set(["a","an","the","and","or","but","of","to","for","with","in","on","at","from","by","this","that","is","are","was","were","be","been","being","it","its","as","not","no","very"]);
  const words=tokenize(original).map(x=>x.toLowerCase());
  const filtered=words.filter(w=>w.length>=3&&!/\d/.test(w)&&!stop.has(w));
  const suff=["tion","sion","ment","ness","ity","ship","er","or","age"];
  const caps=(original.match(/\b[A-Z][a-zA-Z]+\b/g)||[]).filter(w=>!/^[A-Z][a-z]+\.$/.test(w));
  let set=new Set();
  for(const w of filtered){if(suff.some(s=>w.endsWith(s))) set.add(w)}
  for(const w of caps){if(w.length>=3) set.add(w.toLowerCase())}
  const n=set.size; if(n<=5)return"low"; if(n<=15)return"medium"; return"high";
}

async function doSent(){
  if(!state.current) pick();
  uiBusy(true); setErr("");
  try{
    const text=state.current.text||state.current.summary||"";
    const out=await callApi("Return ONLY one word: positive OR negative OR neutral.",text);
    const v=parseSent(out); const m=mapSent(v==="invalid"?"":v);
    el.sentEmoji.textContent=m[0]; el.sentText.textContent=m[1];
    if(v==="invalid") setErr("Invalid sentiment response; retry");
  }catch(e){ setErr(String(e.message||e)); }
  finally{ uiBusy(false); }
}

async function doNouns(){
  if(!state.current) pick();
  uiBusy(true); setErr("");
  try{
    const text=state.current.text||state.current.summary||"";
    const out=await callApi("Read the review. Count English nouns. Return ONLY one word based on total count: high (>=16), medium (6-15), low (<=5).",text);
    const v=parseNoun(out); const h=heuristicLevel(text); const m=mapNoun(v==="invalid"?"":v);
    el.nounEmoji.textContent=m[0]; el.nounText.textContent=m[1];
    if(v==="invalid"){ setErr("Invalid noun-level response; retry"); el.mismatch.classList.add("hidden"); }
    else{ if(v!==h) el.mismatch.classList.remove("hidden"); else el.mismatch.classList.add("hidden"); }
    el.btnRe.classList.remove("hidden");
  }catch(e){ setErr(String(e.message||e)); }
  finally{ uiBusy(false); }
}

el.btnRand.onclick=pick;
el.btnSent.onclick=doSent;
el.btnNouns.onclick=doNouns;

let reTimer=null;
el.btnRe.onclick=()=>{ if(reTimer) return; reTimer=setTimeout(()=>{reTimer=null},800); doNouns(); };

loadTSV();
