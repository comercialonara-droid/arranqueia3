# ArranqueIA

IA de vendas no WhatsApp para lojas de veículos: carros, motos e bicicletas elétricas. Ela responde o cliente em segundos, 24 horas por dia, com dados reais do estoque: manda fotos, simula a parcela, pré-avalia o carro da troca, agenda a visita e passa o cliente para o vendedor na hora certa. Tudo aparece num painel onde a equipe acompanha e assume qualquer conversa.

Feito para converter lead de tráfego pago: quem chega por anúncio de clique para o WhatsApp é identificado, a IA começa pelo carro do anúncio, e os eventos de lead, visita e venda voltam para a Meta (Conversions API) para a campanha otimizar por quem compra, não só por quem manda "oi".

O primeiro cliente configurado é a FA Veículos (`seed/fa-veiculos.json`). Há também um exemplo de loja de bicicletas elétricas (`seed/voltta-ebikes.json`).

Marca e manual de identidade: [docs/marca](docs/marca/README.md).

---

## Novidades da versão 3: marketing com IA

- **Questionário da loja** (região, cliente, ticket, margem, meta, oferta, verba, canais, conteúdo, equipe), que a IA lê antes de criar qualquer campanha.
- **IA estrategista (Claude)**: cria o plano completo da campanha de tráfego pago: públicos, estrutura, anúncios prontos com roteiro de criativo, orçamento por fase, metas, cronograma e regras de otimização.
- **Resultados até a venda**: investimento, custo por lead, qualificados, simulações, visitas, vendas, custo por venda, receita, ROAS e ROI, por campanha e da loja toda.
- **Conta de anúncios da Meta**: investimento e cliques entram sozinhos (Marketing API, a cada 3 horas). Sem conta, lança-se o dia na mão.
- **Lead ligado à campanha** pelo anúncio que o cliente clicou; a IA de atendimento recebe as orientações da campanha.
- **IA analista**: lê os números e devolve diagnóstico e ações.
- **Segmento motos**, além de carros e bicicletas elétricas.

Guia: [docs/guia-marketing.md](docs/guia-marketing.md).

## Novidades da versão 2.1

- **Cada cliente é separado de ponta a ponta.** Conversas, estoque, biblioteca de áudios, respostas prontas, notas, simulações, agenda, equipe, configurações, números de WhatsApp e arquivos (fotos, vídeos e áudios ficam em pastas `loja-N`) são só da loja. Dono e vendedor nunca enxergam outra loja, nem forçando o endereço. A mesma pessoa que fala com duas lojas vira duas conversas diferentes. Isso é verificado em testes automáticos (`server/test/isolation.test.ts`).
- **Segmento por loja: veículos ou bicicletas elétricas.** Ao criar a loja (menu Lojas), o administrador escolhe o segmento. Em loja de bikes, a IA fala de bike, pergunta o uso e o trajeto, busca por autonomia, não fala de km, câmbio nem FIPE, e o cadastro do estoque ganha a ficha técnica (motor, bateria, autonomia, velocidade, recarga, carga máxima, aro, suspensão, freios, marchas, garantia). Os padrões de uma loja de bikes já vêm prontos: preço informado, parcelamento no cartão, sem troca e simulação sem CPF/CNH (tudo ajustável).
- **Nova marca ArranqueIA** no painel (logo, ícone e favicon), seguindo o manual de identidade.

---

## O que mudou na versão 2

