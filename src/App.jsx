import { useState, useRef, useEffect } from 'react'

const PERGUNTAS = [
  {
    id: 1,
    texto: "Me conta uma situação em que um cliente estava insatisfeito e você não tinha a solução na mão. O que você fez?",
    avalia: "Autonomia, comunicação sob pressão, foco no cliente"
  },
  {
    id: 2,
    texto: "Como você organiza sua rotina quando está gerenciando vários clientes ao mesmo tempo? Me dá um exemplo real.",
    avalia: "Organização, gestão de prioridades, método"
  },
  {
    id: 3,
    texto: "Você já usou alguma plataforma de cursos online — como aluno, criador ou no trabalho? O que achou da experiência?",
    avalia: "Familiaridade com EdTech, curiosidade, visão de produto"
  },
  {
    id: 4,
    texto: "Por que CS e por que agora? O que te atrai nessa área?",
    avalia: "Intencionalidade, clareza de carreira"
  }
]

const SENHA_PAINEL = "curseduca2025"

// ─── Avaliação via Claude API ───────────────────────────────────────────────
async function avaliarRespostas(apiKey, nome, respostas) {
  const prompt = `Você é um recrutador especialista da Curseduca, uma EdTech brasileira em crescimento.
Avalie as respostas do candidato "${nome}" para a vaga de Analista de CS com base nos critérios abaixo.

${respostas.map((r, i) => `Pergunta ${i+1}: ${PERGUNTAS[i].texto}\nResposta: ${r.texto}\n`).join('\n')}

Critérios de avaliação:
- Comunicação clara e objetiva
- Exemplos concretos nas respostas
- Fit cultural com startup em crescimento
- Familiaridade com tecnologia/EdTech
- Motivação genuína

Responda APENAS em JSON válido, sem texto extra, neste formato exato:
{
  "score": <número de 0 a 100>,
  "classificacao": "<✅ Avança | 🟡 Talvez | ❌ Não avança>",
  "pontos_fortes": ["<ponto 1>", "<ponto 2>"],
  "alertas": ["<alerta 1>"],
  "resumo": "<2 frases sobre o candidato>"
}`

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    })
  })

  const data = await response.json()
  const text = data.content?.[0]?.text || "{}"
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim())
  } catch {
    return { score: 50, classificacao: "🟡 Talvez", pontos_fortes: [], alertas: ["Erro na avaliação automática"], resumo: "Avalie manualmente." }
  }
}

