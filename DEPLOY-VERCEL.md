# Publicar: interface na Vercel + compilador fora da Vercel

## Por que não dá pra rodar TUDO na Vercel?

Gerar o APK precisa de: JDK 17, Android SDK (~700 MB de ferramentas:
`aapt2`, `d8`, `apksigner`), rodar processos do sistema por vários
segundos e gravar arquivos temporários. As funções serverless da
Vercel não permitem instalar isso, têm limite de tamanho/tempo e
sistema de arquivos temporário. **Resultado: na Vercel vai só a
interface (HTML bonito); a compilação roda num backend Docker.**

Arquitetura final (o visitante nem percebe — usa um site só):

```
Visitante → seu-site.vercel.app  (interface, pasta public/)
                │  /api/*  (rewrite do vercel.json)
                ▼
         web2apk-backend.onrender.com  (Docker: Node + JDK + Android SDK)
                ▼
              APK pronto
```

---

## Passo 1 — Suba este projeto pro GitHub

Crie um repositório e envie o conteúdo desta pasta (a pasta `web2apk/`
inteira pode ser a raiz do repositório).

## Passo 2 — Publique o BACKEND (Render, grátis pra testar)

1. Acesse https://render.com → **New → Web Service** → conecte seu GitHub
   e escolha o repositório.
2. Ele detecta o `Dockerfile` (e o `render.yaml`). Confirme e clique em
   **Create Web Service**.
3. Aguarde o build (baixa o Android SDK na primeira vez, leva alguns
   minutos). No fim você ganha uma URL tipo
   `https://web2apk-backend.onrender.com`.
4. Teste abrindo `https://web2apk-backend.onrender.com/api/health`
   → deve responder `{"ok":true,...}`.

> Alternativas ao Render: **Railway** (New Project → Deploy from GitHub,
> ele usa o mesmo Dockerfile), **Fly.io** (`fly launch`) ou uma **VPS**
> com `docker build -t web2apk . && docker run -p 3000:3000 web2apk`.
> No plano free do Render o serviço "dorme" sem uso — a primeira
> geração depois disso demora 1–2 min pra acordar.

## Passo 3 — Ligue a Vercel ao backend

Edite o arquivo **`vercel.json`** e troque `SEU-BACKEND.onrender.com`
pela URL real do seu backend (sem barra no final):

```json
"destination": "https://web2apk-backend.onrender.com/api/:path*"
```

Faça commit dessa alteração.

## Passo 4 — Publique a interface na Vercel

1. Acesse https://vercel.com → **Add New → Project** → importe o mesmo
   repositório do GitHub.
2. Se o repositório tiver a pasta `web2apk/` dentro dele, defina
   **Root Directory = web2apk**. Framework Preset: **Other** (o
   `vercel.json` já configura `outputDirectory: public`).
3. **Deploy**. Pronto: `https://seu-site.vercel.app` com tudo
   funcionando — o navegador chama `/api/...` no próprio domínio da
   Vercel, ela repassa pro backend, e o APK é gerado lá.

## Testando rápido sem editar o vercel.json

Na própria página publicada existe, no rodapé, a seção
**"⚙️ Configuração do servidor de geração"**: cole a URL do backend
e salve. Isso vale só no seu navegador (bom pra testar). O jeito
definitivo, pra todos os visitantes, é o Passo 3.

---

## Atalho: tudo num lugar só (sem Vercel)

O backend Docker já serve a interface também. Se publicar **só o
Passo 2**, o site inteiro (interface + geração) funciona na URL do
Render/Railway. A Vercel, nesse projeto, é opcional — útil se você
quer o domínio `.vercel.app`, CDN rápida pra interface e o costume
de usar a Vercel.
