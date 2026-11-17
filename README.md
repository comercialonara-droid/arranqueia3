# Arranque

IA de vendas no WhatsApp para lojas de veículos. Ela responde o cliente em segundos, 24 horas por dia, com dados reais do estoque: manda fotos, simula a parcela, pré-avalia o carro da troca, agenda a visita e passa o cliente para o vendedor na hora certa. Tudo aparece num painel onde a equipe acompanha e assume qualquer conversa.

Feito para converter lead de tráfego pago: quem chega por anúncio de clique para o WhatsApp é identificado, a IA começa pelo carro do anúncio, e os eventos de lead, visita e venda voltam para a Meta (Conversions API) para a campanha otimizar por quem compra, não só por quem manda "oi".

O primeiro cliente configurado é a FA Veículos (`seed/fa-veiculos.json`), mas o sistema é de uso geral: cada loja tem sua própria instância, configuração e estoque.

---

## O que a IA faz

| Etapa | Como |
|---|---|
| Responde rápido e como gente | Espera o cliente terminar de digitar (agrupa mensagens seguidas), mostra "digitando…", responde em balões curtos, uma pergunta por vez. |
| Começa pelo anúncio | Lê o `referral` do clique no anúncio (título, texto, `ctwa_clid`) e já puxa o carro anunciado. |
| Só fala do que existe | Toda informação de carro vem da ferramenta de estoque. Nada de preço ou opcional inventado. |
| Mostra o carro | Envia as fotos reais do estoque direto no WhatsApp. |
| Fala de parcela | Simula financiamento pela regra da loja (ex.: a cada R$ 30 mil financiados, R$ 1 mil de parcela) ou pela tabela Price, sempre com o aviso de análise de crédito. |
| Qualifica sem interrogatório | Vai anotando nome, carro de interesse, forma de pagamento, entrada, troca, urgência e bairro na ficha do CRM. Calcula a temperatura do lead. |
| Pré-avalia a troca | Pede modelo, ano, km, se é quitado e fotos. Vê as fotos que o cliente manda. Nunca dá valor de avaliação. |
| Agenda a visita | Consulta horários livres (expediente, antecedência, lotação), oferece em botões do WhatsApp, confirma e manda a localização. |
| Passa para o vendedor | Quando o cliente quer negociar, pede uma pessoa, reclama ou está pronto para fechar: pausa a IA naquele contato, escolhe o vendedor em rodízio e manda o resumo para ele no WhatsApp. |
| Retoma quem sumiu | Mensagens curtas e diferentes depois de X horas sem resposta (dentro da janela de 24h), modelo aprovado depois disso. Lembrete automático antes da visita, com botões de confirmar ou remarcar. |
| Entende áudio (opcional) | Transcreve o áudio do cliente. Sem transcrição configurada, pede com educação para escrever. |
| Respeita limites | Para de mandar mensagens automáticas para quem pede. Não pede CPF ou renda. Admite que é assistente virtual se perguntarem. Negociação de valor é sempre com humano. |

## O painel da loja

- **Visão geral**: quem precisa de um vendedor agora, visitas de hoje e amanhã, funil da conversa até a venda, conversas e visitas por dia, anúncios que mais trazem cliente, carros mais procurados, custo estimado da IA.
- **Conversas**: tudo em tempo real, no formato do WhatsApp. Botão para assumir a conversa (a IA pausa) e para devolver. Ficha completa do lead ao lado.
- **Funil de leads**: quadro por etapa, arrastar para mudar. Registrar venda com valor manda o evento de compra para a Meta e tira o carro do estoque.
- **Estoque**: cadastro com fotos, preço, FIPE, destaques; importação por planilha CSV.
- **Agenda**: visitas e test-drives; marcar se o cliente compareceu.
- **Testar a IA**: um celular simulado para conversar com a IA usando o estoque e as regras reais, sem mandar nada pelo WhatsApp. Ótimo para treinar e para mostrar ao cliente.
- **Configurações**: dados da loja, tom de voz, política de preço, regras específicas, financiamento, horários, vendedores, retomadas, modelos aprovados e status das integrações.

