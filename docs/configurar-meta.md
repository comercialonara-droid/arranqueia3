# Conectar o WhatsApp da loja (Meta Cloud API)

Passo a passo para ligar o Arranque ao número de WhatsApp da loja. Leva de 30 minutos a algumas horas, dependendo da verificação da empresa na Meta. Os nomes dos menus da Meta mudam com frequência; se algum não bater, procure pelo nome do recurso.

## 1. Conta comercial e app

1. No **Gerenciador de Negócios** (business.facebook.com), confira se a empresa da loja está criada e, de preferência, **verificada** (Configurações, Central de segurança). Sem verificação o número tem limite baixo de conversas por dia.
2. Em **developers.facebook.com**, crie um app do tipo **Business** ligado a essa conta comercial.
3. No app, adicione o produto **WhatsApp**.

## 2. Número

- **Número novo ou que pode sair do app**: em WhatsApp, Configuração da API, adicione o número e confirme por SMS ou ligação.
- **Manter o app WhatsApp Business no celular ao mesmo tempo (coexistência)**: o mesmo número continua no app e passa a funcionar também pela API. Isso é feito pelo cadastro incorporado (Embedded Signup) de um parceiro ou provedor de tecnologia da Meta. Com a coexistência, o Arranque percebe quando alguém da loja responde pelo celular e pausa a IA naquele contato.

Anote:
- **ID do número de telefone** → `WA_PHONE_NUMBER_ID`
- **ID da conta do WhatsApp Business (WABA)** → `WA_WABA_ID`

## 3. Token permanente

O token temporário da tela de teste expira em 24 horas. Para produção:

1. Gerenciador de Negócios, Configurações do negócio, **Usuários do sistema**: crie um usuário do sistema administrador.
2. Atribua a ele o app e a conta do WhatsApp (controle total).
3. Gere um token sem expiração com as permissões `whatsapp_business_messaging`, `whatsapp_business_management` e, para as conversões, `whatsapp_business_manage_events`.
4. Coloque em `WA_ACCESS_TOKEN`.

**App Secret**: no app, Configurações do app, Básico, Chave secreta do app → `WA_APP_SECRET`. É com ela que o Arranque confere que cada chamada do webhook veio mesmo da Meta.

## 4. Webhook

1. Suba o Arranque com HTTPS e `PUBLIC_URL` correto.
2. No app, WhatsApp, Configuração, **Webhook**:
   - URL de callback: `https://SEU-DOMINIO/webhook` (o painel mostra o endereço exato em Configurações, Integrações)
   - Token de verificação: o valor de `WA_VERIFY_TOKEN`
3. Assine o campo **messages**. Se usar coexistência, assine também **smb_message_echoes**.
4. Coloque o app em modo **Ao vivo** (Live).

Teste: mande "oi" de outro celular para o número da loja. A conversa aparece no painel em segundos.

## 5. Modelos de mensagem (templates)

O WhatsApp só deixa a empresa escrever livremente até 24 horas depois da última mensagem do cliente. Fora disso, só com modelo aprovado. Crie estes três no Gerenciador do WhatsApp, Modelos de mensagem, idioma Português (BR), e depois informe o nome deles em Configurações no painel.

**Aviso ao vendedor** (categoria Utilidade), usado em Configurações, Vendedores:
```
Novo cliente para você: {{1}} ({{2}}).
Motivo: {{3}}
Resumo: {{4}}
Abra o painel para continuar o atendimento.
```

**Retomada** (categoria Marketing), usado em Configurações, Retomadas e lembretes:
```
Oi, {{1}}! O {{2}} que você viu ainda está disponível aqui na loja. Quer que eu reserve um horário para você conhecer pessoalmente?
```

**Lembrete de visita** (categoria Utilidade):
```
Oi, {{1}}! Passando para lembrar da sua visita {{2}}. Responda aqui para confirmar ou se precisar remarcar.
```

Sem o modelo de aviso ao vendedor, o alerta só chega se o vendedor tiver mandado mensagem para o número da loja nas últimas 24 horas. Uma alternativa simples: o vendedor deixa o painel aberto no celular (a conversa aparece em "Precisam de você agora").

## 6. Conversões para os anúncios

Quando o cliente chega por um anúncio de clique para o WhatsApp, a mensagem traz um identificador do clique (`ctwa_clid`). O Arranque guarda esse identificador e devolve para a Meta:

| Momento | Evento enviado |
|---|---|
| Cliente mostrou interesse real (carro + forma de pagamento, nome ou entrada) | `LeadSubmitted` |
| Agendou visita ou foi passado para o vendedor | `QualifiedLead` |
| Venda registrada no painel, com valor | `Purchase` |

Para ligar:

1. Crie (ou recupere) o dataset da conta do WhatsApp no Gerenciador de Eventos, ou pela API com `POST /{WA_WABA_ID}/dataset`. O ID retornado vai em `META_DATASET_ID`.
2. O token precisa da permissão `whatsapp_business_manage_events`.
3. Para conferir, defina `META_TEST_EVENT_CODE` com o código de teste do Gerenciador de Eventos e veja os eventos chegando. Depois, apague o código.

Com os eventos chegando, dá para otimizar a campanha por lead qualificado ou por compra, em vez de só por conversa iniciada.

## 7. Anúncios

Nos anúncios com destino WhatsApp (objetivo Engajamento, Leads ou Vendas), use o número da loja. O título do anúncio aparece para a IA, então um título que nomeia o carro ("Corolla XEi 2022 com GNV") faz ela começar a conversa direto por ele.
