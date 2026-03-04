import { useState, useEffect, useRef } from "react";

const PERGUNTAS = [
  { id:1, texto:"Me conta uma situação em que um cliente estava insatisfeito e você não tinha a solução na mão. O que você fez?" },
  { id:2, texto:"Como você organiza sua rotina quando está gerenciando vários clientes ao mesmo tempo? Me dá um exemplo real." },
  { id:3, texto:"Você já usou alguma plataforma de cursos online — como aluno, criador ou no trabalho? O que achou da experiência?" },
  { id:4, texto:"Por que CS e por que agora? O que te atrai nessa área?" },
];

const SENHA_PAINEL = "curseduca2025";
const STORE_KEY    = "triagem_v3";
const OAI_KEY_K    = "oai_key_triagem";

const gerarId    = () => Date.now().toString(36) + Math.random().toString(36).slice(2);
const getStore   = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)||"[]"); } catch { return []; } };
const saveStore  = (d) => localStorage.setItem(STORE_KEY, JSON.stringify(d));
const getOAIKey  = () => localStorage.getItem(OAI_KEY_K)||"";
const saveOAIKey = (k) => localStorage.setItem(OAI_KEY_K, k);

// ─── WHISPER ─────────────────────────────────────────────────────────────────
async function transcrever(blob, apiKey) {
  const form = new FormData();
  form.append("file", new File([blob], "audio.webm", { type: blob.type||"audio/webm" }));
  form.append("model", "whisper-1");
  form.append("language", "pt");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method:"POST",
    headers:{ Authorization:`Bearer ${apiKey}` },
    body:form,
  });
  if (!res.ok) throw new Error(res.status);
  return (await res.json()).text?.trim()||"";
}

// ─── AVALIAÇÃO ────────────────────────────────────────────────────────────────
async function avaliar(nome, respostas, modos) {
  const prompt = `Você é avaliador de triagem de CS para a Curseduca, EdTech SaaS brasileira em crescimento acelerado.
Valores: Foco no cliente, Somos Inconformados, Executamos com Inteligência, Comunicação com Clareza e Coragem.
Candidato: ${nome}
Respostas:
${PERGUNTAS.map((p,i)=>`P${i+1} [${modos[i]==="audio"?"áudio":"texto"}]: ${p.texto}\nR: ${respostas[i]||"(sem resposta)"}`).join("\n\n")}
Retorne APENAS JSON válido:
{"classificacao":"AVANÇA"|"NÃO AVANÇA"|"TALVEZ","score":0-100,"resumo":"2 frases","avaliacoes":[{"pergunta":1,"nota":"FORTE"|"OK"|"FRACO","comentario":"1 frase"},{"pergunta":2,"nota":"FORTE"|"OK"|"FRACO","comentario":"1 frase"},{"pergunta":3,"nota":"FORTE"|"OK"|"FRACO","comentario":"1 frase"},{"pergunta":4,"nota":"FORTE"|"OK"|"FRACO","comentario":"1 frase"}],"pontoForte":"...","atencao":"..."}`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000, messages:[{role:"user",content:prompt}] }),
    });
    const data = await res.json();
    return JSON.parse(data.content?.[0]?.text.replace(/```json|```/g,"").trim()||"{}");
  } catch { return null; }
}

// ─── BADGE ────────────────────────────────────────────────────────────────────
function Badge({ v }) {
  const m = {
    "AVANÇA":     {bg:"#0d3d2e",c:"#4ade80",l:"✅ Avança"},
    "NÃO AVANÇA": {bg:"#3d0d0d",c:"#f87171",l:"❌ Não avança"},
    "TALVEZ":     {bg:"#3d320d",c:"#fbbf24",l:"🟡 Talvez"},
    "FORTE":      {bg:"#0d3d2e",c:"#4ade80",l:"Forte"},
    "OK":         {bg:"#1e293b",c:"#94a3b8",l:"OK"},
    "FRACO":      {bg:"#3d0d0d",c:"#f87171",l:"Fraco"},
  };
  const s = m[v]||m["OK"];
  return <span style={{background:s.bg,color:s.c,padding:"2px 10px",borderRadius:20,fontSize:12,fontWeight:700}}>{s.l}</span>;
}