---

## Arquitetura

```
Cliente no WhatsApp
      │  (mensagem, foto, áudio, clique em botão, clique no anúncio)
      ▼
Meta Cloud API ──webhook──▶ /webhook  (valida assinatura, responde 200 na hora)
                               │
                               ▼
                     Fila por contato (agrupa mensagens, uma resposta por vez)
                               │
                               ▼
                 Agente de vendas (Claude Opus 5.5 + 14 ferramentas)
     buscar_estoque · detalhes_veiculo · enviar_fotos · simular_financiamento
     registrar_cliente · registrar_troca · horarios_disponiveis · agendar_visita
     alterar_visita · enviar_localizacao_loja · enviar_botoes · enviar_mensagem
     transferir_para_vendedor · registrar_sem_interesse
                               │
          ┌────────────────────┼─────────────────────┐
          ▼                    ▼                     ▼
   WhatsApp (respostas)   SQLite (CRM, estoque,   Conversions API (Meta)
                          agenda, histórico)      LeadSubmitted / QualifiedLead / Purchase
                               │
                               ▼
                    Painel React (tempo real via SSE)
```

Pontos de engenharia que importam para a qualidade:

- **Histórico só de acréscimo.** Nada que já foi enviado ao modelo é editado. Isso mantém o cache do prompt (mais barato e mais rápido) e preserva o raciocínio entre turnos.
- **Contexto do turno como mensagem de sistema.** Data, hora, loja aberta ou fechada, origem do anúncio e ficha do CRM entram como mensagem de sistema no meio da conversa, não no prompt fixo. O prompt fixo fica em cache por 1 hora.
- **Ferramentas com schema estrito** e validação com zod antes de executar. Erros voltam para o modelo como resultado de ferramenta, e ele se corrige.
- **Fallback do lado da API** (`fallbacks: "default"`) se o modelo recusar. Se a API cair, o sistema tenta de novo com espera crescente; na última falha, avisa o cliente e chama um vendedor.
- **Sessões**: se o cliente volta depois de 72 horas, começa uma conversa nova com a IA, que recebe a ficha do CRM como contexto. O custo não cresce sem limite.
- **Coexistência com o app WhatsApp Business**: se alguém da loja responder pelo celular (campo `smb_message_echoes`), a IA sai de cena naquele contato.
- **Idempotência**: mensagens reentregues pela Meta são ignoradas; conversões não são duplicadas.

## Estrutura

```
server/src
  index.ts              servidor (Fastify), estáticos, painel
  config.ts             variáveis de ambiente
  agent/                prompt do vendedor, ferramentas, loop do agente, modo simulado
  pipeline/             entrada (fila, agrupamento, mídia) e saída (envio, balões)
  whatsapp/             cliente da Cloud API e webhook
  services/             estoque, financiamento, agenda, pontuação, vendedor, conversões, retomadas, métricas
  api/                  API do painel e login
  db/                   SQLite (node:sqlite), repositórios, configurações
server/test             testes (npm test)
web/                    painel (React, Vite, Tailwind, shadcn/ui)
seed/fa-veiculos.json   configuração e estoque inicial da FA Veículos
docs/                   passo a passo da Meta e guia de operação
```

## Rodar localmente

Requisitos: Node 22.13 ou mais novo.

```bash
npm install
cd web && npm install && cd ..
cp .env.example .env          # preencha ADMIN_PASSWORD (o resto pode ficar vazio para testar)
npm run seed -- --fotos-demo  # carrega a FA Veículos com fotos de exemplo
npm run build:web
npm run dev                   # http://localhost:3000/painel
```

