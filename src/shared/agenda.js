// Datas do 2º turno de 2026. Conferidas em 11/10/2026; debates dependem das emissoras e podem mudar.
export const FONTES_AGENDA = {
  cf0510: { nome: 'Congresso em Foco: prazos e datas do 2º turno (5/10/2026)', url: 'https://www.congressoemfoco.com.br/noticia/122787/reta-final-confira-os-prazos-e-principais-datas-do-segundo-turno' },
  met0610: { nome: 'Metrópoles: debates do 2º turno (6/10/2026)', url: 'https://www.metropoles.com/brasil/globo-band-record-debates-flavio' },
  dn0710: { nome: 'Diário do Nordeste: datas dos debates (7/10/2026)', url: 'https://diariodonordeste.verdesmares.com.br/pontopoder/veja-datas-dos-debates-previstos-para-o-segundo-turno-das-eleicoes-1.3797047' },
};

/** data: AAAA-MM-DD (horário de Brasília). tipo: debate | prazo | votacao */
export const AGENDA = [
  { data: '2026-10-09', ate: '2026-10-23', tipo: 'prazo', titulo: 'Propaganda gratuita no rádio e na TV', detalhe: 'De 9 a 23 de outubro.', fonte: 'cf0510' },
  { data: '2026-10-11', tipo: 'debate', titulo: 'Debate na Record', detalhe: 'Presidente, 20h. Participação sinalizada pelas campanhas.', fonte: 'met0610' },
  { data: '2026-10-18', tipo: 'debate', titulo: 'Debate na Band', detalhe: 'Presidente, 20h. Participação sinalizada pelas campanhas.', fonte: 'met0610' },
  { data: '2026-10-20', tipo: 'prazo', titulo: 'Eleitores não podem ser presos, salvo em flagrante', detalhe: 'Vale até 27 de outubro.', fonte: 'cf0510' },
  { data: '2026-10-22', tipo: 'prazo', titulo: 'Último dia de comícios e de propaganda paga na internet', detalhe: 'A partir daí, fica proibido publicar novos conteúdos feitos ou alterados por IA com imagem ou voz de candidatos.', fonte: 'cf0510' },
  { data: '2026-10-23', tipo: 'debate', titulo: 'Debate na Globo', detalhe: 'Presidente, horário ainda não anunciado.', fonte: 'met0610' },
  { data: '2026-10-23', tipo: 'prazo', titulo: 'Fim da propaganda no rádio e na TV e dos debates', detalhe: 'Debates podem ir até a meia-noite.', fonte: 'cf0510' },
  { data: '2026-10-24', tipo: 'prazo', titulo: 'Véspera: caminhadas, carreatas e material impresso até 22h', detalhe: '', fonte: 'cf0510' },
  { data: '2026-10-25', tipo: 'votacao', titulo: 'Votação do 2º turno', detalhe: 'Das 8h às 17h (Brasília). Resultados a partir das 17h.', fonte: 'cf0510' },
];