// ─── Componente Candidato ───────────────────────────────────────────────────
function TelaCandidato({ apiKey, onFinalizar }) {
  const [nome, setNome] = useState("")
  const [iniciado, setIniciado] = useState(false)
  const [perguntaAtual, setPerguntaAtual] = useState(0)
  const [respostas, setRespostas] = useState([])
  const [inputTexto, setInputTexto] = useState("")
  const [gravando, setGravando] = useState(false)
  const [transcrevendo, setTranscrevendo] = useState(false)
  const [avaliando, setAvaliando] = useState(false)
  const [concluido, setConcluido] = useState(false)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])

  const iniciarGravacao = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const mr = new MediaRecorder(stream)
      mr.ondataavailable = e => chunksRef.current.push(e.data)
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        await transcreverAudio(blob)
      }
      mediaRecorderRef.current = mr
      mr.start()
      setGravando(true)
    } catch {
      alert("Não foi possível acessar o microfone. Por favor, use o campo de texto ou permita o acesso ao microfone nas configurações do navegador.")
    }
  }

  const pararGravacao = () => {
    mediaRecorderRef.current?.stop()
    setGravando(false)
    setTranscrevendo(true)
  }

  const transcreverAudio = async (blob) => {
    const reader = new FileReader()
    reader.onloadend = async () => {
      const base64 = reader.result.split(',')[1]
      try {
        const savedKey = localStorage.getItem("openai_key") || ""
        if (!savedKey) {
          alert("API key não encontrada. Volte à tela inicial e salve a key da Anthropic.")
          setTranscrevendo(false)
          return
        }
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": savedKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true"
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 500,
            messages: [{
              role: "user",
              content: [
                { type: "text", text: "Transcreva exatamente o que foi dito neste áudio em português. Retorne apenas a transcrição, sem comentários." },
                { type: "document", source: { type: "base64", media_type: "audio/webm", data: base64 } }
              ]
            }]
          })
        })
        const data = await response.json()
        if (data.error) {
          alert("Erro da API: " + data.error.message)
          setTranscrevendo(false)
          return
        }
        const transcricao = data.content?.[0]?.text || ""
        setInputTexto(transcricao)
      } catch (err) {
        alert("Erro ao transcrever: " + err.message)
      }
      setTranscrevendo(false)
    }
    reader.readAsDataURL(blob)
  }

  const enviarResposta = async () => {
    if (!inputTexto.trim()) return
    const novasRespostas = [...respostas, { texto: inputTexto.trim(), porAudio: gravando === false && transcrevendo === false && inputTexto !== "" }]
    setRespostas(novasRespostas)
    setInputTexto("")

    if (perguntaAtual + 1 < PERGUNTAS.length) {
      setPerguntaAtual(perguntaAtual + 1)
    } else {
      setAvaliando(true)
      const avaliacao = await avaliarRespostas(apiKey, nome, novasRespostas)
      const candidatos = JSON.parse(localStorage.getItem("candidatos") || "[]")
      candidatos.push({ nome, respostas: novasRespostas, avaliacao, data: new Date().toLocaleDateString("pt-BR") })
      localStorage.setItem("candidatos", JSON.stringify(candidatos))
      setAvaliando(false)
      setConcluido(true)
      onFinalizar()
    }
  }

  const styles = {
    container: { minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: 'system-ui, sans-serif' },
    card: { background: 'white', borderRadius: '16px', padding: '40px', maxWidth: '600px', width: '100%', boxShadow: '0 25px 50px rgba(0,0,0,0.3)' },
    titulo: { fontSize: '24px', fontWeight: '700', color: '#0f172a', marginBottom: '8px' },
    subtitulo: { fontSize: '14px', color: '#64748b', marginBottom: '32px' },
    input: { width: '100%', padding: '12px 16px', border: '2px solid #e2e8f0', borderRadius: '10px', fontSize: '16px', boxSizing: 'border-box', outline: 'none', transition: 'border-color 0.2s' },
    btn: { background: '#7c3aed', color: 'white', border: 'none', borderRadius: '10px', padding: '14px 28px', fontSize: '16px', fontWeight: '600', cursor: 'pointer', width: '100%', marginTop: '16px' },
    btnVermelho: { background: '#dc2626', color: 'white', border: 'none', borderRadius: '10px', padding: '12px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
    btnCinza: { background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', padding: '12px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
    progresso: { background: '#e2e8f0', borderRadius: '99px', height: '8px', marginBottom: '32px' },
    progressoBar: { background: '#7c3aed', borderRadius: '99px', height: '8px', transition: 'width 0.4s' },
    perguntaBox: { background: '#f8fafc', borderRadius: '12px', padding: '20px', marginBottom: '24px', borderLeft: '4px solid #7c3aed' },
    textarea: { width: '100%', padding: '12px 16px', border: '2px solid #e2e8f0', borderRadius: '10px', fontSize: '15px', boxSizing: 'border-box', minHeight: '120px', resize: 'vertical', outline: 'none', fontFamily: 'inherit' },
    row: { display: 'flex', gap: '12px', marginTop: '16px', alignItems: 'center' },
    badge: { display: 'inline-block', background: '#ede9fe', color: '#7c3aed', borderRadius: '99px', padding: '4px 12px', fontSize: '12px', fontWeight: '600', marginBottom: '16px' }
  }

  if (concluido) return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>✅</div>
          <h2 style={styles.titulo}>Triagem concluída!</h2>
          <p style={{ color: '#64748b', marginTop: '8px' }}>Obrigado, {nome}! Suas respostas foram enviadas com sucesso. Nossa equipe entrará em contato em breve.</p>
        </div>
      </div>
    </div>
  )

  if (avaliando) return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px', animation: 'spin 1s linear infinite' }}>⏳</div>
          <h2 style={styles.titulo}>Analisando suas respostas...</h2>
          <p style={{ color: '#64748b', marginTop: '8px' }}>Isso pode levar alguns segundos.</p>
        </div>
      </div>
    </div>
  )

  if (!iniciado) return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>👋</div>
          <h1 style={styles.titulo}>Triagem — Analista de CS</h1>
          <p style={styles.subtitulo}>Curseduca • Processo Seletivo</p>
        </div>
        <p style={{ color: '#475569', marginBottom: '24px', lineHeight: '1.6' }}>
          Essa é a primeira etapa do nosso processo. Você vai responder <strong>4 perguntas</strong> — pode digitar ou gravar por áudio. Fale naturalmente, sem roteiro. Cada resposta pode ter até 2 minutos. Não existe resposta certa ou errada.
        </p>
        <input style={styles.input} placeholder="Seu nome completo" value={nome} onChange={e => setNome(e.target.value)} onKeyDown={e => e.key === 'Enter' && nome.trim() && setIniciado(true)} />
        <button style={{ ...styles.btn, opacity: nome.trim() ? 1 : 0.5 }} onClick={() => nome.trim() && setIniciado(true)}>
          Começar →
        </button>
      </div>
    </div>
  )

  const pct = ((perguntaAtual) / PERGUNTAS.length) * 100

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <span style={styles.badge}>Pergunta {perguntaAtual + 1} de {PERGUNTAS.length}</span>
        <div style={styles.progresso}><div style={{ ...styles.progressoBar, width: `${pct}%` }} /></div>

        <div style={styles.perguntaBox}>
          <p style={{ margin: 0, fontSize: '17px', fontWeight: '600', color: '#1e293b', lineHeight: '1.5' }}>
            {PERGUNTAS[perguntaAtual].texto}
          </p>
        </div>

        <textarea
          style={styles.textarea}
          placeholder="Digite sua resposta aqui..."
          value={inputTexto}
          onChange={e => setInputTexto(e.target.value)}
        />

        {transcrevendo && <p style={{ color: '#7c3aed', fontSize: '14px', marginTop: '8px' }}>🎙 Transcrevendo áudio...</p>}

        <div style={styles.row}>
          {!gravando ? (
            <button style={styles.btnCinza} onClick={iniciarGravacao}>🎙 Gravar áudio</button>
          ) : (
            <button style={styles.btnVermelho} onClick={pararGravacao}>⏹ Parar gravação</button>
          )}
          <button
            style={{ ...styles.btn, marginTop: 0, opacity: inputTexto.trim() ? 1 : 0.4 }}
            onClick={enviarResposta}
            disabled={!inputTexto.trim()}
          >
            {perguntaAtual + 1 < PERGUNTAS.length ? 'Próxima →' : 'Enviar respostas ✓'}
          </button>
        </div>
        {gravando && <p style={{ color: '#dc2626', fontSize: '13px', marginTop: '8px' }}>🔴 Gravando... clique em "Parar gravação" quando terminar.</p>}
      </div>
    </div>
  )
}

