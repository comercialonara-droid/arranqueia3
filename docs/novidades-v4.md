# ArranqueIA v4 · painel com visual novo

Só o painel (pasta `web/`) mudou. Servidor, banco e IA continuam iguais: dá para atualizar por cima da v3 sem migração.

O que mudou no painel:
- Tema escuro com a mesma luz azul e a faixa amarela da landing page.
- Menu lateral novo, com cartão do usuário embaixo, e barra superior com saudação, data, loja e o estado do WhatsApp e da IA.
- Visão geral reorganizada: quatro indicadores principais com minigráfico, gráfico de atendimento por dia, "Precisam de você agora" em destaque, funil em formato de estrada, visitas, anúncios e mais procurados.
- Cores ajustadas em todas as telas (conversas, funil, estoque, simulações, marketing, campanhas, agenda, configurações e simulador).

Como atualizar no Railway: substitua os arquivos do repositório pelos desta pasta e faça o deploy. O Dockerfile já roda o build do painel.

Ajustes desta revisão:
- Conversa no celular: o cabeçalho não passa mais da tela (botões encurtam no celular).
- Marketing: valores grandes aparecem resumidos (ex.: R$ 1,15 mi) em vez de cortados.