function Dots() {
  return (
    <span style={{display:"inline-flex",gap:4}}>
      {[0,1,2].map(i=>(
        <span key={i} style={{width:6,height:6,borderRadius:"50%",background:"#64748b",display:"inline-block",animation:`bounce 1.2s ease-in-out ${i*0.2}s infinite`}}/>
      ))}
    </span>
  );
}

// ─── GRAVADOR ────────────────────────────────────────────────────────────────
function GravadorAudio({ onTranscricao, apiKey }) {
  const [estado, setEstado] = useState("idle");
  const [seg, setSeg]       = useState(0);
  const [erroMsg, setErro]  = useState("");
  const mediaRef  = useRef(null);
  const chunksRef = useRef([]);
  const timerRef  = useRef(null);

  async function gravar() {
    if (!apiKey) {
      setErro("Cole a API key da OpenAI na tela inicial antes de gravar.");
      setEstado("erro"); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/ogg";
      const mr = new MediaRecorder(stream, { mimeType });
      mediaRef.current  = mr;
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size>0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t=>t.stop());
        const blob = new Blob(chunksRef.current, { type:mimeType });
        setEstado("transcrevendo");
        try {
          const texto = await transcrever(blob, apiKey);
          setEstado("idle"); setSeg(0);
          if (texto) onTranscricao(texto);
          else { setErro("Não consegui entender o áudio. Tente novamente."); setEstado("erro"); }
        } catch {
          setErro("Erro na transcrição. Verifique a API key da OpenAI.");
          setEstado("erro");
        }
      };
      mr.start();
      setEstado("gravando"); setSeg(0);
      timerRef.current = setInterval(()=>setSeg(s=>s+1), 1000);
    } catch {
      setErro("Não foi possível acessar o microfone. Verifique as permissões do browser.");
      setEstado("erro");
    }
  }

  function parar() { clearInterval(timerRef.current); mediaRef.current?.stop(); }
  const fmt = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  if (estado==="transcrevendo") return (
    <div style={S.audioRow}>
      <div style={S.spinner}/>
      <span style={{color:"#94a3b8",fontSize:13}}>Transcrevendo com IA...</span>
    </div>
  );
  if (estado==="gravando") return (
    <div style={S.audioRow}>
      <div style={S.recDot}/>
      <span style={{color:"#f87171",fontSize:13,fontWeight:600}}>Gravando {fmt(seg)}</span>
      <button style={S.stopBtn} onClick={parar}>⏹ Parar e enviar</button>
    </div>
  );
  if (estado==="erro") return (
    <div style={{display:"flex",flexDirection:"column",gap:6}}>
      <div style={{fontSize:12,color:"#f87171",padding:"4px 8px"}}>{erroMsg}</div>
      <button style={S.micBtn} onClick={()=>setEstado("idle")}>Tentar novamente</button>
    </div>
  );
  return <button style={S.micBtn} onClick={gravar}>🎙 Responder por áudio</button>;
}

// ─── HEADER ──────────────────────────────────────────────────────────────────
function Header({ sub, progresso }) {
  return (
    <div style={S.header}>
      <div style={S.logo}>C</div>
      <div style={{flex:1}}>
        <div style={{fontWeight:700,fontSize:15,color:"#f1f5f9"}}>Triagem — Analista de CS</div>
        <div style={{fontSize:12,color:"#64748b",marginTop:1}}>Curseduca · {sub}</div>
      </div>
      {progresso!==undefined&&(
        <div style={S.progressWrap}>
          <div style={{...S.progressFill,width:`${progresso}%`}}/>
        </div>
      )}
    </div>
  );
}

