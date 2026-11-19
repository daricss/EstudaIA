# EstudaIA · Plataforma de estudo ativo

Projeto multidisciplinar de **Matheus Godoy, Leonardo Bueno e Kauã Eduardo**, turma **3º C**, curso **Técnico em Vendas**, Atibaia (2026).

> **Ideia:** usar inteligência artificial para compreender, conferir e aprender, não apenas copiar respostas.

## O que foi preservado da versão 6

- Identidade visual e globo interativo, sem animação de abertura.
- Tutor com métodos de estudo (Socrático, Feynman, quiz, redação e outros).
- Gerador e biblioteca de comandos.
- Simulação de conversa, cartões de revisão e anotações.
- Temporizador, organização de estudo, temas e senso crítico.
- Compatibilidade com o armazenamento das versões anteriores, porque as chaves antigas de dados continuam as mesmas.

## O que foi desenvolvido nesta continuação

1. **Materiais próprios:** leitura de PDF com texto selecionável, TXT e Markdown; também é possível colar texto. O arquivo é aberto no navegador, não no servidor do EstudaIA. Limites: 10 MB, 60 páginas e até 150 mil caracteres para evitar travamentos.
2. **Estudo guiado com o material:** a pessoa vê uma prévia, faz uma pergunta e, se estiver usando IA externa e autorizar, o tutor recebe apenas alguns trechos que combinam com a pergunta. É uma busca básica por palavras, não uma análise perfeita de todo o PDF. A IA pode errar.
3. **Modo local sem IA conectada:** mostra um trecho selecionado e propõe uma pergunta de leitura ativa. **Não afirma interpretar ou corrigir o PDF automaticamente.**
4. **Método em quatro etapas:** Consciência, Tutoria guiada, Verificação e Estudo sem IA.
5. **Informações do projeto e referências:** equipe, objetivos, metas e cuidados com a privacidade, em linguagem escolar. Os números de 85%, 60% e 80% da apresentação aparecem apenas como *simulação fictícia*, nunca como pesquisa realizada.
6. **Nome padronizado:** EstudaIA em toda a interface, sem apagar dados que já foram salvos no navegador.

## Como abrir

- Para testar as funções que não dependem de servidor, abra `index.html` em um navegador moderno.
- Para testar como site, rode um servidor estático na pasta (`python -m http.server 8000`), depois entre em `http://localhost:8000`.
- Para hospedar na Cloudflare (Workers): conecte o repositório, deixe o Build command vazio e use `npx wrangler deploy`. O site fica em `public/` e a rota `/api/chat` está em `src/worker.js`. Para ligar o tutor com IA, use chaves gratuitas da Groq (`GROQ_API_KEY`) e da NVIDIA (`NVIDIA_API_KEY`). Local: copie `.dev.vars.example` para `.dev.vars`, preencha e rode `npx wrangler dev`. Quando um motor esgota, o Worker passa para o próximo; se todos esgotarem, o site avisa quando a IA volta.

**A leitura de PDF precisa de conexão com a internet para carregar a biblioteca PDF.js do CDN.** PDF feito só de imagens necessita de OCR externo: esta versão não possui OCR. Textos TXT/Markdown e o campo de colagem não precisam da biblioteca.

## Quando o tutor tem IA de verdade?

O tutor funciona de duas formas:

- **Sem configuração:** modo local, com roteiro de perguntas, *sem geração de respostas por IA*. Ainda é possível usar cartões, comandos, notas e leitura de textos.
- **Com conexão configurada:** uma chave `ANTHROPIC_API_KEY` no Worker da Cloudflare ou uma chave fornecida pelo próprio usuário na área de conexão. Isso envolve serviço externo sujeito a **cobrança, limites e políticas do fornecedor**. Para manter a proposta escolar de gasto adicional previsto R$ 0, não é necessário ativar uma API paga. **Nunca publique uma chave no código.**

Outras variáveis opcionais para o servidor: `CLAUDE_MODEL`, `ALLOWED_ORIGIN` e `RATE_LIMIT_PER_10MIN`. O limite embutido por IP é de melhor esforço e não substitui ferramentas adequadas para alto tráfego.

## Privacidade

- Não é necessário criar conta.
- Notas, cartões e histórico de chat são armazenados localmente no navegador. Limpar os dados do navegador pode apagá-los.
- O texto de arquivos carregados fica em memória, apenas na aba atual, e não é guardado no `localStorage` pelo módulo de materiais.
- O conteúdo do PDF **não é enviado automaticamente** para a API. Apenas os trechos selecionados para uma pergunta são enviados quando o usuário marca explicitamente a autorização, *e* o tutor está conectado a um serviço de IA externo.
- Mensagens enviadas ao tutor remoto são processadas pelo serviço externo. Evite compartilhar documentos pessoais, dados de terceiros ou informações sensíveis.
- O código original oferece a opção de salvar uma chave pessoal da Anthropic no navegador. Em dispositivos compartilhados, evite essa opção e prefira uma conexão administrada pelo site.

## Correspondência com o trabalho escolar

| Item dos PDFs | Local no site |
| --- | --- |
| Uso ativo e crítica às respostas prontas | Introdução, tutor e Senso crítico |
| Método em quatro etapas | Faixa abaixo da abertura |
| Tutor por perguntas, exemplos e pistas | Tutor |
| Leitura de PDFs e materiais próprios | Materiais |
| Revisão e consolidação | Mesa, cartões e lista de conferência |
| Foco | Temporizador e metas na Mesa |
| Divulgação, análise SWOT e pesquisa | Projeto e apresentação; metas não são resultados reais |
| Equipe e referências | Sobre |

O projeto não comprova melhora de notas nem aprendizagem automaticamente: isso requer pesquisa de campo e testes reais, conforme o próprio PDF.
