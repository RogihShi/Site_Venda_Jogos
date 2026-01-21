// ==========================================================
// 1. IMPORTAÇÃO DE BIBLIOTECAS (DEPENDÊNCIAS)
// ==========================================================

// 'express': A ferramenta que cria o servidor web de forma fácil.
const express = require('express');

// 'cors': Permite que o seu site (index.html) converse com este servidor.
// Sem isso, o navegador bloqueia a conexão por segurança.
const cors = require('cors');

// 'pg': A biblioteca que conecta o Node.js ao PostgreSQL.
// 'Pool' é um gerenciador de conexões (mantém várias conexões abertas para ser rápido).
const { Pool } = require('pg');

// Cria a "aplicação" do servidor
const app = express();
const port = 3000; // A porta onde o servidor vai "escutar" (localhost:3000)

// ==========================================================
// 2. CONFIGURAÇÕES DO SERVIDOR (MIDDLEWARES)
// ==========================================================

// Libera o acesso para qualquer página acessar este servidor
app.use(cors());

// Permite que o servidor entenda dados enviados em formato JSON.
// Quando o site envia { email: "a@a.com" }, isso traduz para o servidor ler.
app.use(express.json());

// Diz ao servidor: "Se alguém pedir um arquivo que começa com /imagens,
// procure dentro da pasta 'imagens' do computador".
app.use('/imagens', express.static('imagens'));

// ==========================================================
// 3. CONEXÃO COM O BANCO DE DADOS
// ==========================================================
const pool = new Pool({
    user: 'postgres',      // Seu usuário do banco (padrão é postgres)
    host: 'localhost',     // Onde está o banco (no seu próprio PC)
    database: 'postgres',  // Nome do banco de dados
    password: '1234',      // <--- A SENHA QUE VOCÊ DEFINIU NA INSTALAÇÃO
    port: 5432,            // Porta padrão do PostgreSQL
});

// ==========================================================
// ROTA 1: PEGAR TODOS OS JOGOS (Usado no Index e Busca)
// ==========================================================
// GET: Significa "Quero pegar dados".
app.get('/jogos', async (req, res) => {
    try {
        // Vai no banco e pede tudo da tabela 'jogos', ordenado por título
        const resultado = await pool.query('SELECT * FROM jogos ORDER BY titulo ASC');
        
        // Devolve a lista (rows) para o site em formato JSON
        res.json(resultado.rows);
    } catch (err) {
        console.error(err); // Mostra o erro no terminal preto
        res.status(500).send('Erro ao buscar jogos'); // Avisa o site que deu erro
    }
});

// ==========================================================
// ROTA 2: PEGAR UM JOGO ESPECÍFICO (Usado na paginaJogo.html)
// ==========================================================
// :id é uma variável. Se o site chamar /jogos/5, o id será 5.
app.get('/jogos/:id', async (req, res) => {
    const { id } = req.params; // Pega o número que veio na URL
    try {
        // O $1 é substituído pelo 'id' de forma segura (evita hack de SQL Injection)
        const resultado = await pool.query('SELECT * FROM jogos WHERE id = $1', [id]);
        
        // Se a lista vier vazia, o jogo não existe
        if (resultado.rows.length === 0) {
            return res.status(404).json({ erro: 'Jogo não encontrado' });
        }
        
        // Devolve apenas o primeiro item (o jogo encontrado)
        res.json(resultado.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('Erro ao buscar jogo');
    }
});

// ==========================================================
// ROTA 3: LOGIN DO USUÁRIO
// ==========================================================
// POST: Significa "Estou enviando dados sensíveis/novos".
app.post('/login', async (req, res) => {
    const { email, senha } = req.body; // Pega o email e senha que o site enviou
    try {
        // Busca o usuário pelo e-mail
        const resultado = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        
        // Se encontrou alguém com esse e-mail...
        if (resultado.rows.length > 0) {
            const usuario = resultado.rows[0];
            
            // Compara a senha do banco com a senha enviada
            if (usuario.senha === senha) {
                // SUCESSO: Devolve os dados do usuário (menos a senha)
                res.json({
                    sucesso: true,
                    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email }
                });
            } else {
                // ERRO: Senha errada (401 = Não autorizado)
                res.status(401).json({ sucesso: false, mensagem: 'Senha incorreta!' });
            }
        } else {
            // ERRO: E-mail não existe (404 = Não encontrado)
            res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado!' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Erro no login');
    }
});