// ─── TELA CANDIDATO ───────────────────────────────────────────────────────────
function TelaCandidato({ apiKey }) {
  const [etapa, setEtapa]     = useState("nome");
  const [nome, setNome]       = useState("");
  const [msgs, setMsgs]       = useState([]);
  const [input, setInput]     = useState("");
  const [pIdx, setPIdx]       = useState(0);
  const [respostas, setR]     = useState([]);
  const [modos, setM]         = useState([]);
  const [digitando, setDig]   = useState(false);
  const [aguarda, setAguarda] = useState(false);
  const bottomRef             = useRef(null);

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[msgs,digitando]);

  function iniciar() {
    if (!nome.trim()) return;
    setEtapa("chat");
    const intro = [
      `Olá, ${nome.split(" ")[0]}! 👋 Bem-vindo(a) ao processo seletivo da Curseduca.`,
      `São só 4 perguntas. Responda por texto ou grave um áudio — como preferir.`,
      `Vamos lá?`,
    ];
    let d=0;
    intro.forEach((txt,i)=>{
      d += i===0?400:1100;
      setTimeout(()=>{
        setMsgs(prev=>[...prev,{tipo:"bot",texto:txt}]);
        if (i===intro.length-1) setTimeout(()=>{
          setMsgs(prev=>[...prev,{tipo:"pergunta",texto:PERGUNTAS[0].texto}]);
          setAguarda(true);
        },700);
      },d);
    });
  }

  async function responder(resp, modo) {
    if (!resp.trim()) return;
    setAguarda(false); setInput("");
    setMsgs(prev=>[...prev,{tipo:"user",texto:resp,modo}]);
    const nr=[...respostas,resp], nm=[...modos,modo];
    setR(nr); setM(nm);
    const prox = pIdx+1;
    if (prox<PERGUNTAS.length) {
      setDig(true);
      setTimeout(()=>{
        setDig(false);
        setMsgs(prev=>[...prev,{tipo:"pergunta",texto:PERGUNTAS[prox].texto}]);
        setPIdx(prox); setAguarda(true);
      },1300);
    } else {
      setDig(true);
      setTimeout(()=>{
        setDig(false);
        setMsgs(prev=>[...prev,{tipo:"bot",texto:"Perfeito! Recebi tudo. Nossa equipe de G&C vai analisar seu perfil e entrará em contato em breve. Obrigada! 🚀"}]);
        setEtapa("enviando");
        finalizar(nome,nr,nm);
      },1200);
    }
  }

  async function finalizar(n,r,m) {
    const av = await avaliar(n,r,m);
    const c = {
      id:gerarId(), nome:n, respostas:r, modos:m, avaliacao:av,
      data:new Date().toLocaleDateString("pt-BR"),
      hora:new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}),
    };
    saveStore([...getStore(),c]);
    setTimeout(()=>setEtapa("fim"),600);
  }

  if (etapa==="nome") return (
    <div style={S.wrap}>
      <Header sub="Processo Seletivo"/>
      <div style={S.center}>
        <div style={{fontSize:48}}>👋</div>
        <div style={S.titulo}>Antes de começar</div>
        <div style={S.subtxt}>Como você se chama?</div>
        <input style={S.inp} placeholder="Seu nome completo" value={nome}
          onChange={e=>setNome(e.target.value)} onKeyDown={e=>e.key==="Enter"&&iniciar()} autoFocus/>
        <button style={S.btnG} onClick={iniciar}>Começar →</button>
      </div>
    </div>
  );

  if (etapa==="fim") return (
    <div style={S.wrap}>
      <Header sub="Concluído"/>
      <div style={S.center}>
        <div style={{fontSize:52}}>🎉</div>
        <div style={S.titulo}>Tudo certo, {nome.split(" ")[0]}!</div>
        <div style={{color:"#94a3b8",textAlign:"center",lineHeight:1.7,fontSize:14}}>
          Suas respostas foram recebidas com sucesso.<br/>
          Nossa equipe de G&C entrará em contato em breve.
        </div>
      </div>
    </div>
  );

  const prog = (Math.min(respostas.length,PERGUNTAS.length)/PERGUNTAS.length)*100;

  return (
    <div style={S.wrap}>
      <Header sub={`Pergunta ${Math.min(pIdx+1,PERGUNTAS.length)} de ${PERGUNTAS.length}`} progresso={prog}/>
      <div style={S.chatBody}>
        {msgs.map((m,i)=>(
          <div key={i} style={m.tipo==="user"?S.rowUser:S.rowBot}>
            {m.tipo!=="user"&&<div style={S.avatar}>C</div>}
            <div style={m.tipo==="user"?S.bUser:m.tipo==="pergunta"?S.bPerg:S.bBot}>
              {m.tipo==="user"&&m.modo==="audio"&&<span style={{fontSize:11,color:"#4ade80",marginRight:6}}>🎙</span>}
              {m.texto}
            </div>
          </div>
        ))}
        {digitando&&<div style={S.rowBot}><div style={S.avatar}>C</div><div style={S.bBot}><Dots/></div></div>}
        <div ref={bottomRef}/>
      </div>
      {etapa==="chat"&&aguarda&&(
        <div style={S.inputArea}>
          <div style={{display:"flex",gap:8}}>
            <textarea style={S.ta} placeholder="Digite sua resposta... (Enter para enviar)"
              value={input} onChange={e=>setInput(e.target.value)} rows={2}
              onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();responder(input,"texto");}}}/>
            <button style={S.sendBtn} onClick={()=>responder(input,"texto")}>→</button>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{flex:1,height:1,background:"#1e293b"}}/>
            <span style={{fontSize:11,color:"#475569",letterSpacing:1}}>OU</span>
            <div style={{flex:1,height:1,background:"#1e293b"}}/>
          </div>
          <GravadorAudio onTranscricao={t=>responder(t,"audio")} apiKey={apiKey}/>
        </div>
      )}
      {etapa==="enviando"&&(
        <div style={{padding:16,textAlign:"center",color:"#4ade80",fontSize:13}}>
          Analisando perfil com IA...
        </div>
      )}
    </div>
  );
}

