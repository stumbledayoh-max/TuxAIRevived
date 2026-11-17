# Web2APK 📱

Site que transforma **HTML / CSS / JS / WASM** em um **APK Android de verdade** (app nativo com WebView).

## Como rodar

```bash
cd web2apk
bash setup.sh   # só na 1ª vez: baixa JDK 17 + Android SDK (~700 MB) para ~/build
node server.js  # abre em http://localhost:3000
```

## Como funciona

1. O usuário cola um HTML, ou envia um `.html`, um `.zip` ou a **pasta** do projeto (precisa ter `index.html`).
2. Informa **nome do app, nome do pacote, versão e foto/ícone** (+ cor, orientação, internet, zoom).
3. O servidor monta um projeto Android, gera os ícones em todas as densidades
   (incl. ícone adaptativo), compila com `aapt2` + `javac` + `d8`, alinha com
   `zipalign` e assina com `apksigner` — sem Gradle, sem internet na hora de compilar.
4. O WebView serve os arquivos dos assets com os MIME types certos, então
   **`.wasm` (application/wasm), JS modules, fontes, mídia** etc. funcionam offline.

## Estrutura

- `public/index.html` — interface (tudo inline, funciona no preview)
- `server.js` — servidor Node sem dependências + pipeline de build
- `template/` — `MainActivity.java` e `AndroidManifest.xml` base
- `make_icon.py` — gera os ícones (ou um padrão com a inicial do app)
- `jobs/` — builds temporários (limpos após 1h)
- `keystore/debug.keystore` — chave de assinatura gerada automaticamente

> APK assinado com chave de teste: instala em qualquer Android. Para a Play
> Store, re-assine com sua chave oficial (`apksigner sign --ks sua-chave.jks`).

## Publicar na internet

- **Interface na Vercel + compilador em Docker (Render/Railway/VPS):**
  passo a passo completo em `DEPLOY-VERCEL.md`. A Vercel sozinha não
  compila APK (serverless, sem Android SDK).
- **Tudo num lugar só:** suba o `Dockerfile` no Render/Railway que o
  site inteiro (interface + geração) roda numa URL só.