// ==========================================================
// ROTA 4: BIBLIOTECA (Lista o que o usuário comprou)
// ==========================================================
app.get('/biblioteca/:usuario_id', async (req, res) => {
    const { usuario_id } = req.params;
    try {
        // QUERY COMPLEXA (JOIN):
        // "Pegue os dados dos jogos, JUNTANDO com a tabela biblioteca...
        // ...ONDE o id do jogo bate com o id salvo na biblioteca...
        // ...PARA o usuário específico que pediu."
        const query = `
            SELECT jogos.*, biblioteca.data_compra 
            FROM jogos 
            JOIN biblioteca ON jogos.id = biblioteca.jogo_id 
            WHERE biblioteca.usuario_id = $1
            ORDER BY biblioteca.data_compra DESC
        `;
        const resultado = await pool.query(query, [usuario_id]);
        res.json(resultado.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Erro ao carregar biblioteca');
    }
});

// ==========================================================
// ROTA 5: COMPRAR JOGO (Transação inteligente)
// ==========================================================
app.post('/comprar', async (req, res) => {
    const { usuario_id, jogo_id } = req.body;
    try {
        // PASSO 1: Salva na tabela biblioteca
        await pool.query('INSERT INTO biblioteca (usuario_id, jogo_id) VALUES ($1, $2)', [usuario_id, jogo_id]);

        // PASSO 2: Remove da lista de desejos (se estiver lá) para limpar a lista
        await pool.query('DELETE FROM lista_desejos WHERE usuario_id = $1 AND jogo_id = $2', [usuario_id, jogo_id]);

        res.json({ sucesso: true, mensagem: 'Jogo comprado com sucesso e removido da lista de desejos!' });
    } catch (err) {
        // Código '23505' é o erro do Postgres para "Duplicidade"
        if (err.code === '23505') {
            res.status(400).json({ sucesso: false, mensagem: 'Você já possui este jogo!' });
        } else {
            console.error(err);
            res.status(500).send('Erro ao comprar jogo');
        }
    }
});

// ==========================================================
// ROTA 6: LISTA DE DESEJOS (Ver, Adicionar e Remover)
// ==========================================================

// 6a. Ver a lista (GET)
app.get('/desejos/:usuario_id', async (req, res) => {
    const { usuario_id } = req.params;
    try {
        // Mesmo esquema do JOIN da biblioteca, mas olhando a tabela lista_desejos
        const query = `
            SELECT jogos.* FROM jogos 
            JOIN lista_desejos ON jogos.id = lista_desejos.jogo_id 
            WHERE lista_desejos.usuario_id = $1
        `;
        const resultado = await pool.query(query, [usuario_id]);
        res.json(resultado.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Erro ao carregar lista de desejos');
    }
});

// 6b. Adicionar na lista (POST)
app.post('/desejos', async (req, res) => {
    const { usuario_id, jogo_id } = req.body;
    try {
        await pool.query('INSERT INTO lista_desejos (usuario_id, jogo_id) VALUES ($1, $2)', [usuario_id, jogo_id]);
        res.json({ sucesso: true, mensagem: 'Adicionado à Lista de Desejos!' });
    } catch (err) {
        // Se tentar adicionar o mesmo jogo 2x, dá erro de duplicidade
        if (err.code === '23505') {
            res.status(400).json({ sucesso: false, mensagem: 'Jogo já está na lista!' });
        } else {
            console.error(err);
            res.status(500).send('Erro ao adicionar aos desejos');
        }
    }
});

// 6c. Remover da lista manualmente - Botão Lixeira (DELETE)
app.delete('/desejos/:usuario_id/:jogo_id', async (req, res) => {
    const { usuario_id, jogo_id } = req.params; // Pega IDs da URL
    try {
        // Roda o comando SQL DELETE
        await pool.query('DELETE FROM lista_desejos WHERE usuario_id = $1 AND jogo_id = $2', [usuario_id, jogo_id]);
        res.json({ sucesso: true, mensagem: 'Removido da lista de desejos!' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Erro ao remover dos desejos');
    }
});

// ==========================================================
// ROTA 7: REDEFINIR SENHA
// ==========================================================
app.post('/redefinir-senha', async (req, res) => {
    const { email, novaSenha } = req.body;
    try {
        // Atualiza (UPDATE) a senha onde o email for igual
        const resultado = await pool.query(
            'UPDATE usuarios SET senha = $1 WHERE email = $2 RETURNING id',
            [novaSenha, email]
        );
        // Se rowCount > 0, significa que achou o email e mudou a senha
        if (resultado.rowCount > 0) {
            res.json({ sucesso: true, mensagem: 'Senha redefinida com sucesso!' });
        } else {
            res.status(404).json({ sucesso: false, mensagem: 'E-mail não encontrado.' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Erro ao redefinir senha');
    }
});

// ==========================================================
// ROTA 8: CADASTRO DE NOVO USUÁRIO
// ==========================================================
app.post('/cadastro', async (req, res) => {
    const { nome, email, senha } = req.body;
    try {
        // 1. Verifica se o e-mail já existe
        const usuarioExistente = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        
        if (usuarioExistente.rows.length > 0) {
            return res.status(400).json({ sucesso: false, mensagem: 'E-mail já cadastrado!' });
        }
        
        // 2. Se não existe, cria o novo usuário (INSERT)
        await pool.query('INSERT INTO usuarios (nome, email, senha) VALUES ($1, $2, $3)', [nome, email, senha]);
        
        res.json({ sucesso: true, mensagem: 'Conta criada com sucesso!' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Erro ao cadastrar');
    }
});

// ==========================================================
// LIGAR O SERVIDOR
// ==========================================================
// Fica esperando conexões na porta 3000.
app.listen(port, () => {
    console.log(`--- Games4Player SERVER ONLINE ---`);
    console.log(`Rodando em: http://localhost:${port}`);
});