- **A IA é um filtro.** Ela entende o que a pessoa quer (só informação, fotos e vídeos, simulação, visita, negociar) e atende cada caso do jeito certo, sem empurrar.
- **Simulação de crédito pelo WhatsApp.** Quando o cliente mostra interesse, ela oferece a simulação, coleta forma de pagamento, entrada ou troca, nome completo, CPF, data de nascimento e CNH, e manda a **ficha pronta para o vendedor**, que assume a conversa. O CPF é conferido (dígitos verificadores), guardado criptografado e aparece mascarado no painel.
- **Preço só com o consultor** (configurável): a loja escolhe se a IA passa preço, destaca parcela ou não fala valores.
- **Conversa humanizada.** Prompt reescrito com exemplos do tom certo e errado, mensagens curtas, uma pergunta por vez, sem legenda de ficha técnica nas fotos.
- **Áudios do vendedor.** A loja grava áudios (boas-vindas, convite para simulação…), diz quando usar cada um, e a IA manda o áudio certo na hora certa, sem repetir. O sistema converte para mensagem de voz do WhatsApp.
- **Vídeos dos carros** no estoque, enviados pela IA.
- **Qualificação em 4 dimensões** (intenção, capacidade de pagamento, momento, engajamento), com o motivo de cada ponto, e temperatura frio, morno, quente ou pronto.
- **Leitura da IA em cada conversa:** resumo, travas, sinais de compra e próximo passo para o vendedor, e um botão "Analisar agora" que lê a conversa inteira.
- **Vários acessos:** administrador (todas as lojas), dono da loja (tudo da loja dele) e vendedor (só os clientes dele). Cada pessoa com e-mail e senha.
- **Várias lojas** num sistema só, cada uma com seu número de WhatsApp, estoque, equipe e configurações.
- **Mais ferramentas no painel:** tela de Simulações com situação (nova, em análise, aprovada, reprovada), notas internas, etiquetas, transferir lead entre vendedores, respostas rápidas, mandar áudio gravado pelo painel, relatório por vendedor e exportar os leads em planilha.

Para atualizar quem já está na versão 1, siga [docs/atualizar-para-v2.md](docs/atualizar-para-v2.md).

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
                 Agente de vendas (Claude Opus 5.5 + até 18 ferramentas)
     buscar_estoque · detalhes_veiculo · enviar_fotos · enviar_videos · enviar_audio
     atualizar_ficha · registrar_troca · registrar_dados_simulacao
     enviar_simulacao_para_vendedor · simular_financiamento · horarios_disponiveis
     agendar_visita · alterar_visita · enviar_localizacao_loja · enviar_botoes
     enviar_mensagem · transferir_para_vendedor · registrar_sem_interesse
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
cp .env.example .env          # preencha ADMIN_EMAIL e ADMIN_PASSWORD (o resto pode ficar vazio para testar)
npm run seed -- --fotos-demo  # cria a loja FA Veículos com fotos de exemplo
npm run build:web
npm run dev                   # http://localhost:3000/painel
```

Sem `ANTHROPIC_API_KEY`, a IA roda em **modo de teste**: respostas prontas e sempre iguais, só para exercitar o caminho (estoque, fotos, simulação, agenda, vendedor). **Não julgue a qualidade da conversa nesse modo** — com a chave, quem responde é o Claude. Sem as credenciais da Meta, tudo funciona pelo simulador do painel.

Para desenvolver o painel com recarga automática: `cd web && API_URL=http://localhost:3000 npm run dev`.

Testes: `npm test` (18 testes: financiamento, CPF e criptografia, qualificação, webhook por loja, CSV, agenda, schema das ferramentas e o funil completo até a ficha de simulação chegar no vendedor).

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

- Chave da Anthropic (`ANTHROPIC_API_KEY`) para sair do modo de teste.
- Número da loja na Cloud API (pode ser o mesmo do app, via coexistência), cadastrado em Lojas.
- Fotos e vídeos reais de cada carro no estoque.
- WhatsApp e senha do Beto e senha do Fabrício, em Equipe.
- Áudios gravados pelo Beto, em Áudios do vendedor.
- Latitude e longitude da loja, para mandar o pin.
- Três modelos de mensagem aprovados na Meta (sugestões em `docs/configurar-meta.md`).
- Dataset da Meta para as conversões.

## Próximos passos possíveis

- Várias lojas numa instalação só (hoje é uma instância por loja).
- Integração do estoque com o site da loja ou com o sistema de gestão (feed automático em vez de cadastro manual).
- Disparo de campanhas para a base (com opt-in e modelos de marketing).
- Integração com financeiras para pré-análise de crédito.