// ─── Componente Painel ──────────────────────────────────────────────────────
function Painel({ onVoltar }) {
  const [senha, setSenha] = useState("")
  const [autenticado, setAutenticado] = useState(false)
  const [candidatos, setCandidatos] = useState([])
  const [expandido, setExpandido] = useState(null)
  const [filtro, setFiltro] = useState("todos")

  useEffect(() => {
    if (autenticado) {
      setCandidatos(JSON.parse(localStorage.getItem("candidatos") || "[]"))
    }
  }, [autenticado])

  const styles = {
    container: { minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui, sans-serif', padding: '32px 20px' },
    header: { maxWidth: '900px', margin: '0 auto 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    titulo: { fontSize: '22px', fontWeight: '700', color: '#0f172a' },
    card: { background: 'white', borderRadius: '12px', padding: '20px', marginBottom: '16px', maxWidth: '900px', margin: '0 auto 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', cursor: 'pointer' },
    btn: { background: '#7c3aed', color: 'white', border: 'none', borderRadius: '8px', padding: '10px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
    btnOutline: { background: 'white', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 20px', fontSize: '14px', cursor: 'pointer' },
    score: (s) => ({ display: 'inline-block', background: s >= 70 ? '#dcfce7' : s >= 50 ? '#fef9c3' : '#fee2e2', color: s >= 70 ? '#16a34a' : s >= 50 ? '#ca8a04' : '#dc2626', borderRadius: '99px', padding: '4px 14px', fontSize: '13px', fontWeight: '700' }),
    input: { width: '100%', padding: '12px 16px', border: '2px solid #e2e8f0', borderRadius: '10px', fontSize: '16px', boxSizing: 'border-box', outline: 'none', marginBottom: '16px' }
  }

  if (!autenticado) return (
    <div style={{ ...styles.container, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'white', borderRadius: '16px', padding: '40px', maxWidth: '400px', width: '100%', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}>
        <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '8px' }}>Painel G&C</h2>
        <p style={{ color: '#64748b', marginBottom: '24px', fontSize: '14px' }}>Acesso restrito à equipe Curseduca</p>
        <input style={styles.input} type="password" placeholder="Senha" value={senha} onChange={e => setSenha(e.target.value)} onKeyDown={e => e.key === 'Enter' && senha === SENHA_PAINEL && setAutenticado(true)} />
        <button style={{ ...styles.btn, width: '100%' }} onClick={() => senha === SENHA_PAINEL ? setAutenticado(true) : alert("Senha incorreta")}>
          Entrar
        </button>
        <button style={{ ...styles.btnOutline, width: '100%', marginTop: '12px' }} onClick={onVoltar}>← Voltar</button>
      </div>
    </div>
  )

  const filtrados = filtro === "todos" ? candidatos : candidatos.filter(c => c.avaliacao?.classificacao?.includes(filtro === "avanca" ? "Avança" : filtro === "talvez" ? "Talvez" : "Não avança"))

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.titulo}>Painel G&C — Analista de CS</h1>
          <p style={{ color: '#64748b', fontSize: '14px', marginTop: '4px' }}>{candidatos.length} candidato(s) triado(s)</p>
        </div>
        <button style={styles.btnOutline} onClick={onVoltar}>← Voltar</button>
      </div>

      <div style={{ maxWidth: '900px', margin: '0 auto 24px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {[["todos", "Todos"], ["avanca", "✅ Avança"], ["talvez", "🟡 Talvez"], ["nao", "❌ Não avança"]].map(([v, l]) => (
          <button key={v} onClick={() => setFiltro(v)} style={{ ...styles.btn, background: filtro === v ? '#7c3aed' : 'white', color: filtro === v ? 'white' : '#475569', border: '1px solid #e2e8f0', padding: '8px 16px' }}>{l}</button>
        ))}
      </div>

      {filtrados.length === 0 && <div style={{ ...styles.card, textAlign: 'center', color: '#64748b' }}>Nenhum candidato ainda.</div>}

      {filtrados.map((c, i) => (
        <div key={i} style={styles.card} onClick={() => setExpandido(expandido === i ? null : i)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong style={{ fontSize: '16px' }}>{c.nome}</strong>
              <span style={{ marginLeft: '12px', color: '#94a3b8', fontSize: '13px' }}>{c.data}</span>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <span style={styles.score(c.avaliacao?.score || 0)}>{c.avaliacao?.score || '?'}/100</span>
              <span style={{ fontSize: '18px' }}>{c.avaliacao?.classificacao?.split(' ')[0]}</span>
            </div>
          </div>

          {expandido === i && (
            <div style={{ marginTop: '20px', borderTop: '1px solid #f1f5f9', paddingTop: '20px' }}>
              <p style={{ color: '#475569', fontSize: '14px', marginBottom: '16px' }}>{c.avaliacao?.resumo}</p>

              {c.avaliacao?.pontos_fortes?.length > 0 && (
                <div style={{ marginBottom: '12px' }}>
                  <strong style={{ fontSize: '13px', color: '#16a34a' }}>✅ Pontos fortes</strong>
                  <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
                    {c.avaliacao.pontos_fortes.map((p, j) => <li key={j} style={{ fontSize: '13px', color: '#475569' }}>{p}</li>)}
                  </ul>
                </div>
              )}

              {c.avaliacao?.alertas?.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <strong style={{ fontSize: '13px', color: '#dc2626' }}>⚠️ Alertas</strong>
                  <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
                    {c.avaliacao.alertas.map((a, j) => <li key={j} style={{ fontSize: '13px', color: '#475569' }}>{a}</li>)}
                  </ul>
                </div>
              )}

              <strong style={{ fontSize: '13px', color: '#475569' }}>Respostas completas</strong>
              {c.respostas.map((r, j) => (
                <div key={j} style={{ marginTop: '12px', background: '#f8fafc', borderRadius: '8px', padding: '12px' }}>
                  <p style={{ margin: '0 0 6px 0', fontSize: '12px', color: '#94a3b8', fontWeight: '600' }}>
                    P{j + 1}: {PERGUNTAS[j]?.texto}
                  </p>
                  <p style={{ margin: 0, fontSize: '14px', color: '#1e293b' }}>{r.texto}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── App Principal ──────────────────────────────────────────────────────────
export default function App() {
  const [tela, setTela] = useState("home")
  const [apiKey, setApiKey] = useState(localStorage.getItem("openai_key") || "")
  const [inputKey, setInputKey] = useState("")

  const salvarKey = () => {
    localStorage.setItem("openai_key", inputKey)
    setApiKey(inputKey)
    setInputKey("")
    alert("API key salva!")
  }

  const styles = {
    container: { minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #4c1d95 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: 'system-ui, sans-serif' },
    card: { background: 'white', borderRadius: '20px', padding: '48px 40px', maxWidth: '480px', width: '100%', boxShadow: '0 30px 60px rgba(0,0,0,0.4)', textAlign: 'center' },
    logo: { fontSize: '48px', marginBottom: '16px' },
    titulo: { fontSize: '26px', fontWeight: '800', color: '#0f172a', marginBottom: '8px' },
    subtitulo: { color: '#64748b', marginBottom: '40px', fontSize: '15px' },
    btn: (cor) => ({ background: cor, color: 'white', border: 'none', borderRadius: '12px', padding: '16px 24px', fontSize: '16px', fontWeight: '600', cursor: 'pointer', width: '100%', marginBottom: '12px', display: 'block' }),
    keyBox: { background: '#f8fafc', borderRadius: '12px', padding: '20px', marginTop: '32px', textAlign: 'left' },
    input: { width: '100%', padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', marginBottom: '10px' }
  }

  if (tela === "candidato") return <TelaCandidato apiKey={apiKey} onFinalizar={() => setTela("home")} />
  if (tela === "painel") return <Painel onVoltar={() => setTela("home")} />

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logo}>🎯</div>
        <h1 style={styles.titulo}>Triagem Curseduca</h1>
        <p style={styles.subtitulo}>Analista de Customer Success</p>

        <button style={styles.btn('#7c3aed')} onClick={() => setTela("candidato")}>
          👤 Sou candidato(a)
        </button>
        <button style={styles.btn('#1e293b')} onClick={() => setTela("painel")}>
          🔒 Painel G&C
        </button>

        <div style={styles.keyBox}>
          <p style={{ margin: '0 0 10px', fontSize: '13px', color: '#475569', fontWeight: '600' }}>
            {apiKey ? "✅ API Key da OpenAI configurada" : "⚙️ Configurar API Key (necessária para áudio)"}
          </p>
          <input style={styles.input} type="password" placeholder="sk-..." value={inputKey} onChange={e => setInputKey(e.target.value)} />
          <button onClick={salvarKey} style={{ background: '#0f172a', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', cursor: 'pointer' }}>
            Salvar
          </button>
        </div>
      </div>
    </div>
  )
}