Sem `ANTHROPIC_API_KEY`, a IA roda em **modo de teste**: respostas prontas que exercitam o fluxo inteiro (estoque, fotos, parcela, agenda, vendedor). Com a chave, quem responde é o Claude. Sem as credenciais da Meta, tudo funciona pelo simulador do painel.

Para desenvolver o painel com recarga automática: `cd web && API_URL=http://localhost:3000 npm run dev`.

Testes: `npm test` (17 testes: financiamento, webhook, CSV, agenda, schema das ferramentas e uma conversa completa de ponta a ponta).

## Colocar no ar

> **Não use Vercel (nem outra hospedagem "serverless") para o servidor.** O Arranque precisa ficar ligado o tempo todo: guarda o banco em disco (SQLite), espera alguns segundos para agrupar as mensagens do cliente antes de responder, roda as retomadas e lembretes a cada minuto e mantém o painel atualizado ao vivo. Na Vercel cada requisição roda numa função que é congelada logo depois de responder e o disco é apagado: a IA para de responder no meio, os dados somem e os lembretes não rodam. Use um servidor que fica ligado, com disco persistente.
>
> O jeito mais simples: **Railway** (ou Render). Conecte o repositório do GitHub, ele detecta o `Dockerfile` sozinho; crie um **volume** montado em `/app/data`, cole as variáveis do `.env` e gere um domínio público. Coloque esse domínio em `PUBLIC_URL`.

1. Um servidor com HTTPS e disco persistente (Railway, Render, Fly.io ou uma VPS com Docker). A Meta exige HTTPS no webhook e baixa as fotos pelo `PUBLIC_URL`.
2. `cp .env.example .env` e preencha tudo.
3. `docker compose up -d --build`
4. Defina `SEED_FILE=seed/fa-veiculos.json` (ou o JSON de outra loja): na primeira vez que sobe com o banco vazio, o servidor carrega a configuração e o estoque sozinho.
5. Siga [docs/configurar-meta.md](docs/configurar-meta.md) para conectar o número e o webhook.
6. Abra o painel, suba as fotos reais dos carros, cadastre os vendedores e teste em **Testar a IA** antes de ligar o anúncio.

O banco fica em `data/arranque.db` (SQLite). Faça backup dessa pasta.

## Custos de operação (referência)

- **Claude Opus 5.5**: US$ 4 por milhão de tokens de entrada, US$ 20 de saída, US$ 0,20 para leitura de cache. Uma conversa típica de venda fica na casa de alguns centavos de dólar até poucas dezenas de centavos, dependendo do tamanho. O painel mostra o custo estimado do período. Para baratear, `AI_EFFORT=low` reduz o raciocínio.
- **WhatsApp**: respostas dentro da janela de atendimento (cliente falou nas últimas 24h) não são cobradas pela Meta, e quem chega por anúncio de clique para o WhatsApp abre uma janela gratuita maior. Mensagens de modelo fora da janela são cobradas por mensagem, conforme a tabela de preços da Meta (confira a atual antes de orçar).
- **Transcrição de áudio** (opcional): cobrada por minuto pelo provedor.

## O que falta para a FA Veículos ir ao ar

- Número da loja na Cloud API (pode ser o mesmo do app, via coexistência) e credenciais no `.env`.
- Fotos reais de cada carro no estoque e o preço dos que estão sem.
- WhatsApp do Beto em Configurações, Vendedores (ele está cadastrado e desativado até ter o número).
- Latitude e longitude da loja, para mandar o pin.
- Três modelos de mensagem aprovados na Meta (sugestões em `docs/configurar-meta.md`).
- Dataset da Meta para as conversões.

## Próximos passos possíveis

- Várias lojas numa instalação só (hoje é uma instância por loja).
- Integração do estoque com o site da loja ou com o sistema de gestão (feed automático em vez de cadastro manual).
- Disparo de campanhas para a base (com opt-in e modelos de marketing).
- Integração com financeiras para pré-análise de crédito.