// ─── TELA PAINEL ─────────────────────────────────────────────────────────────
function TelaPainel() {
  const [senha, setSenha]     = useState("");
  const [ok, setOk]           = useState(false);
  const [candidatos, setCand] = useState([]);
  const [sel, setSel]         = useState(null);
  const [erro, setErro]       = useState(false);

  function entrar() {
    if (senha===SENHA_PAINEL) { setOk(true); setCand(getStore()); }
    else { setErro(true); setTimeout(()=>setErro(false),2000); }
  }
  function limpar() {
    if (window.confirm("Apagar todos os candidatos?")) { saveStore([]); setCand([]); setSel(null); }
  }

  if (!ok) return (
    <div style={S.wrap}>
      <Header sub="Acesso G&C"/>
      <div style={S.center}>
        <div style={S.logo}>C</div>
        <div style={S.titulo}>Painel G&C</div>
        <div style={S.subtxt}>Thais · Amanda · Gabriele</div>
        <input style={{...S.inp,...(erro?{borderColor:"#f87171"}:{})}} type="password"
          placeholder="Senha de acesso" value={senha}
          onChange={e=>setSenha(e.target.value)} onKeyDown={e=>e.key==="Enter"&&entrar()}/>
        {erro&&<div style={{color:"#f87171",fontSize:13}}>Senha incorreta</div>}
        <button style={S.btnG} onClick={entrar}>Acessar →</button>
      </div>
    </div>
  );

  const st = {
    total:  candidatos.length,
    avanca: candidatos.filter(c=>c.avaliacao?.classificacao==="AVANÇA").length,
    talvez: candidatos.filter(c=>c.avaliacao?.classificacao==="TALVEZ").length,
    nao:    candidatos.filter(c=>c.avaliacao?.classificacao==="NÃO AVANÇA").length,
  };

  return (
    <div style={{...S.wrap,overflowY:"auto"}}>
      <div style={S.painelH}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={S.logo}>C</div>
          <div>
            <div style={{fontWeight:700,fontSize:15,color:"#f1f5f9"}}>Painel de Triagem — CS</div>
            <div style={{fontSize:12,color:"#64748b"}}>Gente & Cultura · Curseduca</div>
          </div>
        </div>
        <button style={S.clearBtn} onClick={limpar}>Limpar</button>
      </div>

      <div style={S.statsRow}>
        {[["Total",st.total,"#94a3b8"],["✅ Avança",st.avanca,"#4ade80"],["🟡 Talvez",st.talvez,"#fbbf24"],["❌ Não avança",st.nao,"#f87171"]].map(([l,v,c])=>(
          <div key={l} style={S.statCard}>
            <div style={{fontSize:26,fontWeight:800,color:c}}>{v}</div>
            <div style={{fontSize:12,color:"#64748b",marginTop:2}}>{l}</div>
          </div>
        ))}
      </div>

      {candidatos.length===0?(
        <div style={{textAlign:"center",color:"#64748b",padding:40,fontSize:14}}>
          Nenhum candidato ainda. Compartilhe o link com os candidatos!
        </div>
      ):(
        <div style={{padding:"0 20px 40px",display:"flex",flexDirection:"column",gap:10}}>
          {[...candidatos].reverse().map(c=>(
            <div key={c.id}
              style={{...S.card,...(sel?.id===c.id?{border:"1px solid #166534"}:{})}}
              onClick={()=>setSel(sel?.id===c.id?null:c)}
            >
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15,color:"#f1f5f9"}}>{c.nome}</div>
                  <div style={{fontSize:12,color:"#64748b",marginTop:2}}>
                    {c.data} às {c.hora}
                    {c.modos?.some(m=>m==="audio")&&(
                      <span style={{marginLeft:8,color:"#4ade80"}}>· 🎙 {c.modos.filter(m=>m==="audio").length} áudio</span>
                    )}
                  </div>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  {c.avaliacao&&<span style={{background:"#1e293b",color:"#94a3b8",padding:"2px 8px",borderRadius:20,fontSize:12,fontWeight:700}}>{c.avaliacao.score}/100</span>}
                  {c.avaliacao?<Badge v={c.avaliacao.classificacao}/>:<span style={{color:"#64748b",fontSize:12}}>Avaliando...</span>}
                </div>
              </div>
              {sel?.id===c.id&&c.avaliacao&&(
                <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:10}}>
                  <div style={{background:"#0a0f1e",borderRadius:8,padding:"10px 14px",fontSize:14,color:"#cbd5e1",lineHeight:1.6}}>{c.avaliacao.resumo}</div>
                  <div style={{display:"flex",gap:10}}>
                    {[["💪 Ponto forte",c.avaliacao.pontoForte],["⚠️ Atenção",c.avaliacao.atencao]].map(([l,v])=>(
                      <div key={l} style={{flex:1,background:"#0a0f1e",borderRadius:8,padding:"10px 14px"}}>
                        <div style={{fontSize:11,color:"#64748b",fontWeight:700,marginBottom:4,textTransform:"uppercase",letterSpacing:0.5}}>{l}</div>
                        <div style={{fontSize:13,color:"#cbd5e1",lineHeight:1.5}}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {c.avaliacao.avaliacoes?.map((a,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"flex-start",gap:10,background:"#0a0f1e",borderRadius:8,padding:"8px 12px"}}>
                        <span style={{fontSize:12,fontWeight:700,color:"#64748b",minWidth:20}}>P{a.pergunta}</span>
                        <Badge v={a.nota}/>
                        <span style={{fontSize:13,color:"#94a3b8",lineHeight:1.5}}>{a.comentario}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    <div style={{fontSize:11,color:"#64748b",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5}}>Respostas completas</div>
                    {c.respostas.map((r,i)=>(
                      <div key={i} style={{background:"#0a0f1e",borderRadius:8,padding:"10px 14px",borderLeft:"2px solid #166534"}}>
                        <div style={{fontSize:11,color:"#64748b",marginBottom:4,display:"flex",justifyContent:"space-between"}}>
                          <span>{PERGUNTAS[i]?.texto}</span>
                          {c.modos?.[i]==="audio"&&<span style={{color:"#4ade80",marginLeft:8,flexShrink:0}}>🎙 áudio</span>}
                        </div>
                        <div style={{fontSize:13,color:"#cbd5e1",lineHeight:1.6}}>{r}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ESTILOS ──────────────────────────────────────────────────────────────────
const S = {
  wrap:        {background:"#0a0f1e",minHeight:"100vh",display:"flex",flexDirection:"column",fontFamily:"'DM Sans',sans-serif",color:"#e2e8f0"},
  header:      {background:"#0f172a",borderBottom:"1px solid #1e293b",padding:"14px 18px",display:"flex",alignItems:"center",gap:12,position:"relative",flexShrink:0},
  logo:        {width:36,height:36,background:"linear-gradient(135deg,#166534,#14532d)",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:16,color:"#4ade80",flexShrink:0},
  progressWrap:{position:"absolute",bottom:0,left:0,right:0,height:2,background:"#1e293b"},
  progressFill:{height:"100%",background:"linear-gradient(90deg,#166534,#4ade80)",transition:"width 0.5s ease"},
  center:      {flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32,gap:12},
  titulo:      {fontSize:22,fontWeight:800,color:"#f1f5f9"},
  subtxt:      {fontSize:14,color:"#94a3b8",marginBottom:4},
  inp:         {background:"#0f172a",border:"1px solid #334155",borderRadius:10,padding:"12px 16px",color:"#f1f5f9",fontSize:15,width:"100%",maxWidth:340,outline:"none"},
  btnG:        {background:"linear-gradient(135deg,#166534,#14532d)",color:"#4ade80",border:"none",borderRadius:10,padding:"12px 32px",fontSize:15,fontWeight:700,cursor:"pointer",width:"100%",maxWidth:340,marginTop:4},
  chatBody:    {flex:1,overflowY:"auto",padding:"18px 14px",display:"flex",flexDirection:"column",gap:10},
  rowBot:      {display:"flex",alignItems:"flex-end",gap:8},
  rowUser:     {display:"flex",justifyContent:"flex-end"},
  avatar:      {width:26,height:26,background:"linear-gradient(135deg,#166534,#14532d)",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:900,color:"#4ade80",flexShrink:0},
  bBot:        {background:"#0f172a",border:"1px solid #1e293b",borderRadius:"14px 14px 14px 4px",padding:"10px 14px",maxWidth:"78%",fontSize:14,lineHeight:1.6,color:"#cbd5e1"},
  bPerg:       {background:"#0d2d1a",border:"1px solid #166534",borderRadius:"14px 14px 14px 4px",padding:"12px 16px",maxWidth:"82%",fontSize:14,lineHeight:1.6,color:"#d1fae5",fontWeight:500},
  bUser:       {background:"linear-gradient(135deg,#166534,#14532d)",borderRadius:"14px 14px 4px 14px",padding:"10px 14px",maxWidth:"78%",fontSize:14,lineHeight:1.6,color:"#dcfce7"},
  inputArea:   {borderTop:"1px solid #1e293b",padding:"10px 12px",background:"#0a0f1e",display:"flex",flexDirection:"column",gap:8,flexShrink:0},
  ta:          {flex:1,background:"#0f172a",border:"1px solid #334155",borderRadius:10,padding:"10px 14px",color:"#f1f5f9",fontSize:14,resize:"none",outline:"none",fontFamily:"'DM Sans',sans-serif",lineHeight:1.5},
  sendBtn:     {background:"linear-gradient(135deg,#166534,#14532d)",color:"#4ade80",border:"none",borderRadius:10,width:42,fontSize:18,cursor:"pointer",flexShrink:0},
  micBtn:      {background:"#0f172a",border:"1px dashed #334155",color:"#94a3b8",borderRadius:10,padding:"10px 16px",fontSize:13,fontWeight:600,cursor:"pointer",width:"100%",textAlign:"center"},
  audioRow:    {display:"flex",alignItems:"center",gap:10,background:"#0f172a",border:"1px solid #334155",borderRadius:10,padding:"10px 16px"},
  recDot:      {width:10,height:10,borderRadius:"50%",background:"#f87171",animation:"pulse 1s ease-in-out infinite",flexShrink:0},
  stopBtn:     {background:"#3d0d0d",color:"#f87171",border:"none",borderRadius:8,padding:"4px 12px",fontSize:12,fontWeight:700,cursor:"pointer",marginLeft:"auto"},
  spinner:     {width:16,height:16,borderRadius:"50%",border:"2px solid #334155",borderTopColor:"#4ade80",animation:"spin 0.8s linear infinite",flexShrink:0},
  painelH:     {background:"#0f172a",borderBottom:"1px solid #1e293b",padding:"14px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0},
  statsRow:    {display:"flex",gap:10,padding:"16px 20px",flexWrap:"wrap"},
  statCard:    {background:"#0f172a",border:"1px solid #1e293b",borderRadius:10,padding:"12px 18px",flex:"1 1 100px",textAlign:"center"},
  card:        {background:"#0f172a",border:"1px solid #1e293b",borderRadius:12,padding:"14px",cursor:"pointer",transition:"border 0.2s"},
  clearBtn:    {background:"transparent",border:"1px solid #3d0d0d",color:"#f87171",borderRadius:8,padding:"6px 12px",fontSize:12,cursor:"pointer"},
};

// ─── CONFIG API KEY ────────────────────────────────────────────────────────────
function ConfigAPIKey({ onSave }) {
  const [key, setKey]     = useState(getOAIKey());
  const [salvo, setSalvo] = useState(false);
  function salvar() {
    saveOAIKey(key.trim());
    setSalvo(true);
    setTimeout(()=>setSalvo(false),2000);
    onSave&&onSave(key.trim());
  }
  return (
    <div style={{width:"100%",maxWidth:340,display:"flex",flexDirection:"column",gap:6}}>
      <div style={{fontSize:12,color:"#64748b",textAlign:"center"}}>API key OpenAI (transcrição de áudio)</div>
      <div style={{display:"flex",gap:8}}>
        <input style={{...S.inp,flex:1,maxWidth:"none",fontSize:12,padding:"8px 12px"}}
          type="password" placeholder="sk-..." value={key}
          onChange={e=>setKey(e.target.value)} onKeyDown={e=>e.key==="Enter"&&salvar()}/>
        <button style={{...S.btnG,maxWidth:"none",width:"auto",padding:"8px 14px",marginTop:0,fontSize:13}}
          onClick={salvar}>{salvo?"✓ Salvo":"Salvar"}</button>
      </div>
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [modo, setModo]     = useState("home");
  const [apiKey, setApiKey] = useState(getOAIKey());

  if (modo==="candidato") return <TelaCandidato apiKey={apiKey}/>;
  if (modo==="painel")    return <TelaPainel/>;

  return (
    <div style={{background:"#0a0f1e",minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',sans-serif",gap:20,padding:24}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        input:focus,textarea:focus{border-color:#166534!important;}
        @keyframes bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-6px)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>
      <div style={{textAlign:"center"}}>
        <div style={{width:56,height:56,background:"linear-gradient(135deg,#166534,#14532d)",borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,fontWeight:900,color:"#4ade80",margin:"0 auto 16px"}}>C</div>
        <div style={{fontSize:24,fontWeight:800,color:"#f1f5f9"}}>Triagem Inteligente</div>
        <div style={{fontSize:14,color:"#64748b",marginTop:6}}>Analista de CS · Curseduca</div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10,width:"100%",maxWidth:300}}>
        <button style={{background:"linear-gradient(135deg,#166534,#14532d)",color:"#4ade80",border:"none",borderRadius:10,padding:13,fontSize:15,fontWeight:700,cursor:"pointer"}}
          onClick={()=>setModo("candidato")}>Sou candidato(a) →</button>
        <button style={{background:"#0f172a",color:"#64748b",border:"1px solid #1e293b",borderRadius:10,padding:13,fontSize:14,cursor:"pointer"}}
          onClick={()=>setModo("painel")}>Painel G&C</button>
      </div>
      <ConfigAPIKey onSave={k=>setApiKey(k)}/>
    </div>
  );
}
