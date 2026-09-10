# Budget Solution Cloud — inventário funcional

## Fluxos existentes a preservar

| Área | Comportamento verificável | Critério de aceitação |
|---|---|---|
| Sessão | Login, logout, sessão persistente e recuperação de password | Utilizador autenticado vê apenas as páginas autorizadas |
| Budget individual | Selecionar ano, editar 12 meses por categoria, autosave e colar dados de Excel | Valores ficam persistidos sem duplicar a chave utilizador/categoria/ano/mês |
| Categorias | Criar/editar categorias, hierarquia, associação a ano e ordem pessoal | Ordem e associações sobrevivem a refresh |
| Notas/comentários | Nota por linha, comentários por página e respostas | Autor, data e parent ficam preservados |
| Estado | Submeter e validar páginas; página validada fica bloqueada | Só approver/admin valida; edição bloqueada após validação |
| Dashboards | Totais From e Heads, comparação com ano anterior e filtros | Totais coincidem com a soma das entradas |
| Remuneração | Configuração, FTEs e simulador por ano | Cálculos coincidem com a versão local |
| Administração | Utilizadores, papéis, permissões e páginas restritas | Apenas admin altera permissões e convida utilizadores |
| Auditoria | Registar alterações, ações, autor e valores anterior/novo | Auditoria é imutável e usa identidade autenticada |
| Exportação | XLSX From/Heads, versão e histórico | Ficheiro descarrega/é recuperável sem expor bucket privado |
| Colaboração | Atualizações Realtime e presença online | Segundo browser recebe alteração sem refresh |

## Dados de referência do backup

Fonte: `budget_backup_2026-09-10T20-11-58.db` (cópia de trabalho; conservar original). Espera-se: 7 utilizadores, 12 categorias, 2 anos, 926 entradas (480 em 2026/446 em 2027), 1.059 auditorias, 30 ordens pessoais, 52 associações ano/categoria, 15 FTEs, 3 configurações de remuneração, 1 comentário, 1 estado, 4 papéis e 1 configuração especial de permissões. Os 5 exports quebrados não são critério de importação.
